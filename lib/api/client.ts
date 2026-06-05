import type {
  Employee,
  Expense,
  InventoryItem,
  Loan,
  LoanPayment,
  OnlineBooking,
  PayrollLine,
  PayrollRun,
  Person,
  Purchase,
  Supplier,
  Transaction,
  Vehicle,
} from '../../types';

declare global {
  interface Window {
    motorWorldDesktop?: {
      apiBaseUrl?: string;
      isDesktopApp?: boolean;
      openViewer?: () => Promise<void>;
    };
    /** Legacy preload bridge (pre–Motor World installers). */
    efcpDesktop?: {
      apiBaseUrl?: string;
      isDesktopApp?: boolean;
      openViewer?: () => Promise<void>;
    };
  }
}

const TOKEN_KEY = 'motorworld_auth_token';
const TOKEN_KEY_LEGACY = 'efcp_auth_token';

/** Session-scoped active store for REST API (`X-Motor-Shop-Id`). Each browser tab can use a different value. */
export const ACTIVE_SHOP_SESSION_KEY = 'motorworld_active_shop_id';

/** Query param for deep-linking a tab to a store (works alongside per-tab sessionStorage). */
export const ACTIVE_SHOP_URL_PARAM = 'shop';

/** Read `?shop=motorworld|ecfp` from the top-level URL (and a limited `#/...?shop=` hash form). */
export function readShopIdFromUrl(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const top = new URL(window.location.href);
    const q = top.searchParams.get(ACTIVE_SHOP_URL_PARAM)?.trim().toLowerCase();
    if (q === 'ecfp' || q === 'motorworld') return q;
    const hash = window.location.hash || '';
    const m = hash.match(/[?&]shop=(motorworld|ecfp)(?:&|#|$)/i);
    if (m) return m[1].toLowerCase();
  } catch {
    /* ignore */
  }
  return null;
}

function syncShopQueryParam(shopId: string) {
  if (typeof window === 'undefined') return;
  try {
    const u = new URL(window.location.href);
    u.searchParams.set(ACTIVE_SHOP_URL_PARAM, shopId);
    window.history.replaceState(window.history.state, '', `${u.pathname}${u.search}${u.hash}`);
  } catch {
    /* ignore */
  }
}

/** Same tab + query string, for opening another store in a new browser tab. */
export function buildOperationsUrlWithShop(shopId: string): string {
  const s = shopId === 'ecfp' ? 'ecfp' : 'motorworld';
  if (typeof window === 'undefined') return '';
  try {
    const u = new URL(window.location.href);
    u.searchParams.set(ACTIVE_SHOP_URL_PARAM, s);
    return u.toString();
  } catch {
    return '';
  }
}

/**
 * Resolved store for this tab: sessionStorage first, then `?shop=` / hash, then default.
 * Session wins over URL so an explicit switch in this tab is not overridden by a stale bookmark query.
 */
export function getStoredActiveShopId(): string {
  if (typeof window === 'undefined') return 'motorworld';
  const raw = sessionStorage.getItem(ACTIVE_SHOP_SESSION_KEY)?.trim().toLowerCase();
  if (raw === 'ecfp' || raw === 'motorworld') return raw;
  const fromUrl = readShopIdFromUrl();
  if (fromUrl) return fromUrl;
  return 'motorworld';
}

export function setStoredActiveShopId(shopId: string) {
  if (typeof window === 'undefined') return;
  const s = String(shopId || '').trim().toLowerCase();
  if (s === 'ecfp' || s === 'motorworld') {
    sessionStorage.setItem(ACTIVE_SHOP_SESSION_KEY, s);
    syncShopQueryParam(s);
  }
}

/** Thrown by {@link request} when the server returns a non-2xx status (includes 401). */
export class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}
const runtimeApiBase =
  typeof window !== 'undefined'
    ? window.motorWorldDesktop?.apiBaseUrl ?? window.efcpDesktop?.apiBaseUrl ?? ''
    : '';

function getApiBase(): string {
  let base = (runtimeApiBase || import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
  if (typeof window !== 'undefined' && window.location) {
    const { hostname, port } = window.location;
    const devUiPort = String(import.meta.env.VITE_DEV_SERVER_PORT || '5174');
    const isViteDevUi = import.meta.env.DEV && port === devUiPort;
    const isLoopbackHost =
      hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
    const directLocalApi =
      base === '' ||
      base === 'http://127.0.0.1:3001' ||
      base === 'http://localhost:3001';
    // Hitting Vite from a LAN IP (e.g. 192.168.x.x): use same-origin `/api` so Vite proxies to the local
    // Express port. A remote `VITE_API_BASE_URL` (Render, etc.) almost never allows that browser origin in CORS.
    if (isViteDevUi && !isLoopbackHost) {
      return '';
    }
    if (isViteDevUi && isLoopbackHost && directLocalApi) {
      return '';
    }
  }
  return base;
}

export interface ApiUser {
  id: string;
  email: string;
  displayName: string;
  role: 'overseer' | 'admin';
  createdAt?: string;
  /** REST: which stores this user may manage (motorworld, ecfp). */
  shops?: string[];
}

export interface ActivityLog {
  id: string;
  userId: string;
  actionType: string;
  metadata: Record<string, unknown> | string | null;
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
  photoFilename?: string | null;
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
  paymentsMade?: SoaPaymentApi[];
  totalPaid?: number;
  remainingBalance?: number;
  status?: 'Unpaid' | 'Partially Paid' | 'Paid' | 'Overdue';
  paymentSource?: 'loan' | 'soa';
  itemType?: 'Product' | 'Service';
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

export interface DocumentArchiveEntry {
  id: string;
  kind: string;
  transactionId: string;
  soaId: string | null;
  transactionSnapshot: Transaction | null;
  customerName: string;
  totalValue: number;
  createdAt: string | null;
  createdByUserId: string | null;
  updatedAt: string | null;
  updatedByUserId: string | null;
  editNote: string | null;
}

function getStoredToken() {
  if (typeof window === 'undefined') return '';
  const next = localStorage.getItem(TOKEN_KEY);
  if (next) return next;
  const legacy = localStorage.getItem(TOKEN_KEY_LEGACY);
  if (legacy) {
    localStorage.setItem(TOKEN_KEY, legacy);
    localStorage.removeItem(TOKEN_KEY_LEGACY);
    return legacy;
  }
  return '';
}

export function setStoredToken(token: string) {
  if (typeof window === 'undefined') return;
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

/** True if a JWT may exist (REST auth bootstrap can skip the network when false). */
export function hasStoredAuthToken() {
  return Boolean(getStoredToken());
}

/** Stay slightly below Vercel `api/index.mjs` maxDuration (see vercel.json). */
const DEFAULT_REQUEST_TIMEOUT_MS = 110_000;

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers || {});
  if (!headers.has('Content-Type') && options.body) headers.set('Content-Type', 'application/json');
  const token = getStoredToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const shopId = getStoredActiveShopId();
  headers.set('X-Motor-Shop-Id', shopId);

  const url = `${getApiBase()}${path}`;
  let response: Response;
  let clearTimer: (() => void) | undefined;
  const init: RequestInit = { ...options, headers };
  if (!options.signal) {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), DEFAULT_REQUEST_TIMEOUT_MS);
    clearTimer = () => clearTimeout(t);
    init.signal = c.signal;
  }
  try {
    response = await fetch(url, init);
  } catch (e) {
    const hint =
      typeof window !== 'undefined' &&
      (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
        ? ' From the project folder run `npm run dev` so the API is on port 3001 and Vite proxies /api.'
        : '';
    const msg = e instanceof Error ? e.message : String(e);
    const timedOut = e instanceof Error && (e.name === 'AbortError' || msg.includes('aborted'));
    if (timedOut) {
      throw new HttpError(
        0,
        `Request timed out after ${DEFAULT_REQUEST_TIMEOUT_MS / 1000}s (${url || path}). ` +
          'The API may be cold-starting on Vercel, unreachable, or blocked by the network. Try again in a moment.'
      );
    }
    throw new HttpError(0, `Cannot reach the server (${url || path}). ${msg}${hint}`);
  } finally {
    clearTimer?.();
  }

  const text = await response.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text) as unknown;
    } catch {
      throw new HttpError(
        response.status,
        `Server returned non-JSON (HTTP ${response.status}). Often the API is not running or the URL is wrong. Body starts with: ${text
          .slice(0, 160)
          .replace(/\s+/g, ' ')}`
      );
    }
  }

  if (!response.ok) {
    const obj = data && typeof data === 'object' ? (data as Record<string, unknown>) : null;
    const fromBody =
      (obj?.error != null && String(obj.error)) ||
      (obj?.message != null && String(obj.message)) ||
      '';
    const fallback = `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`.trim();
    throw new HttpError(response.status, fromBody || fallback || 'Request failed.');
  }

  return data as T;
}

export const authApi = {
  async login(email: string, password: string) {
    const data = await request<{ token: string; user: ApiUser }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    return data;
  },
  async me() {
    return request<{ user: ApiUser }>('/api/auth/me');
  },
  async register(email: string, password: string, displayName: string, role: 'overseer' | 'admin') {
    return request<{ user: ApiUser }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, displayName, role }),
    });
  },
  async changePassword(currentPassword: string, newPassword: string) {
    return request<{ success: boolean }>('/api/auth/password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    });
  },
  logout() {
    setStoredToken('');
  },
};

export const systemApi = {
  clearStoreData: (shopId: string) =>
    request<{
      ok: boolean;
      shopId: string;
      collectionsRemoved: number;
      legacyAlsoCleared?: boolean;
      storeLabel?: string;
    }>('/api/system/clear-store-data', {
      method: 'POST',
      body: JSON.stringify({ shopId }),
    }),
  /** Wipe all shops + legacy data; keeps user accounts. Body must include confirm phrase (see server). */
  clearAllBusinessData: (confirm: 'DELETE_ALL_BUSINESS_DATA') =>
    request<{ ok: boolean; removed: number; mode: string }>('/api/system/clear-all-business-data', {
      method: 'POST',
      body: JSON.stringify({ confirm }),
    }),
};

export const usersApi = {
  list: () => request<{ users: ApiUser[] }>('/api/users'),
  create: async (email: string, password: string, displayName: string) =>
    request<{ user: ApiUser }>('/api/users', {
      method: 'POST',
      body: JSON.stringify({ email, password, displayName }),
    }).then((data) => data.user),
  update: async (id: string, payload: { displayName?: string; password?: string }) =>
    request<{ user: ApiUser }>(`/api/users/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  delete: (id: string) => request<{ success: boolean }>(`/api/users/${id}`, { method: 'DELETE' }),
};

export const activityApi = {
  list: (params: { userId?: string; limit?: number; offset?: number; actionType?: string }) =>
    request<{ total: number; logs: ActivityLog[] }>(
      `/api/activity?${new URLSearchParams(
        Object.entries({
          userId: params.userId || '',
          limit: String(params.limit ?? 100),
          offset: String(params.offset ?? 0),
          actionType: params.actionType || '',
        }).filter(([, value]) => value !== '')
      )}`
    ),
  log: (actionType: string, metadata: Record<string, unknown>) =>
    request<{ success: boolean }>('/api/activity/log', {
      method: 'POST',
      body: JSON.stringify({ actionType, metadata }),
    }),
};

export const notificationsApi = {
  list: (params: { limit?: number; offset?: number; unreadOnly?: boolean } = {}) =>
    request<{ total: number; notifications: NotificationItem[] }>(
      `/api/notifications?${new URLSearchParams(
        Object.entries({
          limit: String(params.limit ?? 30),
          offset: String(params.offset ?? 0),
          unreadOnly: params.unreadOnly ? 'true' : '',
        }).filter(([, value]) => value !== '')
      )}`
    ),
  markRead: (id: string) => request<{ success: boolean }>(`/api/notifications/${id}/read`, { method: 'POST' }),
  markAllRead: () => request<{ success: boolean }>('/api/notifications/read-all', { method: 'POST' }),
};

export const itemsApi = {
  list: () => request<{ items: InventoryItemApi[] }>('/api/items'),
  create: (payload: Partial<InventoryItemApi>) =>
    request<InventoryItemApi>('/api/items', { method: 'POST', body: JSON.stringify(payload) }),
  update: (id: string, payload: Partial<InventoryItemApi>) =>
    request<InventoryItemApi>(`/api/items/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  delete: (id: string) => request<{ success: boolean }>(`/api/items/${id}`, { method: 'DELETE' }),
};

export const transactionsApi = {
  list: () => request<{ transactions: Transaction[] }>('/api/transactions'),
  create: (payload: Partial<Transaction> & Record<string, unknown>) =>
    request<Transaction>('/api/transactions', { method: 'POST', body: JSON.stringify(payload) }),
  returnFromSales: (payload: {
    releaseTransactionId: string;
    returnQuantity: number;
    reason: string;
    reasonOthers?: string;
    condition: 'restock' | 'defective';
    returnReasonText: string;
  }) => request<Transaction>('/api/transactions/return-from-sales', { method: 'POST', body: JSON.stringify(payload) }),
  /** Correct an ADDITION (restock) row; inventory is rebuilt from the ledger. Admin-only. */
  patchAddition: (
    id: string,
    payload: {
      quantityChange: number;
      unitPriceAtTime: number;
      sellingPriceAtTime?: number | null;
      note?: string;
      receiptNumber?: string;
      editSummary?: string;
    }
  ) =>
    request<Transaction>(`/api/transactions/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  /** Correct customer / PO / cheque labels on a RELEASE or ISSUE without changing quantities. Admin-only. */
  patchMetadata: (
    id: string,
    payload: Partial<{
      recipient: string;
      note: string;
      invoiceNumber: string;
      dueDate: string;
      terms: string;
      chequeExpectedClearDate: string;
      chequeReference: string;
      modeOfPaymentOther: string;
      releasedBy: string;
    }>
  ) =>
    request<Transaction>(`/api/transactions/${encodeURIComponent(id)}/metadata`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  resolveCheque: (payload: { releaseTransactionId: string; outcome: 'cleared' | 'bounced' }) =>
    request<{ ok: boolean; chequeStatus: string }>('/api/transactions/resolve-cheque', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
};

export const soaApi = {
  getByTransactionId: (transactionId: string) =>
    request<StatementOfAccount>(`/api/soa?${new URLSearchParams({ transactionId })}`),
  getById: (id: string) => request<StatementOfAccount>(`/api/soa/${id}`),
  updatePaymentStatus: (id: string, paymentStatus: StatementOfAccount['paymentStatus']) =>
    request<StatementOfAccount>(`/api/soa/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ paymentStatus }),
    }),
  addPayment: (
    id: string,
    payload: { amount: number; method: 'cash' | 'cheque' | 'card'; paidAt: string; reference?: string; note?: string }
  ) =>
    request<{ soa: StatementOfAccount }>(`/api/soa/${id}/payments`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  patchRecord: (id: string, body: { customerName?: string; itemName?: string; dueDate?: string }) =>
    request<StatementOfAccount>(`/api/soa/${encodeURIComponent(id)}/record`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
};

export const documentArchivesApi = {
  list: (params: {
    q?: string;
    kind?: string;
    from?: string;
    to?: string;
    transactionId?: string;
    limit?: number;
    offset?: number;
  } = {}) =>
    request<{ total: number; archives: DocumentArchiveEntry[] }>(
      `/api/document-archives?${new URLSearchParams(
        Object.entries({
          q: params.q || '',
          kind: params.kind || '',
          from: params.from || '',
          to: params.to || '',
          transactionId: params.transactionId || '',
          limit: String(params.limit ?? 50),
          offset: String(params.offset ?? 0),
        }).filter(([, v]) => v !== '')
      )}`
    ),
  getById: (id: string) => request<DocumentArchiveEntry>(`/api/document-archives/${encodeURIComponent(id)}`),
  patch: (id: string, body: { transactionSnapshot?: Transaction; editNote?: string }) =>
    request<DocumentArchiveEntry>(`/api/document-archives/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  syncTransaction: (transactionId: string, soaId?: string | null) =>
    request<{ success: boolean }>(
      `/api/document-archives/sync-transaction/${encodeURIComponent(transactionId)}`,
      {
        method: 'POST',
        body: JSON.stringify({ soaId: soaId ?? undefined }),
      }
    ),
};

export const loansApi = {
  list: (params: { status?: string; customerName?: string; limit?: number; offset?: number } = {}) =>
    request<{ loans: LoanApi[] }>(
      `/api/loans?${new URLSearchParams(
        Object.entries({
          status: params.status || '',
          customerName: params.customerName || '',
          limit: params.limit != null ? String(params.limit) : '',
          offset: params.offset != null ? String(params.offset) : '',
        }).filter(([, value]) => value !== '')
      )}`
    ),
  getById: (id: string) => request<LoanApi>(`/api/loans/${id}`),
  getByTransactionId: (transactionId: string) => request<LoanApi>(`/api/loans/by-transaction/${transactionId}`),
  addPayment: (id: string, amountPaid: number, note?: string | null) =>
    request<{ loan: LoanApi; payment: LoanPaymentApi }>(`/api/loans/${id}/payments`, {
      method: 'POST',
      body: JSON.stringify({ amountPaid, note, paidAt: new Date().toISOString() }),
    }),
  updateStatus: (id: string, status: Loan['status']) =>
    request<LoanApi>(`/api/loans/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),
};

export const personsApi = {
  list: () => request<{ persons: Person[] }>('/api/persons'),
  getById: (id: string) => request<{ person: Person }>(`/api/persons/${id}`),
  create: (payload: Partial<Person>) => request<Person>('/api/persons', { method: 'POST', body: JSON.stringify(payload) }),
  update: (id: string, payload: Partial<Person>) =>
    request<Person>(`/api/persons/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  delete: (id: string) => request<{ success: boolean }>(`/api/persons/${id}`, { method: 'DELETE' }),
};

export const vehiclesApi = {
  list: (personId?: string) =>
    request<{ vehicles: Vehicle[] }>(
      personId ? `/api/vehicles?${new URLSearchParams({ personId })}` : '/api/vehicles'
    ),
  getById: (id: string) => request<{ vehicle: Vehicle }>(`/api/vehicles/${id}`),
  create: (payload: Partial<Vehicle>) =>
    request<Vehicle>('/api/vehicles', { method: 'POST', body: JSON.stringify(payload) }),
  update: (id: string, payload: Partial<Vehicle>) =>
    request<Vehicle>(`/api/vehicles/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  delete: (id: string) => request<{ success: boolean }>(`/api/vehicles/${id}`, { method: 'DELETE' }),
};

export const expensesApi = {
  list: (params?: { category?: string; startDate?: string; endDate?: string }) => {
    const q = new URLSearchParams();
    if (params?.category) q.set('category', params.category);
    if (params?.startDate) q.set('fromDate', params.startDate);
    if (params?.endDate) q.set('toDate', params.endDate);
    const qs = q.toString();
    return request<{ expenses: Expense[] }>(`/api/expenses${qs ? `?${qs}` : ''}`);
  },
  create: (payload: Partial<Expense>) =>
    request<Expense>('/api/expenses', { method: 'POST', body: JSON.stringify(payload) }),
};

export const suppliersApi = {
  list: () => request<{ suppliers: Supplier[] }>('/api/suppliers'),
  create: (payload: Partial<Supplier>) =>
    request<Supplier>('/api/suppliers', { method: 'POST', body: JSON.stringify(payload) }),
  update: (id: string, payload: Partial<Supplier>) =>
    request<Supplier>(`/api/suppliers/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  delete: (id: string) => request<{ success: boolean }>(`/api/suppliers/${id}`, { method: 'DELETE' }),
};

export const purchasesApi = {
  list: () => request<{ purchases: Purchase[] }>('/api/purchases'),
  getById: (id: string) => request<{ purchase: Purchase }>(`/api/purchases/${id}`),
  create: (payload: Record<string, unknown>) =>
    request<Purchase>('/api/purchases', { method: 'POST', body: JSON.stringify(payload) }),
  addPayment: (id: string, payload: { amount: number; method: 'cash' | 'cheque' | 'card'; paidAt: string; reference?: string }) =>
    request<Purchase>(`/api/purchases/${id}/payments`, { method: 'POST', body: JSON.stringify(payload) }),
};

export const paymentJournalApi = {
  list: (params: { limit?: number; offset?: number } = {}) =>
    request<{ entries: PaymentJournalEntry[] }>(
      `/api/payment-journal?${new URLSearchParams({
        limit: String(params.limit ?? 200),
        offset: String(params.offset ?? 0),
      })}`
    ),
};

export const payrollApi = {
  listEmployees: () => request<{ employees: Employee[] }>('/api/payroll/employees'),
  createEmployee: (payload: Partial<Employee>) =>
    request<{ employee: Employee }>('/api/payroll/employees', { method: 'POST', body: JSON.stringify(payload) }),
  updateEmployee: (id: string, payload: Partial<Employee>) =>
    request<{ employee: Employee }>(`/api/payroll/employees/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  deleteEmployee: (id: string) =>
    request<{ success: boolean }>(`/api/payroll/employees/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  listRuns: () => request<{ runs: PayrollRun[] }>('/api/payroll/runs'),
  getRun: (id: string) => request<{ run: PayrollRun }>(`/api/payroll/runs/${encodeURIComponent(id)}`),
  preview: (payload: {
    summaries: Record<string, unknown>[];
    periodStart?: string;
    periodEnd?: string;
    periodLabel?: string;
  }) =>
    request<{
      periodLabel: string;
      periodStart: string;
      periodEnd: string;
      lines: PayrollLine[];
      totalGross: number;
      totalNet: number;
    }>('/api/payroll/preview', { method: 'POST', body: JSON.stringify(payload) }),
  postRun: (payload: {
    periodLabel: string;
    periodStart: string;
    periodEnd: string;
    sourceFileName?: string;
    lines: PayrollLine[];
    totalGross: number;
    totalNet: number;
  }) =>
    request<{ run: PayrollRun }>('/api/payroll/runs/post', { method: 'POST', body: JSON.stringify(payload) }),
};

export const bookingsApi = {
  list: (params?: { status?: OnlineBooking['status'] }) => {
    const q = params?.status ? `?status=${encodeURIComponent(params.status)}` : '';
    return request<{ bookings: OnlineBooking[] }>(`/api/bookings${q}`);
  },
  get: (id: string) => request<{ booking: OnlineBooking }>(`/api/bookings/${encodeURIComponent(id)}`),
  confirm: (
    id: string,
    payload: {
      quotedAmount?: number;
      modeOfPayment?: string;
      dueDays?: number;
      confirmNote?: string;
    }
  ) =>
    request<{ booking: OnlineBooking; transaction: Transaction }>(
      `/api/bookings/${encodeURIComponent(id)}/confirm`,
      { method: 'POST', body: JSON.stringify(payload) }
    ),
  cancel: (id: string, payload?: { reason?: string }) =>
    request<{ booking: OnlineBooking }>(`/api/bookings/${encodeURIComponent(id)}/cancel`, {
      method: 'POST',
      body: JSON.stringify(payload ?? {}),
    }),
};
