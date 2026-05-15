import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';

initializeApp();

const db = getFirestore();
const auth = getAuth();
const DEFAULT_SHOP_ID = process.env.FIREBASE_SHOP_ID || 'main';
const REGION = process.env.FUNCTIONS_REGION || 'us-central1';

const COLLECTIONS = {
  users: 'users',
  shops: 'shops',
  items: 'items',
  transactions: 'transactions',
  persons: 'persons',
  vehicles: 'vehicles',
  expenses: 'expenses',
  suppliers: 'suppliers',
  purchases: 'purchases',
  soas: 'soas',
  soaPayments: 'soaPayments',
  loans: 'loans',
  loanPayments: 'loanPayments',
  notifications: 'notifications',
  activityLogs: 'activityLogs',
};

function shopIdFrom(data) {
  return String(data?.shopId || DEFAULT_SHOP_ID).trim() || DEFAULT_SHOP_ID;
}

function shopCollection(shopId, name) {
  return db.collection(COLLECTIONS.shops).doc(shopId).collection(name);
}

function requireAuth(request) {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Authentication required.');
  }
  return request.auth;
}

function requireRole(request, roles) {
  const authInfo = requireAuth(request);
  const role = String(authInfo.token.role || '');
  if (!roles.includes(role)) {
    throw new HttpsError('permission-denied', 'Insufficient permissions.');
  }
  return authInfo;
}

function actorInfo(request) {
  const authInfo = requireAuth(request);
  return {
    uid: authInfo.uid,
    email: authInfo.token.email ? String(authInfo.token.email) : '',
    displayName:
      (authInfo.token.displayName && String(authInfo.token.displayName)) ||
      (authInfo.token.name && String(authInfo.token.name)) ||
      (authInfo.token.email && String(authInfo.token.email)) ||
      'Admin',
    role: String(authInfo.token.role || 'admin'),
  };
}

function nowIso() {
  return new Date().toISOString();
}

function roundMoney(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

function receivableModesNeedLoan(mode) {
  const m = String(mode || '').trim();
  return m === 'Credit' || m === 'Cheque';
}

function receivableDueDateIso(body, timestamp, mode) {
  if (String(mode || '').trim() === 'Cheque') {
    const raw = String(body.chequeExpectedClearDate || '').trim();
    const d = new Date(raw.length === 10 ? `${raw}T12:00:00` : raw);
    if (Number.isNaN(d.getTime())) {
      throw new HttpsError('invalid-argument', 'Invalid cheque expected clearance date.');
    }
    return d.toISOString();
  }
  const dueDays = Math.min(365, Math.max(1, Number(body.dueDays || 30)));
  const dueDate = new Date(timestamp);
  dueDate.setDate(dueDate.getDate() + dueDays);
  return dueDate.toISOString();
}

async function addActivityLog(shopId, user, actionType, metadata = {}) {
  await shopCollection(shopId, COLLECTIONS.activityLogs).doc(crypto.randomUUID()).set({
    userId: user.uid,
    actionType,
    metadata: JSON.stringify(metadata),
    createdAt: nowIso(),
    userDisplayName: user.displayName,
    userEmail: user.email,
  });
}

async function addNotification(shopId, user, actionType, message) {
  await shopCollection(shopId, COLLECTIONS.notifications).doc(crypto.randomUUID()).set({
    sourceUserId: user.uid,
    actionType,
    message,
    read: 0,
    createdAt: nowIso(),
    sourceDisplayName: user.displayName,
    sourceEmail: user.email,
  });
}

function computeLoanStatus(loan) {
  if (loan.status === 'cash' || loan.status === 'paid') return loan.status;
  if ((loan.remainingBalance || 0) <= 0) return 'paid';
  const dueDate = loan.dueDate ? new Date(loan.dueDate) : null;
  if (dueDate && dueDate.getTime() < Date.now()) return 'overdue';
  return (loan.totalAmount || 0) === (loan.remainingBalance || 0) ? 'unpaid' : 'ongoing';
}

async function getLoanByTransaction(shopId, transactionId) {
  const snapshot = await shopCollection(shopId, COLLECTIONS.loans)
    .where('transactionId', '==', transactionId)
    .limit(1)
    .get();
  if (snapshot.empty) return null;
  const docSnap = snapshot.docs[0];
  return { id: docSnap.id, ...docSnap.data() };
}

async function getSoaByTransaction(shopId, transactionId) {
  const snapshot = await shopCollection(shopId, COLLECTIONS.soas)
    .where('transactionId', '==', transactionId)
    .limit(1)
    .get();
  if (snapshot.empty) return null;
  const docSnap = snapshot.docs[0];
  return { id: docSnap.id, ...docSnap.data() };
}

async function getSoaPayments(shopId, soaId) {
  const snapshot = await shopCollection(shopId, COLLECTIONS.soaPayments)
    .where('soaId', '==', soaId)
    .orderBy('paidAt', 'desc')
    .get();
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
}

async function getLoanPayments(shopId, loanId) {
  const snapshot = await shopCollection(shopId, COLLECTIONS.loanPayments)
    .where('loanId', '==', loanId)
    .orderBy('paidAt', 'desc')
    .get();
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
}

async function buildEnrichedSoa(shopId, soaId) {
  const soaSnap = await shopCollection(shopId, COLLECTIONS.soas).doc(soaId).get();
  if (!soaSnap.exists) throw new HttpsError('not-found', 'SOA not found.');

  const soa = { id: soaSnap.id, ...soaSnap.data() };
  const loan = await getLoanByTransaction(shopId, soa.transactionId);

  if (loan) {
    const loanPayments = await getLoanPayments(shopId, loan.id);
    const totalPaid = loanPayments.reduce((sum, item) => sum + Number(item.amountPaid || 0), 0);
    const remainingBalance = Number(loan.remainingBalance || 0);
    return {
      ...soa,
      billingTotal: soa.totalAmountDue || 0,
      paymentsMade: loanPayments,
      totalPaid,
      remainingBalance,
      status: computeLoanStatus(loan) === 'paid' ? 'Paid' : loan.status === 'overdue' ? 'Overdue' : totalPaid > 0 ? 'Partially Paid' : 'Unpaid',
      paymentSource: 'loan',
    };
  }

  const payments = await getSoaPayments(shopId, soa.id);
  const totalPaid = payments.reduce((sum, item) => sum + Number(item.amountPaid || 0), 0);
  const remainingBalance = Math.max(0, Number(soa.totalAmountDue || 0) - totalPaid);
  const status =
    remainingBalance <= 0
      ? 'Paid'
      : totalPaid > 0
        ? 'Partially Paid'
        : soa.dueDate && new Date(soa.dueDate).getTime() < Date.now()
          ? 'Overdue'
          : 'Unpaid';

  if (status !== soa.paymentStatus) {
    await shopCollection(shopId, COLLECTIONS.soas).doc(soa.id).set({ paymentStatus: status }, { merge: true });
  }

  return {
    ...soa,
    billingTotal: soa.totalAmountDue || 0,
    paymentsMade: payments,
    totalPaid,
    remainingBalance,
    status,
    paymentSource: 'soa',
  };
}

export const createUserAccount = onCall({ region: REGION }, async (request) => {
  const actor = requireRole(request, ['overseer']);
  const email = String(request.data?.email || '').trim().toLowerCase();
  const password = String(request.data?.password || '');
  const displayName = String(request.data?.displayName || '').trim();
  const role = request.data?.role === 'overseer' ? 'overseer' : 'admin';

  if (!email || !password || !displayName) {
    throw new HttpsError('invalid-argument', 'Email, password, and displayName are required.');
  }

  if (role === 'overseer') {
    const existingOverseer = await db.collection(COLLECTIONS.users).where('role', '==', 'overseer').limit(1).get();
    if (!existingOverseer.empty) {
      throw new HttpsError('failed-precondition', 'Only one overseer account is allowed.');
    }
  }

  const userRecord = await auth.createUser({ email, password, displayName });
  await auth.setCustomUserClaims(userRecord.uid, { role, displayName, email });
  await db.collection(COLLECTIONS.users).doc(userRecord.uid).set({
    email,
    displayName,
    role,
    createdAt: nowIso(),
  });

  return {
    user: {
      id: userRecord.uid,
      email,
      displayName,
      role,
    },
  };
});

export const deleteUserAccount = onCall({ region: REGION }, async (request) => {
  requireRole(request, ['overseer']);
  const uid = String(request.data?.uid || '').trim();
  if (!uid) throw new HttpsError('invalid-argument', 'uid is required.');

  const userSnap = await db.collection(COLLECTIONS.users).doc(uid).get();
  if (!userSnap.exists) throw new HttpsError('not-found', 'User not found.');
  if ((userSnap.data()?.role || '') === 'overseer') {
    throw new HttpsError('failed-precondition', 'The overseer account cannot be deleted.');
  }

  await auth.deleteUser(uid);
  await db.collection(COLLECTIONS.users).doc(uid).delete();
  return { ok: true };
});

export const updateUserAccount = onCall({ region: REGION }, async (request) => {
  requireRole(request, ['overseer']);
  const uid = String(request.data?.uid || '').trim();
  if (!uid) throw new HttpsError('invalid-argument', 'uid is required.');

  const hasDisplay = request.data?.displayName !== undefined;
  const hasPassword = request.data?.password !== undefined;
  if (!hasDisplay && !hasPassword) {
    throw new HttpsError('invalid-argument', 'Provide displayName and/or password.');
  }

  const userSnap = await db.collection(COLLECTIONS.users).doc(uid).get();
  if (!userSnap.exists) throw new HttpsError('not-found', 'User not found.');
  const row = userSnap.data() || {};
  const role = String(row.role || 'admin');

  if (hasPassword) {
    if (role === 'overseer') {
      throw new HttpsError(
        'failed-precondition',
        'Reset the overseer password from that account using Change password in the sidebar.',
      );
    }
    const password = String(request.data.password || '');
    if (password.length < 8) {
      throw new HttpsError('invalid-argument', 'Password must be at least 8 characters.');
    }
    await auth.updateUser(uid, { password });
    await auth.revokeRefreshTokens(uid);
  }

  if (hasDisplay) {
    const displayName = String(request.data.displayName || '').trim();
    if (!displayName) {
      throw new HttpsError('invalid-argument', 'Display name cannot be empty.');
    }
    await auth.updateUser(uid, { displayName });
    await db.collection(COLLECTIONS.users).doc(uid).set({ displayName }, { merge: true });
  }

  const record = await auth.getUser(uid);
  const displayNameForClaims = hasDisplay
    ? String(request.data.displayName || '').trim()
    : String(row.displayName || record.displayName || '');
  await auth.setCustomUserClaims(uid, {
    ...(record.customClaims || {}),
    role: role === 'overseer' ? 'overseer' : 'admin',
    email: record.email || String(row.email || ''),
    displayName: displayNameForClaims,
  });

  const refreshed = await db.collection(COLLECTIONS.users).doc(uid).get();
  const d = refreshed.data() || {};
  return {
    user: {
      id: uid,
      email: String(d.email || record.email || ''),
      displayName: String(d.displayName || record.displayName || ''),
      role: role === 'overseer' ? 'overseer' : 'admin',
      createdAt: d.createdAt,
    },
  };
});

export const deletePerson = onCall({ region: REGION }, async (request) => {
  requireRole(request, ['admin', 'overseer']);
  const shopId = shopIdFrom(request.data);
  const personId = String(request.data?.personId || '').trim();
  if (!personId) throw new HttpsError('invalid-argument', 'personId is required.');

  const loanQuery = await shopCollection(shopId, COLLECTIONS.loans).where('personId', '==', personId).get();
  const hasActive = loanQuery.docs.some((item) => {
    const loan = { id: item.id, ...item.data() };
    return ['unpaid', 'ongoing', 'overdue'].includes(computeLoanStatus(loan));
  });
  if (hasActive) {
    throw new HttpsError('failed-precondition', 'This person has active receivable records.');
  }

  await shopCollection(shopId, COLLECTIONS.persons).doc(personId).delete();
  return { ok: true };
});

export const deleteVehicle = onCall({ region: REGION }, async (request) => {
  requireRole(request, ['admin', 'overseer']);
  const shopId = shopIdFrom(request.data);
  const vehicleId = String(request.data?.vehicleId || '').trim();
  if (!vehicleId) throw new HttpsError('invalid-argument', 'vehicleId is required.');

  const txQuery = await shopCollection(shopId, COLLECTIONS.transactions).where('vehicleId', '==', vehicleId).limit(1).get();
  if (!txQuery.empty) {
    throw new HttpsError('failed-precondition', 'Vehicle may be linked to a transaction.');
  }

  await shopCollection(shopId, COLLECTIONS.vehicles).doc(vehicleId).delete();
  return { ok: true };
});

export const deleteSupplier = onCall({ region: REGION }, async (request) => {
  requireRole(request, ['admin', 'overseer']);
  const shopId = shopIdFrom(request.data);
  const supplierId = String(request.data?.supplierId || '').trim();
  if (!supplierId) throw new HttpsError('invalid-argument', 'supplierId is required.');

  const purchaseQuery = await shopCollection(shopId, COLLECTIONS.purchases).where('supplierId', '==', supplierId).limit(1).get();
  if (!purchaseQuery.empty) {
    throw new HttpsError('failed-precondition', 'Supplier cannot be removed because it has linked purchases.');
  }

  await shopCollection(shopId, COLLECTIONS.suppliers).doc(supplierId).delete();
  return { ok: true };
});

export const createTransaction = onCall({ region: REGION }, async (request) => {
  const actor = actorInfo(request);
  if (!['admin', 'overseer'].includes(actor.role)) {
    throw new HttpsError('permission-denied', 'Admin access required.');
  }

  const shopId = shopIdFrom(request.data);
  const body = request.data || {};
  const id = String(body.id || crypto.randomUUID()).trim();
  const type = String(body.type || '').trim();
  const validTypes = ['RELEASE', 'ISSUE', 'RETURN', 'ADDITION', 'ADJUSTMENT'];
  if (!validTypes.includes(type)) {
    throw new HttpsError('invalid-argument', `type must be one of: ${validTypes.join(', ')}`);
  }

  const itemType = body.itemType === 'Service' ? 'Service' : 'Product';
  const itemId = body.itemId ? String(body.itemId).trim() : null;
  const requestedQty = Math.abs(Number(body.quantityChange || 0));
  const timestamp = body.timestamp ? String(body.timestamp) : nowIso();
  const modeOfPayment = body.modeOfPayment ? String(body.modeOfPayment).trim() : null;
  const modeOfPaymentOther = body.modeOfPaymentOther ? String(body.modeOfPaymentOther).trim() : null;
  const personId = body.personId ? String(body.personId).trim() : null;
  const vehicleId = body.vehicleId ? String(body.vehicleId).trim() : null;

  if (type === 'RELEASE' && modeOfPayment === 'Cheque') {
    const raw = String(body.chequeExpectedClearDate || '').trim();
    if (!raw) {
      throw new HttpsError('invalid-argument', 'Expected cheque clearance date is required for Cheque sales.');
    }
    receivableDueDateIso(body, timestamp, 'Cheque');
  }

  const payload = await db.runTransaction(async (trx) => {
    if (type === 'RELEASE' && Array.isArray(body.posLineItems) && body.posLineItems.length > 0) {
      if (!personId) throw new HttpsError('invalid-argument', 'Please select a Person (Customer) for this sale/release.');
      const personSnap = await trx.get(shopCollection(shopId, COLLECTIONS.persons).doc(personId));
      if (!personSnap.exists) throw new HttpsError('not-found', 'Selected person not found.');
      const person = { id: personSnap.id, ...personSnap.data() };
      if (vehicleId) {
        const vehicleSnap = await trx.get(shopCollection(shopId, COLLECTIONS.vehicles).doc(vehicleId));
        if (!vehicleSnap.exists || (vehicleSnap.data()?.personId || '') !== personId) {
          throw new HttpsError('invalid-argument', 'Selected vehicle does not belong to the selected person.');
        }
      }

      const parsed = [];
      for (let idx = 0; idx < body.posLineItems.length; idx++) {
        const row = body.posLineItems[idx];
        const lt = row.itemType === 'Service' ? 'Service' : 'Product';
        const q = Math.floor(Math.abs(Number(row.quantity ?? 0)));
        if (!q || q < 1) {
          throw new HttpsError('invalid-argument', `Line ${idx + 1}: quantity must be at least 1.`);
        }
        const lineName = String(row.itemName || '').trim();
        if (!lineName) {
          throw new HttpsError('invalid-argument', `Line ${idx + 1}: item name is required.`);
        }
        const unitPrice = roundMoney(Number(row.unitPrice ?? row.unitPriceAtTime ?? 0));
        if (!Number.isFinite(unitPrice) || unitPrice < 0) {
          throw new HttpsError('invalid-argument', `Line ${idx + 1}: invalid unit price.`);
        }
        let lineSubtotal = roundMoney(Number(row.lineSubtotal ?? q * unitPrice));
        if (Math.abs(lineSubtotal - roundMoney(q * unitPrice)) > 0.05) {
          lineSubtotal = roundMoney(q * unitPrice);
        }
        const dpuRaw = row.discountPerUnit ?? row.discount_per_unit;
        const dpu = roundMoney(Math.max(0, Number(dpuRaw ?? 0)));
        if (!Number.isFinite(dpu) || dpu < 0) {
          throw new HttpsError('invalid-argument', `Line ${idx + 1}: invalid discount per unit.`);
        }
        if (dpu > unitPrice + 0.01) {
          throw new HttpsError(
            'invalid-argument',
            `Line ${idx + 1}: discount per unit cannot exceed unit price.`
          );
        }
        if (lt === 'Product') {
          const pid = String(row.itemId || '').trim();
          if (!pid) throw new HttpsError('invalid-argument', `Line ${idx + 1}: itemId is required for products.`);
          const itemRef = shopCollection(shopId, COLLECTIONS.items).doc(pid);
          const itemSnap = await trx.get(itemRef);
          if (!itemSnap.exists) throw new HttpsError('not-found', `Line ${idx + 1}: item not found.`);
          const inv = { id: itemSnap.id, ...itemSnap.data() };
          parsed.push({
            itemType: 'Product',
            itemId: pid,
            itemName: lineName,
            quantity: q,
            unitPrice,
            lineSubtotal,
            discountPerUnit: dpu,
            inv,
            itemRef,
          });
        } else {
          parsed.push({
            itemType: 'Service',
            itemId: null,
            itemName: lineName,
            quantity: q,
            unitPrice,
            lineSubtotal,
            discountPerUnit: dpu,
            inv: null,
            itemRef: null,
          });
        }
      }

      const byProductId = new Map();
      for (const l of parsed) {
        if (l.itemType !== 'Product') continue;
        byProductId.set(l.itemId, (byProductId.get(l.itemId) || 0) + l.quantity);
      }
      for (const [pid, needQty] of byProductId) {
        const line0 = parsed.find((x) => x.itemType === 'Product' && x.itemId === pid);
        const available = Number(line0?.inv?.quantity || 0);
        if (needQty > available) {
          throw new HttpsError(
            'failed-precondition',
            `Insufficient stock for ${line0?.itemName || pid}. Need ${needQty}, available ${available}.`
          );
        }
      }

      const subtotal = roundMoney(parsed.reduce((s, l) => s + l.lineSubtotal, 0));
      const lineLevelDiscount = roundMoney(
        parsed.reduce((s, l) => s + roundMoney(l.quantity * (l.discountPerUnit || 0)), 0)
      );
      let discountPercent = null;
      let discountAmountStored = null;
      let discountValue = 0;
      const pctRaw = body.discountPercent;
      const amtRaw = body.discountAmount;
      if (lineLevelDiscount > 0.005) {
        discountValue = lineLevelDiscount;
        discountAmountStored = lineLevelDiscount;
        discountPercent = null;
        if (pctRaw != null && pctRaw !== '' && Number(pctRaw) > 0) {
          throw new HttpsError(
            'invalid-argument',
            'Per-line unit discounts cannot be combined with a transaction-level percent discount.'
          );
        }
        if (amtRaw != null && amtRaw !== '' && Number(amtRaw) > 0) {
          const clientAmt = roundMoney(Number(amtRaw));
          if (Math.abs(clientAmt - lineLevelDiscount) > 0.06) {
            throw new HttpsError(
              'invalid-argument',
              `discountAmount must equal sum of per-line discounts (expected ₱${lineLevelDiscount}).`
            );
          }
        }
      } else if (pctRaw != null && pctRaw !== '' && Number(pctRaw) > 0) {
        discountPercent = Math.min(100, Math.max(0, Number(pctRaw)));
        discountValue = roundMoney(subtotal * (discountPercent / 100));
        discountAmountStored = discountValue;
      } else if (amtRaw != null && amtRaw !== '' && Number(amtRaw) > 0) {
        discountValue = roundMoney(Math.min(subtotal, Number(amtRaw)));
        discountAmountStored = discountValue;
      }
      const totalValueClient = roundMoney(Number(body.totalValue || 0));
      const expectedTotal = roundMoney(subtotal - discountValue);
      if (Math.abs(expectedTotal - totalValueClient) > 0.06) {
        throw new HttpsError(
          'invalid-argument',
          `Total must equal subtotal minus discount. Expected ₱${expectedTotal}, got ₱${totalValueClient}.`
        );
      }
      if (totalValueClient <= 0) {
        throw new HttpsError('invalid-argument', 'Sale total must be greater than zero.');
      }

      let totalCost = 0;
      const posLineItems = parsed.map((l) => {
        const dpuOut = l.discountPerUnit > 0 ? roundMoney(l.discountPerUnit) : null;
        if (l.itemType === 'Product' && l.inv) {
          const cpu = roundMoney(Number(l.inv.capitalPrice ?? l.inv.unitPrice ?? 0));
          totalCost = roundMoney(totalCost + l.quantity * cpu);
          return {
            itemId: l.itemId,
            itemName: l.itemName,
            itemType: 'Product',
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            lineSubtotal: l.lineSubtotal,
            discountPerUnit: dpuOut,
            costPerUnit: cpu,
          };
        }
        return {
          itemId: null,
          itemName: l.itemName,
          itemType: 'Service',
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          lineSubtotal: l.lineSubtotal,
          discountPerUnit: dpuOut,
          costPerUnit: null,
        };
      });

      const netIncome = roundMoney(totalValueClient - totalCost);
      const totalUnits = parsed.reduce((s, l) => s + l.quantity, 0);
      const blendedUnitPrice = totalUnits > 0 ? roundMoney(totalValueClient / totalUnits) : 0;
      const blendedSrp = totalUnits > 0 ? roundMoney(subtotal / totalUnits) : 0;
      const multiLine = parsed.length > 1;
      const singleProductOnly = parsed.length === 1 && parsed[0].itemType === 'Product';
      const itemIdOut = singleProductOnly ? parsed[0].itemId : null;
      const itemTypeOut = parsed.some((l) => l.itemType === 'Product') ? 'Product' : 'Service';
      const quantityChangeOut = -totalUnits;
      const itemNameSummary = parsed
        .map((l) => `${l.quantity}× ${l.itemName}`)
        .join(', ')
        .slice(0, 500);

      const transaction = {
        id,
        itemId: itemIdOut,
        itemName: itemNameSummary,
        type,
        quantityChange: quantityChangeOut,
        unitPriceAtTime: blendedUnitPrice,
        totalValue: totalValueClient,
        timestamp,
        recipient: person?.fullName || String(body.recipient || '').trim(),
        note: body.note ? String(body.note).trim() : null,
        receiptNumber: body.receiptNumber ? String(body.receiptNumber).trim() : null,
        releaseTransactionId: body.releaseTransactionId ? String(body.releaseTransactionId).trim() : null,
        returnReason: null,
        returnReasonOthers: null,
        returnReasonText: null,
        condition: null,
        modeOfPayment,
        modeOfPaymentOther: modeOfPayment === 'Others' ? modeOfPaymentOther : null,
        personId,
        vehicleId,
        discountPercent,
        discountAmount: discountAmountStored,
        taxPercent: body.taxPercent ?? null,
        taxAmount: body.taxAmount ?? null,
        itemType: itemTypeOut,
        releasedBy: actor.displayName,
        returnProcessedBy: null,
        sellingPriceAtTime: null,
        purchaseId: null,
        invoiceNumber: body.invoiceNumber ? String(body.invoiceNumber).trim() : null,
        dueDate: body.dueDate ? String(body.dueDate).trim() : null,
        terms: body.terms ? String(body.terms).trim() : null,
        posLineItems,
        subtotalBeforeDiscount: subtotal,
        netIncome,
        totalCostAtTime: totalCost,
        bundledSale: multiLine,
        chequeExpectedClearDate:
          modeOfPayment === 'Cheque' ? String(body.chequeExpectedClearDate || '').trim() || null : null,
        chequeReference:
          modeOfPayment === 'Cheque' && body.chequeReference ? String(body.chequeReference).trim() : null,
        chequeStatus: modeOfPayment === 'Cheque' ? 'pending' : null,
        chequeClearedAt: null,
      };

      trx.set(shopCollection(shopId, COLLECTIONS.transactions).doc(id), transaction);

      const now = nowIso();
      for (const [pid, needQty] of byProductId) {
        const line0 = parsed.find((x) => x.itemType === 'Product' && x.itemId === pid);
        const itemRef = shopCollection(shopId, COLLECTIONS.items).doc(pid);
        const nextQty = Math.max(0, Number(line0.inv.quantity || 0) - needQty);
        trx.set(itemRef, { quantity: nextQty, lastUpdated: now }, { merge: true });
      }

      if (receivableModesNeedLoan(transaction.modeOfPayment) && transaction.recipient) {
        const dueDateStr = receivableDueDateIso(body, timestamp, transaction.modeOfPayment);
        const vehiclePlateNumber = vehicleId
          ? String((await trx.get(shopCollection(shopId, COLLECTIONS.vehicles).doc(vehicleId))).data()?.plateNumber || '')
          : null;
        const soaId = crypto.randomUUID();
        trx.set(shopCollection(shopId, COLLECTIONS.soas).doc(soaId), {
          id: soaId,
          transactionId: transaction.id,
          customerName: transaction.recipient,
          itemId: transaction.itemId,
          itemName: transaction.itemName,
          quantity: totalUnits,
          srp: blendedSrp,
          discountPercent: transaction.discountPercent,
          discountAmount: transaction.discountAmount,
          taxPercent: transaction.taxPercent,
          taxAmount: transaction.taxAmount,
          totalAmountDue: transaction.totalValue,
          transactionDate: timestamp,
          dueDate: dueDateStr,
          paymentStatus: 'Unpaid',
          createdAt: nowIso(),
          personId: transaction.personId,
          vehicleId: transaction.vehicleId,
          vehiclePlateNumber,
          itemType: itemTypeOut,
        });

        const downPayment = Math.max(0, Math.min(transaction.totalValue, Number(body.downPayment || 0)));
        const loanId = crypto.randomUUID();
        const interestForLoan = transaction.modeOfPayment === 'Cheque' ? null : body.interestRate != null ? Number(body.interestRate) : null;
        trx.set(shopCollection(shopId, COLLECTIONS.loans).doc(loanId), {
          id: loanId,
          transactionId: transaction.id,
          customerName: transaction.recipient,
          totalAmount: transaction.totalValue,
          downPayment,
          remainingBalance: Math.max(0, transaction.totalValue - downPayment),
          interestRate: interestForLoan,
          startDate: timestamp,
          dueDate: dueDateStr,
          paymentSchedule: ['weekly', 'monthly'].includes(String(body.paymentSchedule || '').toLowerCase())
            ? String(body.paymentSchedule).toLowerCase()
            : 'monthly',
          status: Math.max(0, transaction.totalValue - downPayment) <= 0 ? 'paid' : 'unpaid',
          createdAt: nowIso(),
          updatedAt: nowIso(),
          personId: transaction.personId,
          vehicleId: transaction.vehicleId,
          vehiclePlateNumber,
        });
      }

      if (transaction.modeOfPayment === 'Purchase Order' && transaction.recipient) {
        const soaId = crypto.randomUUID();
        const vehiclePlateNumber = vehicleId
          ? String((await trx.get(shopCollection(shopId, COLLECTIONS.vehicles).doc(vehicleId))).data()?.plateNumber || '')
          : null;
        trx.set(shopCollection(shopId, COLLECTIONS.soas).doc(soaId), {
          id: soaId,
          transactionId: transaction.id,
          customerName: transaction.recipient,
          itemId: transaction.itemId,
          itemName: transaction.itemName,
          quantity: totalUnits,
          srp: blendedSrp,
          discountPercent: transaction.discountPercent,
          discountAmount: transaction.discountAmount,
          taxPercent: transaction.taxPercent,
          taxAmount: transaction.taxAmount,
          totalAmountDue: transaction.totalValue,
          transactionDate: timestamp,
          dueDate: transaction.dueDate || nowIso(),
          paymentStatus: 'Unpaid',
          createdAt: nowIso(),
          personId: transaction.personId,
          vehicleId: transaction.vehicleId,
          vehiclePlateNumber,
          itemType: itemTypeOut,
        });
      }

      return transaction;
    }

    let item = null;
    if (itemType === 'Product') {
      if (!itemId) throw new HttpsError('invalid-argument', 'itemId is required for product transactions.');
      const itemRef = shopCollection(shopId, COLLECTIONS.items).doc(itemId);
      const itemSnap = await trx.get(itemRef);
      if (!itemSnap.exists) throw new HttpsError('not-found', 'Item not found.');
      item = { id: itemSnap.id, ...itemSnap.data() };
    }

    let person = null;
    if (type === 'RELEASE') {
      if (!personId) throw new HttpsError('invalid-argument', 'Please select a Person (Customer) for this sale/release.');
      const personSnap = await trx.get(shopCollection(shopId, COLLECTIONS.persons).doc(personId));
      if (!personSnap.exists) throw new HttpsError('not-found', 'Selected person not found.');
      person = { id: personSnap.id, ...personSnap.data() };
      if (vehicleId) {
        const vehicleSnap = await trx.get(shopCollection(shopId, COLLECTIONS.vehicles).doc(vehicleId));
        if (!vehicleSnap.exists || (vehicleSnap.data()?.personId || '') !== personId) {
          throw new HttpsError('invalid-argument', 'Selected vehicle does not belong to the selected person.');
        }
      }
    }

    if ((type === 'RELEASE' || type === 'ISSUE') && itemType === 'Product') {
      const available = Number(item.quantity || 0);
      if (requestedQty <= 0) throw new HttpsError('invalid-argument', 'Quantity must be greater than zero.');
      if (requestedQty > available) {
        throw new HttpsError('failed-precondition', `Insufficient stock. Available: ${available}, requested: ${requestedQty}.`);
      }
    }

    if (type === 'ISSUE' && !String(body.recipient || '').trim()) {
      throw new HttpsError('invalid-argument', 'Recipient is required for issue transactions.');
    }

    const transaction = {
      id,
      itemId: itemType === 'Service' ? null : itemId,
      itemName: String(body.itemName || '').trim(),
      type,
      quantityChange: Number(body.quantityChange || 0),
      unitPriceAtTime: Number(body.unitPriceAtTime || 0),
      totalValue: Number(body.totalValue || 0),
      timestamp,
      recipient: type === 'RELEASE' ? (person?.fullName || String(body.recipient || '').trim()) : String(body.recipient || '').trim() || null,
      note: body.note ? String(body.note).trim() : null,
      receiptNumber: body.receiptNumber ? String(body.receiptNumber).trim() : null,
      releaseTransactionId: body.releaseTransactionId ? String(body.releaseTransactionId).trim() : null,
      returnReason: body.returnReason || null,
      returnReasonOthers: body.returnReasonOthers || null,
      returnReasonText: body.returnReasonText || null,
      condition: body.condition || null,
      modeOfPayment: type === 'RELEASE' ? modeOfPayment : null,
      modeOfPaymentOther: type === 'RELEASE' && modeOfPayment === 'Others' ? modeOfPaymentOther : null,
      personId: type === 'RELEASE' ? personId : null,
      vehicleId: type === 'RELEASE' ? vehicleId : null,
      discountPercent: body.discountPercent ?? null,
      discountAmount: body.discountAmount ?? null,
      taxPercent: body.taxPercent ?? null,
      taxAmount: body.taxAmount ?? null,
      itemType,
      releasedBy: type === 'RELEASE' ? actor.displayName : null,
      returnProcessedBy: null,
      sellingPriceAtTime: body.sellingPriceAtTime != null ? Number(body.sellingPriceAtTime) : null,
      purchaseId: body.purchaseId || null,
      invoiceNumber: body.invoiceNumber ? String(body.invoiceNumber).trim() : null,
      dueDate: body.dueDate ? String(body.dueDate).trim() : null,
      terms: body.terms ? String(body.terms).trim() : null,
      chequeExpectedClearDate:
        type === 'RELEASE' && modeOfPayment === 'Cheque'
          ? String(body.chequeExpectedClearDate || '').trim() || null
          : null,
      chequeReference:
        type === 'RELEASE' && modeOfPayment === 'Cheque' && body.chequeReference
          ? String(body.chequeReference).trim()
          : null,
      chequeStatus: type === 'RELEASE' && modeOfPayment === 'Cheque' ? 'pending' : null,
      chequeClearedAt: null,
    };

    trx.set(shopCollection(shopId, COLLECTIONS.transactions).doc(id), transaction);

    if (itemType === 'Product' && itemId && item) {
      const itemRef = shopCollection(shopId, COLLECTIONS.items).doc(itemId);
      const now = nowIso();
      if (type === 'RELEASE' || type === 'ISSUE') {
        trx.set(itemRef, { quantity: Math.max(0, Number(item.quantity || 0) - requestedQty), lastUpdated: now }, { merge: true });
      } else if (type === 'RETURN') {
        trx.set(itemRef, { quantity: Number(item.quantity || 0) + requestedQty, lastUpdated: now }, { merge: true });
      } else if (type === 'ADDITION') {
        const currentQty = Number(item.quantity || 0);
        const addQty = requestedQty;
        const cost = Number(body.unitPriceAtTime || 0);
        const sellInput = body.sellingPriceAtTime ?? body.sellingPriceAtTime;
        const sell =
          sellInput != null && sellInput !== '' && Number.isFinite(Number(sellInput))
            ? Number(sellInput)
            : Number(item.unitPrice || 0);
        const newQty = currentQty + addQty;
        const oldCap = Number(item.capitalPrice ?? item.unitPrice ?? 0);
        const oldSell = Number(item.unitPrice || 0);
        const newCap = newQty > 0 ? (currentQty * oldCap + addQty * cost) / newQty : cost;
        const newSell =
          sellInput != null && sellInput !== '' && Number.isFinite(Number(sellInput))
            ? (currentQty * oldSell + addQty * sell) / newQty
            : oldSell;
        trx.set(
          itemRef,
          {
            quantity: newQty,
            unitPrice: newSell,
            capitalPrice: newCap,
            lastUpdated: now,
            receiptNumber: transaction.receiptNumber || item.receiptNumber || null,
          },
          { merge: true }
        );
      }
    }

    if (type === 'RELEASE' && receivableModesNeedLoan(transaction.modeOfPayment) && transaction.recipient) {
      const dueDateStr = receivableDueDateIso(body, timestamp, transaction.modeOfPayment);
      const vehiclePlateNumber = vehicleId
        ? String((await trx.get(shopCollection(shopId, COLLECTIONS.vehicles).doc(vehicleId))).data()?.plateNumber || '')
        : null;
      const soaId = crypto.randomUUID();
      trx.set(shopCollection(shopId, COLLECTIONS.soas).doc(soaId), {
        id: soaId,
        transactionId: transaction.id,
        customerName: transaction.recipient,
        itemId: transaction.itemId,
        itemName: transaction.itemName,
        quantity: requestedQty,
        srp: transaction.unitPriceAtTime,
        discountPercent: transaction.discountPercent,
        discountAmount: transaction.discountAmount,
        taxPercent: transaction.taxPercent,
        taxAmount: transaction.taxAmount,
        totalAmountDue: transaction.totalValue,
        transactionDate: timestamp,
        dueDate: dueDateStr,
        paymentStatus: 'Unpaid',
        createdAt: nowIso(),
        personId: transaction.personId,
        vehicleId: transaction.vehicleId,
        vehiclePlateNumber,
        itemType,
      });

      const downPayment = Math.max(0, Math.min(transaction.totalValue, Number(body.downPayment || 0)));
      const loanId = crypto.randomUUID();
      const interestForLoan =
        transaction.modeOfPayment === 'Cheque' ? null : body.interestRate != null ? Number(body.interestRate) : null;
      trx.set(shopCollection(shopId, COLLECTIONS.loans).doc(loanId), {
        id: loanId,
        transactionId: transaction.id,
        customerName: transaction.recipient,
        totalAmount: transaction.totalValue,
        downPayment,
        remainingBalance: Math.max(0, transaction.totalValue - downPayment),
        interestRate: interestForLoan,
        startDate: timestamp,
        dueDate: dueDateStr,
        paymentSchedule: ['weekly', 'monthly'].includes(String(body.paymentSchedule || '').toLowerCase())
          ? String(body.paymentSchedule).toLowerCase()
          : 'monthly',
        status: Math.max(0, transaction.totalValue - downPayment) <= 0 ? 'paid' : 'unpaid',
        createdAt: nowIso(),
        updatedAt: nowIso(),
        personId: transaction.personId,
        vehicleId: transaction.vehicleId,
        vehiclePlateNumber,
      });
    }

    if (type === 'RELEASE' && transaction.modeOfPayment === 'Purchase Order' && transaction.recipient) {
      const soaId = crypto.randomUUID();
      const vehiclePlateNumber = vehicleId
        ? String((await trx.get(shopCollection(shopId, COLLECTIONS.vehicles).doc(vehicleId))).data()?.plateNumber || '')
        : null;
      trx.set(shopCollection(shopId, COLLECTIONS.soas).doc(soaId), {
        id: soaId,
        transactionId: transaction.id,
        customerName: transaction.recipient,
        itemId: transaction.itemId,
        itemName: transaction.itemName,
        quantity: requestedQty,
        srp: transaction.unitPriceAtTime,
        discountPercent: transaction.discountPercent,
        discountAmount: transaction.discountAmount,
        taxPercent: transaction.taxPercent,
        taxAmount: transaction.taxAmount,
        totalAmountDue: transaction.totalValue,
        transactionDate: timestamp,
        dueDate: transaction.dueDate || nowIso(),
        paymentStatus: 'Unpaid',
        createdAt: nowIso(),
        personId: transaction.personId,
        vehicleId: transaction.vehicleId,
        vehiclePlateNumber,
        itemType,
      });
    }

    return transaction;
  });

  if (payload.type === 'RELEASE') {
    const releaseQty =
      Array.isArray(payload.posLineItems) && payload.posLineItems.length > 0
        ? payload.posLineItems.reduce((s, l) => s + Number(l.quantity || 0), 0)
        : Math.abs(Number(payload.quantityChange || 0));
    await addActivityLog(shopId, actor, 'RELEASE', {
      itemId: payload.itemId,
      itemName: payload.itemName,
      quantity: releaseQty,
      recipient: payload.recipient,
    });
    await addNotification(
      shopId,
      actor,
      'RELEASE',
      `${actor.displayName} created sale/release: ${payload.itemName}, qty ${releaseQty} to ${payload.recipient || '—'}`
    );
    if (payload.modeOfPayment === 'Cheque') {
      const when = String(payload.chequeExpectedClearDate || '').slice(0, 10);
      await addNotification(
        shopId,
        actor,
        'CHEQUE_PENDING',
        `Cheque pending clearance${when ? ` (expected ${when})` : ''}: ${payload.recipient || 'customer'} — ₱${Number(
          payload.totalValue || 0
        ).toFixed(2)}`
      );
    }
  }
  if (payload.type === 'ISSUE') {
    await addActivityLog(shopId, actor, 'ISSUE', {
      itemId: payload.itemId,
      itemName: payload.itemName,
      quantity: requestedQty,
      recipient: payload.recipient,
    });
  }
  if (payload.type === 'RETURN') {
    await addActivityLog(shopId, actor, 'RETURN', {
      itemId: payload.itemId,
      itemName: payload.itemName,
      quantity: requestedQty,
    });
  }
  if (payload.type === 'ADDITION') {
    await addActivityLog(shopId, actor, 'ADD_STOCK', {
      itemId: payload.itemId,
      itemName: payload.itemName,
      quantity: requestedQty,
    });
  }

  return payload;
});

export const returnFromSales = onCall({ region: REGION }, async (request) => {
  const actor = actorInfo(request);
  const shopId = shopIdFrom(request.data);
  const releaseTransactionId = String(request.data?.releaseTransactionId || '').trim();
  const returnQuantity = Math.floor(Number(request.data?.returnQuantity || 0));
  const reason = String(request.data?.reason || '').trim();
  const reasonOthers = request.data?.reasonOthers ? String(request.data.reasonOthers).trim() : null;
  const condition = String(request.data?.condition || '').trim();
  const returnReasonText = String(request.data?.returnReasonText || '').trim();

  if (!releaseTransactionId || !returnQuantity || !returnReasonText) {
    throw new HttpsError('invalid-argument', 'releaseTransactionId, returnQuantity, and returnReasonText are required.');
  }

  const result = await db.runTransaction(async (trx) => {
    const releaseRef = shopCollection(shopId, COLLECTIONS.transactions).doc(releaseTransactionId);
    const releaseSnap = await trx.get(releaseRef);
    if (!releaseSnap.exists) throw new HttpsError('not-found', 'Release transaction not found.');
    const release = { id: releaseSnap.id, ...releaseSnap.data() };
    if (release.type !== 'RELEASE') throw new HttpsError('failed-precondition', 'Transaction is not a release.');
    if (release.itemType === 'Service' || !release.itemId) {
      throw new HttpsError('failed-precondition', 'Only Product releases can be returned.');
    }

    const existingReturns = await shopCollection(shopId, COLLECTIONS.transactions)
      .where('releaseTransactionId', '==', releaseTransactionId)
      .where('type', '==', 'RETURN_FROM_SALES')
      .get();
    const alreadyReturned = existingReturns.docs.reduce((sum, item) => sum + Math.abs(Number(item.data().quantityChange || 0)), 0);
    const releasedQty = Math.abs(Number(release.quantityChange || 0));
    const maxReturn = releasedQty - alreadyReturned;
    if (returnQuantity > maxReturn) {
      throw new HttpsError('failed-precondition', `Return quantity cannot exceed ${maxReturn}.`);
    }

    const itemRef = shopCollection(shopId, COLLECTIONS.items).doc(String(release.itemId));
    const itemSnap = await trx.get(itemRef);
    const item = itemSnap.exists ? { id: itemSnap.id, ...itemSnap.data() } : null;
    const now = nowIso();
    if (condition === 'restock') {
      trx.set(itemRef, { quantity: Number(item?.quantity || 0) + returnQuantity, lastUpdated: now }, { merge: true });
    } else {
      trx.set(
        itemRef,
        {
          defectiveQuantity: Number(item?.defectiveQuantity || 0) + returnQuantity,
          lastUpdated: now,
        },
        { merge: true }
      );
    }

    const returnTx = {
      id: crypto.randomUUID(),
      itemId: release.itemId,
      itemName: release.itemName,
      type: 'RETURN_FROM_SALES',
      quantityChange: returnQuantity,
      unitPriceAtTime: Number(release.unitPriceAtTime || 0),
      totalValue: Number(release.unitPriceAtTime || 0) * returnQuantity,
      timestamp: now,
      recipient: release.recipient || null,
      note: returnReasonText,
      releaseTransactionId,
      returnReason: reason,
      returnReasonOthers: reason === 'others' ? reasonOthers : null,
      returnReasonText,
      condition,
      personId: release.personId || null,
      returnProcessedBy: actor.displayName,
      itemType: 'Product',
    };
    trx.set(shopCollection(shopId, COLLECTIONS.transactions).doc(returnTx.id), returnTx);
    return returnTx;
  });

  await addActivityLog(shopId, actor, 'RETURN_FROM_SALES', {
    itemId: result.itemId,
    itemName: result.itemName,
    quantity: returnQuantity,
    returnReason: returnReasonText,
  });
  await addNotification(
    shopId,
    actor,
    'RETURN_FROM_SALES',
    `${actor.displayName} processed return from sales: ${returnQuantity} of ${result.itemName}. Reason: ${returnReasonText}`
  );

  return result;
});

export const createPurchase = onCall({ region: REGION }, async (request) => {
  const actor = actorInfo(request);
  const shopId = shopIdFrom(request.data);
  const supplierId = String(request.data?.supplierId || '').trim();
  const supplierName = String(request.data?.supplierName || '').trim();
  const paymentType = request.data?.paymentType === 'accounts_payable' ? 'accounts_payable' : 'cash';
  const lineItems = Array.isArray(request.data?.lineItems) ? request.data.lineItems : [];
  const receiptNumber = request.data?.receiptNumber ? String(request.data.receiptNumber).trim() : null;
  const note = request.data?.note ? String(request.data.note).trim() : null;
  if (!supplierId || !supplierName || lineItems.length === 0) {
    throw new HttpsError('invalid-argument', 'Supplier and line items are required.');
  }

  const modeRaw = String(request.data?.purchaseDiscountMode || 'none').toLowerCase();
  const purchaseDiscountMode = ['none', 'percent', 'amount'].includes(modeRaw) ? modeRaw : 'none';
  const purchaseDiscountValue = Math.max(0, Number(request.data?.purchaseDiscountValue || 0));

  const purchase = await db.runTransaction(async (trx) => {
    const supplierRef = shopCollection(shopId, COLLECTIONS.suppliers).doc(supplierId);
    const supplierSnap = await trx.get(supplierRef);
    if (!supplierSnap.exists) throw new HttpsError('not-found', 'Supplier not found.');

    const purchaseId = String(request.data?.id || crypto.randomUUID()).trim();
    const now = nowIso();

    const staged = [];
    let merchandiseSubtotal = 0;
    let expectedRevenue = 0;

    for (const line of lineItems) {
      const itemId = String(line.itemId || '').trim();
      const itemName = String(line.itemName || '').trim();
      const quantity = Math.max(0, Number(line.quantity || 0));
      const unitCost = Math.max(0, Number(line.unitCost || 0));
      if (!itemId || quantity <= 0) {
        throw new HttpsError('invalid-argument', 'Each line must have a valid item and quantity > 0.');
      }
      const itemRef = shopCollection(shopId, COLLECTIONS.items).doc(itemId);
      const itemSnap = await trx.get(itemRef);
      if (!itemSnap.exists) {
        throw new HttpsError('not-found', `Item not found: ${itemName || itemId}.`);
      }
      const item = { id: itemSnap.id, ...itemSnap.data() };
      const sellingPrice = Math.max(0, Number(line.sellingPrice ?? item.unitPrice ?? 0));
      const lineTotal = quantity * unitCost;
      merchandiseSubtotal += lineTotal;
      expectedRevenue += quantity * sellingPrice;
      staged.push({
        itemRef,
        item,
        itemId,
        itemName: itemName || item.name || 'Item',
        quantity,
        unitCost,
        sellingPrice,
        lineTotal,
      });
    }

    const totalReceiveQuantity = staged.reduce((s, row) => s + row.quantity, 0);
    let discountTotal = 0;
    if (purchaseDiscountMode === 'percent' && purchaseDiscountValue > 0) {
      discountTotal = (merchandiseSubtotal * Math.min(100, purchaseDiscountValue)) / 100;
    } else if (purchaseDiscountMode === 'amount' && purchaseDiscountValue > 0) {
      const rawAmountDiscount = purchaseDiscountValue * totalReceiveQuantity;
      discountTotal = Math.min(merchandiseSubtotal, rawAmountDiscount);
    }
    discountTotal = Math.min(discountTotal, merchandiseSubtotal);
    const netMerchandiseCost = merchandiseSubtotal - discountTotal;
    const expectedNetProfit = expectedRevenue - netMerchandiseCost;

    const normalizedLines = staged.map((row) => {
      const share = merchandiseSubtotal > 0 ? discountTotal * (row.lineTotal / merchandiseSubtotal) : 0;
      const effLine = row.lineTotal - share;
      const effectiveUnitCost = row.quantity > 0 ? effLine / row.quantity : row.unitCost;
      return { ...row, effectiveUnitCost };
    });

    for (const row of normalizedLines) {
      const { item, itemRef, quantity, effectiveUnitCost, sellingPrice, itemName, itemId } = row;
      const currentQty = Number(item.quantity || 0);
      const newQty = currentQty + quantity;
      const oldCap = Number(item.capitalPrice ?? item.unitPrice ?? 0);
      const oldSell = Number(item.unitPrice || 0);
      const newCap = newQty > 0 ? (currentQty * oldCap + quantity * effectiveUnitCost) / newQty : effectiveUnitCost;
      const newSell = newQty > 0 ? (currentQty * oldSell + quantity * sellingPrice) / newQty : sellingPrice;
      trx.set(
        itemRef,
        {
          quantity: newQty,
          unitPrice: newSell,
          capitalPrice: newCap,
          lastUpdated: now,
          receiptNumber: receiptNumber || item.receiptNumber || null,
        },
        { merge: true }
      );

      const txId = crypto.randomUUID();
      trx.set(shopCollection(shopId, COLLECTIONS.transactions).doc(txId), {
        id: txId,
        itemId,
        itemName,
        type: 'ADDITION',
        quantityChange: quantity,
        unitPriceAtTime: effectiveUnitCost,
        sellingPriceAtTime: sellingPrice,
        totalValue: quantity * effectiveUnitCost,
        timestamp: now,
        note: note ? `Purchase from ${supplierName}. ${note}` : `Purchase from ${supplierName}`,
        receiptNumber,
        purchaseId,
        itemType: 'Product',
      });
    }

    const purchaseDoc = {
      id: purchaseId,
      supplierId,
      supplierName,
      purchaseDate: now,
      paymentType,
      totalAmount: netMerchandiseCost,
      status: paymentType === 'cash' ? 'paid' : 'unpaid',
      receiptNumber,
      note,
      lineItems: normalizedLines.map((r) => ({
        itemId: r.itemId,
        itemName: r.itemName,
        quantity: r.quantity,
        unitCost: r.unitCost,
        sellingPrice: r.sellingPrice,
        total: r.lineTotal,
        effectiveUnitCost: r.effectiveUnitCost,
      })),
      payments:
        paymentType === 'cash' ? [{ id: crypto.randomUUID(), amount: netMerchandiseCost, method: 'cash', paidAt: now }] : [],
      createdAt: now,
      purchaseDiscountMode,
      purchaseDiscountValue,
      merchandiseSubtotal,
      discountTotal,
      expectedRevenueAtSrp: expectedRevenue,
      expectedNetProfit,
    };
    trx.set(shopCollection(shopId, COLLECTIONS.purchases).doc(purchaseId), purchaseDoc);
    return purchaseDoc;
  });

  await addActivityLog(shopId, actor, 'PURCHASE', {
    supplierName,
    totalAmount: purchase.totalAmount,
    lineCount: purchase.lineItems.length,
  });
  return purchase;
});

export const addPurchasePayment = onCall({ region: REGION }, async (request) => {
  requireRole(request, ['admin', 'overseer']);
  const shopId = shopIdFrom(request.data);
  const purchaseId = String(request.data?.purchaseId || '').trim();
  const amount = Math.max(0, Number(request.data?.amount || 0));
  const method = ['cheque', 'card'].includes(String(request.data?.method || '').toLowerCase())
    ? String(request.data.method).toLowerCase()
    : 'cash';
  const paidAt = request.data?.paidAt ? String(request.data.paidAt).trim() : nowIso();
  const reference = request.data?.reference ? String(request.data.reference).trim() : null;

  if (!purchaseId || amount <= 0) {
    throw new HttpsError('invalid-argument', 'purchaseId and amount are required.');
  }

  const purchase = await db.runTransaction(async (trx) => {
    const purchaseRef = shopCollection(shopId, COLLECTIONS.purchases).doc(purchaseId);
    const purchaseSnap = await trx.get(purchaseRef);
    if (!purchaseSnap.exists) throw new HttpsError('not-found', 'Purchase not found.');
    const purchaseDoc = { id: purchaseSnap.id, ...purchaseSnap.data() };
    const payments = Array.isArray(purchaseDoc.payments) ? [...purchaseDoc.payments] : [];
    const totalPaidBefore = payments.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const remaining = Number(purchaseDoc.totalAmount || 0) - totalPaidBefore;
    if (amount > remaining) {
      throw new HttpsError('failed-precondition', `Payment cannot exceed remaining balance (₱${remaining.toFixed(2)}).`);
    }
    payments.push({
      id: crypto.randomUUID(),
      amount,
      method,
      paidAt,
      reference,
    });
    const totalPaid = payments.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const status = totalPaid >= Number(purchaseDoc.totalAmount || 0) ? 'paid' : totalPaid > 0 ? 'partial' : 'unpaid';
    const updated = { ...purchaseDoc, payments, status };
    trx.set(purchaseRef, updated, { merge: true });
    return updated;
  });

  return purchase;
});

export const getLoanById = onCall({ region: REGION }, async (request) => {
  requireRole(request, ['admin', 'overseer']);
  const shopId = shopIdFrom(request.data);
  const loanId = String(request.data?.loanId || '').trim();
  if (!loanId) throw new HttpsError('invalid-argument', 'loanId is required.');

  const loanSnap = await shopCollection(shopId, COLLECTIONS.loans).doc(loanId).get();
  if (!loanSnap.exists) throw new HttpsError('not-found', 'Loan not found.');
  const loan = { id: loanSnap.id, ...loanSnap.data() };
  const payments = await getLoanPayments(shopId, loanId);
  return {
    ...loan,
    status: computeLoanStatus(loan),
    payments,
  };
});

export const getLoanByTransactionId = onCall({ region: REGION }, async (request) => {
  requireRole(request, ['admin', 'overseer']);
  const shopId = shopIdFrom(request.data);
  const transactionId = String(request.data?.transactionId || '').trim();
  if (!transactionId) throw new HttpsError('invalid-argument', 'transactionId is required.');

  const loan = await getLoanByTransaction(shopId, transactionId);
  if (!loan) throw new HttpsError('not-found', 'Loan not found.');
  return {
    ...loan,
    status: computeLoanStatus(loan),
  };
});

export const addLoanPayment = onCall({ region: REGION }, async (request) => {
  requireRole(request, ['admin', 'overseer']);
  const shopId = shopIdFrom(request.data);
  const loanId = String(request.data?.loanId || '').trim();
  const amount = Number(request.data?.amount || 0);
  const note = request.data?.note ? String(request.data.note).trim() : null;
  if (!loanId || !Number.isFinite(amount) || amount <= 0) {
    throw new HttpsError('invalid-argument', 'loanId and a positive amount are required.');
  }

  const result = await db.runTransaction(async (trx) => {
    const loanRef = shopCollection(shopId, COLLECTIONS.loans).doc(loanId);
    const loanSnap = await trx.get(loanRef);
    if (!loanSnap.exists) throw new HttpsError('not-found', 'Loan not found.');
    const loan = { id: loanSnap.id, ...loanSnap.data() };
    const remaining = Number(loan.remainingBalance || 0);
    if (amount > remaining) {
      throw new HttpsError('failed-precondition', 'Payment cannot exceed remaining balance.');
    }
    const now = nowIso();
    const newBalance = Math.max(0, remaining - amount);
    const paymentId = crypto.randomUUID();
    const payment = {
      id: paymentId,
      loanId,
      amountPaid: amount,
      paidAt: now,
      remainingBalanceAfter: newBalance,
      note,
    };
    trx.set(shopCollection(shopId, COLLECTIONS.loanPayments).doc(paymentId), payment);
    const updatedLoan = {
      ...loan,
      remainingBalance: newBalance,
      status: newBalance <= 0 ? 'paid' : 'ongoing',
      updatedAt: now,
    };
    trx.set(loanRef, updatedLoan, { merge: true });
    return { payment, loan: updatedLoan };
  });

  const soa = await getSoaByTransaction(shopId, result.loan.transactionId);
  if (soa) {
    await buildEnrichedSoa(shopId, soa.id);
  }

  return {
    payment: result.payment,
    loan: {
      ...result.loan,
      status: computeLoanStatus(result.loan),
    },
  };
});

export const resolveCheque = onCall({ region: REGION }, async (request) => {
  requireRole(request, ['admin', 'overseer']);
  const shopId = shopIdFrom(request.data);
  const actor = actorInfo(request);
  const releaseTransactionId = String(request.data?.releaseTransactionId || '').trim();
  const outcome = String(request.data?.outcome || '').trim().toLowerCase();
  if (!releaseTransactionId || !['cleared', 'bounced'].includes(outcome)) {
    throw new HttpsError('invalid-argument', 'releaseTransactionId and outcome (cleared|bounced) are required.');
  }

  const txRef = shopCollection(shopId, COLLECTIONS.transactions).doc(releaseTransactionId);
  const txSnap = await txRef.get();
  if (!txSnap.exists) throw new HttpsError('not-found', 'Transaction not found.');
  const tx = { id: txSnap.id, ...txSnap.data() };
  if (tx.type !== 'RELEASE') throw new HttpsError('failed-precondition', 'Not a sale transaction.');
  if (String(tx.modeOfPayment || '').trim() !== 'Cheque') {
    throw new HttpsError('failed-precondition', 'Only cheque sales can be resolved this way.');
  }
  if (tx.chequeStatus === 'cleared') {
    throw new HttpsError('failed-precondition', 'Cheque already cleared.');
  }

  if (outcome === 'bounced') {
    await txRef.set({ chequeStatus: 'bounced', chequeClearedAt: null }, { merge: true });
    await addNotification(
      shopId,
      actor,
      'CHEQUE_BOUNCED',
      `Cheque marked bounced: ${tx.recipient || 'customer'} — ${tx.itemName || 'sale'} (₱${Number(tx.totalValue || 0).toFixed(
        2
      )}). Still on receivables until resolved.`
    );
    return { ok: true, chequeStatus: 'bounced' };
  }

  const loanPre = await getLoanByTransaction(shopId, releaseTransactionId);
  if (!loanPre) throw new HttpsError('not-found', 'No receivable record linked to this sale.');

  await db.runTransaction(async (trx) => {
    const tSnap = await trx.get(txRef);
    if (!tSnap.exists) throw new HttpsError('not-found', 'Transaction not found.');
    const t = { id: tSnap.id, ...tSnap.data() };
    if (String(t.modeOfPayment || '').trim() !== 'Cheque') {
      throw new HttpsError('failed-precondition', 'Not a cheque sale.');
    }
    if (t.chequeStatus === 'cleared') throw new HttpsError('failed-precondition', 'Cheque already cleared.');

    const loanRef = shopCollection(shopId, COLLECTIONS.loans).doc(loanPre.id);
    const lSnap = await trx.get(loanRef);
    if (!lSnap.exists) throw new HttpsError('not-found', 'Receivable record was removed.');
    const loan = { id: lSnap.id, ...lSnap.data() };
    const remaining = roundMoney(Number(loan.remainingBalance || 0));
    const now = nowIso();
    if (remaining > 0) {
      const paymentId = crypto.randomUUID();
      const payment = {
        id: paymentId,
        loanId: loan.id,
        amountPaid: remaining,
        paidAt: now,
        remainingBalanceAfter: 0,
        note: 'Cheque cleared — recorded as cash received',
      };
      trx.set(shopCollection(shopId, COLLECTIONS.loanPayments).doc(paymentId), payment);
      const updatedLoan = {
        ...loan,
        remainingBalance: 0,
        status: 'paid',
        updatedAt: now,
      };
      trx.set(loanRef, updatedLoan, { merge: true });
    } else {
      trx.set(loanRef, { status: 'paid', remainingBalance: 0, updatedAt: now }, { merge: true });
    }
    trx.set(txRef, { chequeStatus: 'cleared', chequeClearedAt: now }, { merge: true });
  });

  const soa = await getSoaByTransaction(shopId, releaseTransactionId);
  if (soa) await buildEnrichedSoa(shopId, soa.id);

  await addNotification(
    shopId,
    actor,
    'CHEQUE_CLEARED',
    `Cheque cleared (cash received): ${tx.recipient || 'customer'} — ₱${Number(tx.totalValue || 0).toFixed(2)}`
  );
  return { ok: true, chequeStatus: 'cleared' };
});

export const updateLoanStatus = onCall({ region: REGION }, async (request) => {
  requireRole(request, ['admin', 'overseer']);
  const shopId = shopIdFrom(request.data);
  const loanId = String(request.data?.loanId || '').trim();
  const status = String(request.data?.status || '').trim();
  if (!loanId || !['unpaid', 'ongoing', 'overdue', 'paid', 'cash'].includes(status)) {
    throw new HttpsError('invalid-argument', 'loanId and a valid status are required.');
  }
  const updatedAt = nowIso();
  await shopCollection(shopId, COLLECTIONS.loans).doc(loanId).set({ status, updatedAt }, { merge: true });
  const snap = await shopCollection(shopId, COLLECTIONS.loans).doc(loanId).get();
  const loan = { id: snap.id, ...snap.data() };
  return {
    ...loan,
    status: computeLoanStatus(loan),
  };
});

export const getSoaByTransactionId = onCall({ region: REGION }, async (request) => {
  requireRole(request, ['admin', 'overseer']);
  const shopId = shopIdFrom(request.data);
  const transactionId = String(request.data?.transactionId || '').trim();
  if (!transactionId) throw new HttpsError('invalid-argument', 'transactionId is required.');
  const soa = await getSoaByTransaction(shopId, transactionId);
  if (!soa) throw new HttpsError('not-found', 'SOA not found.');
  return buildEnrichedSoa(shopId, soa.id);
});

export const getSoaById = onCall({ region: REGION }, async (request) => {
  requireRole(request, ['admin', 'overseer']);
  const shopId = shopIdFrom(request.data);
  const soaId = String(request.data?.soaId || '').trim();
  if (!soaId) throw new HttpsError('invalid-argument', 'soaId is required.');
  return buildEnrichedSoa(shopId, soaId);
});

export const updateSoaPaymentStatus = onCall({ region: REGION }, async (request) => {
  requireRole(request, ['admin', 'overseer']);
  const shopId = shopIdFrom(request.data);
  const soaId = String(request.data?.soaId || '').trim();
  const paymentStatus = String(request.data?.paymentStatus || '').trim();
  if (!soaId || !['Unpaid', 'Partially Paid', 'Paid', 'Overdue'].includes(paymentStatus)) {
    throw new HttpsError('invalid-argument', 'soaId and a valid paymentStatus are required.');
  }
  await shopCollection(shopId, COLLECTIONS.soas).doc(soaId).set({ paymentStatus }, { merge: true });
  return buildEnrichedSoa(shopId, soaId);
});

export const addSoaPayment = onCall({ region: REGION }, async (request) => {
  requireRole(request, ['admin', 'overseer']);
  const shopId = shopIdFrom(request.data);
  const soaId = String(request.data?.soaId || '').trim();
  const amount = Number(request.data?.amount || 0);
  const method = ['cheque', 'card'].includes(String(request.data?.method || '').toLowerCase())
    ? String(request.data.method).toLowerCase()
    : 'cash';
  const paidAt = request.data?.paidAt ? String(request.data.paidAt).trim() : nowIso();
  const reference = request.data?.reference ? String(request.data.reference).trim() : null;
  const note = request.data?.note ? String(request.data.note).trim() : null;
  if (!soaId || !Number.isFinite(amount) || amount <= 0) {
    throw new HttpsError('invalid-argument', 'soaId and a positive amount are required.');
  }

  const soaSnap = await shopCollection(shopId, COLLECTIONS.soas).doc(soaId).get();
  if (!soaSnap.exists) throw new HttpsError('not-found', 'SOA not found.');
  const soa = { id: soaSnap.id, ...soaSnap.data() };
  const linkedLoan = await getLoanByTransaction(shopId, soa.transactionId);
  if (linkedLoan) {
    throw new HttpsError('failed-precondition', 'This SOA has a linked receivable; record payment via Receivables.');
  }

  const existingPayments = await getSoaPayments(shopId, soaId);
  const totalPaid = existingPayments.reduce((sum, item) => sum + Number(item.amountPaid || 0), 0);
  const remaining = Math.max(0, Number(soa.totalAmountDue || 0) - totalPaid);
  if (amount > remaining) {
    throw new HttpsError('failed-precondition', 'Payment cannot exceed remaining balance.');
  }

  const paymentId = crypto.randomUUID();
  const payment = {
    id: paymentId,
    soaId,
    amountPaid: amount,
    paidAt,
    method,
    reference,
    note,
  };
  await shopCollection(shopId, COLLECTIONS.soaPayments).doc(paymentId).set(payment);
  await buildEnrichedSoa(shopId, soaId);

  return {
    payment,
    soa: await buildEnrichedSoa(shopId, soaId),
  };
});
