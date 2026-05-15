import React, { useMemo, useState } from 'react';
import { Button } from './ui/Button';
import { DashboardSectionHeader, DashboardSurface } from './ui/DashboardPrimitives';
import { Plus, Printer, Trash2 } from 'lucide-react';

/** How line total price is derived from qty × unit price (Motor World–style paper uses whole-peso round-up on some lines). */
export type BillingLineTotalRounding = 'half_up_cents' | 'ceil_whole_peso';

export interface BillingLine {
  id: string;
  date: string;
  description: string;
  qty: number;
  uom: string;
  unitPrice: number;
  priceDiscount: number;
  totalRounding: BillingLineTotalRounding;
}

export function roundMoney(n: number): number {
  return Math.round(Number(n || 0) * 100) / 100;
}

/**
 * Total price = qty × unit price, then:
 * - `half_up_cents`: round to 2 decimals (standard).
 * - `ceil_whole_peso`: round to cents first, then round up to next whole peso (e.g. 2,099.88 → 2,100.00).
 */
export function computeLineTotalPrice(qty: number, unitPrice: number, totalRounding: BillingLineTotalRounding): number {
  const q = Number(qty) || 0;
  const u = Number(unitPrice) || 0;
  const raw = q * u;
  const toCents = roundMoney(raw);
  if (totalRounding === 'ceil_whole_peso') {
    return Math.ceil(toCents - 1e-9);
  }
  return toCents;
}

/** Total amount = total price − line discount (both money, 2 dp). */
export function computeLineTotalAmount(totalPrice: number, priceDiscount: number): number {
  return roundMoney(Math.max(0, totalPrice - roundMoney(priceDiscount)));
}

export interface BillingHeaderForm {
  companyName: string;
  companyAddress: string;
  companyPhone: string;
  billTo: string;
  billToAddress: string;
  bsRef: string;
  dateBilled: string;
  terms: string;
  bsNo: string;
  invoiceNo: string;
  dueDate: string;
  modeOfPayment: string;
}

function createId() {
  return crypto.randomUUID().slice(0, 8);
}

const emptyHeader = (): BillingHeaderForm => ({
  companyName: '',
  companyAddress: '',
  companyPhone: '',
  billTo: '',
  billToAddress: '',
  bsRef: '',
  dateBilled: '',
  terms: '',
  bsNo: '',
  invoiceNo: '',
  dueDate: '',
  modeOfPayment: '',
});

function createEmptyLine(dateBilled = ''): BillingLine {
  return {
    id: createId(),
    date: dateBilled.slice(0, 10),
    description: '',
    qty: 1,
    uom: '',
    unitPrice: 0,
    priceDiscount: 0,
    totalRounding: 'half_up_cents',
  };
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function moneyPhp(n: number) {
  return `PHP${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export const BillingStatementView: React.FC = () => {
  const [header, setHeader] = useState<BillingHeaderForm>(() => emptyHeader());
  const [lines, setLines] = useState<BillingLine[]>([]);

  const enriched = useMemo(() => {
    return lines.map((line) => {
      const totalPrice = computeLineTotalPrice(line.qty, line.unitPrice, line.totalRounding);
      const totalAmount = computeLineTotalAmount(totalPrice, line.priceDiscount);
      return { line, totalPrice, totalAmount };
    });
  }, [lines]);

  const grandTotals = useMemo(() => {
    let sumPrice = 0;
    let sumDisc = 0;
    let sumAmount = 0;
    for (const { line, totalPrice, totalAmount } of enriched) {
      sumPrice = roundMoney(sumPrice + totalPrice);
      sumDisc = roundMoney(sumDisc + roundMoney(line.priceDiscount));
      sumAmount = roundMoney(sumAmount + totalAmount);
    }
    return {
      totalPrice: roundMoney(sumPrice),
      priceDiscount: roundMoney(sumDisc),
      totalAmount: roundMoney(sumAmount),
    };
  }, [enriched]);

  const updateLine = (id: string, patch: Partial<BillingLine>) => {
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  };

  const addLine = () => {
    setLines((prev) => [...prev, createEmptyLine(header.dateBilled)]);
  };

  const clearForm = () => {
    setHeader(emptyHeader());
    setLines([]);
  };

  const removeLine = (id: string) => {
    setLines((prev) => prev.filter((l) => l.id !== id));
  };

  const printStatement = () => {
    const win = window.open('', '_blank', 'width=900,height=900');
    if (!win) return;

    const bodyRows = enriched
      .map(
        ({ line, totalPrice, totalAmount }) => `
      <tr>
        <td>${esc(line.date)}</td>
        <td class="desc">${esc(line.description)}</td>
        <td class="num">${line.qty}</td>
        <td>${esc(line.uom)}</td>
        <td class="num">${moneyPhp(line.unitPrice)}</td>
        <td class="num">${moneyPhp(totalPrice)}</td>
        <td class="num">${moneyPhp(line.priceDiscount)}</td>
        <td>${line.totalRounding === 'ceil_whole_peso' ? 'Whole ↑' : '2 dp'}</td>
        <td class="num">${moneyPhp(totalAmount)}</td>
      </tr>`
      )
      .join('');

    win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Billing ${esc(header.bsNo)}</title>
<style>
  body { font-family: 'Segoe UI', Arial, sans-serif; color: #111; padding: 24px 32px; font-size: 11px; max-width: 900px; margin: 0 auto; }
  .top { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #111; padding-bottom: 12px; margin-bottom: 16px; }
  .brand { font-weight: 800; font-size: 14px; letter-spacing: 0.02em; }
  .addr { color: #333; margin-top: 4px; max-width: 320px; line-height: 1.35; }
  .title { text-align: center; font-weight: 700; font-size: 13px; letter-spacing: 0.2em; margin: 14px 0 18px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px 24px; margin-bottom: 16px; }
  .label { font-weight: 700; font-size: 9px; letter-spacing: 0.06em; color: #444; }
  .val { margin-top: 2px; font-size: 11px; }
  .rightbox { border: 1px solid #ccc; padding: 8px 10px; background: #f5f5f5; }
  .rightbox .row { display: flex; justify-content: space-between; gap: 12px; margin: 4px 0; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th, td { border: 1px solid #111; padding: 6px 8px; vertical-align: top; }
  th { background: #f0f0f0; font-size: 9px; text-transform: uppercase; letter-spacing: 0.04em; text-align: left; }
  th.num, td.num { text-align: right; white-space: nowrap; }
  td.desc { max-width: 280px; }
  .mat { font-weight: 700; margin: 12px 0 6px; font-size: 10px; letter-spacing: 0.1em; }
  tfoot td { font-weight: 700; background: #fafafa; }
  @media print { body { padding: 12px; } }
</style></head><body>
  <div class="top">
    <div>
      <div class="brand">${esc(header.companyName)}</div>
      <div class="addr">${esc(header.companyAddress)}<br/>${esc(header.companyPhone)}</div>
    </div>
  </div>
  <div class="title">BILLING STATEMENT</div>
  <div class="grid">
    <div>
      <div class="label">BILL TO</div><div class="val">${esc(header.billTo)}</div>
      <div class="label" style="margin-top:8px">ADDRESS</div><div class="val">${esc(header.billToAddress)}</div>
      <div class="label" style="margin-top:8px">BS REF.</div><div class="val">${esc(header.bsRef)}</div>
      <div class="label" style="margin-top:8px">DATE BILLED</div><div class="val">${esc(header.dateBilled)}</div>
      <div class="label" style="margin-top:8px">TERMS</div><div class="val">${esc(header.terms)}</div>
    </div>
    <div class="rightbox">
      <div class="row"><span class="label">BS NO.</span><span>${esc(header.bsNo)}</span></div>
      <div class="row"><span class="label">AMOUNT DUE</span><span>${moneyPhp(grandTotals.totalAmount)}</span></div>
      <div class="row"><span class="label">INVOICE NO.</span><span>${esc(header.invoiceNo)}</span></div>
      <div class="row"><span class="label">DUE DATE</span><span>${esc(header.dueDate)}</span></div>
      <div class="row"><span class="label">TOTAL AMOUNT</span><span>${moneyPhp(grandTotals.totalAmount)}</span></div>
      <div class="row"><span class="label">MODE OF PAYMENT</span><span>${esc(header.modeOfPayment)}</span></div>
    </div>
  </div>
  <div class="mat">MATERIALS</div>
  <table>
    <thead>
      <tr>
        <th>Date</th><th>Product description</th><th class="num">Qty</th><th>UOM</th>
        <th class="num">Unit price</th><th class="num">Total price</th><th class="num">Price discount</th><th>Line round</th><th class="num">Total amount</th>
      </tr>
    </thead>
    <tbody>${bodyRows}</tbody>
    <tfoot>
      <tr>
        <td colspan="5" style="text-align:right">TOTAL AMOUNT</td>
        <td class="num">${moneyPhp(grandTotals.totalPrice)}</td>
        <td class="num">${moneyPhp(grandTotals.priceDiscount)}</td>
        <td></td>
        <td class="num">${moneyPhp(grandTotals.totalAmount)}</td>
      </tr>
    </tfoot>
  </table>
  <p style="margin-top:14px;font-size:9px;color:#555">Total price = Qty × Unit price (per line rounding). Total amount = Total price − Price discount. Grand total sums total amount.</p>
</body></html>`);
    win.document.close();
    setTimeout(() => {
      win.focus();
      win.print();
    }, 300);
  };

  return (
    <div className="animate-fade-in max-w-5xl space-y-6">
      <DashboardSurface className="p-5 sm:p-6">
        <DashboardSectionHeader
          eyebrow="Documents"
          title="Billing statement"
          description="Enter billing details and material lines manually. Total price = quantity × unit price; total amount = total price minus line discount. Use Print for a clean paper layout."
        />
        <div className="mt-4 flex flex-wrap gap-2">
          <Button type="button" variant="secondary" onClick={printStatement}>
            <Printer className="w-4 h-4 mr-1.5" />
            Print
          </Button>
          <Button type="button" variant="ghost" className="text-indigo-600" onClick={clearForm}>
            Clear form
          </Button>
        </div>
      </DashboardSurface>

      <DashboardSurface className="p-6 sm:p-8 bg-white text-slate-900 border border-slate-200 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-4 border-b-2 border-slate-900 pb-4">
          <div className="min-w-0">
            <input
              className="font-bold text-lg tracking-wide w-full max-w-md border-0 border-b border-dashed border-slate-300 focus:border-indigo-500 focus:ring-0 bg-transparent placeholder:text-slate-400"
              placeholder="Company name"
              value={header.companyName}
              onChange={(e) => setHeader((h) => ({ ...h, companyName: e.target.value }))}
            />
            <textarea
              className="mt-2 w-full max-w-md text-sm text-slate-600 border border-slate-200 rounded-md p-2 focus:ring-2 focus:ring-indigo-500 resize-y min-h-[52px] placeholder:text-slate-400"
              rows={2}
              placeholder="Business address"
              value={header.companyAddress}
              onChange={(e) => setHeader((h) => ({ ...h, companyAddress: e.target.value }))}
            />
            <input
              className="mt-1 w-full max-w-md text-sm text-slate-600 border border-slate-200 rounded-md px-2 py-1.5 placeholder:text-slate-400"
              placeholder="Tel. no. / mobile"
              value={header.companyPhone}
              onChange={(e) => setHeader((h) => ({ ...h, companyPhone: e.target.value }))}
            />
          </div>
        </div>

        <h2 className="text-center text-sm font-bold tracking-[0.2em] text-slate-900 my-5">BILLING STATEMENT</h2>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 text-sm mb-6">
          <div className="space-y-3">
            <Field label="BILL TO" value={header.billTo} placeholder="Customer name" onChange={(v) => setHeader((h) => ({ ...h, billTo: v }))} />
            <Field label="ADDRESS" value={header.billToAddress} placeholder="Customer address" onChange={(v) => setHeader((h) => ({ ...h, billToAddress: v }))} />
            <Field label="BS REF." value={header.bsRef} placeholder="Reference" onChange={(v) => setHeader((h) => ({ ...h, bsRef: v }))} />
            <div className="grid grid-cols-2 gap-2">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Date billed</span>
                <input
                  type="date"
                  className="mt-0.5 w-full border border-slate-200 rounded px-2 py-1.5 text-sm"
                  value={header.dateBilled}
                  onChange={(e) => setHeader((h) => ({ ...h, dateBilled: e.target.value }))}
                />
              </div>
              <Field label="TERMS" value={header.terms} placeholder="e.g. 30 DAYS" onChange={(v) => setHeader((h) => ({ ...h, terms: v }))} />
            </div>
          </div>
          <div className="border border-slate-300 bg-slate-50 p-4 space-y-2 text-sm">
            <SummaryRow label="BS NO." value={header.bsNo} placeholder="Billing statement no." onChange={(v) => setHeader((h) => ({ ...h, bsNo: v }))} />
            <div className="flex justify-between gap-4 py-1 border-b border-slate-200">
              <span className="text-[10px] font-bold uppercase text-slate-600">Amount due</span>
              <span className="font-semibold tabular-nums">{moneyPhp(grandTotals.totalAmount)}</span>
            </div>
            <SummaryRow label="INVOICE NO." value={header.invoiceNo} placeholder="Invoice number" onChange={(v) => setHeader((h) => ({ ...h, invoiceNo: v }))} />
            <div>
              <span className="text-[10px] font-bold uppercase text-slate-600">Due date</span>
              <input
                type="date"
                className="mt-0.5 w-full border border-slate-200 rounded px-2 py-1.5 text-sm bg-white"
                value={header.dueDate}
                onChange={(e) => setHeader((h) => ({ ...h, dueDate: e.target.value }))}
              />
            </div>
            <div className="flex justify-between gap-4 py-1 border-t border-slate-200 pt-2">
              <span className="text-[10px] font-bold uppercase text-slate-600">Total amount</span>
              <span className="font-semibold tabular-nums">{moneyPhp(grandTotals.totalAmount)}</span>
            </div>
            <SummaryRow
              label="MODE OF PAYMENT"
              value={header.modeOfPayment}
              placeholder="e.g. Cash, Account receivable"
              onChange={(v) => setHeader((h) => ({ ...h, modeOfPayment: v }))}
            />
          </div>
        </div>

        <p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-800 mb-2">Materials</p>
        <div className="overflow-x-auto border border-slate-900">
          <table className="w-full text-xs sm:text-sm border-collapse min-w-[880px]">
            <thead>
              <tr className="bg-slate-100">
                <th className="border border-slate-900 px-2 py-2 text-left font-bold uppercase tracking-wide text-[10px] sm:text-xs">
                  Date
                </th>
                <th className="border border-slate-900 px-2 py-2 text-left font-bold uppercase tracking-wide text-[10px] sm:text-xs">
                  Product description
                </th>
                <th className="border border-slate-900 px-2 py-2 text-right font-bold uppercase tracking-wide text-[10px] sm:text-xs w-14">
                  Qty
                </th>
                <th className="border border-slate-900 px-2 py-2 text-left font-bold uppercase tracking-wide text-[10px] sm:text-xs w-24">
                  UOM
                </th>
                <th className="border border-slate-900 px-2 py-2 text-right font-bold uppercase tracking-wide text-[10px] sm:text-xs whitespace-nowrap">
                  Unit price
                </th>
                <th className="border border-slate-900 px-2 py-2 text-right font-bold uppercase tracking-wide text-[10px] sm:text-xs whitespace-nowrap">
                  Total price
                </th>
                <th className="border border-slate-900 px-2 py-2 text-right font-bold uppercase tracking-wide text-[10px] sm:text-xs whitespace-nowrap">
                  Price discount
                </th>
                <th className="border border-slate-900 px-2 py-2 text-left font-bold uppercase tracking-wide text-[10px] sm:text-xs w-[150px]">
                  Line total round
                </th>
                <th className="border border-slate-900 px-2 py-2 text-right font-bold uppercase tracking-wide text-[10px] sm:text-xs whitespace-nowrap">
                  Total amount
                </th>
                <th className="border border-slate-900 px-1 py-2 w-10" />
              </tr>
            </thead>
            <tbody>
              {enriched.length === 0 && (
                <tr>
                  <td colSpan={10} className="border border-slate-900 px-4 py-8 text-center text-slate-500 text-sm">
                    No material lines yet. Click <strong>Add line</strong> to enter items.
                  </td>
                </tr>
              )}
              {enriched.map(({ line, totalPrice, totalAmount }) => (
                <tr key={line.id} className="bg-white hover:bg-slate-50/80">
                  <td className="border border-slate-900 p-0 align-top">
                    <input
                      type="date"
                      className="w-full min-w-[118px] border-0 bg-transparent px-2 py-1.5 text-xs"
                      value={line.date}
                      onChange={(e) => updateLine(line.id, { date: e.target.value })}
                    />
                  </td>
                  <td className="border border-slate-900 p-0 align-top">
                    <input
                      className="w-full min-w-[200px] border-0 bg-transparent px-2 py-1.5 text-xs"
                      value={line.description}
                      onChange={(e) => updateLine(line.id, { description: e.target.value })}
                    />
                  </td>
                  <td className="border border-slate-900 p-0 align-top">
                    <input
                      type="number"
                      min={0}
                      step={1}
                      className="w-full border-0 bg-transparent px-2 py-1.5 text-right text-xs tabular-nums"
                      value={line.qty}
                      onChange={(e) => updateLine(line.id, { qty: Number(e.target.value) || 0 })}
                    />
                  </td>
                  <td className="border border-slate-900 p-0 align-top">
                    <input
                      className="w-full border-0 bg-transparent px-2 py-1.5 text-xs"
                      value={line.uom}
                      onChange={(e) => updateLine(line.id, { uom: e.target.value })}
                    />
                  </td>
                  <td className="border border-slate-900 p-0 align-top">
                    <input
                      type="number"
                      min={0}
                      step={0.01}
                      className="w-full min-w-[90px] border-0 bg-transparent px-2 py-1.5 text-right text-xs tabular-nums"
                      value={line.unitPrice}
                      onChange={(e) => updateLine(line.id, { unitPrice: Number(e.target.value) || 0 })}
                    />
                  </td>
                  <td className="border border-slate-900 px-2 py-1.5 text-right font-medium tabular-nums whitespace-nowrap">
                    {moneyPhp(totalPrice)}
                  </td>
                  <td className="border border-slate-900 p-0 align-top">
                    <input
                      type="number"
                      min={0}
                      step={0.01}
                      className="w-full min-w-[80px] border-0 bg-transparent px-2 py-1.5 text-right text-xs tabular-nums"
                      value={line.priceDiscount}
                      onChange={(e) => updateLine(line.id, { priceDiscount: Number(e.target.value) || 0 })}
                    />
                  </td>
                  <td className="border border-slate-900 p-0 align-top">
                    <select
                      className="w-full border-0 bg-transparent px-1 py-1.5 text-[10px] sm:text-xs"
                      value={line.totalRounding}
                      onChange={(e) =>
                        updateLine(line.id, { totalRounding: e.target.value as BillingLineTotalRounding })
                      }
                    >
                      <option value="half_up_cents">2 dp (half-up)</option>
                      <option value="ceil_whole_peso">Whole peso ↑</option>
                    </select>
                  </td>
                  <td className="border border-slate-900 px-2 py-1.5 text-right font-semibold tabular-nums whitespace-nowrap">
                    {moneyPhp(totalAmount)}
                  </td>
                  <td className="border border-slate-900 p-1 align-top text-center">
                    <button
                      type="button"
                      className="p-1 text-slate-400 hover:text-red-600 rounded"
                      title="Remove line"
                      onClick={() => removeLine(line.id)}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-slate-100 font-bold">
                <td colSpan={5} className="border border-slate-900 px-2 py-2 text-right uppercase text-xs tracking-wide">
                  Total amount
                </td>
                <td className="border border-slate-900 px-2 py-2 text-right tabular-nums">{moneyPhp(grandTotals.totalPrice)}</td>
                <td className="border border-slate-900 px-2 py-2 text-right tabular-nums">{moneyPhp(grandTotals.priceDiscount)}</td>
                <td className="border border-slate-900 bg-slate-200" />
                <td className="border border-slate-900 px-2 py-2 text-right tabular-nums text-base">{moneyPhp(grandTotals.totalAmount)}</td>
                <td className="border border-slate-900" />
              </tr>
            </tfoot>
          </table>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button type="button" variant="secondary" size="sm" onClick={addLine}>
            <Plus className="w-4 h-4 mr-1" />
            Add line
          </Button>
          <span className="text-xs text-slate-500">
            <strong>Line total round:</strong> default is 2 decimals on Qty × Unit price; use <strong>Whole peso ↑</strong> when the paper
            bill rounds a line up (e.g. Caltex 2T).
          </span>
        </div>

        <p className="mt-4 text-xs text-slate-500 leading-relaxed">
          <strong>Formulas:</strong> Total price = Qty × Unit price (with line rounding). Total amount = Total price − Price discount.
          Footer totals sum the <strong>Total price</strong>, <strong>Price discount</strong>, and <strong>Total amount</strong> columns.
        </p>
      </DashboardSurface>
    </div>
  );
};

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</span>
      <input
        className="mt-0.5 w-full border border-slate-200 rounded-md px-2 py-1.5 text-sm focus:ring-2 focus:ring-indigo-500 placeholder:text-slate-400"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

function SummaryRow({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="flex justify-between gap-4 items-center py-0.5">
      <span className="text-[10px] font-bold uppercase text-slate-600 shrink-0">{label}</span>
      <input
        className="flex-1 min-w-0 border border-slate-200 rounded px-2 py-1 text-sm bg-white text-right placeholder:text-slate-400"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
