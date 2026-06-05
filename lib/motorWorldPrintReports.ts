import type { Expense, InventoryItem, Transaction } from '../types';
import {
  buildSalesSummaryReleaseDetails,
  type MotorWorldSalesSummary,
  type SalesSummaryReleaseDetailRow,
} from './salesSummaryReport';
import { MW_COMPANY, MW_SIGNATURES } from './motorWorldSpreadsheetSpec';

function escHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function moneyPhp(n: number) {
  return `PHP${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function openPrintHtml(title: string, bodyHtml: string) {
  const win = window.open('', '_blank', 'width=900,height=900');
  if (!win) return;
  win.document.open();
  win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"/><title>${escHtml(title)}</title>
<style>
  @page { margin: 12mm; }
  body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 11px; color: #0f172a; padding: 16px; }
  .co { font-weight: 800; font-size: 14px; color: #1e40af; }
  .addr { font-size: 10px; color: #334155; margin: 4px 0 12px; }
  h1 { font-size: 13px; letter-spacing: 0.08em; margin: 12px 0; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th, td { border: 1px solid #0f172a; padding: 6px 8px; }
  th { background: #e2e8f0; text-transform: uppercase; font-size: 9px; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .row-label td:first-child { font-weight: 600; background: #f8fafc; }
  .sigs { margin-top: 32px; display: grid; grid-template-columns: 1fr 1fr; gap: 24px; font-size: 10px; }
  .sig { border-top: 1px solid #000; padding-top: 6px; text-align: center; }
</style></head><body>${bodyHtml}</body></html>`);
  win.document.close();
  setTimeout(() => {
    win.focus();
    win.print();
  }, 350);
}

function companyHeader(title: string, periodStart: Date, periodEnd: Date) {
  const ps = periodStart.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  const pe = periodEnd.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  return `
    <div class="co">${escHtml(MW_COMPANY.name)}</div>
    <div class="addr">${escHtml(MW_COMPANY.address)} · ${escHtml(MW_COMPANY.phone)}</div>
    <h1>${escHtml(title)}</h1>
    <p><strong>Starting Date:</strong> ${escHtml(ps)} &nbsp; <strong>Ending Date:</strong> ${escHtml(pe)}</p>`;
}

function signatureBlock() {
  return `
    <div class="sigs">
      <div class="sig"><strong>PREPARED BY:</strong><br/><br/>${escHtml(MW_SIGNATURES.preparedBy)}</div>
      <div class="sig"><strong>CHECKED BY:</strong><br/><br/>${escHtml(MW_SIGNATURES.checkedBy)}</div>
      <div class="sig"><strong>AUDITED BY:</strong><br/><br/>${escHtml(MW_SIGNATURES.auditedBy)}</div>
      <div class="sig"><strong>VERIFIED BY:</strong><br/><br/>${escHtml(MW_SIGNATURES.verifiedBy)}</div>
    </div>`;
}

/** Tab: SALES SUMMARY REPORTS */
export function printSalesSummaryReport(summary: MotorWorldSalesSummary, rangeStart: Date, rangeEnd: Date) {
  const body = `
    ${companyHeader('SALES SUMMARY REPORTS', rangeStart, rangeEnd)}
    <table>
      <tr class="row-label">
        <td>SALES OF GOODS</td><td class="num">${moneyPhp(summary.salesOfGoods)}</td>
        <td>SALES OF SERVICE AND LABOR</td><td class="num">${moneyPhp(summary.salesOfServiceAndLabor)}</td>
        <td colspan="2"></td>
        <td>TOTAL SALES</td><td class="num">${moneyPhp(summary.totalNetOfGoodsAndServicesSold)}</td>
      </tr>
      <tr class="row-label">
        <td>CASH SALES</td><td class="num">${moneyPhp(summary.cashSales)}</td>
        <td>ACCOUNT RECEIVABLES</td><td class="num">${moneyPhp(summary.accountsReceivableAndSimilar)}</td>
        <td colspan="4"></td>
      </tr>
      <tr>
        <th>SALES OF GOODS</th>
        <th>SALE OF SERVICE AND LABOR</th>
        <th>TOTAL NET OF GOODS &amp; SERVICES SOLD</th>
        <th>LESS: COST OF GOODS &amp; SERVICES</th>
        <th>LESS: DISCOUNT</th>
        <th>TOTAL GROSS SALES</th>
        <th>LESS: EXPENSES</th>
        <th>NET INCOME</th>
      </tr>
      <tr>
        <td class="num">${moneyPhp(summary.salesOfGoods)}</td>
        <td class="num">${moneyPhp(summary.salesOfServiceAndLabor)}</td>
        <td class="num">${moneyPhp(summary.totalNetOfGoodsAndServicesSold)}</td>
        <td class="num">${moneyPhp(summary.costOfGoodsAndServices)}</td>
        <td class="num">${moneyPhp(summary.totalDiscounts)}</td>
        <td class="num">${moneyPhp(summary.totalGrossSales)}</td>
        <td class="num">${moneyPhp(summary.totalOperatingExpenses)}</td>
        <td class="num">${moneyPhp(summary.netIncome)}</td>
      </tr>
    </table>
    ${signatureBlock()}`;
  openPrintHtml(`Sales summary ${summary.periodLabel}`, body);
}

/** Tab: COST OF GOODS SOLD PRINT — line cost from sales journal equivalent. */
export function printCogsReport(
  transactions: Transaction[],
  items: InventoryItem[],
  rangeStart: Date,
  rangeEnd: Date,
  periodLabel: string
) {
  const rows = buildSalesSummaryReleaseDetails(transactions, items, rangeStart, rangeEnd);
  const bodyRows = rows
    .map(
      (r: SalesSummaryReleaseDetailRow) => `<tr>
      <td>${escHtml(new Date(r.timestamp).toLocaleDateString())}</td>
      <td>${escHtml(r.recipient)}</td>
      <td>${escHtml(r.paymentTerms)}</td>
      <td class="num">${moneyPhp(r.grossSelling)}</td>
      <td class="num">${moneyPhp(r.cogs)}</td>
      <td class="num">${moneyPhp(r.discount)}</td>
    </tr>`
    )
    .join('');
  const totalCost = rows.reduce((s, r) => s + r.cogs, 0);
  const body = `
    ${companyHeader('COST OF GOODS SOLD PRINT', rangeStart, rangeEnd)}
    <table>
      <thead><tr>
        <th>Date</th><th>Customer</th><th>Terms</th><th>Total price</th><th>Total cost</th><th>Discount</th>
      </tr></thead>
      <tbody>${bodyRows || '<tr><td colspan="6">No sales in range.</td></tr>'}</tbody>
      <tfoot><tr><td colspan="4"><strong>TOTAL COST OF GOODS &amp; SERVICES</strong></td><td class="num"><strong>${moneyPhp(totalCost)}</strong></td><td></td></tr></tfoot>
    </table>
    ${signatureBlock()}`;
  openPrintHtml(`COGS ${periodLabel}`, body);
}

/** Tab: EXPENSES PRINT */
export function printExpensesReport(expenses: Expense[], rangeStart: Date, rangeEnd: Date, periodLabel: string) {
  const startMs = rangeStart.getTime();
  const endMs = rangeEnd.getTime();
  const rows = expenses.filter((e) => {
    const d = new Date(e.date).getTime();
    return d >= startMs && d <= endMs;
  });
  const bodyRows = rows
    .map(
      (e) => `<tr>
      <td>${escHtml(String(e.date).slice(0, 10))}</td>
      <td>${escHtml(e.category || '')}</td>
      <td>${escHtml(e.title || e.description || '')}</td>
      <td class="num">${moneyPhp(Number(e.amount || 0))}</td>
    </tr>`
    )
    .join('');
  const total = rows.reduce((s, e) => s + Number(e.amount || 0), 0);
  const body = `
    ${companyHeader('MONTHLY EXPENSES REPORT', rangeStart, rangeEnd)}
    <table>
      <thead><tr><th>Date</th><th>Category</th><th>Title</th><th>Amount</th></tr></thead>
      <tbody>${bodyRows || '<tr><td colspan="4">No expenses in range.</td></tr>'}</tbody>
      <tfoot><tr><td colspan="3"><strong>TOTAL EXPENSES</strong></td><td class="num"><strong>${moneyPhp(total)}</strong></td></tr></tfoot>
    </table>
    ${signatureBlock()}`;
  openPrintHtml(`Expenses ${periodLabel}`, body);
}
