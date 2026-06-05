import React, { useEffect, useMemo, useState } from 'react';
import type { Expense, InventoryItem, Person, Transaction, Vehicle } from '../types';
import { expensesApi } from '../lib/api/adminData';
import {
  buildSalesDepositReportRows,
  buildSalesRegisterLines,
  buildSalesSummaryReleaseDetails,
  computeMotorWorldSalesSummary,
  endOfLocalDay,
  parseLocalDayStart,
  toLocalYmd,
  type MotorWorldSalesSummary,
  type SalesDepositReportRow,
  type SalesRegisterLineRow,
  type SalesSummaryReleaseDetailRow,
} from '../lib/salesSummaryReport';
import { DashboardSectionHeader, DashboardSurface } from './ui/DashboardPrimitives';
import { Button } from './ui/Button';
import { FileSpreadsheet, FileUp, Loader2, Printer } from 'lucide-react';
import { Sr1ImportModal } from './Sr1ImportModal';

function defaultMonthRangeYmd(): { start: string; end: string } {
  const d = new Date();
  const y = d.getFullYear();
  const m = d.getMonth();
  return { start: toLocalYmd(new Date(y, m, 1)), end: toLocalYmd(new Date(y, m + 1, 0)) };
}

function money(n: number) {
  return `₱${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function paymentModeLabel(mode: string): string {
  const m = String(mode || '').trim();
  if (m === 'Credit') return 'Accounts Receivable';
  if (m === 'Purchase Order') return 'Purchase Order';
  if (m === 'Cheque') return 'Cheque';
  return m || 'Cash';
}

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

function round2p(n: number) {
  return Math.round(Number(n || 0) * 100) / 100;
}

/** Landscape Motor World–style sales deposit printout (includes customer + sale reference). */
function printSalesSummary(
  summary: MotorWorldSalesSummary,
  depositRows: SalesDepositReportRow[],
  rangeStart: Date,
  rangeEnd: Date
) {
  const win = window.open('', '_blank', 'width=1100,height=900');
  if (!win) return;

  let sumMat = 0;
  let sumSvc = 0;
  let sumDisc = 0;
  let sumNet = 0;
  let sumCost = 0;
  let sumLineProfit = 0;
  let sumCash = 0;
  let sumChk = 0;
  for (const r of depositRows) {
    sumMat = round2p(sumMat + r.materials);
    sumSvc = round2p(sumSvc + r.services);
    sumDisc = round2p(sumDisc + r.discount);
    sumNet = round2p(sumNet + r.totalAmount);
    sumCost = round2p(sumCost + r.costAtSale);
    sumLineProfit = round2p(sumLineProfit + r.lineGrossProfit);
    sumCash = round2p(sumCash + r.cashCardDeposited);
    sumChk = round2p(sumChk + r.checkDeposited);
  }

  const totalSalesGross = round2p(sumMat + sumSvc);
  const totalCollection = round2p(sumCash + sumChk);
  const netAfterDiscountStrip = round2p(summary.totalNetOfGoodsAndServicesSold - summary.totalDiscounts);
  const grossProfitStrip = round2p(summary.totalGrossSales);

  const bodyRows =
    depositRows.length === 0
      ? '<tr><td colspan="14" class="muted center">No sales in this date range.</td></tr>'
      : depositRows
          .map((r) => {
            const discClass = r.discount > 0 ? 'neg' : '';
            const varClass = Math.abs(r.variance) > 0.005 ? (r.variance < 0 ? 'neg' : '') : '';
            return `<tr>
          <td>${escHtml(r.saleDate)}</td>
          <td class="nowrap">${escHtml(r.customerName)}</td>
          <td class="ref">${escHtml(r.saleReference)}</td>
          <td class="num">${moneyPhp(r.materials)}</td>
          <td class="num">${moneyPhp(r.services)}</td>
          <td class="num tax">${moneyPhp(r.taxWithheld)}</td>
          <td class="num ${discClass}">${moneyPhp(r.discount)}</td>
          <td class="num strong">${moneyPhp(r.totalAmount)}</td>
          <td class="num">${moneyPhp(r.costAtSale)}</td>
          <td class="num strong">${moneyPhp(r.lineGrossProfit)}</td>
          <td class="nowrap sm">${escHtml(r.dateDepositedLabel)}</td>
          <td class="num">${moneyPhp(r.cashCardDeposited)}</td>
          <td class="num">${moneyPhp(r.checkDeposited)}</td>
          <td class="num ${varClass}">${moneyPhp(r.variance)}</td>
        </tr>`;
          })
          .join('');

  const periodStart = rangeStart.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  const periodEnd = rangeEnd.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  const datePrepared = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"/><title>Sales deposit report ${escHtml(summary.periodLabel)}</title>
<style>
  @page { size: landscape; margin: 10mm; }
  body { font-family: 'Segoe UI', Arial, sans-serif; color: #0f172a; padding: 12px 16px; font-size: 10px; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; border-bottom: 2px solid #1e3a8a; padding-bottom: 10px; margin-bottom: 10px; }
  .co { font-weight: 800; font-size: 14px; color: #1e40af; letter-spacing: 0.02em; }
  .addr { font-size: 9px; color: #334155; margin-top: 4px; max-width: 340px; line-height: 1.35; }
  .period { text-align: right; font-size: 10px; color: #1e293b; }
  .period strong { display: block; color: #1e40af; font-size: 13px; margin-bottom: 6px; letter-spacing: 0.1em; }
  .title { text-align: center; font-weight: 800; font-size: 13px; color: #1e40af; letter-spacing: 0.12em; margin: 10px 0 12px; }
  table.main { width: 100%; border-collapse: collapse; table-layout: fixed; }
  table.main th, table.main td { border: 1px solid #0f172a; padding: 5px 6px; vertical-align: middle; word-wrap: break-word; }
  table.main thead th { background: #e2e8f0; font-weight: 700; font-size: 8px; text-transform: uppercase; letter-spacing: 0.04em; text-align: center; }
  table.main .num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  table.main .nowrap { white-space: nowrap; max-width: 140px; overflow: hidden; text-overflow: ellipsis; }
  table.main .ref { font-size: 9px; }
  table.main .sm { font-size: 9px; }
  .neg { color: #b91c1c; font-weight: 600; }
  .tax { color: #1d4ed8; }
  .strong { font-weight: 700; }
  .muted { color: #64748b; }
  .center { text-align: center; }
  .foot { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-top: 16px; align-items: start; }
  .foot h4 { font-size: 9px; letter-spacing: 0.1em; margin: 0 0 6px; color: #0f172a; }
  .foot table { width: 100%; border-collapse: collapse; font-size: 10px; }
  .foot td { padding: 4px 0; border-bottom: 1px solid #e2e8f0; }
  .foot td:first-child { font-weight: 600; }
  .foot td.num { text-align: right; font-weight: 700; }
  .strip { margin-top: 16px; border: 1px solid #0f172a; padding: 10px 12px; max-width: 420px; margin-left: auto; }
  .strip .row { display: flex; justify-content: space-between; gap: 12px; margin: 5px 0; font-size: 10px; }
  .strip .row.taxrow .v { color: #1d4ed8; font-weight: 700; }
  .strip .row.disc .v { color: #b91c1c; font-weight: 700; }
  .strip .row.total .v { font-weight: 800; font-size: 11px; }
  .prep { margin-top: 14px; font-size: 10px; color: #334155; }
  .sigs { margin-top: 28px; display: grid; grid-template-columns: 1fr 1fr; gap: 24px 40px; font-size: 9px; }
  .sig { border-top: 1px solid #0f172a; padding-top: 6px; text-align: center; }
  .sig .l { font-weight: 700; letter-spacing: 0.08em; margin-bottom: 20px; }
  .bottomline { margin-top: 20px; border-top: 2px solid #0f172a; padding-top: 8px; display: flex; justify-content: flex-end; gap: 16px; font-weight: 800; font-size: 11px; }
  @media print { body { padding: 0; } }
</style></head><body>
  <div class="header">
    <div>
      <div class="co">MOTOR WORLD AUTO SERVICES & SALES CORPORATION</div>
      <div class="addr">Sales deposit report — matches Motor World–style layout. Customer and sale reference on each line.</div>
    </div>
    <div class="period">
      <strong>SALES DEPOSIT REPORTS</strong>
      <div><strong>Starting date:</strong> ${escHtml(periodStart)}</div>
      <div><strong>Ending date:</strong> ${escHtml(periodEnd)}</div>
    </div>
  </div>

  <table class="main">
    <thead>
      <tr>
        <th style="width:9%">Date</th>
        <th style="width:11%">Customer name</th>
        <th style="width:8%">Ref. no.</th>
        <th style="width:9%">Sales — materials</th>
        <th style="width:9%">Sales — services</th>
        <th style="width:7%">Tax withheld</th>
        <th style="width:7%">Discount</th>
        <th style="width:8%">Total amount</th>
        <th style="width:8%">Cost at sale</th>
        <th style="width:8%">Gross profit</th>
        <th style="width:9%">Date deposited</th>
        <th style="width:8%">Cash — card deposited</th>
        <th style="width:7%">Check deposited</th>
        <th style="width:5%">Variance</th>
      </tr>
    </thead>
    <tbody>${bodyRows}</tbody>
  </table>

  <div class="foot">
    <div>
      <h4>SALES</h4>
      <table>
        <tr><td>SALES — MATERIALS</td><td class="num">${moneyPhp(sumMat)}</td></tr>
        <tr><td>SALES — SERVICES</td><td class="num">${moneyPhp(sumSvc)}</td></tr>
        <tr><td>TOTAL SALES</td><td class="num">${moneyPhp(totalSalesGross)}</td></tr>
        <tr><td>COST OF GOODS AND SERVICES SOLD</td><td class="num">${moneyPhp(summary.costOfGoodsAndServices)}</td></tr>
        <tr><td>DISCOUNT</td><td class="num">${moneyPhp(summary.totalDiscounts)}</td></tr>
        <tr><td>GROSS PROFIT</td><td class="num">${moneyPhp(grossProfitStrip)}</td></tr>
      </table>
    </div>
    <div>
      <h4>SALES COLLECTION</h4>
      <table>
        <tr><td>CASH — CARD DEPOSITS</td><td class="num">${moneyPhp(sumCash)}</td></tr>
        <tr><td>CHECK DEPOSITS</td><td class="num">${moneyPhp(sumChk)}</td></tr>
        <tr><td>TOTAL COLLECTION</td><td class="num">${moneyPhp(totalCollection)}</td></tr>
      </table>
    </div>
  </div>

  <div class="strip">
    <div class="row taxrow"><span>TAX WITHHELD</span><span class="v">${moneyPhp(0)}</span></div>
    <div class="row"><span>TOTAL AMOUNT</span><span class="v">${moneyPhp(summary.totalNetOfGoodsAndServicesSold)}</span></div>
    <div class="row disc"><span>DISCOUNT</span><span class="v">${moneyPhp(summary.totalDiscounts)}</span></div>
    <div class="row"><span>COST OF GOODS AND SERVICES SOLD</span><span class="v">${moneyPhp(summary.costOfGoodsAndServices)}</span></div>
    <div class="row total"><span>NET SALES (after discount)</span><span class="v">${moneyPhp(netAfterDiscountStrip)}</span></div>
    <div class="row total"><span>GROSS PROFIT (after cost &amp; discount)</span><span class="v">${moneyPhp(grossProfitStrip)}</span></div>
  </div>

  <p class="prep"><strong>DATE PREPARED:</strong> ${escHtml(datePrepared)}</p>

  <div class="sigs">
    <div class="sig"><div class="l">PREPARED BY</div><div style="height:28px"></div><div>Signature over printed name</div></div>
    <div class="sig"><div class="l">CHECKED BY</div><div style="height:28px"></div><div>Signature over printed name</div></div>
    <div class="sig"><div class="l">AUDITED BY</div><div style="height:28px"></div><div>Signature over printed name</div></div>
    <div class="sig"><div class="l">VERIFIED BY</div><div style="height:28px"></div><div>Signature over printed name</div></div>
  </div>

  <div class="bottomline">
    <span>TOTAL AMOUNT (sum of sale totals)</span>
    <span>${moneyPhp(sumNet)}</span>
  </div>
</body></html>`;

  win.document.open();
  win.document.write(html);
  win.document.close();
  setTimeout(() => {
    win.focus();
    win.print();
  }, 350);
}

/** Landscape SR-1 sales register — line-by-line detail matching Motor World SR-1.pdf. */
function printSalesRegisterSr1(rows: SalesRegisterLineRow[], rangeStart: Date, rangeEnd: Date) {
  const win = window.open('', '_blank', 'width=1400,height=900');
  if (!win) return;

  const periodStart = rangeStart.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  const periodEnd = rangeEnd.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  const datePrepared = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });

  const bodyRows =
    rows.length === 0
      ? '<tr><td colspan="24" class="center muted">No sales in this date range.</td></tr>'
      : rows
          .map((r) => {
            const discClass = r.discountPeso > 0 ? 'neg' : '';
            return `<tr>
          <td class="nowrap">${escHtml(r.saleDate)}</td>
          <td class="nowrap sm">${escHtml(r.dateCovered)}</td>
          <td class="mono">${escHtml(r.crNo)}</td>
          <td class="mono">${escHtml(r.bsNo)}</td>
          <td class="mono">${escHtml(r.poNo)}</td>
          <td class="sm">${escHtml(r.invoiceLabel)}</td>
          <td class="sm">${escHtml(r.transactionType)}</td>
          <td>${escHtml(r.customerName)}</td>
          <td class="sm">${escHtml(r.address)}</td>
          <td class="sm">${escHtml(r.carModel)}</td>
          <td class="mono">${escHtml(r.plateNo)}</td>
          <td class="sm">${escHtml(r.terms)}</td>
          <td class="sm">${escHtml(r.supplierName)}</td>
          <td class="mono">${escHtml(r.itemCode)}</td>
          <td>${escHtml(r.description)}</td>
          <td class="num">${r.qty}</td>
          <td class="sm">${escHtml(r.uom)}</td>
          <td class="num">${moneyPhp(r.costPerUnit)}</td>
          <td class="num">${moneyPhp(r.totalCost)}</td>
          <td class="num">${moneyPhp(r.unitPrice)}</td>
          <td class="num">${moneyPhp(r.totalPrice)}</td>
          <td class="num strong">${moneyPhp(r.transactionTotal)}</td>
          <td class="num ${discClass}">${r.discountPeso > 0 ? moneyPhp(r.discountPeso) : '—'}</td>
          <td class="num ${discClass}">${r.discountPercent > 0 ? `${r.discountPercent.toFixed(2)}%` : '—'}</td>
        </tr>`;
          })
          .join('');

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"/><title>SR-1 Sales register ${escHtml(periodStart)} – ${escHtml(periodEnd)}</title>
<style>
  @page { size: landscape; margin: 8mm; }
  body { font-family: 'Segoe UI', Arial, sans-serif; color: #0f172a; padding: 8px 10px; font-size: 7px; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #1e3a8a; padding-bottom: 8px; margin-bottom: 8px; }
  .co { font-weight: 800; font-size: 12px; color: #1e40af; }
  .sub { font-size: 8px; color: #334155; margin-top: 3px; }
  .period { text-align: right; font-size: 8px; }
  .period strong { display: block; color: #1e40af; font-size: 11px; letter-spacing: 0.12em; margin-bottom: 4px; }
  .title { text-align: center; font-weight: 800; font-size: 11px; color: #1e40af; letter-spacing: 0.14em; margin: 6px 0 8px; }
  table.main { width: 100%; border-collapse: collapse; table-layout: fixed; }
  table.main th, table.main td { border: 1px solid #0f172a; padding: 3px 4px; vertical-align: top; word-wrap: break-word; }
  table.main thead th { background: #e2e8f0; font-weight: 700; font-size: 6px; text-transform: uppercase; letter-spacing: 0.03em; text-align: center; line-height: 1.2; }
  table.main .num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  table.main .nowrap { white-space: nowrap; }
  table.main .mono { font-family: Consolas, monospace; font-size: 6.5px; }
  table.main .sm { font-size: 6.5px; }
  .neg { color: #b91c1c; font-weight: 600; }
  .strong { font-weight: 700; }
  .muted { color: #64748b; }
  .center { text-align: center; }
  .prep { margin-top: 10px; font-size: 8px; }
  @media print { body { padding: 0; } }
</style></head><body>
  <div class="header">
    <div>
      <div class="co">MOTOR WORLD AUTO SERVICES &amp; SALES CORPORATION</div>
      <div class="sub">SR-1 Sales register — generated from system transactions (POS / releases).</div>
    </div>
    <div class="period">
      <strong>SR-1</strong>
      <div><strong>From:</strong> ${escHtml(periodStart)}</div>
      <div><strong>To:</strong> ${escHtml(periodEnd)}</div>
    </div>
  </div>
  <div class="title">SALES REGISTER (SR-1)</div>
  <table class="main">
    <thead>
      <tr>
        <th>Date</th><th>Date covered</th><th>CR no.</th><th>BS no.</th><th>PO no.</th>
        <th>Invoice</th><th>Type</th><th>Customer</th><th>Address</th><th>Car model</th>
        <th>Plate</th><th>Terms</th><th>Supplier</th><th>Item code</th><th>Description</th>
        <th>Qty</th><th>UOM</th><th>Cost/unit</th><th>Total cost</th><th>Unit price</th>
        <th>Total price</th><th>Txn total</th><th>Disc (₱)</th><th>Disc %</th>
      </tr>
    </thead>
    <tbody>${bodyRows}</tbody>
  </table>
  <p class="prep"><strong>DATE PREPARED:</strong> ${escHtml(datePrepared)} · <strong>Lines:</strong> ${rows.length}</p>
</body></html>`;

  win.document.open();
  win.document.write(html);
  win.document.close();
  setTimeout(() => {
    win.focus();
    win.print();
  }, 350);
}

interface SalesSummaryReportViewProps {
  transactions: Transaction[];
  items: InventoryItem[];
  persons?: Person[];
  vehicles?: Vehicle[];
  onDataImported?: () => void;
}

export const SalesSummaryReportView: React.FC<SalesSummaryReportViewProps> = ({
  transactions,
  items,
  persons = [],
  vehicles = [],
  onDataImported,
}) => {
  const defaults = useMemo(() => defaultMonthRangeYmd(), []);
  const [startDate, setStartDate] = useState(defaults.start);
  const [endDate, setEndDate] = useState(defaults.end);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sr1ImportOpen, setSr1ImportOpen] = useState(false);

  const invalidRange = useMemo(() => {
    const ok = /^\d{4}-\d{2}-\d{2}$/.test(startDate) && /^\d{4}-\d{2}-\d{2}$/.test(endDate);
    if (!ok) return true;
    return startDate > endDate;
  }, [startDate, endDate]);

  const rangeStart = useMemo(() => parseLocalDayStart(startDate), [startDate]);
  const rangeEnd = useMemo(() => endOfLocalDay(endDate), [endDate]);

  useEffect(() => {
    if (invalidRange) return;
    const startStr = toLocalYmd(rangeStart);
    const endStr = toLocalYmd(rangeEnd);
    setLoading(true);
    setLoadError(null);
    expensesApi
      .list({ startDate: startStr, endDate: endStr })
      .then((res) => setExpenses(res.expenses ?? []))
      .catch((e) => setLoadError(e instanceof Error ? e.message : 'Failed to load expenses.'))
      .finally(() => setLoading(false));
  }, [startDate, endDate, invalidRange, rangeStart, rangeEnd]);

  const summary = useMemo(() => {
    if (invalidRange) return null;
    return computeMotorWorldSalesSummary(transactions, expenses, items, rangeStart, rangeEnd);
  }, [transactions, expenses, items, invalidRange, rangeStart, rangeEnd]);

  const releaseDetails = useMemo(() => {
    if (invalidRange) return [];
    return buildSalesSummaryReleaseDetails(transactions, items, rangeStart, rangeEnd);
  }, [transactions, items, invalidRange, rangeStart, rangeEnd]);

  const depositReportRows = useMemo(() => {
    if (invalidRange) return [];
    return buildSalesDepositReportRows(transactions, items, rangeStart, rangeEnd);
  }, [transactions, items, invalidRange, rangeStart, rangeEnd]);

  const salesRegisterRows = useMemo(() => {
    if (invalidRange) return [];
    return buildSalesRegisterLines(transactions, items, persons, vehicles, rangeStart, rangeEnd);
  }, [transactions, items, persons, vehicles, invalidRange, rangeStart, rangeEnd]);

  const expensesInRange = useMemo(() => {
    if (!summary) return [];
    const lo = summary.startDate;
    const hi = summary.endDate;
    return expenses.filter((e) => {
      const d = String(e.date || '').slice(0, 10);
      return d >= lo && d <= hi;
    });
  }, [expenses, summary]);

  const checkCashPlusAr = useMemo(() => {
    if (!summary) return { sum: 0, diff: 0 };
    const sum = summary.cashSales + summary.accountsReceivableAndSimilar;
    const diff = Math.abs(sum - summary.totalNetOfGoodsAndServicesSold);
    return { sum, diff };
  }, [summary]);

  const setThisMonth = () => {
    const { start, end } = defaultMonthRangeYmd();
    setStartDate(start);
    setEndDate(end);
  };

  return (
    <div className="animate-fade-in max-w-full space-y-6">
      <DashboardSurface className="p-5 sm:p-6">
        <DashboardSectionHeader
          eyebrow="Finance"
          title="Sales summary report"
          description={
            'Import a sales register PDF (SR-1 and more) or generate SR-1 from live POS data. P&L totals and printable deposit report below.'
          }
        />

        <div className="mt-6 flex flex-col gap-4 lg:flex-row lg:flex-wrap lg:items-end lg:justify-between">
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">From date</label>
              <input
                type="date"
                className="rounded-lg border border-slate-200 px-3 py-2 text-slate-800 focus:ring-2 focus:ring-indigo-500"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">To date</label>
              <input
                type="date"
                className="rounded-lg border border-slate-200 px-3 py-2 text-slate-800 focus:ring-2 focus:ring-indigo-500"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
            <Button type="button" variant="ghost" className="text-sm text-indigo-600" onClick={setThisMonth}>
              This month
            </Button>
            {loading && (
              <span className="flex items-center gap-2 text-sm text-slate-500">
                <Loader2 className="w-4 h-4 animate-spin" /> Loading expenses…
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm text-slate-600 flex items-center gap-1">
              <FileSpreadsheet className="w-4 h-4 text-indigo-600 shrink-0" />
              {invalidRange ? '—' : summary?.periodLabel}
            </p>
            <Button type="button" variant="primary" onClick={() => setSr1ImportOpen(true)}>
              <FileUp className="w-4 h-4 mr-1.5" />
              Import register PDF
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={invalidRange || !summary || loading || salesRegisterRows.length === 0}
              onClick={() => printSalesRegisterSr1(salesRegisterRows, rangeStart, rangeEnd)}
            >
              <Printer className="w-4 h-4 mr-1.5" />
              Print SR-1 register
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={invalidRange || !summary || loading}
              onClick={() => summary && printSalesSummary(summary, depositReportRows, rangeStart, rangeEnd)}
            >
              <Printer className="w-4 h-4 mr-1.5" />
              Print deposit report
            </Button>
          </div>
        </div>
        {invalidRange && (
          <p className="mt-3 text-sm text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
            Choose a valid range: <strong>From date</strong> must be on or before <strong>To date</strong>.
          </p>
        )}
        {loadError && <p className="mt-2 text-sm text-red-600">{loadError}</p>}
      </DashboardSurface>

      {!invalidRange && summary && (
        <>
          <DashboardSurface className="p-5 sm:p-6">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500 mb-4">Sales breakdown</h3>
            <table className="w-full text-sm border border-slate-200 rounded-lg overflow-hidden">
              <tbody className="divide-y divide-slate-100">
                <tr className="bg-white">
                  <td className="py-3 px-4 text-slate-700">Sales of goods</td>
                  <td className="py-3 px-4 text-right font-medium text-slate-900">{money(summary.salesOfGoods)}</td>
                </tr>
                <tr className="bg-slate-50/80">
                  <td className="py-3 px-4 text-slate-700">Sales of service and labor</td>
                  <td className="py-3 px-4 text-right font-medium text-slate-900">{money(summary.salesOfServiceAndLabor)}</td>
                </tr>
                <tr className="bg-indigo-50">
                  <td className="py-3 px-4 font-semibold text-slate-900">Total net of goods &amp; services sold</td>
                  <td className="py-3 px-4 text-right font-bold text-indigo-900">{money(summary.totalNetOfGoodsAndServicesSold)}</td>
                </tr>
                <tr className="bg-white">
                  <td className="py-3 px-4 text-slate-700">Cash sales</td>
                  <td className="py-3 px-4 text-right font-medium text-slate-900">{money(summary.cashSales)}</td>
                </tr>
                <tr className="bg-slate-50/80">
                  <td className="py-3 px-4 text-slate-700">Accounts receivable &amp; similar (Credit, P.O., Cheque)</td>
                  <td className="py-3 px-4 text-right font-medium text-slate-900">{money(summary.accountsReceivableAndSimilar)}</td>
                </tr>
              </tbody>
            </table>
            {checkCashPlusAr.diff > 0.02 && (
              <p className="mt-2 text-xs text-amber-700">
                Note: cash + on-account ({money(checkCashPlusAr.sum)}) differs from total revenue by {money(checkCashPlusAr.diff)}{' '}
                (rounding or legacy rows without payment mode).
              </p>
            )}
            <p className="mt-2 text-xs text-slate-500">
              {summary.releaseCount} release (sale) record(s) in range. Returns and other movement types are excluded from this summary.
            </p>
          </DashboardSurface>

          <DashboardSurface className="p-5 sm:p-6">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500 mb-4">Profit path (matches manual worksheet)</h3>
            <table className="w-full text-sm border border-slate-200 rounded-lg overflow-hidden">
              <tbody className="divide-y divide-slate-100">
                <tr className="bg-white">
                  <td className="py-3 px-4 text-slate-700">Sales of goods</td>
                  <td className="py-3 px-4 text-right font-medium">{money(summary.salesOfGoods)}</td>
                </tr>
                <tr className="bg-slate-50/80">
                  <td className="py-3 px-4 text-slate-700">Sale of service and labor</td>
                  <td className="py-3 px-4 text-right font-medium">{money(summary.salesOfServiceAndLabor)}</td>
                </tr>
                <tr className="bg-white">
                  <td className="py-3 px-4 font-medium text-slate-800">Total net of goods &amp; services sold</td>
                  <td className="py-3 px-4 text-right font-semibold">{money(summary.totalNetOfGoodsAndServicesSold)}</td>
                </tr>
                <tr className="bg-rose-50/50">
                  <td className="py-3 px-4 text-slate-700">Less: Cost of goods and services sold</td>
                  <td className="py-3 px-4 text-right font-medium text-rose-900">({money(summary.costOfGoodsAndServices)})</td>
                </tr>
                <tr className="bg-amber-50/50">
                  <td className="py-3 px-4 text-slate-700">Less: Discounts</td>
                  <td className="py-3 px-4 text-right font-medium text-amber-900">({money(summary.totalDiscounts)})</td>
                </tr>
                <tr className="bg-emerald-50">
                  <td className="py-3 px-4 font-semibold text-slate-900">Total gross sales (gross profit)</td>
                  <td className="py-3 px-4 text-right font-bold text-emerald-900">{money(summary.totalGrossSales)}</td>
                </tr>
                <tr className="bg-orange-50/60">
                  <td className="py-3 px-4 text-slate-700">Less: Operating expenses (this period)</td>
                  <td className="py-3 px-4 text-right font-medium text-orange-900">({money(summary.totalOperatingExpenses)})</td>
                </tr>
                <tr className="bg-slate-900 text-white">
                  <td className="py-3 px-4 font-bold">Net income</td>
                  <td className="py-3 px-4 text-right font-bold">{money(summary.netIncome)}</td>
                </tr>
              </tbody>
            </table>
            <p className="mt-3 text-xs text-slate-500 leading-relaxed">
              Formula: (Goods + service revenue) − cost of goods and services sold − discounts = gross profit; then gross profit −
              operating expenses = net income. Cost uses{' '}
              <span className="font-medium text-slate-700">total cost at sale</span> on POS lines or inventory capital price for older
              records.
            </p>
          </DashboardSurface>

          <DashboardSurface className="p-5 sm:p-6">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500 mb-1">SR-1 sales register</h3>
            <p className="text-xs text-slate-500 mb-4">
              Same layout as your <strong>SR-1.pdf</strong> — one row per line item with customer, vehicle, supplier/brand, item
              code, cost, selling price, and discount. Data comes from POS releases in the selected range.
            </p>
            <div className="overflow-x-auto border border-slate-900 rounded-sm">
              {salesRegisterRows.length === 0 ? (
                <p className="p-6 text-sm text-slate-500">No sales in this range.</p>
              ) : (
                <table className="w-full text-[10px] min-w-[1800px] border-collapse">
                  <thead>
                    <tr className="bg-slate-200">
                      <th className="border border-slate-900 px-1.5 py-1.5 text-left font-bold whitespace-nowrap">Date</th>
                      <th className="border border-slate-900 px-1.5 py-1.5 text-left font-bold whitespace-nowrap">Covered</th>
                      <th className="border border-slate-900 px-1.5 py-1.5 text-left font-bold">CR</th>
                      <th className="border border-slate-900 px-1.5 py-1.5 text-left font-bold">BS</th>
                      <th className="border border-slate-900 px-1.5 py-1.5 text-left font-bold">PO</th>
                      <th className="border border-slate-900 px-1.5 py-1.5 text-left font-bold">Invoice</th>
                      <th className="border border-slate-900 px-1.5 py-1.5 text-left font-bold">Type</th>
                      <th className="border border-slate-900 px-1.5 py-1.5 text-left font-bold">Customer</th>
                      <th className="border border-slate-900 px-1.5 py-1.5 text-left font-bold">Address</th>
                      <th className="border border-slate-900 px-1.5 py-1.5 text-left font-bold">Car</th>
                      <th className="border border-slate-900 px-1.5 py-1.5 text-left font-bold">Plate</th>
                      <th className="border border-slate-900 px-1.5 py-1.5 text-left font-bold">Terms</th>
                      <th className="border border-slate-900 px-1.5 py-1.5 text-left font-bold">Supplier</th>
                      <th className="border border-slate-900 px-1.5 py-1.5 text-left font-bold">Code</th>
                      <th className="border border-slate-900 px-1.5 py-1.5 text-left font-bold">Description</th>
                      <th className="border border-slate-900 px-1.5 py-1.5 text-right font-bold">Qty</th>
                      <th className="border border-slate-900 px-1.5 py-1.5 text-left font-bold">UOM</th>
                      <th className="border border-slate-900 px-1.5 py-1.5 text-right font-bold">Cost/u</th>
                      <th className="border border-slate-900 px-1.5 py-1.5 text-right font-bold">Tot cost</th>
                      <th className="border border-slate-900 px-1.5 py-1.5 text-right font-bold">Unit ₱</th>
                      <th className="border border-slate-900 px-1.5 py-1.5 text-right font-bold">Line ₱</th>
                      <th className="border border-slate-900 px-1.5 py-1.5 text-right font-bold">Txn ₱</th>
                      <th className="border border-slate-900 px-1.5 py-1.5 text-right font-bold text-red-800">Disc</th>
                      <th className="border border-slate-900 px-1.5 py-1.5 text-right font-bold text-red-800">%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {salesRegisterRows.map((r, idx) => (
                      <tr key={`${r.transactionId}-${idx}`} className="bg-white hover:bg-slate-50/80">
                        <td className="border border-slate-900 px-1.5 py-1 whitespace-nowrap">{r.saleDate}</td>
                        <td className="border border-slate-900 px-1.5 py-1 whitespace-nowrap text-[9px]">{r.dateCovered}</td>
                        <td className="border border-slate-900 px-1.5 py-1 font-mono">{r.crNo}</td>
                        <td className="border border-slate-900 px-1.5 py-1 font-mono text-[9px]">{r.bsNo}</td>
                        <td className="border border-slate-900 px-1.5 py-1 font-mono text-[9px]">{r.poNo}</td>
                        <td className="border border-slate-900 px-1.5 py-1 text-[9px]">{r.invoiceLabel}</td>
                        <td className="border border-slate-900 px-1.5 py-1">{r.transactionType}</td>
                        <td className="border border-slate-900 px-1.5 py-1 max-w-[120px] truncate" title={r.customerName}>
                          {r.customerName}
                        </td>
                        <td className="border border-slate-900 px-1.5 py-1 max-w-[100px] truncate text-[9px]" title={r.address}>
                          {r.address}
                        </td>
                        <td className="border border-slate-900 px-1.5 py-1 text-[9px] max-w-[90px] truncate" title={r.carModel}>
                          {r.carModel}
                        </td>
                        <td className="border border-slate-900 px-1.5 py-1 font-mono">{r.plateNo}</td>
                        <td className="border border-slate-900 px-1.5 py-1 text-[9px]">{r.terms}</td>
                        <td className="border border-slate-900 px-1.5 py-1 text-[9px]">{r.supplierName}</td>
                        <td className="border border-slate-900 px-1.5 py-1 font-mono text-[9px]">{r.itemCode}</td>
                        <td className="border border-slate-900 px-1.5 py-1 max-w-[140px] truncate" title={r.description}>
                          {r.description}
                        </td>
                        <td className="border border-slate-900 px-1.5 py-1 text-right tabular-nums">{r.qty}</td>
                        <td className="border border-slate-900 px-1.5 py-1 text-[9px]">{r.uom}</td>
                        <td className="border border-slate-900 px-1.5 py-1 text-right tabular-nums">{money(r.costPerUnit)}</td>
                        <td className="border border-slate-900 px-1.5 py-1 text-right tabular-nums">{money(r.totalCost)}</td>
                        <td className="border border-slate-900 px-1.5 py-1 text-right tabular-nums">{money(r.unitPrice)}</td>
                        <td className="border border-slate-900 px-1.5 py-1 text-right tabular-nums">{money(r.totalPrice)}</td>
                        <td className="border border-slate-900 px-1.5 py-1 text-right font-semibold tabular-nums">{money(r.transactionTotal)}</td>
                        <td className="border border-slate-900 px-1.5 py-1 text-right tabular-nums text-red-800">
                          {r.discountPeso > 0 ? money(r.discountPeso) : '—'}
                        </td>
                        <td className="border border-slate-900 px-1.5 py-1 text-right tabular-nums text-red-800">
                          {r.discountPercent > 0 ? `${r.discountPercent.toFixed(2)}%` : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <p className="mt-2 text-xs text-slate-500">
              {salesRegisterRows.length} line(s) · {summary.releaseCount} sale(s). Use <strong>Print SR-1 register</strong> for
              landscape PDF/print output.
            </p>
          </DashboardSurface>

          <DashboardSurface className="p-5 sm:p-6">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500 mb-4">Release detail (each sale)</h3>
            <div className="overflow-x-auto border border-slate-200 rounded-lg">
              {releaseDetails.length === 0 ? (
                <p className="p-6 text-sm text-slate-500">No sales in this range.</p>
              ) : (
                <table className="w-full text-sm text-left min-w-[800px]">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="py-2 px-3 font-semibold text-slate-600 whitespace-nowrap">Date</th>
                      <th className="py-2 px-3 font-semibold text-slate-600">Customer</th>
                      <th className="py-2 px-3 font-semibold text-slate-600">Items</th>
                      <th className="py-2 px-3 font-semibold text-slate-600">Payment</th>
                      <th className="py-2 px-3 font-semibold text-slate-600">Bucket</th>
                      <th className="py-2 px-3 font-semibold text-slate-600 text-right whitespace-nowrap">Gross</th>
                      <th className="py-2 px-3 font-semibold text-slate-600 text-right whitespace-nowrap">Cost at sale</th>
                      <th className="py-2 px-3 font-semibold text-slate-600 text-right whitespace-nowrap">Discount</th>
                      <th className="py-2 px-3 font-semibold text-slate-600 text-right whitespace-nowrap">Line net</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {releaseDetails.map((r) => (
                      <tr key={r.id} className="bg-white hover:bg-slate-50/80">
                        <td className="py-2 px-3 text-slate-700 whitespace-nowrap">{new Date(r.timestamp).toLocaleString()}</td>
                        <td className="py-2 px-3 text-slate-800">{r.recipient}</td>
                        <td className="py-2 px-3 text-slate-600 max-w-[220px]">{r.itemSummary}</td>
                        <td className="py-2 px-3 text-slate-700 whitespace-nowrap">{paymentModeLabel(r.modeOfPayment)}</td>
                        <td className="py-2 px-3 text-slate-600 whitespace-nowrap">
                          {r.paymentBucket === 'cash' ? 'Cash' : 'On account'}
                        </td>
                        <td className="py-2 px-3 text-right font-medium text-slate-900">{money(r.grossSelling)}</td>
                        <td className="py-2 px-3 text-right text-slate-700">{money(r.cogs)}</td>
                        <td className="py-2 px-3 text-right text-slate-700">{money(r.discount)}</td>
                        <td className="py-2 px-3 text-right font-semibold text-slate-900">{money(r.lineNet)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <p className="mt-2 text-xs text-slate-500">
              Line net = gross selling (pre-discount) − cost at sale − discount for that receipt; sums to gross profit before shop-wide
              expense totals (see rounding vs. summary totals).
            </p>
          </DashboardSurface>

          <DashboardSurface className="p-5 sm:p-6">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500 mb-1">Sales deposit report (print preview)</h3>
            <p className="text-xs text-slate-500 mb-4">
              Same columns as the printable Motor World–style sheet: customer name, sale reference (receipt no. or TX-id), materials vs
              services split, cost at sale, gross profit, deposits, and variance. Use <strong>Print deposit report</strong> above for landscape output.
            </p>
            <div className="overflow-x-auto border border-slate-900 rounded-sm">
              {depositReportRows.length === 0 ? (
                <p className="p-6 text-sm text-slate-500">No sales in this range.</p>
              ) : (
                <table className="w-full text-xs min-w-[1100px] border-collapse">
                  <thead>
                    <tr className="bg-slate-200">
                      <th className="border border-slate-900 px-2 py-2 text-left font-bold">Date</th>
                      <th className="border border-slate-900 px-2 py-2 text-left font-bold">Customer</th>
                      <th className="border border-slate-900 px-2 py-2 text-left font-bold">Ref.</th>
                      <th className="border border-slate-900 px-2 py-2 text-right font-bold">Materials</th>
                      <th className="border border-slate-900 px-2 py-2 text-right font-bold">Services</th>
                      <th className="border border-slate-900 px-2 py-2 text-right font-bold text-blue-800">Tax</th>
                      <th className="border border-slate-900 px-2 py-2 text-right font-bold text-red-800">Discount</th>
                      <th className="border border-slate-900 px-2 py-2 text-right font-bold">Total</th>
                      <th className="border border-slate-900 px-2 py-2 text-right font-bold">Cost at sale</th>
                      <th className="border border-slate-900 px-2 py-2 text-right font-bold">Gross profit</th>
                      <th className="border border-slate-900 px-2 py-2 text-left font-bold">Deposited</th>
                      <th className="border border-slate-900 px-2 py-2 text-right font-bold">Cash/card</th>
                      <th className="border border-slate-900 px-2 py-2 text-right font-bold">Check</th>
                      <th className="border border-slate-900 px-2 py-2 text-right font-bold">Var.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {depositReportRows.map((r) => (
                      <tr key={r.id} className="bg-white">
                        <td className="border border-slate-900 px-2 py-1.5 whitespace-nowrap">{r.saleDate}</td>
                        <td className="border border-slate-900 px-2 py-1.5 max-w-[140px] truncate" title={r.customerName}>
                          {r.customerName}
                        </td>
                        <td className="border border-slate-900 px-2 py-1.5 font-mono text-[11px]">{r.saleReference}</td>
                        <td className="border border-slate-900 px-2 py-1.5 text-right tabular-nums">{money(r.materials)}</td>
                        <td className="border border-slate-900 px-2 py-1.5 text-right tabular-nums">{money(r.services)}</td>
                        <td className="border border-slate-900 px-2 py-1.5 text-right tabular-nums text-blue-800">{money(r.taxWithheld)}</td>
                        <td className="border border-slate-900 px-2 py-1.5 text-right tabular-nums text-red-800">
                          {r.discount > 0 ? money(r.discount) : money(0)}
                        </td>
                        <td className="border border-slate-900 px-2 py-1.5 text-right font-semibold tabular-nums">{money(r.totalAmount)}</td>
                        <td className="border border-slate-900 px-2 py-1.5 text-right tabular-nums">{money(r.costAtSale)}</td>
                        <td className="border border-slate-900 px-2 py-1.5 text-right font-semibold tabular-nums">{money(r.lineGrossProfit)}</td>
                        <td className="border border-slate-900 px-2 py-1.5 text-[11px]">{r.dateDepositedLabel}</td>
                        <td className="border border-slate-900 px-2 py-1.5 text-right tabular-nums">{money(r.cashCardDeposited)}</td>
                        <td className="border border-slate-900 px-2 py-1.5 text-right tabular-nums">{money(r.checkDeposited)}</td>
                        <td className="border border-slate-900 px-2 py-1.5 text-right tabular-nums">{money(r.variance)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </DashboardSurface>

          <DashboardSurface className="p-5 sm:p-6">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500 mb-4">Operating expenses (in range)</h3>
            <div className="overflow-x-auto border border-slate-200 rounded-lg">
              {expensesInRange.length === 0 ? (
                <p className="p-6 text-sm text-slate-500">No expenses recorded for these dates.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="py-2 px-3 font-semibold text-slate-600 text-left">Date</th>
                      <th className="py-2 px-3 font-semibold text-slate-600 text-left">Category</th>
                      <th className="py-2 px-3 font-semibold text-slate-600 text-left">Title</th>
                      <th className="py-2 px-3 font-semibold text-slate-600 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {[...expensesInRange]
                      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
                      .map((e) => (
                        <tr key={e.id} className="bg-white">
                          <td className="py-2 px-3 text-slate-700">{String(e.date || '').slice(0, 10)}</td>
                          <td className="py-2 px-3 text-slate-600">{e.category}</td>
                          <td className="py-2 px-3 text-slate-800">{e.title}</td>
                          <td className="py-2 px-3 text-right font-medium">{money(Number(e.amount || 0))}</td>
                        </tr>
                      ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-orange-50/80 font-semibold">
                      <td colSpan={3} className="py-2 px-3 text-right text-slate-800">
                        Total (matches summary)
                      </td>
                      <td className="py-2 px-3 text-right text-orange-900">{money(summary.totalOperatingExpenses)}</td>
                    </tr>
                  </tfoot>
                </table>
              )}
            </div>
          </DashboardSurface>
        </>
      )}

      <Sr1ImportModal
        isOpen={sr1ImportOpen}
        onClose={() => setSr1ImportOpen(false)}
        onImported={() => onDataImported?.()}
      />
    </div>
  );
};
