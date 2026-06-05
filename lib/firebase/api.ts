import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import type {
  Expense,
  InventoryItem,
  Loan,
  LoanPayment,
  Person,
  Purchase,
  Supplier,
  Transaction,
  Vehicle,
} from '../types';
import {
  readCurrentFirebaseAppUser,
  signInWithFirebaseEmail,
  signOutFromFirebase,
} from './auth';
import {
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword,
} from 'firebase/auth';
import {
  getFirebaseAuth,
  getFirebaseFirestore,
  getFirebaseFunctions,
  getFirebaseShopId,
} from './app';
import { FIRESTORE_COLLECTIONS, getShopCollection, getShopDoc, getUserDoc } from './schema';

export interface ApiUser {
  id: string;
  email: string;
  displayName: string;
  role: 'overseer' | 'admin';
  createdAt?: string;
}

export interface ActivityLog {
  id: string;
  userId: string;
  actionType: string;
  metadata: string | null;
  createdAt: string;
  userDisplayName: string;
  userEmail: string;
}

export interface NotificationItem {
  id: string;
  sourceUserId: string;
  actionType: string;
  message: string;
  read: number;
  createdAt: string;
  sourceDisplayName: string;
  sourceEmail: string;
}

export interface InventoryItemApi extends InventoryItem {
  photoFilename?: string;
  photoStoragePath?: string | null;
  photoUrl?: string | null;
}

export interface SoaPaymentApi {
  id: string;
  soaId: string;
  amountPaid: number;
  paidAt: string;
  method: 'cash' | 'cheque' | 'card';
  reference?: string | null;
  note?: string | null;
}

export interface StatementOfAccount {
  id: string;
  transactionId: string;
  customerName: string;
  itemId: string | null;
  itemName: string;
  quantity: number;
  srp: number;
  discountPercent?: number | null;
  discountAmount?: number | null;
  taxPercent?: number | null;
  taxAmount?: number | null;
  totalAmountDue: number;
  transactionDate: string;
  dueDate: string;
  paymentStatus: 'Unpaid' | 'Partially Paid' | 'Paid' | 'Overdue';
  createdAt: string;
  personId?: string | null;
  vehicleId?: string | null;
  vehiclePlateNumber?: string | null;
  billingTotal?: number;
  paymentsMade?: {
    id: string;
    amountPaid: number;
    paidAt: string;
    method?: string;
    reference?: string | null;
    note?: string | null;
  }[];
  totalPaid?: number;
  remainingBalance?: number;
  status?: 'Unpaid' | 'Partially Paid' | 'Paid' | 'Overdue';
  paymentSource?: 'loan' | 'soa';
}

export interface LoanApi extends Loan {
  personId?: string | null;
  vehicleId?: string | null;
  vehiclePlateNumber?: string | null;
}

export interface LoanPaymentApi extends LoanPayment {}

export interface PaymentJournalEntry {
  id: string;
  type: 'soa' | 'loan';
  soaId: string | null;
  loanId: string | null;
  transactionId: string;
  customerName: string;
  amount: number;
  method: string;
  paidAt: string;
  reference: string | null;
  note: string | null;
}

export interface PersonApi extends Person {}
export interface VehicleApi extends Vehicle {}
export interface ExpenseApi extends Expense {}
export interface SupplierApi extends Supplier {}
export interface PurchaseApi extends Purchase {}

function dbOrThrow() {
  const db = getFirebaseFirestore();
  if (!db) throw new Error('Firebase is not configured.');
  return db;
}

async function callFunction<TInput extends Record<string, unknown>, TResult>(name: string, payload: TInput) {
  const functions = getFirebaseFunctions();
  if (!functions) throw new Error('Firebase Functions are not configured.');
  const callable = httpsCallable<TInput, TResult>(functions, name);
  const result = await callable(payload);
  return result.data;
}

function normalizeUser(data: Record<string, unknown>, id: string): ApiUser {
  return {
    id,
    email: String(data.email || ''),
    displayName: String(data.displayName || data.email || 'User'),
    role: (data.role === 'overseer' ? 'overseer' : 'admin'),
    createdAt: data.createdAt ? String(data.createdAt) : undefined,
  };
}

async function listShopDocs<T>(
  collectionName: string,
  orderField = 'createdAt',
  direction: 'asc' | 'desc' = 'desc'
): Promise<T[]> {
  const db = dbOrThrow();
  const snapshot = await getDocs(query(getShopCollection(db, collectionName), orderBy(orderField, direction)));
  return snapshot.docs.map((item) => ({ id: item.id, ...(item.data() as object) } as T));
}

async function getShopDocById<T>(collectionName: string, id: string): Promise<T | null> {
  const db = dbOrThrow();
  const snapshot = await getDoc(getShopDoc(db, collectionName, id));
  return snapshot.exists() ? ({ id: snapshot.id, ...(snapshot.data() as object) } as T) : null;
}

async function upsertShopDoc<T extends { id?: string }>(
  collectionName: string,
  payload: T,
  options: { merge?: boolean } = {}
): Promise<T & { id: string }> {
  const db = dbOrThrow();
  const id = payload.id || crypto.randomUUID();
  const { id: _ignored, ...rest } = payload as T & { id?: string };
  await setDoc(getShopDoc(db, collectionName, id), rest as object, { merge: options.merge ?? false });
  return { ...(rest as object), id } as T & { id: string };
}

function computeLoanStatus(loan: LoanApi): LoanApi['status'] {
  if (loan.status === 'cash' || loan.status === 'paid') return loan.status;
  if ((loan.remainingBalance ?? 0) <= 0) return 'paid';
  const due = loan.dueDate ? new Date(loan.dueDate) : null;
  if (due && due.getTime() < Date.now()) return 'overdue';
  return (loan.totalAmount ?? 0) === (loan.remainingBalance ?? 0) ? 'unpaid' : 'ongoing';
}

async function listPayments(collectionName: string, field: string, id: string) {
  const db = dbOrThrow();
  const snapshot = await getDocs(
    query(getShopCollection(db, collectionName), where(field, '==', id), orderBy('paidAt', 'desc'))
  );
  return snapshot.docs.map((item) => ({ id: item.id, ...(item.data() as object) }));
}

async function getCurrentAdminIdentity() {
  const appUser = await readCurrentFirebaseAppUser();
  return appUser ?? { id: '', email: '', displayName: 'System', role: 'admin' as const };
}

export const authApi = {
  login: async (email: string, password: string) => {
    const credential = await signInWithFirebaseEmail(email.trim(), password);
    const profile = await readCurrentFirebaseAppUser();
    if (!profile) throw new Error('Account profile not found.');
    const token = await credential.user.getIdToken();
    return { token, user: profile };
  },
  me: async () => {
    const user = await readCurrentFirebaseAppUser();
    if (!user) throw new Error('Not authenticated.');
    return { user };
  },
  register: async (email: string, password: string, displayName: string, role: 'overseer' | 'admin') => {
    const data = await callFunction<
      { email: string; password: string; displayName: string; role: 'overseer' | 'admin' },
      { user: ApiUser }
    >('createUserAccount', { email, password, displayName, role });
    return {
      token: '',
      user: data.user,
    };
  },
  changePassword: async (currentPassword: string, newPassword: string) => {
    const auth = getFirebaseAuth();
    const u = auth?.currentUser;
    if (!u?.email) throw new Error('Not authenticated.');
    const cred = EmailAuthProvider.credential(u.email, currentPassword);
    await reauthenticateWithCredential(u, cred);
    await updatePassword(u, newPassword);
    return { success: true as const };
  },
  logout: () => {
    void signOutFromFirebase();
  },
};

export const usersApi = {
  list: async () => {
    const db = dbOrThrow();
    const snapshot = await getDocs(query(collection(db, FIRESTORE_COLLECTIONS.users), orderBy('createdAt', 'asc')));
    return {
      users: snapshot.docs.map((item) => normalizeUser(item.data() as Record<string, unknown>, item.id)),
    };
  },
  create: async (email: string, password: string, displayName: string) =>
    callFunction<
      { email: string; password: string; displayName: string; role: 'admin' },
      { user: ApiUser }
    >('createUserAccount', {
      email,
      password,
      displayName,
      role: 'admin',
    }).then((data) => data.user),
  update: async (id: string, payload: { displayName?: string; password?: string }) => {
    const hasDisplay = payload.displayName !== undefined;
    const hasPassword = payload.password !== undefined;
    if (!hasDisplay && !hasPassword) {
      throw new Error('Send displayName and/or password to update.');
    }
    const data = await callFunction<
      { uid: string; displayName?: string; password?: string },
      { user: ApiUser }
    >('updateUserAccount', {
      uid: id,
      ...(hasDisplay ? { displayName: String(payload.displayName || '').trim() } : {}),
      ...(hasPassword ? { password: String(payload.password || '') } : {}),
    });
    return { user: data.user };
  },
  delete: async (id: string) =>
    callFunction<{ uid: string }, { ok: boolean }>('deleteUserAccount', { uid: id }).then(() => undefined),
};

export const activityApi = {
  list: async (params?: { userId?: string; limit?: number; offset?: number }) => {
    const rows = await listShopDocs<ActivityLog>(FIRESTORE_COLLECTIONS.activityLogs);
    const filtered = params?.userId ? rows.filter((item) => item.userId === params.userId) : rows;
    const offset = params?.offset ?? 0;
    const limitCount = params?.limit ?? 100;
    return {
      logs: filtered.slice(offset, offset + limitCount),
      total: filtered.length,
    };
  },
  log: async () => ({ ok: true }),
};

export const itemsApi = {
  list: async () => ({ items: await listShopDocs<InventoryItemApi>(FIRESTORE_COLLECTIONS.items, 'name', 'asc') }),
  create: async (body: {
    itemCode?: string;
    name: string;
    brand?: string;
    category: string;
    quantity?: number;
    unit?: string;
    unitPrice?: number;
    capitalPrice?: number;
    description?: string;
    minStockLevel?: number;
    receiptNumber?: string;
    stockPurpose?: 'for_sale' | 'for_supply';
  }) => {
    const now = new Date().toISOString();
    const purpose = body.stockPurpose === 'for_supply' ? 'for_supply' : 'for_sale';
    const sell = Number(body.unitPrice ?? 0);
    const cap = Number(body.capitalPrice ?? body.unitPrice ?? 0);
    return upsertShopDoc<InventoryItemApi>(FIRESTORE_COLLECTIONS.items, {
      id: crypto.randomUUID(),
      itemCode: body.itemCode?.trim().toUpperCase() ?? '',
      name: body.name,
      brand: body.brand ?? '',
      category: body.category,
      quantity: Number(body.quantity ?? 0),
      unit: body.unit ?? 'pcs',
      unitPrice: sell,
      capitalPrice: cap,
      description: body.description ?? '',
      minStockLevel: Number(body.minStockLevel ?? 0),
      lastUpdated: now,
      createdAt: now,
      receiptNumber: body.receiptNumber,
      defectiveQuantity: 0,
      stockPurpose: purpose,
    });
  },
  update: async (id: string, body: Partial<InventoryItemApi>) => {
    const db = dbOrThrow();
    await updateDoc(getShopDoc(db, FIRESTORE_COLLECTIONS.items, id), {
      ...body,
      lastUpdated: body.lastUpdated || new Date().toISOString(),
    });
    const updated = await getShopDocById<InventoryItemApi>(FIRESTORE_COLLECTIONS.items, id);
    if (!updated) throw new Error('Item not found.');
    return updated;
  },
  delete: async (id: string) => {
    const db = dbOrThrow();
    await deleteDoc(getShopDoc(db, FIRESTORE_COLLECTIONS.items, id));
  },
};

export const transactionsApi = {
  list: async () => ({ transactions: await listShopDocs<Transaction>(FIRESTORE_COLLECTIONS.transactions, 'timestamp') }),
  create: async (transaction: {
    id: string;
    itemId?: string | null;
    itemName: string;
    type: string;
    quantityChange: number;
    unitPriceAtTime: number;
    totalValue: number;
    timestamp: string;
    recipient?: string;
    note?: string;
    modeOfPayment?: string;
    modeOfPaymentOther?: string;
    dueDays?: number;
    downPayment?: number;
    interestRate?: number;
    paymentSchedule?: 'weekly' | 'monthly';
    personId?: string;
    vehicleId?: string;
    itemType?: 'Product' | 'Service';
    receiptNumber?: string;
    invoiceNumber?: string;
    dueDate?: string;
    terms?: string;
    discountPercent?: number | null;
    discountAmount?: number | null;
    taxPercent?: number | null;
    taxAmount?: number | null;
    posLineItems?: Array<{
      itemId?: string | null;
      itemName: string;
      itemType: 'Product' | 'Service';
      quantity: number;
      unitPrice: number;
      lineSubtotal: number;
      discountPerUnit?: number | null;
      costPerUnit?: number | null;
    }>;
    subtotalBeforeDiscount?: number | null;
    netIncome?: number | null;
    totalCostAtTime?: number | null;
    bundledSale?: boolean | null;
    chequeExpectedClearDate?: string | null;
    chequeReference?: string | null;
  }) =>
    callFunction<typeof transaction, Transaction>('createTransaction', {
      ...transaction,
      shopId: getFirebaseShopId(),
    }),
  returnFromSales: (params: {
    releaseTransactionId: string;
    returnQuantity: number;
    reason: string;
    reasonOthers?: string;
    condition: 'restock' | 'defective';
    returnReasonText: string;
  }) =>
    callFunction<typeof params & { shopId: string }, Transaction>('returnFromSales', {
      ...params,
      shopId: getFirebaseShopId(),
    }),
  patchAddition: (_id: string, _payload: Record<string, unknown>) =>
    Promise.reject(
      new Error(
        'Editing restock (ADDITION) rows requires the REST API backend. Deploy a Cloud Function or use VITE_DATA_BACKEND=rest for this shop.'
      )
    ),
  patchMetadata: (_id: string, _payload: Record<string, unknown>) =>
    Promise.reject(
      new Error(
        'POS metadata edits require the REST API backend. Use VITE_DATA_BACKEND=rest or deploy a Cloud Function.'
      )
    ),
  resolveCheque: (params: { releaseTransactionId: string; outcome: 'cleared' | 'bounced' }) =>
    callFunction<typeof params & { shopId: string }, { ok: boolean; chequeStatus: string }>('resolveCheque', {
      ...params,
      shopId: getFirebaseShopId(),
    }),
};

export const soaApi = {
  getByTransactionId: async (transactionId: string) =>
    callFunction<{ transactionId: string; shopId: string }, StatementOfAccount>('getSoaByTransactionId', {
      transactionId,
      shopId: getFirebaseShopId(),
    }),
  getById: async (id: string) =>
    callFunction<{ soaId: string; shopId: string }, StatementOfAccount>('getSoaById', {
      soaId: id,
      shopId: getFirebaseShopId(),
    }),
  updatePaymentStatus: async (
    id: string,
    paymentStatus: 'Unpaid' | 'Partially Paid' | 'Paid' | 'Overdue'
  ) =>
    callFunction<{ soaId: string; paymentStatus: string; shopId: string }, StatementOfAccount>('updateSoaPaymentStatus', {
      soaId: id,
      paymentStatus,
      shopId: getFirebaseShopId(),
    }),
  addPayment: async (
    soaId: string,
    body: {
      amount: number;
      method?: 'cash' | 'cheque' | 'card';
      paidAt?: string;
      reference?: string;
      note?: string;
    }
  ) =>
    callFunction<
      {
        soaId: string;
        amount: number;
        method?: 'cash' | 'cheque' | 'card';
        paidAt?: string;
        reference?: string;
        note?: string;
        shopId: string;
      },
      { payment: SoaPaymentApi; soa: StatementOfAccount }
    >('addSoaPayment', {
      soaId,
      ...body,
      shopId: getFirebaseShopId(),
    }),
  patchRecord: (_id: string, _body: Record<string, unknown>) =>
    Promise.reject(
      new Error('SOA record edits require the REST API backend. Use VITE_DATA_BACKEND=rest or deploy a Cloud Function.')
    ),
};

export const documentArchivesApi = {
  list: async () =>
    Promise.reject(
      new Error('Document archives require the REST API backend. Use VITE_DATA_BACKEND=rest for this shop.')
    ),
  getById: async (_id: string) =>
    Promise.reject(
      new Error('Document archives require the REST API backend. Use VITE_DATA_BACKEND=rest for this shop.')
    ),
  patch: async (_id: string, _body: Record<string, unknown>) =>
    Promise.reject(
      new Error('Document archives require the REST API backend. Use VITE_DATA_BACKEND=rest for this shop.')
    ),
  syncTransaction: async (_transactionId: string, _soaId?: string | null) =>
    Promise.reject(
      new Error('Document archives require the REST API backend. Use VITE_DATA_BACKEND=rest for this shop.')
    ),
};

export const paymentJournalApi = {
  list: async (params?: { limit?: number; offset?: number }) => {
    const db = dbOrThrow();
    const [soaPaymentsSnap, loanPaymentsSnap, soasSnap, loansSnap] = await Promise.all([
      getDocs(query(getShopCollection(db, FIRESTORE_COLLECTIONS.soaPayments), orderBy('paidAt', 'desc'))),
      getDocs(query(getShopCollection(db, FIRESTORE_COLLECTIONS.loanPayments), orderBy('paidAt', 'desc'))),
      getDocs(getShopCollection(db, FIRESTORE_COLLECTIONS.soas)),
      getDocs(getShopCollection(db, FIRESTORE_COLLECTIONS.loans)),
    ]);

    const soas = new Map(
      soasSnap.docs.map((item) => [item.id, { id: item.id, ...(item.data() as Record<string, unknown>) }])
    );
    const loans = new Map(
      loansSnap.docs.map((item) => [item.id, { id: item.id, ...(item.data() as Record<string, unknown>) }])
    );

    const entries: PaymentJournalEntry[] = [];

    soaPaymentsSnap.docs.forEach((item) => {
      const data = item.data() as Record<string, unknown>;
      const soa = soas.get(String(data.soaId || ''));
      if (!soa) return;
      entries.push({
        id: item.id,
        type: 'soa',
        soaId: String(data.soaId || ''),
        loanId: null,
        transactionId: String(soa.transactionId || ''),
        customerName: String(soa.customerName || ''),
        amount: Number(data.amountPaid || 0),
        method: String(data.method || 'cash'),
        paidAt: String(data.paidAt || ''),
        reference: data.reference ? String(data.reference) : null,
        note: data.note ? String(data.note) : null,
      });
    });

    loanPaymentsSnap.docs.forEach((item) => {
      const data = item.data() as Record<string, unknown>;
      const loan = loans.get(String(data.loanId || ''));
      if (!loan) return;
      entries.push({
        id: item.id,
        type: 'loan',
        soaId: null,
        loanId: String(data.loanId || ''),
        transactionId: String(loan.transactionId || ''),
        customerName: String(loan.customerName || ''),
        amount: Number(data.amountPaid || 0),
        method: 'cash',
        paidAt: String(data.paidAt || ''),
        reference: null,
        note: data.note ? String(data.note) : null,
      });
    });

    entries.sort((a, b) => new Date(b.paidAt).getTime() - new Date(a.paidAt).getTime());
    const offset = params?.offset ?? 0;
    const limitCount = params?.limit ?? 100;
    return {
      entries: entries.slice(offset, offset + limitCount),
      total: entries.length,
    };
  },
};

export const loansApi = {
  list: async (params?: { status?: string; customerName?: string; limit?: number; offset?: number }) => {
    let loans = await listShopDocs<LoanApi>(FIRESTORE_COLLECTIONS.loans);
    loans = loans.map((loan) => ({ ...loan, status: computeLoanStatus(loan) }));
    if (params?.status) loans = loans.filter((loan) => loan.status === params.status);
    if (params?.customerName) {
      const q = params.customerName.toLowerCase();
      loans = loans.filter((loan) => (loan.customerName || '').toLowerCase().includes(q));
    }
    const offset = params?.offset ?? 0;
    const limitCount = params?.limit ?? 100;
    return {
      loans: loans.slice(offset, offset + limitCount),
      total: loans.length,
    };
  },
  getById: async (id: string) =>
    callFunction<{ loanId: string; shopId: string }, LoanApi & { payments?: LoanPaymentApi[] }>('getLoanById', {
      loanId: id,
      shopId: getFirebaseShopId(),
    }),
  getByTransactionId: async (transactionId: string) =>
    callFunction<{ transactionId: string; shopId: string }, LoanApi>('getLoanByTransactionId', {
      transactionId,
      shopId: getFirebaseShopId(),
    }),
  addPayment: async (loanId: string, amount: number, note?: string) =>
    callFunction<{ loanId: string; amount: number; note?: string; shopId: string }, { payment: LoanPaymentApi; loan: LoanApi }>(
      'addLoanPayment',
      { loanId, amount, note, shopId: getFirebaseShopId() }
    ),
  updateStatus: async (loanId: string, status: 'unpaid' | 'ongoing' | 'overdue' | 'paid' | 'cash') =>
    callFunction<{ loanId: string; status: string; shopId: string }, LoanApi>('updateLoanStatus', {
      loanId,
      status,
      shopId: getFirebaseShopId(),
    }),
};

export const personsApi = {
  list: async () => ({ persons: await listShopDocs<PersonApi>(FIRESTORE_COLLECTIONS.persons, 'fullName', 'asc') }),
  getById: async (id: string) => {
    const person = await getShopDocById<PersonApi>(FIRESTORE_COLLECTIONS.persons, id);
    if (!person) throw new Error('Person not found.');
    return person;
  },
  create: async (body: { fullName: string; contactNumber: string; address?: string; email?: string }) =>
    upsertShopDoc<PersonApi>(FIRESTORE_COLLECTIONS.persons, {
      id: crypto.randomUUID(),
      ...body,
      createdAt: new Date().toISOString(),
    }),
  update: async (id: string, body: { fullName?: string; contactNumber?: string; address?: string; email?: string }) => {
    const db = dbOrThrow();
    await updateDoc(getShopDoc(db, FIRESTORE_COLLECTIONS.persons, id), body);
    const person = await getShopDocById<PersonApi>(FIRESTORE_COLLECTIONS.persons, id);
    if (!person) throw new Error('Person not found.');
    return person;
  },
  delete: async (id: string) =>
    callFunction<{ personId: string; shopId: string }, { ok: boolean }>('deletePerson', {
      personId: id,
      shopId: getFirebaseShopId(),
    }).then(() => undefined),
};

export const vehiclesApi = {
  list: async (params?: { personId?: string }) => {
    const rows = await listShopDocs<VehicleApi>(FIRESTORE_COLLECTIONS.vehicles, 'plateNumber', 'asc');
    return { vehicles: params?.personId ? rows.filter((item) => item.personId === params.personId) : rows };
  },
  getById: async (id: string) => {
    const vehicle = await getShopDocById<VehicleApi>(FIRESTORE_COLLECTIONS.vehicles, id);
    if (!vehicle) throw new Error('Vehicle not found.');
    return vehicle;
  },
  create: async (body: {
    personId: string;
    plateNumber: string;
    brand?: string;
    model?: string;
    year?: number | null;
    color?: string;
  }) =>
    upsertShopDoc<VehicleApi>(FIRESTORE_COLLECTIONS.vehicles, {
      id: crypto.randomUUID(),
      ...body,
      createdAt: new Date().toISOString(),
    }),
  update: async (
    id: string,
    body: {
      personId?: string;
      plateNumber?: string;
      brand?: string;
      model?: string;
      year?: number | null;
      color?: string;
    }
  ) => {
    const db = dbOrThrow();
    await updateDoc(getShopDoc(db, FIRESTORE_COLLECTIONS.vehicles, id), body);
    const vehicle = await getShopDocById<VehicleApi>(FIRESTORE_COLLECTIONS.vehicles, id);
    if (!vehicle) throw new Error('Vehicle not found.');
    return vehicle;
  },
  delete: async (id: string) =>
    callFunction<{ vehicleId: string; shopId: string }, { ok: boolean }>('deleteVehicle', {
      vehicleId: id,
      shopId: getFirebaseShopId(),
    }).then(() => undefined),
};

export const expensesApi = {
  list: async (params?: { category?: string; startDate?: string; endDate?: string }) => {
    let rows = await listShopDocs<ExpenseApi>(FIRESTORE_COLLECTIONS.expenses, 'date');
    if (params?.category) rows = rows.filter((item) => item.category === params.category);
    if (params?.startDate) rows = rows.filter((item) => String(item.date || '') >= params.startDate);
    if (params?.endDate) rows = rows.filter((item) => String(item.date || '') <= params.endDate);
    rows.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    return { expenses: rows };
  },
  categories: async () => ({ categories: ['Utilities', 'Supplies', 'Salary', 'Maintenance', 'Others'] }),
  create: async (body: {
    title: string;
    category: string;
    amount: number;
    description?: string;
    date: string;
  }) => {
    const user = await getCurrentAdminIdentity();
    return upsertShopDoc<ExpenseApi>(FIRESTORE_COLLECTIONS.expenses, {
      id: crypto.randomUUID(),
      ...body,
      recordedBy: user.displayName,
      recordedByUserId: user.id || null,
      createdAt: new Date().toISOString(),
    });
  },
};

export const suppliersApi = {
  list: async () => ({ suppliers: await listShopDocs<SupplierApi>(FIRESTORE_COLLECTIONS.suppliers, 'name', 'asc') }),
  getById: async (id: string) => {
    const supplier = await getShopDocById<SupplierApi>(FIRESTORE_COLLECTIONS.suppliers, id);
    if (!supplier) throw new Error('Supplier not found.');
    return supplier;
  },
  create: async (body: {
    name: string;
    contactNumber?: string;
    address?: string;
    email?: string;
    tin?: string;
  }) =>
    upsertShopDoc<SupplierApi>(FIRESTORE_COLLECTIONS.suppliers, {
      id: crypto.randomUUID(),
      ...body,
      createdAt: new Date().toISOString(),
    }),
  update: async (
    id: string,
    body: {
      name?: string;
      contactNumber?: string;
      address?: string;
      email?: string;
      tin?: string;
    }
  ) => {
    const db = dbOrThrow();
    await updateDoc(getShopDoc(db, FIRESTORE_COLLECTIONS.suppliers, id), body);
    const supplier = await getShopDocById<SupplierApi>(FIRESTORE_COLLECTIONS.suppliers, id);
    if (!supplier) throw new Error('Supplier not found.');
    return supplier;
  },
  delete: async (id: string) =>
    callFunction<{ supplierId: string; shopId: string }, { ok: boolean }>('deleteSupplier', {
      supplierId: id,
      shopId: getFirebaseShopId(),
    }).then(() => undefined),
};

export const purchasesApi = {
  list: async (params?: { status?: string }) => {
    let rows = await listShopDocs<PurchaseApi>(FIRESTORE_COLLECTIONS.purchases, 'purchaseDate');
    if (params?.status) rows = rows.filter((item) => item.status === params.status);
    return { purchases: rows };
  },
  getById: async (id: string) => {
    const purchase = await getShopDocById<PurchaseApi>(FIRESTORE_COLLECTIONS.purchases, id);
    if (!purchase) throw new Error('Purchase not found.');
    return purchase;
  },
  create: async (body: {
    supplierId: string;
    supplierName: string;
    paymentType: 'cash' | 'accounts_payable';
    receiptNumber?: string;
    note?: string;
    lineItems: { itemId: string; itemName: string; quantity: number; unitCost: number; total: number }[];
  }) =>
    callFunction<typeof body & { shopId: string }, PurchaseApi>('createPurchase', {
      ...body,
      shopId: getFirebaseShopId(),
    }),
  addPayment: async (
    id: string,
    body: { amount: number; method: 'cash' | 'cheque' | 'card'; paidAt?: string; reference?: string }
  ) =>
    callFunction<{ purchaseId: string; amount: number; method: string; paidAt?: string; reference?: string; shopId: string }, PurchaseApi>(
      'addPurchasePayment',
      { purchaseId: id, ...body, shopId: getFirebaseShopId() }
    ),
};

export const notificationsApi = {
  list: async (params?: { limit?: number; offset?: number; unreadOnly?: boolean }) => {
    let rows = await listShopDocs<NotificationItem>(FIRESTORE_COLLECTIONS.notifications, 'createdAt');
    if (params?.unreadOnly) rows = rows.filter((item) => !item.read);
    const offset = params?.offset ?? 0;
    const limitCount = params?.limit ?? 50;
    return {
      notifications: rows.slice(offset, offset + limitCount),
      total: rows.length,
    };
  },
  markRead: async (id: string) => {
    const db = dbOrThrow();
    await updateDoc(getShopDoc(db, FIRESTORE_COLLECTIONS.notifications, id), { read: 1 });
    return { success: true as const };
  },
  markAllRead: async () => {
    const db = dbOrThrow();
    const snapshot = await getDocs(query(getShopCollection(db, FIRESTORE_COLLECTIONS.notifications), where('read', '==', 0)));
    const batch = writeBatch(db);
    snapshot.docs.forEach((item) => batch.update(item.ref, { read: 1 }));
    await batch.commit();
    return { success: true as const };
  },
};

export const systemApi = {
  clearStoreData: async (_shopId: string) => {
    throw new Error('Clearing store data requires the REST API backend (SQLite), not Firebase.');
  },
  clearAllBusinessData: async (_confirm: 'DELETE_ALL_BUSINESS_DATA') => {
    throw new Error('Wiping all business data requires the REST API backend, not Firebase.');
  },
};

export const bookingsApi = {
  list: async () => {
    throw new Error('Online bookings require the REST API backend, not Firebase.');
  },
  get: async (_id: string) => {
    throw new Error('Online bookings require the REST API backend, not Firebase.');
  },
  confirm: async (_id: string, _payload: Record<string, unknown>) => {
    throw new Error('Online bookings require the REST API backend, not Firebase.');
  },
  cancel: async (_id: string) => {
    throw new Error('Online bookings require the REST API backend, not Firebase.');
  },
};
