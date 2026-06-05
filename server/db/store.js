import path from 'path';
import bcrypt from 'bcryptjs';
import { fileURLToPath } from 'url';
import {
  DEFAULT_REST_ADMIN_EMAIL,
  DEFAULT_REST_ADMIN_PASSWORD,
  FIREBASE_SIGNIN_EMAIL,
  SINGLE_ADMIN_USERNAME,
} from '../lib/adminLogin.js';
import * as collectionsBackend from './shopCollections.js';
import { isEmergencyDbBypass } from '../lib/emergencyAuth.js';
import { DEFAULT_SHOP_ID, SHOP_IDS } from '../lib/shops.js';
import { getActiveShopId } from '../lib/shopContext.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const COLLECTIONS = {
  users: 'users',
  items: 'items',
  transactions: 'transactions',
  activityLogs: 'activity_logs',
  notifications: 'notifications',
  persons: 'persons',
  vehicles: 'vehicles',
  expenses: 'expenses',
  suppliers: 'suppliers',
  purchases: 'purchases',
  soas: 'soas',
  soaPayments: 'soa_payments',
  loans: 'loans',
  loanPayments: 'loan_payments',
  /** Archived POS receipts & billing snapshots for search and audit. */
  documentArchives: 'document_archives',
  /** Website service booking requests (Motor World public site). */
  onlineBookings: 'online_bookings',
  /** Staff profiles for DTR / payroll. */
  employees: 'employees',
  /** Imported DTR payroll batches (posted → Salary expenses). */
  payrollRuns: 'payroll_runs',
};

let initialized = false;
/** Dedupe concurrent first-request inits (e.g. Vercel serverless). */
let storeInitPromise = null;

/** Single administrator row; migrates legacy `admin` / `admin@efcp.com` / older aliases to {@link DEFAULT_REST_ADMIN_EMAIL}. */
function consolidateUsersToSingleAdmin(users) {
  const canonicalEmail = String(DEFAULT_REST_ADMIN_EMAIL).trim().toLowerCase();
  const legacyEmails = new Set(
    [SINGLE_ADMIN_USERNAME, 'admin@efcp.com', 'admin@motorworldcorp.com', FIREBASE_SIGNIN_EMAIL].map((x) =>
      String(x).toLowerCase(),
    ),
  );
  const normalized = (u) => String(u.email || '').trim().toLowerCase();

  if (users.length === 1) {
    const e = normalized(users[0]);
    if (e === canonicalEmail) {
      let row = users[0];
      if (row.role === 'overseer') row = { ...row, role: 'admin' };
      const isNewDefault = bcrypt.compareSync(DEFAULT_REST_ADMIN_PASSWORD, row.password_hash);
      const isOldDefault = bcrypt.compareSync('admin2026', row.password_hash);
      if (!isNewDefault && isOldDefault) {
        return [
          {
            ...row,
            password_hash: bcrypt.hashSync(DEFAULT_REST_ADMIN_PASSWORD, 10),
            shops: shopsForUser(row),
          },
        ];
      }
      return [{ ...row, shops: shopsForUser(row) }];
    }
    if (legacyEmails.has(e)) {
      return [
        {
          ...users[0],
          email: canonicalEmail,
          password_hash: bcrypt.hashSync(DEFAULT_REST_ADMIN_PASSWORD, 10),
          display_name: users[0].display_name || 'Administrator',
          role: 'admin',
          shops: [...SHOP_IDS],
        },
      ];
    }
  }

  const password_hash = bcrypt.hashSync(DEFAULT_REST_ADMIN_PASSWORD, 10);
  const canonical = users.filter((u) => {
    const e = normalized(u);
    return e === canonicalEmail || legacyEmails.has(e);
  });
  const keep = canonical[0] || users[0];
  const id = keep?.id || crypto.randomUUID();
  return [
    {
      id,
      email: canonicalEmail,
      password_hash,
      display_name: keep?.display_name || 'Administrator',
      role: 'admin',
      created_at: keep?.created_at || new Date().toISOString(),
      shops: [...SHOP_IDS],
    },
  ];
}

export async function ensureStoreInitialized() {
  if (initialized) return;
  if (!storeInitPromise) {
    storeInitPromise = initializeStore().catch((err) => {
      storeInitPromise = null;
      throw err;
    });
  }
  await storeInitPromise;
}

export async function initializeStore() {
  if (initialized) return;
  if (isEmergencyDbBypass()) {
    initialized = true;
    return;
  }
  /**
   * Only materialize `users` at startup. Every other collection is created lazily on first
   * `readCollection` (empty default), which avoids a long Postgres burst before `/api/auth/login`
   * on Vercel cold starts.
   */
  await collectionsBackend.seedEmptyCollections([COLLECTIONS.users]);
  const users = await collectionsBackend.readCollection(COLLECTIONS.users, []);
  await collectionsBackend.writeCollection(COLLECTIONS.users, consolidateUsersToSingleAdmin(users));
  initialized = true;
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeString(value, fallback = '') {
  return value == null ? fallback : String(value);
}

function normalizeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function titleCaseStatus(rawStatus) {
  switch (rawStatus) {
    case 'paid':
      return 'Paid';
    case 'partial':
    case 'partially_paid':
      return 'Partially Paid';
    case 'overdue':
      return 'Overdue';
    default:
      return 'Unpaid';
  }
}

function computeLoanStatus(loan) {
  if (!loan) return 'unpaid';
  if (loan.status === 'cash' || loan.status === 'paid') return loan.status;
  const remaining = normalizeNumber(loan.remainingBalance ?? loan.remaining_balance);
  if (remaining <= 0) return 'paid';
  const total = normalizeNumber(loan.totalAmount ?? loan.total_amount);
  const dueDate = loan.dueDate ?? loan.due_date;
  if (dueDate && new Date(dueDate).getTime() < Date.now()) return 'overdue';
  return remaining >= total ? 'unpaid' : 'ongoing';
}

function itemToApi(item) {
  const purposeRaw = item.stock_purpose ?? item.stockPurpose;
  const stockPurpose = purposeRaw === 'for_supply' ? 'for_supply' : 'for_sale';
  return {
    id: item.id,
    itemCode: normalizeString(item.item_code ?? item.itemCode),
    name: normalizeString(item.name, 'Untitled Item'),
    brand: normalizeString(item.brand),
    category: normalizeString(item.category, 'Uncategorized'),
    quantity: normalizeNumber(item.quantity),
    unit: normalizeString(item.unit, 'pcs'),
    unitPrice: normalizeNumber(item.unit_price ?? item.unitPrice),
    capitalPrice: normalizeNumber(
      item.capital_price ?? item.capitalPrice ?? item.unit_price ?? item.unitPrice
    ),
    description: normalizeString(item.description),
    minStockLevel: normalizeNumber(item.min_stock_level ?? item.minStockLevel),
    lastUpdated: item.last_updated ?? item.lastUpdated ?? nowIso(),
    createdAt:
      item.created_at ?? item.createdAt ?? item.last_updated ?? item.lastUpdated ?? nowIso(),
    receiptNumber: item.receipt_number ?? item.receiptNumber ?? null,
    defectiveQuantity: normalizeNumber(item.defective_quantity ?? item.defectiveQuantity),
    photoFilename: item.photo_filename ?? item.photoFilename ?? null,
    photoUrl: item.photo_url ?? item.photoUrl ?? null,
    stockPurpose,
  };
}

function transactionToApi(tx) {
  return {
    id: tx.id,
    itemId: tx.item_id ?? tx.itemId ?? null,
    itemName: normalizeString(tx.item_name ?? tx.itemName, 'Untitled'),
    type: normalizeString(tx.type),
    quantityChange: normalizeNumber(tx.quantity_change ?? tx.quantityChange),
    unitPriceAtTime: normalizeNumber(tx.unit_price_at_time ?? tx.unitPriceAtTime),
    sellingPriceAtTime:
      tx.selling_price_at_time != null || tx.sellingPriceAtTime != null
        ? normalizeNumber(tx.selling_price_at_time ?? tx.sellingPriceAtTime)
        : null,
    totalValue: normalizeNumber(tx.total_value ?? tx.totalValue),
    timestamp: tx.timestamp ?? nowIso(),
    recipient: tx.recipient ?? null,
    note: tx.note ?? null,
    receiptNumber: tx.receipt_number ?? tx.receiptNumber ?? null,
    releaseTransactionId: tx.release_transaction_id ?? tx.releaseTransactionId ?? null,
    returnReason: tx.return_reason ?? tx.returnReason ?? null,
    returnReasonOthers: tx.return_reason_others ?? tx.returnReasonOthers ?? null,
    returnReasonText: tx.return_reason_text ?? tx.returnReasonText ?? null,
    condition: tx.condition ?? null,
    modeOfPayment: tx.mode_of_payment ?? tx.modeOfPayment ?? null,
    modeOfPaymentOther: tx.mode_of_payment_other ?? tx.modeOfPaymentOther ?? null,
    personId: tx.person_id ?? tx.personId ?? null,
    vehicleId: tx.vehicle_id ?? tx.vehicleId ?? null,
    discountPercent: tx.discount_percent ?? tx.discountPercent ?? null,
    discountAmount: tx.discount_amount ?? tx.discountAmount ?? null,
    taxPercent: tx.tax_percent ?? tx.taxPercent ?? null,
    taxAmount: tx.tax_amount ?? tx.taxAmount ?? null,
    itemType: tx.item_type ?? tx.itemType ?? null,
    releasedBy: tx.released_by ?? tx.releasedBy ?? null,
    returnProcessedBy: tx.return_processed_by ?? tx.returnProcessedBy ?? null,
    purchaseId: tx.purchase_id ?? tx.purchaseId ?? null,
    invoiceNumber: tx.invoice_number ?? tx.invoiceNumber ?? null,
    dueDate: tx.due_date ?? tx.dueDate ?? null,
    terms: tx.terms ?? null,
    posLineItems: tx.pos_line_items ?? tx.posLineItems ?? null,
    chequeExpectedClearDate: tx.cheque_expected_clear_date ?? tx.chequeExpectedClearDate ?? null,
    chequeReference: tx.cheque_reference ?? tx.chequeReference ?? null,
    chequeStatus: tx.cheque_status ?? tx.chequeStatus ?? null,
    chequeClearedAt: tx.cheque_cleared_at ?? tx.chequeClearedAt ?? null,
    editedAt: tx.edited_at ?? tx.editedAt ?? null,
    editNote: tx.edit_note ?? tx.editNote ?? null,
    shopId: tx.shop_id ?? tx.shopId ?? null,
    historicalSale: Boolean(tx.historical_sale ?? tx.historicalSale),
    subtotalBeforeDiscount:
      tx.subtotal_before_discount != null ? normalizeNumber(tx.subtotal_before_discount) : null,
    totalCostAtTime: tx.total_cost_at_time != null ? normalizeNumber(tx.total_cost_at_time) : null,
    netIncome: tx.net_income != null ? normalizeNumber(tx.net_income) : null,
    bundledSale: tx.bundled_sale != null ? Boolean(tx.bundled_sale) : null,
  };
}

export function receivableModesNeedLoan(mode) {
  const m = String(mode || '').trim();
  return m === 'Credit' || m === 'Cheque';
}

export function isNonCashReleasePayment(mode) {
  const m = String(mode || '').trim();
  return m && m !== 'Cash';
}

export function receivableDueDateFromPayload(body, timestamp, mode) {
  const m = String(mode || '').trim();
  if (m === 'Cheque') {
    const raw = String(body.chequeExpectedClearDate || '').trim();
    if (!raw) throw new Error('Expected cheque clearance date is required for Cheque sales.');
    const d = new Date(raw.length === 10 ? `${raw}T12:00:00` : raw);
    if (Number.isNaN(d.getTime())) throw new Error('Invalid cheque expected clearance date.');
    return d.toISOString();
  }
  if (m === 'Purchase Order') {
    const raw = String(body.dueDate || '').trim();
    if (raw) {
      const d = new Date(raw.length === 10 ? `${raw}T12:00:00` : raw);
      if (!Number.isNaN(d.getTime())) return d.toISOString();
    }
    return timestamp;
  }
  const dueDays = Math.min(365, Math.max(1, Number(body.dueDays || 30)));
  const dueDate = new Date(timestamp);
  dueDate.setDate(dueDate.getDate() + dueDays);
  return dueDate.toISOString();
}

/**
 * After a RELEASE, create SOA and/or loan rows for non-cash payment modes (Credit, Cheque, Purchase Order).
 */
export async function syncReceivablesForRelease(created, payload) {
  const mode = String(created.modeOfPayment || '').trim();
  if (!isNonCashReleasePayment(mode) || !created.recipient) {
    return { soaId: null };
  }

  const posLines = Array.isArray(created.posLineItems)
    ? created.posLineItems
    : Array.isArray(payload.posLineItems)
      ? payload.posLineItems
      : [];
  const totalUnits =
    posLines.length > 0
      ? posLines.reduce((s, l) => s + Math.abs(Number(l.quantity) || 0), 0)
      : Math.abs(Number(created.quantityChange) || 0);

  const totalAmountDue = normalizeNumber(created.totalValue);
  const discountAmount =
    payload.discountAmount != null && Number(payload.discountAmount) > 0
      ? normalizeNumber(payload.discountAmount)
      : null;
  const itemType = created.itemType === 'Service' ? 'Service' : 'Product';

  let vehiclePlateNumber = null;
  const vehicleId = payload.vehicleId ?? created.vehicleId ?? null;
  if (vehicleId) {
    const vehicle = await getVehicleById(vehicleId);
    vehiclePlateNumber = vehicle?.plateNumber ?? null;
  }

  const dueDateStr = receivableDueDateFromPayload(payload, created.timestamp, mode);
  let soaId = null;

  if (receivableModesNeedLoan(mode) || mode === 'Purchase Order') {
    const soa = await createSoa({
      transactionId: created.id,
      customerName: created.recipient || 'Walk-in Customer',
      itemId: created.itemId ?? null,
      itemName: created.itemName,
      quantity: totalUnits || Math.abs(Number(created.quantityChange) || 1),
      srp: created.unitPriceAtTime,
      discountPercent: payload.discountPercent ?? null,
      discountAmount,
      taxPercent: payload.taxPercent ?? null,
      taxAmount: payload.taxAmount != null ? normalizeNumber(payload.taxAmount) : null,
      totalAmountDue,
      transactionDate: created.timestamp,
      dueDate: dueDateStr,
      paymentStatus: 'Unpaid',
      personId: payload.personId ?? created.personId ?? null,
      vehicleId,
      vehiclePlateNumber,
      itemType,
    });
    soaId = soa.id;
  }

  if (receivableModesNeedLoan(mode) && totalAmountDue > 0) {
    const downPayment = Math.max(0, Math.min(totalAmountDue, Number(payload.downPayment || 0)));
    const interestRate = mode === 'Cheque' ? 0 : Number(payload.interestRate || 0);
    const principal = Math.max(0, totalAmountDue - downPayment);
    const totalAmount =
      mode === 'Cheque' ? totalAmountDue : principal + principal * (interestRate / 100);
    const remainingBalance = Math.max(0, totalAmount - downPayment);

    await createLoan({
      transactionId: created.id,
      customerName: created.recipient || 'Walk-in Customer',
      totalAmount: mode === 'Cheque' ? totalAmountDue : totalAmount,
      downPayment,
      remainingBalance: mode === 'Cheque' ? Math.max(0, totalAmountDue - downPayment) : remainingBalance,
      interestRate: mode === 'Cheque' ? null : interestRate,
      startDate: created.timestamp,
      dueDate: dueDateStr,
      paymentSchedule: payload.paymentSchedule === 'weekly' ? 'weekly' : 'monthly',
      status:
        remainingBalance <= 0
          ? 'paid'
          : mode === 'Cheque'
            ? 'unpaid'
            : 'ongoing',
      personId: payload.personId ?? created.personId ?? null,
      vehicleId,
      vehiclePlateNumber,
    });
  } else if (mode === 'Purchase Order' && totalAmountDue > 0) {
    await createLoan({
      transactionId: created.id,
      customerName: created.recipient || 'Walk-in Customer',
      totalAmount: totalAmountDue,
      downPayment: 0,
      remainingBalance: totalAmountDue,
      interestRate: null,
      startDate: created.timestamp,
      dueDate: dueDateStr,
      paymentSchedule: 'monthly',
      status: 'unpaid',
      personId: payload.personId ?? created.personId ?? null,
      vehicleId,
      vehiclePlateNumber,
    });
  }

  return { soaId };
}

export async function resolveChequeForRelease(releaseTransactionId, outcome) {
  const id = String(releaseTransactionId || '').trim();
  const result = String(outcome || '').trim().toLowerCase();
  if (!id || !['cleared', 'bounced'].includes(result)) {
    throw new Error('releaseTransactionId and outcome (cleared|bounced) are required.');
  }

  const tx = await getTransactionById(id);
  if (!tx || tx.type !== 'RELEASE') throw new Error('Transaction not found.');
  if (String(tx.modeOfPayment || '').trim() !== 'Cheque') {
    throw new Error('Only cheque sales can be resolved this way.');
  }
  if (tx.chequeStatus === 'cleared') throw new Error('Cheque already cleared.');

  if (result === 'bounced') {
    await updateTransaction(id, {
      cheque_status: 'bounced',
      cheque_cleared_at: null,
    });
    return { ok: true, chequeStatus: 'bounced' };
  }

  const loan = await getLoanByTransactionId(id);
  if (!loan) throw new Error('No receivable record linked to this sale.');

  const remaining = normalizeNumber(loan.remainingBalance);
  const now = nowIso();
  if (remaining > 0) {
    await addLoanPayment(loan.id, {
      amountPaid: remaining,
      paidAt: now,
      note: 'Cheque cleared — recorded as cash received',
    });
  } else {
    await updateLoanStatus(loan.id, 'paid');
  }

  await updateTransaction(id, {
    cheque_status: 'cleared',
    cheque_cleared_at: now,
  });
  return { ok: true, chequeStatus: 'cleared' };
}

function purchaseToApi(purchase) {
  return {
    id: purchase.id,
    supplierId: purchase.supplier_id ?? purchase.supplierId,
    supplierName: purchase.supplier_name ?? purchase.supplierName,
    purchaseDate: purchase.purchase_date ?? purchase.purchaseDate,
    paymentType: purchase.payment_type ?? purchase.paymentType,
    totalAmount: normalizeNumber(purchase.total_amount ?? purchase.totalAmount),
    status: purchase.status ?? 'unpaid',
    receiptNumber: purchase.receipt_number ?? purchase.receiptNumber ?? null,
    note: purchase.note ?? null,
    lineItems: purchase.line_items ?? purchase.lineItems ?? [],
    payments: purchase.payments ?? [],
    createdAt: purchase.created_at ?? purchase.createdAt ?? nowIso(),
    purchaseDiscountMode: purchase.purchase_discount_mode ?? purchase.purchaseDiscountMode ?? 'none',
    purchaseDiscountValue: normalizeNumber(
      purchase.purchase_discount_value ?? purchase.purchaseDiscountValue ?? 0
    ),
    merchandiseSubtotal: normalizeNumber(
      purchase.merchandise_subtotal ?? purchase.merchandiseSubtotal ?? 0
    ),
    discountTotal: normalizeNumber(purchase.discount_total ?? purchase.discountTotal ?? 0),
    expectedRevenueAtSrp: normalizeNumber(
      purchase.expected_revenue_at_srp ?? purchase.expectedRevenueAtSrp ?? 0
    ),
    expectedNetProfit: normalizeNumber(
      purchase.expected_net_profit ?? purchase.expectedNetProfit ?? 0
    ),
  };
}

function soaPaymentToApi(payment) {
  return {
    id: payment.id,
    soaId: payment.soa_id ?? payment.soaId,
    amountPaid: normalizeNumber(payment.amount_paid ?? payment.amountPaid),
    paidAt: payment.paid_at ?? payment.paidAt,
    method: payment.method ?? 'cash',
    reference: payment.reference ?? null,
    note: payment.note ?? null,
  };
}

function loanPaymentToApi(payment) {
  return {
    id: payment.id,
    loanId: payment.loan_id ?? payment.loanId,
    amountPaid: normalizeNumber(payment.amount_paid ?? payment.amountPaid),
    paidAt: payment.paid_at ?? payment.paidAt,
    remainingBalanceAfter: normalizeNumber(payment.remaining_balance_after ?? payment.remainingBalanceAfter),
    note: payment.note ?? null,
  };
}

function loanToApi(loan) {
  return {
    id: loan.id,
    transactionId: loan.transaction_id ?? loan.transactionId,
    customerName: loan.customer_name ?? loan.customerName,
    totalAmount: normalizeNumber(loan.total_amount ?? loan.totalAmount),
    downPayment: normalizeNumber(loan.down_payment ?? loan.downPayment),
    remainingBalance: normalizeNumber(loan.remaining_balance ?? loan.remainingBalance),
    interestRate: loan.interest_rate ?? loan.interestRate ?? null,
    startDate: loan.start_date ?? loan.startDate,
    dueDate: loan.due_date ?? loan.dueDate,
    paymentSchedule: loan.payment_schedule ?? loan.paymentSchedule,
    status: computeLoanStatus(loan),
    createdAt: loan.created_at ?? loan.createdAt ?? nowIso(),
    updatedAt: loan.updated_at ?? loan.updatedAt ?? nowIso(),
    personId: loan.person_id ?? loan.personId ?? null,
    vehicleId: loan.vehicle_id ?? loan.vehicleId ?? null,
    vehiclePlateNumber: loan.vehicle_plate_number ?? loan.vehiclePlateNumber ?? null,
  };
}

function soaToApi(soa) {
  return {
    id: soa.id,
    transactionId: soa.transaction_id ?? soa.transactionId,
    customerName: soa.customer_name ?? soa.customerName,
    itemId: soa.item_id ?? soa.itemId ?? null,
    itemName: soa.item_name ?? soa.itemName,
    quantity: normalizeNumber(soa.quantity),
    srp: normalizeNumber(soa.srp),
    discountPercent: soa.discount_percent ?? soa.discountPercent ?? null,
    discountAmount: soa.discount_amount ?? soa.discountAmount ?? null,
    taxPercent: soa.tax_percent ?? soa.taxPercent ?? null,
    taxAmount: soa.tax_amount ?? soa.taxAmount ?? null,
    totalAmountDue: normalizeNumber(soa.total_amount_due ?? soa.totalAmountDue),
    transactionDate: soa.transaction_date ?? soa.transactionDate,
    dueDate: soa.due_date ?? soa.dueDate,
    paymentStatus: titleCaseStatus(soa.payment_status ?? soa.paymentStatus),
    createdAt: soa.created_at ?? soa.createdAt ?? nowIso(),
    personId: soa.person_id ?? soa.personId ?? null,
    vehicleId: soa.vehicle_id ?? soa.vehicleId ?? null,
    vehiclePlateNumber: soa.vehicle_plate_number ?? soa.vehiclePlateNumber ?? null,
    itemType: soa.item_type ?? soa.itemType ?? 'Product',
  };
}

function personToApi(person) {
  return {
    id: person.id,
    fullName: person.full_name ?? person.fullName,
    contactNumber: person.contact_number ?? person.contactNumber ?? '',
    address: person.address ?? '',
    email: person.email ?? '',
    createdAt: person.created_at ?? person.createdAt ?? nowIso(),
  };
}

function vehicleToApi(vehicle) {
  return {
    id: vehicle.id,
    personId: vehicle.person_id ?? vehicle.personId,
    plateNumber: vehicle.plate_number ?? vehicle.plateNumber,
    brand: vehicle.brand ?? '',
    model: vehicle.model ?? '',
    year: vehicle.year ?? null,
    color: vehicle.color ?? '',
    createdAt: vehicle.created_at ?? vehicle.createdAt ?? nowIso(),
  };
}

function expenseToApi(expense) {
  return {
    id: expense.id,
    title: expense.title,
    category: expense.category,
    amount: normalizeNumber(expense.amount),
    description: expense.description ?? '',
    date: expense.date,
    recordedBy: expense.recorded_by ?? expense.recordedBy ?? 'System',
    recordedByUserId: expense.recorded_by_user_id ?? expense.recordedByUserId ?? null,
    createdAt: expense.created_at ?? expense.createdAt ?? nowIso(),
  };
}

function supplierToApi(supplier) {
  return {
    id: supplier.id,
    name: supplier.name,
    contactNumber: supplier.contact_number ?? supplier.contactNumber ?? '',
    address: supplier.address ?? '',
    email: supplier.email ?? '',
    tin: supplier.tin ?? '',
    createdAt: supplier.created_at ?? supplier.createdAt ?? nowIso(),
  };
}

function totalPaidForPurchase(purchase) {
  return (purchase.payments ?? []).reduce((sum, payment) => sum + normalizeNumber(payment.amount), 0);
}

export async function getUsers() {
  return await collectionsBackend.readCollection(COLLECTIONS.users, []);
}

export async function getUserById(id) {
  return (await getUsers()).find((user) => user.id === id) || null;
}

export async function getUserByEmail(email) {
  const normalized = String(email || '').trim().toLowerCase();
  return (await getUsers()).find((user) => String(user.email || '').trim().toLowerCase() === normalized) || null;
}

export async function createUser(user) {
  const users = await getUsers();
  users.unshift({
    id: user.id || crypto.randomUUID(),
    email: user.email.trim().toLowerCase(),
    password_hash: user.password_hash,
    display_name: user.display_name,
    role: user.role || 'admin',
    created_at: user.created_at || nowIso(),
    ...(Array.isArray(user.shops) && user.shops.length
      ? { shops: user.shops.map((s) => String(s).trim()).filter((s) => SHOP_IDS.includes(s)) }
      : { shops: [DEFAULT_SHOP_ID] }),
  });
  await collectionsBackend.writeCollection(COLLECTIONS.users, users);
  return await getUserById(users[0].id);
}

export async function updateUser(id, patch) {
  const users = await getUsers();
  const index = users.findIndex((user) => user.id === id);
  if (index === -1) return null;
  users[index] = { ...users[index], ...patch };
  await collectionsBackend.writeCollection(COLLECTIONS.users, users);
  return users[index];
}

export async function deleteUser(id) {
  const users = await getUsers();
  const nextUsers = users.filter((user) => user.id !== id);
  const changed = nextUsers.length !== users.length;
  if (changed) await collectionsBackend.writeCollection(COLLECTIONS.users, nextUsers);
  return changed;
}

export function shopsForUser(user) {
  if (!user) return [DEFAULT_SHOP_ID];
  const email = String(user.email || '').trim().toLowerCase();
  /** Seeded primary admin always manages every logical store (DB may still have a legacy single `shops` entry). */
  if (email === String(DEFAULT_REST_ADMIN_EMAIL).trim().toLowerCase()) {
    return [...SHOP_IDS];
  }
  if (Array.isArray(user.shops) && user.shops.length) {
    return user.shops.map((s) => String(s).trim()).filter((s) => SHOP_IDS.includes(s));
  }
  return [DEFAULT_SHOP_ID];
}

/** Public session shape for Express; legacy `overseer` rows are treated as admin. */
export function mapUserToSession(user) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    displayName: user.display_name,
    role: 'admin',
    shops: shopsForUser(user),
  };
}

export async function getPrimaryUserForSession() {
  const u = (await getUsers())[0];
  return mapUserToSession(u);
}

export async function countUsersByRole(role) {
  return (await getUsers()).filter((user) => user.role === role).length;
}

export async function getAllItems() {
  const consolidated = await consolidateDuplicateInventoryItems();
  return consolidated.items;
}

export async function getItemById(id) {
  const item = (await collectionsBackend.readCollection(COLLECTIONS.items, [])).find((entry) => entry.id === id);
  return item ? itemToApi(item) : null;
}

export async function createItem(itemData) {
  const items = await collectionsBackend.readCollection(COLLECTIONS.items, []);
  const mergeMatch = findItemByMergeKey(items, itemData);
  if (mergeMatch) {
    const addQty = Math.max(0, normalizeNumber(itemData.quantity));
    const addDef = Math.max(0, normalizeNumber(itemData.defectiveQuantity ?? itemData.defective_quantity));
    const index = items.findIndex((entry) => entry.id === mergeMatch.id);
    if (index === -1) return null;
    items[index] = {
      ...items[index],
      quantity: normalizeNumber(items[index].quantity) + addQty,
      defective_quantity:
        normalizeNumber(items[index].defective_quantity ?? items[index].defectiveQuantity) + addDef,
      last_updated: nowIso(),
    };
    await collectionsBackend.writeCollection(COLLECTIONS.items, items);
    const merged = itemToApi(items[index]);
    merged.quantityAdded = addQty;
    merged.wasMerged = true;
    return merged;
  }

  const created = {
    id: itemData.id || crypto.randomUUID(),
    item_code: normalizeString(itemData.itemCode ?? itemData.item_code),
    name: itemData.name,
    brand: itemData.brand || '',
    category: itemData.category || 'Uncategorized',
    quantity: normalizeNumber(itemData.quantity),
    unit: itemData.unit || 'pcs',
    unit_price: normalizeNumber(itemData.unitPrice ?? itemData.unit_price),
    capital_price: normalizeNumber(
      itemData.capitalPrice ?? itemData.capital_price ?? itemData.unitPrice ?? itemData.unit_price
    ),
    description: itemData.description || '',
    min_stock_level: normalizeNumber(itemData.minStockLevel ?? itemData.min_stock_level),
    last_updated: itemData.lastUpdated || itemData.last_updated || nowIso(),
    created_at: itemData.createdAt ?? itemData.created_at ?? nowIso(),
    receipt_number: itemData.receiptNumber ?? itemData.receipt_number ?? null,
    defective_quantity: normalizeNumber(itemData.defectiveQuantity ?? itemData.defective_quantity),
    photo_filename: itemData.photoFilename ?? itemData.photo_filename ?? null,
    photo_url: itemData.photoUrl ?? itemData.photo_url ?? null,
    stock_purpose:
      itemData.stockPurpose === 'for_supply' || itemData.stock_purpose === 'for_supply' ? 'for_supply' : 'for_sale',
  };
  items.unshift(created);
  await collectionsBackend.writeCollection(COLLECTIONS.items, items);
  return itemToApi(created);
}

export async function updateItem(id, patch) {
  const items = await collectionsBackend.readCollection(COLLECTIONS.items, []);
  const index = items.findIndex((item) => item.id === id);
  if (index === -1) return null;
  items[index] = {
    ...items[index],
    item_code:
      patch.itemCode !== undefined || patch.item_code !== undefined
        ? normalizeString(patch.itemCode ?? patch.item_code)
        : items[index].item_code ?? items[index].itemCode ?? '',
    name: patch.name ?? items[index].name,
    brand: patch.brand ?? items[index].brand,
    category: patch.category ?? items[index].category,
    quantity: patch.quantity ?? items[index].quantity,
    unit: patch.unit ?? items[index].unit,
    unit_price: patch.unitPrice ?? patch.unit_price ?? items[index].unit_price,
    capital_price:
      patch.capitalPrice !== undefined || patch.capital_price !== undefined
        ? normalizeNumber(patch.capitalPrice ?? patch.capital_price)
        : items[index].capital_price ?? items[index].capitalPrice ?? items[index].unit_price,
    description: patch.description ?? items[index].description,
    min_stock_level: patch.minStockLevel ?? patch.min_stock_level ?? items[index].min_stock_level,
    last_updated: patch.lastUpdated ?? patch.last_updated ?? nowIso(),
    receipt_number: patch.receiptNumber ?? patch.receipt_number ?? items[index].receipt_number ?? null,
    defective_quantity: patch.defectiveQuantity ?? patch.defective_quantity ?? items[index].defective_quantity ?? 0,
    photo_filename: patch.photoFilename ?? patch.photo_filename ?? items[index].photo_filename ?? null,
    photo_url: patch.photoUrl ?? patch.photo_url ?? items[index].photo_url ?? null,
    stock_purpose:
      patch.stockPurpose !== undefined || patch.stock_purpose !== undefined
        ? patch.stockPurpose === 'for_supply' || patch.stock_purpose === 'for_supply'
          ? 'for_supply'
          : 'for_sale'
        : items[index].stock_purpose ?? 'for_sale',
  };
  await collectionsBackend.writeCollection(COLLECTIONS.items, items);
  return itemToApi(items[index]);
}

export async function deleteItem(id) {
  const items = await collectionsBackend.readCollection(COLLECTIONS.items, []);
  const target = items.find((item) => item.id === id);
  if (!target) return false;
  await collectionsBackend.writeCollection(
    COLLECTIONS.items,
    items.filter((item) => item.id !== id)
  );
  return true;
}

function roundMoney(value) {
  const n = normalizeNumber(value);
  return Math.round(n * 100) / 100;
}

function normalizeItemMergeSnapshot(raw) {
  const purposeRaw = raw.stockPurpose ?? raw.stock_purpose;
  return {
    itemCode: normalizeString(raw.itemCode ?? raw.item_code).toUpperCase(),
    name: String(raw.name ?? raw.productName ?? '').trim(),
    brand: String(raw.brand ?? '').trim(),
    category: String(raw.category ?? raw.productType ?? 'Uncategorized').trim() || 'Uncategorized',
    unit: String(raw.unit ?? raw.uom ?? 'pcs').trim().toLowerCase() || 'pcs',
    unitPrice: roundMoney(raw.unitPrice ?? raw.unit_price ?? raw.srpPrice),
    capitalPrice: roundMoney(
      raw.capitalPrice ?? raw.capital_price ?? raw.unitCost ?? raw.unitPrice ?? raw.unit_price ?? raw.srpPrice
    ),
    stockPurpose: purposeRaw === 'for_supply' ? 'for_supply' : 'for_sale',
    minStockLevel: Math.round(normalizeNumber(raw.minStockLevel ?? raw.min_stock_level ?? 0)),
  };
}

function itemMergeKeyFromSnapshot(snapshot) {
  return JSON.stringify(snapshot);
}

function itemRowMergeKey(row) {
  return itemMergeKeyFromSnapshot(normalizeItemMergeSnapshot(row));
}

function findItemByMergeKey(items, candidate) {
  const key = itemMergeKeyFromSnapshot(normalizeItemMergeSnapshot(candidate));
  return items.find((entry) => itemRowMergeKey(entry) === key) ?? null;
}

/**
 * Merge inventory rows that match on code, name, brand, type, UOM, prices, and stock use.
 * Different UOM or any other field → kept as separate stock lines.
 */
export async function consolidateDuplicateInventoryItems() {
  let items = await collectionsBackend.readCollection(COLLECTIONS.items, []);
  const groups = new Map();

  for (const item of items) {
    const key = itemRowMergeKey(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }

  const idsToDelete = [];
  const reassign = new Map();
  let mergedGroups = 0;

  for (const group of groups.values()) {
    if (group.length <= 1) continue;
    mergedGroups += 1;
    group.sort(
      (a, b) =>
        new Date(a.created_at ?? a.createdAt ?? 0).getTime() -
        new Date(b.created_at ?? b.createdAt ?? 0).getTime()
    );
    const keeper = group[0];
    let totalQty = 0;
    let totalDef = 0;

    for (const entry of group) {
      totalQty += normalizeNumber(entry.quantity);
      totalDef += normalizeNumber(entry.defective_quantity ?? entry.defectiveQuantity);
      if (entry.id !== keeper.id) {
        idsToDelete.push(entry.id);
        reassign.set(entry.id, keeper.id);
      }
    }

    const keeperIndex = items.findIndex((entry) => entry.id === keeper.id);
    if (keeperIndex !== -1) {
      items[keeperIndex] = {
        ...items[keeperIndex],
        quantity: totalQty,
        defective_quantity: totalDef,
        last_updated: nowIso(),
      };
    }
  }

  if (!mergedGroups) {
    return { mergedGroups: 0, items: items.map(itemToApi) };
  }

  if (reassign.size) {
    const transactions = await collectionsBackend.readCollection(COLLECTIONS.transactions, []);
    const updatedTransactions = transactions.map((tx) => {
      const itemId = tx.item_id ?? tx.itemId;
      const keeperId = reassign.get(itemId);
      if (!keeperId) return tx;
      return { ...tx, item_id: keeperId, itemId: keeperId };
    });
    await collectionsBackend.writeCollection(COLLECTIONS.transactions, updatedTransactions);
  }

  items = items.filter((entry) => !idsToDelete.includes(entry.id));
  await collectionsBackend.writeCollection(COLLECTIONS.items, items);

  return { mergedGroups, items: items.map(itemToApi) };
}

async function postItemAdditionFromImport(item, note) {
  if (Number(item.quantity) <= 0) return;
  const cap = Number(item.capitalPrice ?? item.unitPrice ?? 0);
  await addTransaction({
    id: crypto.randomUUID(),
    itemId: item.id,
    itemName: item.name,
    type: 'ADDITION',
    quantityChange: Number(item.quantity),
    unitPriceAtTime: cap,
    sellingPriceAtTime: Number(item.unitPrice ?? 0),
    totalValue: Number(item.quantity) * cap,
    timestamp: item.createdAt ?? item.lastUpdated ?? nowIso(),
    note: note || 'Price list import',
    itemType: 'Product',
  });
}

async function postItemQuantityAdjustmentFromImport(item, previousQty, note) {
  const delta = Number(item.quantity) - Number(previousQty);
  if (!delta) return;
  const cap = Number(item.capitalPrice ?? item.unitPrice ?? 0);
  await addTransaction({
    id: crypto.randomUUID(),
    itemId: item.id,
    itemName: item.name,
    type: 'ADJUSTMENT',
    quantityChange: delta,
    unitPriceAtTime: cap,
    totalValue: delta * cap,
    timestamp: item.lastUpdated ?? nowIso(),
    note: note || 'Price list import stock update',
    itemType: 'Product',
  });
}

/**
 * Bulk import from Motor World–style inventory price list spreadsheets.
 * mode: upsert (default) updates existing item codes; createOnly skips duplicates.
 */
export async function importInventoryPriceList(rows, options = {}) {
  const mode = options.mode === 'createOnly' ? 'createOnly' : 'upsert';
  const sourceLabel = String(options.sourceLabel || 'Inventory price list import').trim();
  const list = Array.isArray(rows) ? rows : [];
  const results = { created: 0, updated: 0, skipped: 0, errors: [] };

  for (const raw of list) {
    const itemCode = normalizeString(raw.itemCode ?? raw.item_code).toUpperCase();
    const name = String(raw.productName ?? raw.name ?? '').trim();
    const category = String(raw.productType ?? raw.category ?? 'Uncategorized').trim() || 'Uncategorized';
    const brand = String(raw.brand ?? '').trim();
    const unit = String(raw.uom ?? raw.unit ?? 'pcs').trim() || 'pcs';
    const quantity = Math.max(0, normalizeNumber(raw.beginningStock ?? raw.quantity));
    const unitPrice = Math.max(0, normalizeNumber(raw.srpPrice ?? raw.unitPrice ?? raw.unit_price));
    const capitalPrice = Math.max(0, normalizeNumber(raw.unitCost ?? raw.capitalPrice ?? raw.capital_price ?? unitPrice));
    const rowLabel = raw.sourceRow ? `Row ${raw.sourceRow}` : itemCode || 'row';

    if (!itemCode) {
      results.errors.push(`${rowLabel}: missing item code.`);
      continue;
    }
    if (!name) {
      results.errors.push(`${rowLabel}: missing product name.`);
      continue;
    }

    try {
      const allRows = await collectionsBackend.readCollection(COLLECTIONS.items, []);
      const candidate = {
        itemCode,
        name,
        brand,
        category,
        unit,
        unitPrice,
        capitalPrice,
        stockPurpose: 'for_sale',
        minStockLevel: 0,
      };
      const existingRow = findItemByMergeKey(allRows, candidate);

      if (existingRow) {
        if (mode === 'createOnly') {
          results.skipped += 1;
          continue;
        }
        const beforeQty = normalizeNumber(existingRow.quantity);
        const mergedQty = beforeQty + quantity;
        const updated = await updateItem(existingRow.id, {
          name,
          brand,
          category,
          unit,
          quantity: mergedQty,
          unitPrice,
          capitalPrice,
          description: existingRow.description || `${category} — ${brand}`.trim(),
        });
        if (!updated) {
          results.errors.push(`${rowLabel}: could not update ${itemCode}.`);
          continue;
        }
        await postItemQuantityAdjustmentFromImport(updated, beforeQty, sourceLabel);
        results.updated += 1;
        continue;
      }

      const created = await createItem({
        itemCode,
        name,
        brand,
        category,
        unit,
        quantity,
        unitPrice,
        capitalPrice,
        description: `${category} — ${brand}`.replace(/ — $/, '').trim(),
        minStockLevel: 0,
        stockPurpose: 'for_sale',
      });
      await postItemAdditionFromImport(created, sourceLabel);
      results.created += 1;
    } catch (e) {
      results.errors.push(`${rowLabel}: ${e?.message || 'import failed.'}`);
    }
  }

  const consolidated = await consolidateDuplicateInventoryItems();
  results.mergedGroups = consolidated.mergedGroups;

  return results;
}

export async function getTransactions() {
  return (await collectionsBackend.readCollection(COLLECTIONS.transactions, []))
    .map(transactionToApi)
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}

export async function getTransactionById(id) {
  const tx = (await collectionsBackend.readCollection(COLLECTIONS.transactions, [])).find((entry) => entry.id === id);
  return tx ? transactionToApi(tx) : null;
}

export async function addTransaction(tx) {
  const transactions = await collectionsBackend.readCollection(COLLECTIONS.transactions, []);
  const raw = {
    id: tx.id || crypto.randomUUID(),
    item_id: tx.itemId ?? tx.item_id ?? null,
    item_name: tx.itemName ?? tx.item_name ?? '',
    type: tx.type,
    quantity_change: normalizeNumber(tx.quantityChange ?? tx.quantity_change),
    unit_price_at_time: normalizeNumber(tx.unitPriceAtTime ?? tx.unit_price_at_time),
    selling_price_at_time:
      tx.sellingPriceAtTime != null || tx.selling_price_at_time != null
        ? normalizeNumber(tx.sellingPriceAtTime ?? tx.selling_price_at_time)
        : null,
    total_value: normalizeNumber(tx.totalValue ?? tx.total_value),
    timestamp: tx.timestamp || nowIso(),
    recipient: tx.recipient ?? null,
    note: tx.note ?? null,
    receipt_number: tx.receiptNumber ?? tx.receipt_number ?? null,
    release_transaction_id: tx.releaseTransactionId ?? tx.release_transaction_id ?? null,
    return_reason: tx.returnReason ?? tx.return_reason ?? null,
    return_reason_others: tx.returnReasonOthers ?? tx.return_reason_others ?? null,
    return_reason_text: tx.returnReasonText ?? tx.return_reason_text ?? null,
    condition: tx.condition ?? null,
    mode_of_payment: tx.modeOfPayment ?? tx.mode_of_payment ?? null,
    mode_of_payment_other: tx.modeOfPaymentOther ?? tx.mode_of_payment_other ?? null,
    person_id: tx.personId ?? tx.person_id ?? null,
    vehicle_id: tx.vehicleId ?? tx.vehicle_id ?? null,
    discount_percent: tx.discountPercent ?? tx.discount_percent ?? null,
    discount_amount: tx.discountAmount ?? tx.discount_amount ?? null,
    tax_percent: tx.taxPercent ?? tx.tax_percent ?? null,
    tax_amount: tx.taxAmount ?? tx.tax_amount ?? null,
    item_type: tx.itemType ?? tx.item_type ?? 'Product',
    released_by: tx.releasedBy ?? tx.released_by ?? null,
    return_processed_by: tx.returnProcessedBy ?? tx.return_processed_by ?? null,
    purchase_id: tx.purchaseId ?? tx.purchase_id ?? null,
    invoice_number: tx.invoiceNumber ?? tx.invoice_number ?? null,
    due_date: tx.dueDate ?? tx.due_date ?? null,
    terms: tx.terms ?? null,
    pos_line_items: tx.posLineItems ?? tx.pos_line_items ?? null,
    cheque_expected_clear_date:
      tx.chequeExpectedClearDate ?? tx.cheque_expected_clear_date ?? null,
    cheque_reference: tx.chequeReference ?? tx.cheque_reference ?? null,
    cheque_status: tx.chequeStatus ?? tx.cheque_status ?? null,
    cheque_cleared_at: tx.chequeClearedAt ?? tx.cheque_cleared_at ?? null,
    edited_at: tx.editedAt ?? tx.edited_at ?? null,
    edit_note: tx.editNote ?? tx.edit_note ?? null,
    shop_id: tx.shopId ?? tx.shop_id ?? getActiveShopId(),
    historical_sale: Boolean(tx.historicalSale ?? tx.historical_sale),
    subtotal_before_discount:
      tx.subtotalBeforeDiscount != null ? normalizeNumber(tx.subtotalBeforeDiscount) : null,
    total_cost_at_time: tx.totalCostAtTime != null ? normalizeNumber(tx.totalCostAtTime) : null,
    net_income: tx.netIncome != null ? normalizeNumber(tx.netIncome) : null,
    bundled_sale: tx.bundledSale != null ? Boolean(tx.bundledSale) : null,
  };
  transactions.unshift(raw);
  await collectionsBackend.writeCollection(COLLECTIONS.transactions, transactions);
  return transactionToApi(raw);
}

export async function updateTransaction(id, patch) {
  const transactions = await collectionsBackend.readCollection(COLLECTIONS.transactions, []);
  const index = transactions.findIndex((tx) => tx.id === id);
  if (index === -1) return null;
  transactions[index] = { ...transactions[index], ...patch };
  await collectionsBackend.writeCollection(COLLECTIONS.transactions, transactions);
  return transactionToApi(transactions[index]);
}

/**
 * Recompute quantity, weighted SRP/capital, and defective pool for one SKU from the full transaction ledger.
 * Used after correcting an ADDITION row so inventory stays consistent with history.
 */
export async function rebuildProductItemInventoryFromLedger(itemId) {
  const item = await getItemById(itemId);
  if (!item) return null;

  const rawList = await collectionsBackend.readCollection(COLLECTIONS.transactions, []);
  const relevant = rawList
    .map((row) => transactionToApi(row))
    .filter((t) => {
      if (t.itemType === 'Service') return false;
      if (
        t.posLineItems &&
        Array.isArray(t.posLineItems) &&
        t.posLineItems.some((l) => l.itemId === itemId && l.itemType === 'Product')
      ) {
        return true;
      }
      return t.itemId === itemId;
    })
    .sort((a, b) => {
      const ta = new Date(a.timestamp).getTime();
      const tb = new Date(b.timestamp).getTime();
      if (ta !== tb) return ta - tb;
      return String(a.id).localeCompare(String(b.id));
    });

  let qty = 0;
  let defectiveQty = 0;
  let unitPrice = 0;
  let capitalPrice = 0;

  for (const t of relevant) {
    const type = t.type;
    if ((type === 'RELEASE' || type === 'ISSUE') && t.posLineItems && t.posLineItems.length > 0) {
      for (const line of t.posLineItems) {
        if (line.itemType === 'Product' && line.itemId === itemId) {
          qty -= Math.abs(Number(line.quantity) || 0);
        }
      }
      continue;
    }
    if (t.itemId !== itemId) continue;

    if (type === 'ADDITION') {
      const addQ = Math.abs(Number(t.quantityChange));
      const cost = Number(t.unitPriceAtTime);
      const sellInput = t.sellingPriceAtTime;
      const sell =
        sellInput != null && Number.isFinite(Number(sellInput)) ? Number(sellInput) : unitPrice || cost;
      const q0 = qty;
      const q1 = q0 + addQ;
      const oldCap = q0 > 0 ? capitalPrice : cost;
      const oldSell = q0 > 0 ? unitPrice : sell;
      const newCap = q1 > 0 ? (q0 * oldCap + addQ * cost) / q1 : cost;
      const newSell =
        sellInput != null && Number.isFinite(Number(sellInput))
          ? (q0 * oldSell + addQ * sell) / q1
          : q0 > 0
            ? oldSell
            : sell;
      qty = q1;
      capitalPrice = newCap;
      unitPrice = newSell;
    } else if (type === 'RELEASE' || type === 'ISSUE') {
      qty += Number(t.quantityChange);
    } else if (type === 'RETURN') {
      qty += Number(t.quantityChange);
    } else if (type === 'RETURN_FROM_SALES') {
      const q = Math.abs(Number(t.quantityChange));
      if (t.condition === 'defective') defectiveQty += q;
      else qty += q;
    } else if (type === 'ADJUSTMENT') {
      qty += Number(t.quantityChange);
    }
  }

  const qi = Math.max(0, Math.round(Number(qty) || 0));
  const dqi = Math.max(0, Math.round(Number(defectiveQty) || 0));

  return await updateItem(itemId, {
    quantity: qi,
    unitPrice,
    capitalPrice,
    defectiveQuantity: dqi,
    lastUpdated: nowIso(),
  });
}

export async function getIssueRecipientsByItemId(itemId) {
  return (await getTransactions())
    .filter((tx) => tx.itemId === itemId && (tx.type === 'RELEASE' || tx.type === 'ISSUE') && tx.recipient)
    .map((tx) => tx.recipient)
    .filter(Boolean);
}

export async function getReturnedQuantityForRelease(releaseTransactionId) {
  return (await getTransactions())
    .filter((tx) => tx.releaseTransactionId === releaseTransactionId && tx.type === 'RETURN_FROM_SALES')
    .reduce((sum, tx) => sum + Math.abs(normalizeNumber(tx.quantityChange)), 0);
}

function parseMetadataField(raw) {
  if (raw == null) return null;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(String(raw));
  } catch {
    return null;
  }
}

export async function getActivityLogs({ userId, limit = 100, offset = 0, actionType } = {}) {
  const users = await getUsers();
  const at = actionType ? String(actionType).trim() : '';
  const logs = (await collectionsBackend.readCollection(COLLECTIONS.activityLogs, []))
    .filter((log) => !userId || (log.user_id ?? log.userId) === userId)
    .filter((log) => !at || String(log.action_type ?? log.actionType) === at)
    .sort((a, b) => new Date(b.created_at ?? b.createdAt).getTime() - new Date(a.created_at ?? a.createdAt).getTime());
  const paged = logs.slice(offset, offset + limit);
  return {
    total: logs.length,
    logs: paged.map((log) => {
      const user = users.find((entry) => entry.id === (log.user_id ?? log.userId));
      return {
        id: log.id,
        userId: log.user_id ?? log.userId,
        actionType: log.action_type ?? log.actionType,
        metadata: parseMetadataField(log.metadata),
        createdAt: log.created_at ?? log.createdAt ?? nowIso(),
        userDisplayName: user?.display_name ?? 'Unknown user',
        userEmail: user?.email ?? '',
      };
    }),
  };
}

export async function addActivityLog(entry) {
  const logs = await collectionsBackend.readCollection(COLLECTIONS.activityLogs, []);
  logs.unshift({
    id: entry.id || crypto.randomUUID(),
    user_id: entry.user_id ?? entry.userId,
    action_type: entry.action_type ?? entry.actionType,
    metadata: typeof entry.metadata === 'string' ? entry.metadata : JSON.stringify(entry.metadata ?? {}),
    created_at: entry.created_at ?? entry.createdAt ?? nowIso(),
  });
  await collectionsBackend.writeCollection(COLLECTIONS.activityLogs, logs);
  return logs[0];
}

export async function hasRecentDuplicateNotification(sourceUserId, actionType, message, windowMs = 15000) {
  const notifications = await collectionsBackend.readCollection(COLLECTIONS.notifications, []);
  const threshold = Date.now() - windowMs;
  return notifications.some((notification) => {
    const createdAt = new Date(notification.created_at ?? notification.createdAt ?? 0).getTime();
    return (
      createdAt >= threshold &&
      (notification.source_user_id ?? notification.sourceUserId) === sourceUserId &&
      (notification.action_type ?? notification.actionType) === actionType &&
      notification.message === message
    );
  });
}

export async function addNotification(entry) {
  const notifications = await collectionsBackend.readCollection(COLLECTIONS.notifications, []);
  notifications.unshift({
    id: entry.id || crypto.randomUUID(),
    source_user_id: entry.source_user_id ?? entry.sourceUserId,
    action_type: entry.action_type ?? entry.actionType,
    message: entry.message,
    read: entry.read ?? 0,
    created_at: entry.created_at ?? entry.createdAt ?? nowIso(),
  });
  await collectionsBackend.writeCollection(COLLECTIONS.notifications, notifications);
  return notifications[0];
}

export async function getNotifications({ unreadOnly = false, limit = 30, offset = 0 } = {}) {
  const users = await getUsers();
  const notifications = (await collectionsBackend.readCollection(COLLECTIONS.notifications, []))
    .filter((notification) => (unreadOnly ? !notification.read : true))
    .sort((a, b) => new Date(b.created_at ?? b.createdAt).getTime() - new Date(a.created_at ?? a.createdAt).getTime());
  const paged = notifications.slice(offset, offset + limit);
  return {
    total: notifications.length,
    notifications: paged.map((notification) => {
      const user = users.find((entry) => entry.id === (notification.source_user_id ?? notification.sourceUserId));
      return {
        id: notification.id,
        sourceUserId: notification.source_user_id ?? notification.sourceUserId,
        actionType: notification.action_type ?? notification.actionType,
        message: notification.message,
        read: normalizeNumber(notification.read),
        createdAt: notification.created_at ?? notification.createdAt ?? nowIso(),
        sourceDisplayName: user?.display_name ?? '',
        sourceEmail: user?.email ?? '',
      };
    }),
  };
}

export async function markNotificationRead(id) {
  const notifications = await collectionsBackend.readCollection(COLLECTIONS.notifications, []);
  const index = notifications.findIndex((notification) => notification.id === id);
  if (index === -1) return false;
  notifications[index].read = 1;
  await collectionsBackend.writeCollection(COLLECTIONS.notifications, notifications);
  return true;
}

export async function markAllNotificationsRead() {
  const notifications = await collectionsBackend.readCollection(COLLECTIONS.notifications, []);
  notifications.forEach((notification) => {
    notification.read = 1;
  });
  await collectionsBackend.writeCollection(COLLECTIONS.notifications, notifications);
  return true;
}

export async function getPersons() {
  return (await collectionsBackend.readCollection(COLLECTIONS.persons, []))
    .map(personToApi)
    .sort((a, b) => a.fullName.localeCompare(b.fullName));
}

export async function getPersonById(id) {
  const person = (await collectionsBackend.readCollection(COLLECTIONS.persons, [])).find((entry) => entry.id === id);
  return person ? personToApi(person) : null;
}

export async function createPerson(data) {
  const persons = await collectionsBackend.readCollection(COLLECTIONS.persons, []);
  const created = {
    id: data.id || crypto.randomUUID(),
    full_name: data.fullName,
    contact_number: data.contactNumber || '',
    address: data.address || '',
    email: data.email || '',
    created_at: data.createdAt || nowIso(),
  };
  persons.unshift(created);
  await collectionsBackend.writeCollection(COLLECTIONS.persons, persons);
  return personToApi(created);
}

export async function updatePerson(id, patch) {
  const persons = await collectionsBackend.readCollection(COLLECTIONS.persons, []);
  const index = persons.findIndex((person) => person.id === id);
  if (index === -1) return null;
  persons[index] = {
    ...persons[index],
    full_name: patch.fullName ?? persons[index].full_name,
    contact_number: patch.contactNumber ?? persons[index].contact_number,
    address: patch.address ?? persons[index].address,
    email: patch.email ?? persons[index].email,
  };
  await collectionsBackend.writeCollection(COLLECTIONS.persons, persons);
  return personToApi(persons[index]);
}

export async function deletePerson(id) {
  const persons = await collectionsBackend.readCollection(COLLECTIONS.persons, []);
  const loans = (await getLoans()).filter((loan) => loan.personId === id && loan.status !== 'paid' && loan.status !== 'cash');
  const soas = (await collectionsBackend.readCollection(COLLECTIONS.soas, [])).filter((soa) => (soa.person_id ?? soa.personId) === id);
  if (loans.length > 0 || soas.length > 0) {
    throw new Error('Cannot delete person with linked SOA or loan records.');
  }
  await collectionsBackend.writeCollection(
    COLLECTIONS.persons,
    persons.filter((person) => person.id !== id)
  );
  return true;
}

export async function getVehicles(personId) {
  return (await collectionsBackend.readCollection(COLLECTIONS.vehicles, []))
    .filter((vehicle) => !personId || (vehicle.person_id ?? vehicle.personId) === personId)
    .map(vehicleToApi)
    .sort((a, b) => a.plateNumber.localeCompare(b.plateNumber));
}

export async function getVehicleById(id) {
  const vehicle = (await collectionsBackend.readCollection(COLLECTIONS.vehicles, [])).find((entry) => entry.id === id);
  return vehicle ? vehicleToApi(vehicle) : null;
}

export async function createVehicle(data) {
  const vehicles = await collectionsBackend.readCollection(COLLECTIONS.vehicles, []);
  const created = {
    id: data.id || crypto.randomUUID(),
    person_id: data.personId,
    plate_number: String(data.plateNumber || '').trim().toUpperCase(),
    brand: data.brand || '',
    model: data.model || '',
    year: data.year ?? null,
    color: data.color || '',
    created_at: data.createdAt || nowIso(),
  };
  vehicles.unshift(created);
  await collectionsBackend.writeCollection(COLLECTIONS.vehicles, vehicles);
  return vehicleToApi(created);
}

export async function updateVehicle(id, patch) {
  const vehicles = await collectionsBackend.readCollection(COLLECTIONS.vehicles, []);
  const index = vehicles.findIndex((vehicle) => vehicle.id === id);
  if (index === -1) return null;
  vehicles[index] = {
    ...vehicles[index],
    person_id: patch.personId ?? vehicles[index].person_id,
    plate_number: patch.plateNumber ? String(patch.plateNumber).trim().toUpperCase() : vehicles[index].plate_number,
    brand: patch.brand ?? vehicles[index].brand,
    model: patch.model ?? vehicles[index].model,
    year: patch.year ?? vehicles[index].year,
    color: patch.color ?? vehicles[index].color,
  };
  await collectionsBackend.writeCollection(COLLECTIONS.vehicles, vehicles);
  return vehicleToApi(vehicles[index]);
}

export async function deleteVehicle(id) {
  const hasTx = (await getTransactions()).some((tx) => tx.vehicleId === id);
  const hasLoan = (await getLoans()).some((loan) => loan.vehicleId === id);
  if (hasTx || hasLoan) {
    throw new Error('Cannot delete vehicle with linked transactions or loans.');
  }
  const vehicles = await collectionsBackend.readCollection(COLLECTIONS.vehicles, []);
  await collectionsBackend.writeCollection(
    COLLECTIONS.vehicles,
    vehicles.filter((vehicle) => vehicle.id !== id)
  );
  return true;
}

export async function getExpenses({ category, fromDate, toDate } = {}) {
  return (await collectionsBackend.readCollection(COLLECTIONS.expenses, []))
    .map(expenseToApi)
    .filter((expense) => !category || expense.category === category)
    .filter((expense) => !fromDate || new Date(expense.date).getTime() >= new Date(fromDate).getTime())
    .filter((expense) => !toDate || new Date(expense.date).getTime() <= new Date(toDate).getTime())
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

export async function createExpense(data) {
  const expenses = await collectionsBackend.readCollection(COLLECTIONS.expenses, []);
  const created = {
    id: data.id || crypto.randomUUID(),
    title: data.title,
    category: data.category,
    amount: normalizeNumber(data.amount),
    description: data.description || '',
    date: data.date || nowIso(),
    recorded_by: data.recordedBy || 'System',
    recorded_by_user_id: data.recordedByUserId ?? null,
    created_at: data.createdAt || nowIso(),
  };
  expenses.unshift(created);
  await collectionsBackend.writeCollection(COLLECTIONS.expenses, expenses);
  return expenseToApi(created);
}

export async function getSuppliers() {
  return (await collectionsBackend.readCollection(COLLECTIONS.suppliers, []))
    .map(supplierToApi)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function getSupplierById(id) {
  const supplier = (await collectionsBackend.readCollection(COLLECTIONS.suppliers, [])).find((entry) => entry.id === id);
  return supplier ? supplierToApi(supplier) : null;
}

export async function createSupplier(data) {
  const suppliers = await collectionsBackend.readCollection(COLLECTIONS.suppliers, []);
  const created = {
    id: data.id || crypto.randomUUID(),
    name: data.name,
    contact_number: data.contactNumber || '',
    address: data.address || '',
    email: data.email || '',
    tin: data.tin || '',
    created_at: data.createdAt || nowIso(),
  };
  suppliers.unshift(created);
  await collectionsBackend.writeCollection(COLLECTIONS.suppliers, suppliers);
  return supplierToApi(created);
}

export async function updateSupplier(id, patch) {
  const suppliers = await collectionsBackend.readCollection(COLLECTIONS.suppliers, []);
  const index = suppliers.findIndex((supplier) => supplier.id === id);
  if (index === -1) return null;
  suppliers[index] = {
    ...suppliers[index],
    name: patch.name ?? suppliers[index].name,
    contact_number: patch.contactNumber ?? suppliers[index].contact_number,
    address: patch.address ?? suppliers[index].address,
    email: patch.email ?? suppliers[index].email,
    tin: patch.tin ?? suppliers[index].tin,
  };
  await collectionsBackend.writeCollection(COLLECTIONS.suppliers, suppliers);
  return supplierToApi(suppliers[index]);
}

export async function deleteSupplier(id) {
  const hasPurchases = (await collectionsBackend.readCollection(COLLECTIONS.purchases, [])).some(
    (purchase) => (purchase.supplier_id ?? purchase.supplierId) === id
  );
  if (hasPurchases) {
    throw new Error('Cannot delete supplier with purchase records.');
  }
  const suppliers = await collectionsBackend.readCollection(COLLECTIONS.suppliers, []);
  await collectionsBackend.writeCollection(
    COLLECTIONS.suppliers,
    suppliers.filter((supplier) => supplier.id !== id)
  );
  return true;
}

export async function getPurchases({ status } = {}) {
  return (await collectionsBackend.readCollection(COLLECTIONS.purchases, []))
    .map(purchaseToApi)
    .filter((purchase) => !status || purchase.status === status)
    .sort((a, b) => new Date(b.purchaseDate).getTime() - new Date(a.purchaseDate).getTime());
}

export async function getPurchaseById(id) {
  const purchase = (await collectionsBackend.readCollection(COLLECTIONS.purchases, [])).find((entry) => entry.id === id);
  return purchase ? purchaseToApi(purchase) : null;
}

export async function createPurchase(purchaseData) {
  const purchases = await collectionsBackend.readCollection(COLLECTIONS.purchases, []);
  const items = await collectionsBackend.readCollection(COLLECTIONS.items, []);
  const purchase = {
    id: purchaseData.id || crypto.randomUUID(),
    supplier_id: purchaseData.supplierId,
    supplier_name: purchaseData.supplierName,
    purchase_date: purchaseData.purchaseDate || nowIso(),
    payment_type: purchaseData.paymentType,
    total_amount: normalizeNumber(purchaseData.totalAmount),
    status: purchaseData.status || (purchaseData.paymentType === 'cash' ? 'paid' : 'unpaid'),
    receipt_number: purchaseData.receiptNumber ?? null,
    note: purchaseData.note ?? null,
    line_items: purchaseData.lineItems || [],
    payments: purchaseData.payments || [],
    created_at: purchaseData.createdAt || nowIso(),
    purchase_discount_mode: purchaseData.purchaseDiscountMode ?? 'none',
    purchase_discount_value: normalizeNumber(purchaseData.purchaseDiscountValue ?? 0),
    merchandise_subtotal: normalizeNumber(purchaseData.merchandiseSubtotal ?? 0),
    discount_total: normalizeNumber(purchaseData.discountTotal ?? 0),
    expected_revenue_at_srp: normalizeNumber(purchaseData.expectedRevenueAtSrp ?? 0),
    expected_net_profit: normalizeNumber(purchaseData.expectedNetProfit ?? 0),
  };

  purchases.unshift(purchase);

  const lineItems = purchase.line_items || [];
  lineItems.forEach((line) => {
    const itemId = line.itemId ?? line.item_id;
    const index = items.findIndex((item) => item.id === itemId);
    if (index < 0) return;
    const item = items[index];
    const q0 = normalizeNumber(item.quantity);
    const addQ = normalizeNumber(line.quantity);
    if (addQ <= 0) return;
    const q1 = q0 + addQ;
    const costPerUnit = normalizeNumber(
      line.effectiveUnitCost ?? line.effective_unit_cost ?? line.unitCost ?? line.unit_cost
    );
    const sellPerUnit = normalizeNumber(
      line.sellingPrice ?? line.selling_price ?? line.unit_price ?? item.unit_price ?? item.unitPrice
    );
    const oldCap = normalizeNumber(item.capital_price ?? item.capitalPrice ?? item.unit_price ?? item.unitPrice);
    const oldSell = normalizeNumber(item.unit_price ?? item.unitPrice);
    const newCap = q1 > 0 ? (q0 * oldCap + addQ * costPerUnit) / q1 : costPerUnit;
    const newSell = q1 > 0 ? (q0 * oldSell + addQ * sellPerUnit) / q1 : sellPerUnit;
    items[index] = {
      ...item,
      quantity: q1,
      unit_price: newSell,
      capital_price: newCap,
      receipt_number: purchase.receipt_number,
      last_updated: nowIso(),
    };
  });

  await collectionsBackend.writeCollection(COLLECTIONS.purchases, purchases);
  await collectionsBackend.writeCollection(COLLECTIONS.items, items);
  return purchaseToApi(purchase);
}

export async function addPurchasePayment(purchaseId, payment) {
  const purchases = await collectionsBackend.readCollection(COLLECTIONS.purchases, []);
  const index = purchases.findIndex((purchase) => purchase.id === purchaseId);
  if (index === -1) return null;
  const purchase = purchases[index];
  purchase.payments = purchase.payments || [];
  purchase.payments.push({
    id: payment.id || crypto.randomUUID(),
    amount: normalizeNumber(payment.amount),
    method: payment.method,
    paidAt: payment.paidAt || nowIso(),
    reference: payment.reference || null,
  });
  const balance = normalizeNumber(purchase.total_amount ?? purchase.totalAmount) - totalPaidForPurchase(purchase);
  purchase.status = balance <= 0 ? 'paid' : 'partial';
  purchases[index] = purchase;
  await collectionsBackend.writeCollection(COLLECTIONS.purchases, purchases);
  return purchaseToApi(purchase);
}

export async function getSoaByTransactionId(transactionId) {
  const soa = (await collectionsBackend.readCollection(COLLECTIONS.soas, [])).find((entry) => (entry.transaction_id ?? entry.transactionId) === transactionId);
  return soa ? enrichSoa(soaToApi(soa)) : null;
}

export async function getSoaById(id) {
  const soa = (await collectionsBackend.readCollection(COLLECTIONS.soas, [])).find((entry) => entry.id === id);
  return soa ? enrichSoa(soaToApi(soa)) : null;
}

export async function createSoa(data) {
  const soas = await collectionsBackend.readCollection(COLLECTIONS.soas, []);
  const raw = {
    id: data.id || crypto.randomUUID(),
    transaction_id: data.transactionId,
    customer_name: data.customerName,
    item_id: data.itemId ?? null,
    item_name: data.itemName,
    quantity: normalizeNumber(data.quantity),
    srp: normalizeNumber(data.srp),
    discount_percent: data.discountPercent ?? null,
    discount_amount: data.discountAmount ?? null,
    tax_percent: data.taxPercent ?? null,
    tax_amount: data.taxAmount ?? null,
    total_amount_due: normalizeNumber(data.totalAmountDue),
    transaction_date: data.transactionDate,
    due_date: data.dueDate,
    payment_status: data.paymentStatus ?? 'Unpaid',
    created_at: data.createdAt || nowIso(),
    person_id: data.personId ?? null,
    vehicle_id: data.vehicleId ?? null,
    vehicle_plate_number: data.vehiclePlateNumber ?? null,
    item_type: data.itemType ?? 'Product',
  };
  soas.unshift(raw);
  await collectionsBackend.writeCollection(COLLECTIONS.soas, soas);
  return await enrichSoa(soaToApi(raw));
}

async function enrichSoa(soa) {
  const loan = await getLoanByTransactionId(soa.transactionId);
  let shopId = loan?.shopId ?? null;
  if (shopId == null) {
    const tx = await getTransactionById(soa.transactionId);
    shopId = tx?.shopId ?? null;
  }
  const payments = loan
    ? [
        ...(loan.downPayment > 0
          ? [
              {
                id: `${loan.id}-down-payment`,
                amountPaid: loan.downPayment,
                paidAt: loan.startDate,
                note: 'Down payment',
              },
            ]
          : []),
        ...(await getLoanPayments(loan.id)).map((payment) => ({
          id: payment.id,
          amountPaid: payment.amountPaid,
          paidAt: payment.paidAt,
          note: payment.note ?? null,
        })),
      ]
    : await getSoaPayments(soa.id);
  const totalPaid = payments.reduce((sum, payment) => sum + normalizeNumber(payment.amountPaid), 0);
  const remainingBalance = Math.max(0, normalizeNumber(soa.totalAmountDue) - totalPaid);
  let status = soa.paymentStatus || 'Unpaid';
  if (remainingBalance <= 0) status = 'Paid';
  else if (totalPaid > 0) status = 'Partially Paid';
  else if (new Date(soa.dueDate).getTime() < Date.now()) status = 'Overdue';

  return {
    ...soa,
    shopId,
    paymentsMade: payments,
    totalPaid,
    remainingBalance,
    status,
    paymentSource: loan ? 'loan' : 'soa',
  };
}

export async function updateSoaPaymentStatus(id, status) {
  const soas = await collectionsBackend.readCollection(COLLECTIONS.soas, []);
  const index = soas.findIndex((soa) => soa.id === id);
  if (index === -1) return null;
  soas[index].payment_status = status;
  await collectionsBackend.writeCollection(COLLECTIONS.soas, soas);
  return await enrichSoa(soaToApi(soas[index]));
}

/**
 * Safe SOA / billing statement corrections (customer label, line description, due date).
 * Does not auto-adjust linked loans; use for typographical fixes.
 */
export async function updateSoaRecord(id, body) {
  const soas = await collectionsBackend.readCollection(COLLECTIONS.soas, []);
  const index = soas.findIndex((soa) => soa.id === id);
  if (index === -1) return null;
  const row = soas[index];
  if (body.customerName !== undefined) row.customer_name = String(body.customerName ?? '').trim() || row.customer_name;
  if (body.itemName !== undefined) row.item_name = String(body.itemName ?? '').trim() || row.item_name;
  if (body.dueDate !== undefined) row.due_date = String(body.dueDate ?? '').trim() || row.due_date;
  row.updated_at = nowIso();
  soas[index] = row;
  await collectionsBackend.writeCollection(COLLECTIONS.soas, soas);
  return await enrichSoa(soaToApi(row));
}

export async function addSoaPayment(soaId, payment) {
  const soas = await collectionsBackend.readCollection(COLLECTIONS.soas, []);
  const soa = soas.find((entry) => entry.id === soaId);
  if (!soa) return null;
  const payments = await collectionsBackend.readCollection(COLLECTIONS.soaPayments, []);
  const next = {
    id: payment.id || crypto.randomUUID(),
    soa_id: soaId,
    amount_paid: normalizeNumber(payment.amount),
    paid_at: payment.paidAt || nowIso(),
    method: payment.method || 'cash',
    reference: payment.reference || null,
    note: payment.note || null,
  };
  payments.unshift(next);
  await collectionsBackend.writeCollection(COLLECTIONS.soaPayments, payments);

  const enriched = await getSoaById(soaId);
  if (enriched) {
    const nextStatus =
      enriched.remainingBalance <= 0 ? 'Paid' : enriched.totalPaid > 0 ? 'Partially Paid' : 'Unpaid';
    await updateSoaPaymentStatus(soaId, nextStatus);
  }
  return await getSoaById(soaId);
}

export async function getSoaPayments(soaId) {
  return (await collectionsBackend.readCollection(COLLECTIONS.soaPayments, []))
    .filter((payment) => (payment.soa_id ?? payment.soaId) === soaId)
    .map(soaPaymentToApi)
    .sort((a, b) => new Date(b.paidAt).getTime() - new Date(a.paidAt).getTime());
}

export async function getLoans({ status, customerName, limit, offset = 0 } = {}) {
  let loans = (await collectionsBackend.readCollection(COLLECTIONS.loans, [])).map(loanToApi);
  if (status) loans = loans.filter((loan) => loan.status === status);
  if (customerName) {
    const needle = String(customerName).toLowerCase();
    loans = loans.filter((loan) => String(loan.customerName).toLowerCase().includes(needle));
  }
  loans = loans.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  if (typeof limit === 'number') {
    loans = loans.slice(offset, offset + limit);
  }
  return await Promise.all(
    loans.map(async (loan) => {
      const saleTx = loan.transactionId ? await getTransactionById(loan.transactionId) : null;
      return {
        ...loan,
        shopId: saleTx?.shopId ?? null,
        payments: await getLoanPayments(loan.id),
      };
    })
  );
}

export async function getLoanById(id) {
  const loan = (await collectionsBackend.readCollection(COLLECTIONS.loans, [])).find((entry) => entry.id === id);
  if (!loan) return null;
  const tid = loan.transaction_id ?? loan.transactionId;
  const saleTx = tid ? await getTransactionById(tid) : null;
  return {
    ...loanToApi(loan),
    shopId: saleTx?.shopId ?? null,
    payments: await getLoanPayments(id),
  };
}

export async function getLoanByTransactionId(transactionId) {
  const loan = (await collectionsBackend.readCollection(COLLECTIONS.loans, [])).find((entry) => (entry.transaction_id ?? entry.transactionId) === transactionId);
  return loan ? await getLoanById(loan.id) : null;
}

export async function createLoan(data) {
  const loans = await collectionsBackend.readCollection(COLLECTIONS.loans, []);
  const raw = {
    id: data.id || crypto.randomUUID(),
    transaction_id: data.transactionId,
    customer_name: data.customerName,
    total_amount: normalizeNumber(data.totalAmount),
    down_payment: normalizeNumber(data.downPayment),
    remaining_balance: normalizeNumber(data.remainingBalance),
    interest_rate: data.interestRate ?? null,
    start_date: data.startDate,
    due_date: data.dueDate,
    payment_schedule: data.paymentSchedule,
    status: data.status ?? 'ongoing',
    created_at: data.createdAt || nowIso(),
    updated_at: data.updatedAt || nowIso(),
    person_id: data.personId ?? null,
    vehicle_id: data.vehicleId ?? null,
    vehicle_plate_number: data.vehiclePlateNumber ?? null,
  };
  loans.unshift(raw);
  await collectionsBackend.writeCollection(COLLECTIONS.loans, loans);
  return await getLoanById(raw.id);
}

export async function getLoanPayments(loanId) {
  return (await collectionsBackend.readCollection(COLLECTIONS.loanPayments, []))
    .filter((payment) => (payment.loan_id ?? payment.loanId) === loanId)
    .map(loanPaymentToApi)
    .sort((a, b) => new Date(b.paidAt).getTime() - new Date(a.paidAt).getTime());
}

export async function addLoanPayment(loanId, payment) {
  const loans = await collectionsBackend.readCollection(COLLECTIONS.loans, []);
  const loanIndex = loans.findIndex((loan) => loan.id === loanId);
  if (loanIndex === -1) return null;
  const currentLoan = loanToApi(loans[loanIndex]);
  const amountPaid = normalizeNumber(payment.amountPaid ?? payment.amount);
  const remainingBalance = Math.max(0, currentLoan.remainingBalance - amountPaid);
  const payments = await collectionsBackend.readCollection(COLLECTIONS.loanPayments, []);
  const newPayment = {
    id: payment.id || crypto.randomUUID(),
    loan_id: loanId,
    amount_paid: amountPaid,
    paid_at: payment.paidAt || nowIso(),
    remaining_balance_after: remainingBalance,
    note: payment.note || null,
  };
  payments.unshift(newPayment);
  await collectionsBackend.writeCollection(COLLECTIONS.loanPayments, payments);

  loans[loanIndex] = {
    ...loans[loanIndex],
    remaining_balance: remainingBalance,
    status: remainingBalance <= 0 ? 'paid' : 'ongoing',
    updated_at: nowIso(),
  };
  await collectionsBackend.writeCollection(COLLECTIONS.loans, loans);

  const linkedSoa = await getSoaByTransactionId(currentLoan.transactionId);
  if (linkedSoa) {
    await updateSoaPaymentStatus(linkedSoa.id, remainingBalance <= 0 ? 'Paid' : 'Partially Paid');
  }
  return await getLoanById(loanId);
}

export async function updateLoanStatus(id, status) {
  const loans = await collectionsBackend.readCollection(COLLECTIONS.loans, []);
  const index = loans.findIndex((loan) => loan.id === id);
  if (index === -1) return null;
  loans[index].status = status;
  loans[index].updated_at = nowIso();
  if (status === 'cash' || status === 'paid') {
    loans[index].remaining_balance = 0;
  }
  await collectionsBackend.writeCollection(COLLECTIONS.loans, loans);
  const linkedSoa = await getSoaByTransactionId(loans[index].transaction_id ?? loans[index].transactionId);
  if (linkedSoa && (status === 'cash' || status === 'paid')) {
    await updateSoaPaymentStatus(linkedSoa.id, 'Paid');
  }
  return await getLoanById(id);
}

export async function getPaymentJournal({ limit = 200, offset = 0 } = {}) {
  const allSoas = await collectionsBackend.readCollection(COLLECTIONS.soas, []);
  const allLoans = await collectionsBackend.readCollection(COLLECTIONS.loans, []);
  const soaPayments = await collectionsBackend.readCollection(COLLECTIONS.soaPayments, []);
  const loanPayments = await collectionsBackend.readCollection(COLLECTIONS.loanPayments, []);
  const soaEntries = soaPayments.map((payment) => {
    const soa = allSoas.find((entry) => entry.id === (payment.soa_id ?? payment.soaId));
    return {
      id: payment.id,
      type: 'soa',
      soaId: payment.soa_id ?? payment.soaId,
      loanId: null,
      transactionId: soa?.transaction_id ?? null,
      customerName: soa?.customer_name ?? '',
      amount: normalizeNumber(payment.amount_paid ?? payment.amountPaid),
      method: payment.method ?? 'cash',
      paidAt: payment.paid_at ?? payment.paidAt,
      reference: payment.reference ?? null,
      note: payment.note ?? null,
    };
  });

  const loanEntries = loanPayments.map((payment) => {
    const loan = allLoans.find((entry) => entry.id === (payment.loan_id ?? payment.loanId));
    return {
      id: payment.id,
      type: 'loan',
      soaId: null,
      loanId: payment.loan_id ?? payment.loanId,
      transactionId: loan?.transaction_id ?? null,
      customerName: loan?.customer_name ?? '',
      amount: normalizeNumber(payment.amount_paid ?? payment.amountPaid),
      method: 'loan',
      paidAt: payment.paid_at ?? payment.paidAt,
      reference: null,
      note: payment.note ?? null,
    };
  });

  return [...soaEntries, ...loanEntries]
    .sort((a, b) => new Date(b.paidAt).getTime() - new Date(a.paidAt).getTime())
    .slice(offset, offset + limit);
}

function documentArchiveToApi(row) {
  const snap = row.transaction_snapshot ?? row.transactionSnapshot;
  return {
    id: row.id,
    kind: row.kind,
    transactionId: row.transaction_id ?? row.transactionId,
    soaId: row.soa_id ?? row.soaId ?? null,
    transactionSnapshot: typeof snap === 'string' ? parseMetadataField(snap) : snap ?? null,
    customerName: row.customer_name ?? row.customerName ?? '',
    totalValue: normalizeNumber(row.total_value ?? row.totalValue),
    createdAt: row.created_at ?? row.createdAt ?? null,
    createdByUserId: row.created_by_user_id ?? row.createdByUserId ?? null,
    updatedAt: row.updated_at ?? row.updatedAt ?? null,
    updatedByUserId: row.updated_by_user_id ?? row.updatedByUserId ?? null,
    editNote: row.edit_note ?? row.editNote ?? null,
  };
}

export async function upsertDocumentArchivesForRelease(transactionApi, userId, { soaId = null } = {}) {
  if (!transactionApi?.id) return null;
  const rows = await collectionsBackend.readCollection(COLLECTIONS.documentArchives, []);
  const ts = nowIso();
  const kinds = [
    { kind: 'pos_receipt', soa_id: null },
    { kind: 'billing_statement', soa_id: soaId || null },
  ];
  for (const { kind, soa_id } of kinds) {
    const idx = rows.findIndex(
      (r) => (r.transaction_id ?? r.transactionId) === transactionApi.id && r.kind === kind
    );
    const base = {
      kind,
      transaction_id: transactionApi.id,
      transaction_snapshot: transactionApi,
      customer_name: transactionApi.recipient || '',
      total_value: normalizeNumber(transactionApi.totalValue),
      soa_id,
      updated_at: ts,
      updated_by_user_id: userId,
    };
    if (idx >= 0) {
      rows[idx] = { ...rows[idx], ...base, id: rows[idx].id };
    } else {
      rows.unshift({
        id: crypto.randomUUID(),
        ...base,
        created_at: ts,
        created_by_user_id: userId,
      });
    }
  }
  await collectionsBackend.writeCollection(COLLECTIONS.documentArchives, rows);
  return true;
}

export async function listDocumentArchives({
  q = '',
  kind = '',
  from = '',
  to = '',
  transactionId = '',
  limit = 50,
  offset = 0,
} = {}) {
  let rows = await collectionsBackend.readCollection(COLLECTIONS.documentArchives, []);
  const qq = String(q || '').trim().toLowerCase();
  const kt = String(kind || '').trim();
  const txf = String(transactionId || '').trim();
  if (txf) {
    rows = rows.filter((r) => (r.transaction_id ?? r.transactionId) === txf);
  }
  if (kt) {
    rows = rows.filter((r) => r.kind === kt);
  }
  if (qq) {
    rows = rows.filter((r) => {
      const cust = String(r.customer_name ?? r.customerName ?? '').toLowerCase();
      const tid = String(r.transaction_id ?? r.transactionId ?? '').toLowerCase();
      return cust.includes(qq) || tid.includes(qq);
    });
  }
  if (from) {
    const t0 = new Date(from).getTime();
    rows = rows.filter((r) => new Date(r.created_at ?? r.createdAt ?? 0).getTime() >= t0);
  }
  if (to) {
    const t1 = new Date(to).getTime() + 86400000;
    rows = rows.filter((r) => new Date(r.created_at ?? r.createdAt ?? 0).getTime() < t1);
  }
  rows.sort(
    (a, b) =>
      new Date(b.updated_at ?? b.updatedAt ?? b.created_at ?? b.createdAt ?? 0).getTime() -
      new Date(a.updated_at ?? a.updatedAt ?? a.created_at ?? a.createdAt ?? 0).getTime()
  );
  const total = rows.length;
  const paged = rows.slice(offset, offset + limit).map(documentArchiveToApi);
  return { total, archives: paged };
}

export async function getDocumentArchiveById(id) {
  const rows = await collectionsBackend.readCollection(COLLECTIONS.documentArchives, []);
  const row = rows.find((r) => r.id === id);
  return row ? documentArchiveToApi(row) : null;
}

export async function updateDocumentArchiveSnapshot(id, { transactionSnapshot, editNote }, userId) {
  const rows = await collectionsBackend.readCollection(COLLECTIONS.documentArchives, []);
  const index = rows.findIndex((r) => r.id === id);
  if (index === -1) return null;
  const ts = nowIso();
  rows[index] = {
    ...rows[index],
    transaction_snapshot: transactionSnapshot ?? rows[index].transaction_snapshot,
    edit_note: editNote != null ? String(editNote) : rows[index].edit_note ?? null,
    updated_at: ts,
    updated_by_user_id: userId,
    customer_name:
      (transactionSnapshot && transactionSnapshot.recipient) ||
      rows[index].customer_name ||
      rows[index].customerName ||
      '',
    total_value:
      transactionSnapshot != null
        ? normalizeNumber(transactionSnapshot.totalValue)
        : normalizeNumber(rows[index].total_value ?? rows[index].totalValue),
  };
  await collectionsBackend.writeCollection(COLLECTIONS.documentArchives, rows);
  return documentArchiveToApi(rows[index]);
}

export async function listRawCollection(name) {
  return await collectionsBackend.readCollection(name, []);
}

function bookingToApi(row) {
  return {
    id: row.id,
    fullName: normalizeString(row.full_name ?? row.fullName),
    phone: normalizeString(row.phone),
    email: normalizeString(row.email),
    serviceKey: normalizeString(row.service_key ?? row.serviceKey),
    serviceLabel: normalizeString(row.service_label ?? row.serviceLabel),
    preferredDate: row.preferred_date ?? row.preferredDate ?? null,
    vehicleDescription: row.vehicle_description ?? row.vehicleDescription ?? null,
    notes: row.notes ?? null,
    status: normalizeString(row.status ?? 'pending'),
    createdAt: row.created_at ?? row.createdAt ?? nowIso(),
    updatedAt: row.updated_at ?? row.updatedAt ?? null,
    confirmedAt: row.confirmed_at ?? row.confirmedAt ?? null,
    confirmedBy: row.confirmed_by ?? row.confirmedBy ?? null,
    personId: row.person_id ?? row.personId ?? null,
    vehicleId: row.vehicle_id ?? row.vehicleId ?? null,
    transactionId: row.transaction_id ?? row.transactionId ?? null,
    quotedAmount:
      row.quoted_amount != null || row.quotedAmount != null
        ? normalizeNumber(row.quoted_amount ?? row.quotedAmount)
        : null,
    modeOfPayment: row.mode_of_payment ?? row.modeOfPayment ?? null,
    confirmNote: row.confirm_note ?? row.confirmNote ?? null,
    dueDays:
      row.due_days != null || row.dueDays != null
        ? normalizeNumber(row.due_days ?? row.dueDays)
        : null,
    shopId: row.shop_id ?? row.shopId ?? getActiveShopId(),
  };
}

export async function getOnlineBookings({ status } = {}) {
  const rows = await collectionsBackend.readCollection(COLLECTIONS.onlineBookings, []);
  let list = rows.map(bookingToApi);
  if (status) {
    const s = String(status).trim().toLowerCase();
    list = list.filter((b) => String(b.status).toLowerCase() === s);
  }
  return list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export async function getOnlineBookingById(id) {
  const row = (await collectionsBackend.readCollection(COLLECTIONS.onlineBookings, [])).find(
    (b) => b.id === id
  );
  return row ? bookingToApi(row) : null;
}

export async function createOnlineBooking(data) {
  const bookings = await collectionsBackend.readCollection(COLLECTIONS.onlineBookings, []);
  const created = {
    id: data.id || crypto.randomUUID(),
    full_name: String(data.fullName || '').trim(),
    phone: String(data.phone || '').trim(),
    email: String(data.email || '').trim(),
    service_key: String(data.serviceKey || '').trim(),
    service_label: String(data.serviceLabel || '').trim(),
    preferred_date: data.preferredDate ? String(data.preferredDate).trim() : null,
    vehicle_description: data.vehicleDescription ? String(data.vehicleDescription).trim() : null,
    notes: data.notes ? String(data.notes).trim() : null,
    status: 'pending',
    created_at: nowIso(),
    updated_at: null,
    confirmed_at: null,
    confirmed_by: null,
    person_id: null,
    vehicle_id: null,
    transaction_id: null,
    quoted_amount: null,
    mode_of_payment: null,
    confirm_note: null,
    due_days: null,
    shop_id: getActiveShopId(),
  };
  bookings.unshift(created);
  await collectionsBackend.writeCollection(COLLECTIONS.onlineBookings, bookings);
  return bookingToApi(created);
}

async function findOrCreatePersonForBooking(bookingRow) {
  const persons = await collectionsBackend.readCollection(COLLECTIONS.persons, []);
  const email = String(bookingRow.email || '').trim().toLowerCase();
  const phoneDigits = String(bookingRow.phone || '').replace(/\D/g, '');
  let found = persons.find((p) => String(p.email || '').trim().toLowerCase() === email && email);
  if (!found && phoneDigits) {
    found = persons.find((p) => String(p.contact_number || '').replace(/\D/g, '') === phoneDigits);
  }
  if (found) return personToApi(found);
  return createPerson({
    fullName: bookingRow.full_name,
    contactNumber: bookingRow.phone || '',
    email: bookingRow.email || '',
  });
}

async function findOrCreateVehicleForBooking(personId, bookingRow) {
  const desc = String(bookingRow.vehicle_description || '').trim();
  if (!desc) return null;
  const vehicles = await collectionsBackend.readCollection(COLLECTIONS.vehicles, []);
  const plate = `WEB-${String(bookingRow.id).slice(0, 8).toUpperCase()}`;
  const existing = vehicles.find(
    (v) => v.person_id === personId && String(v.plate_number || '').toUpperCase() === plate
  );
  if (existing) return vehicleToApi(existing);
  return createVehicle({
    personId,
    plateNumber: plate,
    brand: desc.slice(0, 120),
  });
}

/**
 * Accept a pending booking: ensure customer + vehicle records, mark confirmed (sale finished in POS).
 */
export async function confirmOnlineBooking(id, options = {}) {
  const bookings = await collectionsBackend.readCollection(COLLECTIONS.onlineBookings, []);
  const index = bookings.findIndex((b) => b.id === id);
  if (index === -1) throw new Error('Booking not found.');
  const row = bookings[index];
  if (String(row.status) !== 'pending') {
    throw new Error('Only pending bookings can be confirmed.');
  }

  const quotedAmount = Math.max(0, normalizeNumber(options.quotedAmount ?? 0));
  const modeOfPayment = String(options.modeOfPayment || 'Cash').trim() || 'Cash';
  const confirmNote = String(options.confirmNote || '').trim();
  const confirmedBy = String(options.confirmedBy || '').trim();
  const dueDays =
    options.dueDays != null ? Math.min(365, Math.max(1, Number(options.dueDays) || 30)) : null;

  const person = await findOrCreatePersonForBooking(row);
  const vehicle = await findOrCreateVehicleForBooking(person.id, row);

  const now = nowIso();
  bookings[index] = {
    ...row,
    status: 'confirmed',
    updated_at: now,
    confirmed_at: now,
    confirmed_by: confirmedBy || null,
    person_id: person.id,
    vehicle_id: vehicle?.id ?? null,
    transaction_id: null,
    quoted_amount: quotedAmount,
    mode_of_payment: modeOfPayment,
    confirm_note: confirmNote || null,
    due_days: modeOfPayment === 'Credit' ? dueDays : null,
  };
  await collectionsBackend.writeCollection(COLLECTIONS.onlineBookings, bookings);
  return { booking: bookingToApi(bookings[index]), person, vehicle };
}

/** Link a POS sale to a confirmed booking after staff completes checkout. */
export async function completeOnlineBookingPosTransfer(id, transactionId, options = {}) {
  const txId = String(transactionId || '').trim();
  if (!txId) throw new Error('Transaction id is required.');

  const bookings = await collectionsBackend.readCollection(COLLECTIONS.onlineBookings, []);
  const index = bookings.findIndex((b) => b.id === id);
  if (index === -1) throw new Error('Booking not found.');
  const row = bookings[index];
  if (String(row.status) !== 'confirmed') {
    throw new Error('Only confirmed bookings can be linked to a POS sale.');
  }
  if (row.transaction_id || row.transactionId) {
    throw new Error('This booking is already linked to a sale.');
  }

  const tx = await getTransactionById(txId);
  if (!tx) throw new Error('Sale transaction not found.');

  const now = nowIso();
  bookings[index] = {
    ...row,
    transaction_id: txId,
    updated_at: now,
    confirmed_by: options.completedBy ? String(options.completedBy).trim() : row.confirmed_by ?? row.confirmedBy,
  };
  await collectionsBackend.writeCollection(COLLECTIONS.onlineBookings, bookings);
  return { booking: bookingToApi(bookings[index]), transaction: tx };
}

export async function cancelOnlineBooking(id, { cancelledBy, reason } = {}) {
  const bookings = await collectionsBackend.readCollection(COLLECTIONS.onlineBookings, []);
  const index = bookings.findIndex((b) => b.id === id);
  if (index === -1) throw new Error('Booking not found.');
  if (String(bookings[index].status) !== 'pending') {
    throw new Error('Only pending bookings can be cancelled.');
  }
  const now = nowIso();
  bookings[index] = {
    ...bookings[index],
    status: 'cancelled',
    updated_at: now,
    confirm_note: reason ? String(reason).trim() : null,
    confirmed_by: cancelledBy ? String(cancelledBy).trim() : null,
  };
  await collectionsBackend.writeCollection(COLLECTIONS.onlineBookings, bookings);
  return bookingToApi(bookings[index]);
}

function employeeToApi(row) {
  return {
    id: row.id,
    employeeCode: normalizeString(row.employee_code ?? row.employeeCode),
    fullName: normalizeString(row.full_name ?? row.fullName, 'Unnamed'),
    position: normalizeString(row.position),
    dailyRate: normalizeNumber(row.daily_rate ?? row.dailyRate),
    standardHoursPerDay: normalizeNumber(row.standard_hours_per_day ?? row.standardHoursPerDay ?? 8) || 8,
    overtimeMultiplier: normalizeNumber(row.overtime_multiplier ?? row.overtimeMultiplier ?? 1.25) || 1.25,
    isActive: row.is_active !== false && row.isActive !== false,
    createdAt: row.created_at ?? row.createdAt ?? null,
    updatedAt: row.updated_at ?? row.updatedAt ?? null,
  };
}

function payrollRunToApi(row) {
  return {
    id: row.id,
    shopId: row.shop_id ?? row.shopId ?? null,
    periodLabel: normalizeString(row.period_label ?? row.periodLabel),
    periodStart: row.period_start ?? row.periodStart ?? '',
    periodEnd: row.period_end ?? row.periodEnd ?? '',
    status: row.status === 'posted' ? 'posted' : 'draft',
    sourceFileName: row.source_file_name ?? row.sourceFileName ?? null,
    importedAt: row.imported_at ?? row.importedAt ?? nowIso(),
    importedBy: row.imported_by ?? row.importedBy ?? null,
    lines: Array.isArray(row.lines) ? row.lines : [],
    totalGross: normalizeNumber(row.total_gross ?? row.totalGross),
    totalNet: normalizeNumber(row.total_net ?? row.totalNet),
    expenseIds: row.expense_ids ?? row.expenseIds ?? [],
    postedAt: row.posted_at ?? row.postedAt ?? null,
    postedBy: row.posted_by ?? row.postedBy ?? null,
  };
}

export async function getEmployees({ activeOnly } = {}) {
  return (await collectionsBackend.readCollection(COLLECTIONS.employees, []))
    .map(employeeToApi)
    .filter((e) => !activeOnly || e.isActive !== false)
    .sort((a, b) => a.fullName.localeCompare(b.fullName, undefined, { sensitivity: 'base' }));
}

export async function getEmployeeById(id) {
  const row = (await collectionsBackend.readCollection(COLLECTIONS.employees, [])).find((e) => e.id === id);
  return row ? employeeToApi(row) : null;
}

export async function createEmployee(data) {
  const employees = await collectionsBackend.readCollection(COLLECTIONS.employees, []);
  const code = normalizeString(data.employeeCode ?? data.employee_code).toUpperCase();
  if (!code) throw new Error('Employee code is required.');
  if (!String(data.fullName ?? data.full_name ?? '').trim()) throw new Error('Full name is required.');
  if (employees.some((e) => String(e.employee_code ?? e.employeeCode ?? '').toUpperCase() === code)) {
    throw new Error('Employee code already exists.');
  }
  const now = nowIso();
  const created = {
    id: data.id || crypto.randomUUID(),
    employee_code: code,
    full_name: String(data.fullName ?? data.full_name).trim(),
    position: String(data.position ?? '').trim(),
    daily_rate: Math.max(0, normalizeNumber(data.dailyRate ?? data.daily_rate)),
    standard_hours_per_day: Math.max(1, normalizeNumber(data.standardHoursPerDay ?? data.standard_hours_per_day ?? 8)),
    overtime_multiplier: Math.max(1, normalizeNumber(data.overtimeMultiplier ?? data.overtime_multiplier ?? 1.25)),
    is_active: data.isActive !== false && data.is_active !== false,
    created_at: now,
    updated_at: null,
  };
  employees.unshift(created);
  await collectionsBackend.writeCollection(COLLECTIONS.employees, employees);
  return employeeToApi(created);
}

export async function updateEmployee(id, patch) {
  const employees = await collectionsBackend.readCollection(COLLECTIONS.employees, []);
  const index = employees.findIndex((e) => e.id === id);
  if (index === -1) return null;
  const nextCode =
    patch.employeeCode !== undefined || patch.employee_code !== undefined
      ? normalizeString(patch.employeeCode ?? patch.employee_code).toUpperCase()
      : employees[index].employee_code ?? employees[index].employeeCode;
  if (
    nextCode &&
    employees.some(
      (e, i) =>
        i !== index && String(e.employee_code ?? e.employeeCode ?? '').toUpperCase() === nextCode
    )
  ) {
    throw new Error('Employee code already exists.');
  }
  employees[index] = {
    ...employees[index],
    employee_code: nextCode || employees[index].employee_code,
    full_name: patch.fullName ?? patch.full_name ?? employees[index].full_name ?? employees[index].fullName,
    position: patch.position ?? employees[index].position ?? '',
    daily_rate:
      patch.dailyRate !== undefined || patch.daily_rate !== undefined
        ? Math.max(0, normalizeNumber(patch.dailyRate ?? patch.daily_rate))
        : employees[index].daily_rate ?? employees[index].dailyRate,
    standard_hours_per_day:
      patch.standardHoursPerDay !== undefined || patch.standard_hours_per_day !== undefined
        ? Math.max(1, normalizeNumber(patch.standardHoursPerDay ?? patch.standard_hours_per_day))
        : employees[index].standard_hours_per_day ?? employees[index].standardHoursPerDay ?? 8,
    overtime_multiplier:
      patch.overtimeMultiplier !== undefined || patch.overtime_multiplier !== undefined
        ? Math.max(1, normalizeNumber(patch.overtimeMultiplier ?? patch.overtime_multiplier))
        : employees[index].overtime_multiplier ?? employees[index].overtimeMultiplier ?? 1.25,
    is_active:
      patch.isActive !== undefined || patch.is_active !== undefined
        ? patch.isActive !== false && patch.is_active !== false
        : employees[index].is_active !== false,
    updated_at: nowIso(),
  };
  await collectionsBackend.writeCollection(COLLECTIONS.employees, employees);
  return employeeToApi(employees[index]);
}

export async function deleteEmployee(id) {
  const employees = await collectionsBackend.readCollection(COLLECTIONS.employees, []);
  if (!employees.some((e) => e.id === id)) return false;
  await collectionsBackend.writeCollection(
    COLLECTIONS.employees,
    employees.filter((e) => e.id !== id)
  );
  return true;
}

export async function getPayrollRuns() {
  return (await collectionsBackend.readCollection(COLLECTIONS.payrollRuns, []))
    .map(payrollRunToApi)
    .sort((a, b) => new Date(b.importedAt).getTime() - new Date(a.importedAt).getTime());
}

export async function getPayrollRunById(id) {
  const row = (await collectionsBackend.readCollection(COLLECTIONS.payrollRuns, [])).find((r) => r.id === id);
  return row ? payrollRunToApi(row) : null;
}

export async function previewPayrollFromDtr({ summaries, periodStart, periodEnd, periodLabel }) {
  const { computePayrollFromDtr } = await import('../lib/payrollCompute.js');
  const employees = await collectionsBackend.readCollection(COLLECTIONS.employees, []);
  const activeEmployees = employees.filter((e) => e.is_active !== false);
  const lines = computePayrollFromDtr(activeEmployees, summaries || []);
  const totalGross = lines.reduce((s, l) => s + (l.grossPay || 0), 0);
  const totalNet = lines.reduce((s, l) => s + (l.netPay || 0), 0);
  return {
    periodLabel: periodLabel || 'Payroll',
    periodStart: periodStart || '',
    periodEnd: periodEnd || '',
    lines,
    totalGross: Math.round(totalGross * 100) / 100,
    totalNet: Math.round(totalNet * 100) / 100,
  };
}

export async function createAndPostPayrollRun(data, { postedBy, recordedBy, recordedByUserId } = {}) {
  const runs = await collectionsBackend.readCollection(COLLECTIONS.payrollRuns, []);
  const lines = Array.isArray(data.lines) ? data.lines : [];
  if (!lines.length) throw new Error('Payroll has no employee lines.');
  const unmatched = lines.filter((l) => !l.matched);
  if (unmatched.length) {
    throw new Error(
      `${unmatched.length} employee(s) not matched to staff profiles. Add them under Employees first.`
    );
  }
  const zeroRate = lines.filter((l) => !(l.dailyRate > 0));
  if (zeroRate.length) {
    throw new Error('All matched employees need a daily rate set before posting payroll.');
  }

  const runId = data.id || crypto.randomUUID();
  const now = nowIso();
  const periodLabel = String(data.periodLabel || data.period_label || 'Payroll').trim();
  const periodStart = String(data.periodStart || data.period_start || '').trim();
  const periodEnd = String(data.periodEnd || data.period_end || '').trim();
  const expenseIds = [];
  const postedLines = [];

  for (const line of lines) {
    const net = Math.max(0, normalizeNumber(line.netPay ?? line.net_pay));
    if (net <= 0) {
      postedLines.push({ ...line, expenseId: null });
      continue;
    }
    const title = `Salary — ${line.employeeName} (${periodLabel})`;
    const description = [
      `Payroll run ${runId.slice(0, 8)}`,
      `Code: ${line.employeeCode}`,
      `Days: ${line.daysWorked}`,
      `Reg hrs: ${line.regularHours}`,
      `OT hrs: ${line.overtimeHours}`,
      line.lateMinutes ? `Late: ${line.lateMinutes} min` : '',
      line.deductions ? `Deductions: ₱${line.deductions}` : '',
    ]
      .filter(Boolean)
      .join(' · ');
    const expense = await createExpense({
      title,
      category: 'Salary',
      amount: net,
      description,
      date: periodEnd ? `${periodEnd}T12:00:00.000Z` : now,
      recordedBy: recordedBy || postedBy || 'System',
      recordedByUserId: recordedByUserId ?? null,
    });
    expenseIds.push(expense.id);
    postedLines.push({ ...line, expenseId: expense.id });
  }

  const created = {
    id: runId,
    shop_id: getActiveShopId(),
    period_label: periodLabel,
    period_start: periodStart,
    period_end: periodEnd,
    status: 'posted',
    source_file_name: data.sourceFileName ?? data.source_file_name ?? null,
    imported_at: now,
    imported_by: postedBy || null,
    lines: postedLines,
    total_gross: normalizeNumber(data.totalGross ?? data.total_gross),
    total_net: normalizeNumber(data.totalNet ?? data.total_net),
    expense_ids: expenseIds,
    posted_at: now,
    posted_by: postedBy || null,
  };
  runs.unshift(created);
  await collectionsBackend.writeCollection(COLLECTIONS.payrollRuns, runs);
  return payrollRunToApi(created);
}

export async function notifyAdminsOnlineBooking(booking) {
  const users = await getUsers();
  const admins = users.filter((u) => u.role === 'admin' || u.role === 'overseer');
  const message = `New online booking: ${booking.fullName} — ${booking.serviceLabel}`;
  for (const admin of admins) {
    await addNotification({
      source_user_id: admin.id,
      action_type: 'ONLINE_BOOKING',
      message,
      read: 0,
    });
  }
}

export {
  itemToApi,
  transactionToApi,
  expenseToApi,
  purchaseToApi,
  supplierToApi,
  personToApi,
  vehicleToApi,
};
