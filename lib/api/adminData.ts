import { isFirebaseConfigured } from '../firebase/app';
import * as rest from './client';
import * as firebase from '../firebase/api';

/** Use Firestore-backed admin APIs only when `VITE_DATA_BACKEND=firebase` and web Firebase env is complete. */
const dataBackend = String(import.meta.env.VITE_DATA_BACKEND || 'rest').toLowerCase().trim();
export const USE_FIRESTORE_ADMIN_DATA =
  dataBackend === 'firebase' && isFirebaseConfigured();

const data = USE_FIRESTORE_ADMIN_DATA ? firebase : rest;

export const authApi = data.authApi;
export const usersApi = data.usersApi;
export const activityApi = data.activityApi;
export const notificationsApi = data.notificationsApi;
export const itemsApi = data.itemsApi;
export const transactionsApi = data.transactionsApi;
export const soaApi = data.soaApi;
export const loansApi = data.loansApi;
export const personsApi = data.personsApi;
export const vehiclesApi = data.vehiclesApi;
export const expensesApi = data.expensesApi;
export const suppliersApi = data.suppliersApi;
export const purchasesApi = data.purchasesApi;
export const paymentJournalApi = data.paymentJournalApi;
export const documentArchivesApi = data.documentArchivesApi;
export const systemApi = data.systemApi;
export const bookingsApi = data.bookingsApi;

export type {
  ApiUser,
  ActivityLog,
  NotificationItem,
  InventoryItemApi,
  SoaPaymentApi,
  StatementOfAccount,
  LoanApi,
  LoanPaymentApi,
  PaymentJournalEntry,
  DocumentArchiveEntry,
} from './client';

export { setStoredToken } from './client';
