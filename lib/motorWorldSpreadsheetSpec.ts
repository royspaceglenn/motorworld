/**
 * Formula and label alignment with the Motor World Google Sheets workbook
 * ("copy of motorworld" — SALES JOURNAL drives SALES SUMMARY REPORTS, etc.).
 *
 * Journal columns (SALES JOURNAL sheet):
 *  H = TRANSACTION TYPE (MATERIALS | SERVICES)
 *  M = TERMS (CASH | CHECK | MAYA-CARD | 30 DAYS | 60 DAYS | …)
 *  T = TOTAL COST PER ITEM (qty × cost)
 *  V = TOTAL PRICE (qty × unit price, pre line discount)
 *  AB = DISCOUNT (V − net line amount)
 */
import type { Transaction } from '../types';

export const MW_COMPANY = {
  name: 'MOTOR WORLD AUTO SERVICES AND SALES CORPORATION',
  address: 'BLK. 1, LOT 15&16, PUROK 18, DABDAI SUBD., BRGY. MABUHAY, GSC',
  phone: 'TEL. NO. (083)552-9173 / 0912-506-1034',
} as const;

export const MW_SIGNATURES = {
  preparedBy: 'YWAY, SHEENA',
  checkedBy: 'BALQUIN, VERGIL III',
  auditedBy: 'BERDON, DHELANIE MAE',
  verifiedBy: 'SUGABO, PEDERICK',
} as const;

/** TERMS column (journal col M) normalized for SUMIFS-style buckets. */
export function journalTermsLabel(t: Transaction): string {
  const raw = String(t.terms || '').trim().toUpperCase();
  if (raw && raw !== '—' && raw !== '-') return raw.replace(/\s+/g, ' ');

  const mode = String(t.modeOfPayment || 'Cash').trim();
  if (mode === 'Cheque') return 'CHECK';
  if (mode === 'Cash') return 'CASH';
  if (mode === 'Purchase Order') return '30 DAYS';
  if (mode === 'Credit') {
    const days = Number(t.dueDays);
    if (days === 60) return '60 DAYS';
    return '30 DAYS';
  }
  const other = String(t.modeOfPaymentOther || '').trim().toUpperCase();
  if (other) return other.replace(/\s+/g, ' ');
  return 'CASH';
}

/** Spreadsheet CASH SALES row: SUMIFS(V) where TERMS is CASH, CHECK, or MAYA-CARD. */
export function isSpreadsheetCashSalesTerms(t: Transaction): boolean {
  const terms = journalTermsLabel(t);
  return terms === 'CASH' || terms === 'CHECK' || terms === 'CHEQUE' || terms === 'MAYA-CARD';
}

/** Spreadsheet ACCOUNT RECEIVABLES row: SUMIFS(V) where TERMS is 30 DAYS or 60 DAYS. */
export function isSpreadsheetAccountReceivableTerms(t: Transaction): boolean {
  const terms = journalTermsLabel(t);
  if (terms === '30 DAYS' || terms === '60 DAYS') return true;
  const m = terms.match(/^(\d+)\s*DAYS/);
  return m ? Number(m[1]) >= 30 : false;
}

/** TRANSACTION TYPE column (journal col H). */
export function journalTransactionType(t: Transaction): 'MATERIALS' | 'SERVICES' {
  if (t.posLineItems && t.posLineItems.length > 0) {
    const hasProduct = t.posLineItems.some((l) => l.itemType !== 'Service');
    const hasService = t.posLineItems.some((l) => l.itemType === 'Service');
    if (hasService && !hasProduct) return 'SERVICES';
    return 'MATERIALS';
  }
  return t.itemType === 'Service' ? 'SERVICES' : 'MATERIALS';
}
