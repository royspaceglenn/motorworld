/** Retail line vs consumable / shop-supply stock (not offered as a POS product). */
export type StockPurpose = 'for_sale' | 'for_supply';

export function normalizeStockPurpose(value: unknown): StockPurpose {
  const v = String(value ?? '').toLowerCase().replace(/\s+/g, '_');
  if (v === 'for_supply' || v === 'supply' || v === 'consumable') return 'for_supply';
  return 'for_sale';
}

/** POS product search: hide rows whose product category is internal / shop supply. */
export function isExcludedFromPosProductPicker(category: unknown): boolean {
  const c = String(category ?? '').trim().toLowerCase();
  return c === 'supply' || c === 'company supply';
}

export const STOCK_PURPOSE_META: Record<
  StockPurpose,
  { label: string; hint: string; badgeClass: string }
> = {
  for_sale: {
    label: 'Inventory',
    hint: 'Sold to customers — appears in POS when selling products.',
    badgeClass: 'bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200/80',
  },
  for_supply: {
    label: 'Company Supply',
    hint: 'Consumable / internal company use — kept in stock but not listed as a POS product.',
    badgeClass: 'bg-amber-50 text-amber-900 ring-1 ring-amber-200/80',
  },
};

export interface InventoryItem {
  id: string;
  name: string;
  brand: string;
  category: string;
  quantity: number;
  unit: string; // Added unit field (e.g., pcs, kg, liters)
  /** Selling price per unit (SRP / retail) — used in POS. */
  unitPrice: number;
  /** Cost / capital per unit (COGS). Gross profit per unit = unitPrice − capitalPrice. When omitted, treated as unitPrice (zero margin). */
  capitalPrice?: number;
  description: string;
  minStockLevel: number;
  lastUpdated: string;
  /** When the item record was first created in the system (ISO). May match lastUpdated for legacy rows. */
  createdAt?: string;
  receiptNumber?: string; // Track the latest receipt number
  defectiveQuantity?: number;
  /** Default `for_sale` when missing (legacy data). */
  stockPurpose?: StockPurpose;
}

export type TransactionType = 'ADDITION' | 'RELEASE' | 'ADJUSTMENT' | 'ISSUE' | 'RETURN' | 'RETURN_FROM_SALES';

/** One line on a multi-line POS sale (stored on the parent RELEASE transaction). */
export interface PosLineItem {
  itemId?: string | null;
  itemName: string;
  itemType: 'Product' | 'Service';
  quantity: number;
  unitPrice: number;
  /** Extended line amount before line discount (qty × unit price). */
  lineSubtotal: number;
  /** Per-unit discount in PHP; total line discount = discountPerUnit × quantity. */
  discountPerUnit?: number | null;
  /** COGS per unit at sale time (products only). */
  costPerUnit?: number | null;
}

export interface Transaction {
  id: string;
  itemId?: string | null;
  itemName: string;
  type: TransactionType;
  quantityChange: number;
  unitPriceAtTime: number; // RELEASE: selling price; ADDITION: capital/cost per unit at posting time.
  totalValue: number;
  /** ADDITION: selling price per unit for the batch (optional; stored for audit). */
  sellingPriceAtTime?: number | null;
  timestamp: string;
  recipient?: string; // Name of the person/department receiving the item
  note?: string;
  receiptNumber?: string; // Optional receipt number for tracking purchases
  releaseTransactionId?: string;
  returnReason?: 'defective' | 'wrong_item' | 'customer_return' | 'others';
  returnReasonOthers?: string;
  returnReasonText?: string;
  condition?: 'restock' | 'defective';
  modeOfPayment?: string | null;
  modeOfPaymentOther?: string | null;
  personId?: string | null;
  vehicleId?: string | null;
  discountPercent?: number | null;
  discountAmount?: number | null;
  taxPercent?: number | null;
  taxAmount?: number | null;
  /** Product = inventory item, deduct stock. Service = custom name/price, no stock. */
  itemType?: 'Product' | 'Service' | null;
  /** Admin who created the RELEASE (for accountability). */
  releasedBy?: string | null;
  /** Admin who processed the RETURN_FROM_SALES (for accountability). */
  returnProcessedBy?: string | null;
  /** Link ADDITION to a purchase (receive from supplier). */
  purchaseId?: string | null;
  /** Purchase Order: invoice number, due date, terms (for RELEASE with mode Purchase Order). */
  invoiceNumber?: string | null;
  dueDate?: string | null;
  terms?: string | null;
  /** Cheque payment: expected bank clearance date (YYYY-MM-DD or ISO). */
  chequeExpectedClearDate?: string | null;
  chequeReference?: string | null;
  chequeStatus?: 'pending' | 'cleared' | 'bounced' | null;
  chequeClearedAt?: string | null;
  /** Multi-line POS basket (single RELEASE with multiple stock deductions). */
  posLineItems?: PosLineItem[] | null;
  /** Set when an ADDITION (restock) row was corrected after save. */
  editedAt?: string | null;
  editNote?: string | null;
  /** Sum of line subtotals before transaction-level discount. */
  subtotalBeforeDiscount?: number | null;
  /** Revenue minus COGS for this sale (after discount). */
  netIncome?: number | null;
  /** Total COGS for product lines at sale time. */
  totalCostAtTime?: number | null;
  /** More than one line item — return-from-sales is not supported for this receipt. */
  bundledSale?: boolean | null;
}

export interface DashboardStats {
  totalItems: number;
  totalInventoryValue: number;
  lowStockCount: number;
  recentActivityCount: number;
}

export type SoaPaymentStatus = 'Unpaid' | 'Partially Paid' | 'Paid';

export interface StatementOfAccount {
  id: string;
  transactionId: string;
  customerName: string;
  itemId?: string | null;
  itemName: string;
  quantity: number;
  srp: number;
  discountPercent?: number | null;
  discountAmount?: number | null;
  totalAmountDue: number;
  transactionDate: string;
  dueDate: string;
  paymentStatus: SoaPaymentStatus;
  createdAt: string;
  personId?: string | null;
  vehicleId?: string | null;
  vehiclePlateNumber?: string | null;
  taxPercent?: number | null;
  taxAmount?: number | null;
  itemType?: 'Product' | 'Service';
  /** Enriched: from API when fetched by transactionId */
  billingTotal?: number;
  paymentsMade?: { id: string; amountPaid: number; paidAt: string; note?: string | null }[];
  totalPaid?: number;
  remainingBalance?: number;
  status?: 'Unpaid' | 'Partially Paid' | 'Paid' | 'Overdue';
}

export type LoanStatus = 'unpaid' | 'ongoing' | 'overdue' | 'paid' | 'cash';
export type PaymentSchedule = 'weekly' | 'monthly';

export interface Loan {
  id: string;
  transactionId: string;
  customerName: string;
  totalAmount: number;
  downPayment: number;
  remainingBalance: number;
  interestRate?: number | null;
  startDate: string;
  dueDate: string;
  paymentSchedule: PaymentSchedule;
  status: LoanStatus;
  createdAt: string;
  updatedAt: string;
  payments?: LoanPayment[];
}

export interface LoanPayment {
  id: string;
  loanId: string;
  amountPaid: number;
  paidAt: string;
  remainingBalanceAfter: number;
  note?: string | null;
}

export interface Person {
  id: string;
  fullName: string;
  contactNumber: string;
  address?: string;
  email?: string;
  createdAt?: string;
}

export interface Vehicle {
  id: string;
  personId: string;
  plateNumber: string;
  brand?: string;
  model?: string;
  year?: number | null;
  color?: string;
  createdAt?: string;
}

export type ExpenseCategory = 'Utilities' | 'Supplies' | 'Salary' | 'Maintenance' | 'Others';

export interface Expense {
  id: string;
  title: string;
  category: ExpenseCategory | string;
  amount: number;
  description?: string;
  date: string;
  recordedBy: string;
  recordedByUserId?: string | null;
  createdAt?: string;
}

// --- Purchasing (Supplier → Receive → Inventory) ---
export interface Supplier {
  id: string;
  name: string;
  contactNumber?: string;
  address?: string;
  email?: string;
  /** Tax Identification Number (business TIN) */
  tin?: string;
  createdAt?: string;
}

export type PurchasePaymentType = 'cash' | 'accounts_payable';
export type PurchasePaymentMethod = 'cash' | 'cheque' | 'card';

export interface PurchaseLineItem {
  itemId: string;
  itemName: string;
  quantity: number;
  /** Supplier unit cost (before purchase-level discount allocation). */
  unitCost: number;
  /** Expected selling price per unit for this line (SRP). */
  sellingPrice?: number;
  total: number;
  /** After purchase discount is spread across lines (optional; set by server). */
  effectiveUnitCost?: number;
}

export interface PurchasePaymentRecord {
  id: string;
  amount: number;
  method: PurchasePaymentMethod;
  paidAt: string;
  reference?: string;
}

export type PurchaseStatus = 'paid' | 'unpaid' | 'partial';

/** Supplier invoice discount for the whole receive (one of: none, % of merchandise, or fixed ₱). */
export type PurchaseDiscountMode = 'none' | 'percent' | 'amount';

export interface Purchase {
  id: string;
  supplierId: string;
  supplierName: string;
  purchaseDate: string;
  paymentType: PurchasePaymentType;
  /** Net amount owed after discount (merchandise − discount). */
  totalAmount: number;
  status: PurchaseStatus;
  receiptNumber?: string;
  note?: string;
  lineItems: PurchaseLineItem[];
  payments: PurchasePaymentRecord[];
  createdAt: string;
  purchaseDiscountMode?: PurchaseDiscountMode;
  /** When mode is percent: 0–100. When mode is amount: peso discount per unit; invoice discount = this × sum of line quantities. */
  purchaseDiscountValue?: number;
  /** Sum of qty × unitCost before discount. */
  merchandiseSubtotal?: number;
  discountTotal?: number;
  /** Sum of qty × sellingPrice per line. */
  expectedRevenueAtSrp?: number;
  /** expectedRevenueAtSrp − net merchandise cost (after discount). */
  expectedNetProfit?: number;
}