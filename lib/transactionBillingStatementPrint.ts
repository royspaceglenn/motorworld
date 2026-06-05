import type { Transaction } from '../types';
import type { BillingLetterhead } from './billingLetterhead';
import {
  buildPrePrintedOverlayHtml,
  type PrePrintedOverlayCalibration,
  type PrePrintedOverlayData,
  DEFAULT_OVERLAY_CALIBRATION,
} from './prePrintedReceiptOverlay';

export const BILLING_LINES_PER_PAGE = 9;
/** Default PH VAT rate when showing inclusive breakdown. */
export const BILLING_VAT_RATE = 12;

export function roundMoney(n: number): number {
  return Math.round(Number(n || 0) * 100) / 100;
}

export interface BillingPrintLineRow {
  description: string;
  unitPrice: number;
  amount: number;
}

function escapeHtml(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatPhp(n: number): string {
  const v = roundMoney(n);
  const neg = v < 0;
  const abs = Math.abs(v);
  const parts = abs.toFixed(2).split('.');
  const intPart = parts[0]!.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${neg ? '−' : ''}PHP${intPart}.${parts[1]}`;
}

export interface PosCartLineForBilling {
  name: string;
  itemType: 'Product' | 'Service';
  qty: number;
  unitPrice: number;
  /** Per-unit discount (PHP); total discount for the line = discountPerUnit × qty. */
  discountPerUnit?: number;
}

/** Build table rows from the POS cart (before sale) — same shape as a saved multi-line RELEASE. */
export function billingLineRowsFromPosCart(lines: PosCartLineForBilling[]): BillingPrintLineRow[] {
  const rows: BillingPrintLineRow[] = [];
  for (const l of lines) {
    const descBase = `${l.name} (${l.itemType})`;
    const desc = l.qty !== 1 ? `${descBase} — Qty ${l.qty}` : descBase;
    const gross = roundMoney(l.qty * l.unitPrice);
    rows.push({
      description: desc,
      unitPrice: l.unitPrice,
      amount: gross,
    });
    const dpu = Math.max(0, Number(l.discountPerUnit ?? 0));
    if (dpu > 0.0005) {
      const lineDisc = roundMoney(l.qty * dpu);
      if (lineDisc > 0.005) {
        rows.push({
          description: `Less: discount (${l.qty} × ₱${dpu.toFixed(2)} / unit)`,
          unitPrice: 0,
          amount: -lineDisc,
        });
      }
    }
  }
  return rows;
}

/** Line rows for the billing table: item lines plus optional discount row for multi-line POS sales. */
export function extractBillingLineRows(t: Transaction): BillingPrintLineRow[] {
  const rows: BillingPrintLineRow[] = [];
  if (t.posLineItems && t.posLineItems.length > 0) {
    let hasPerLineDiscount = false;
    for (const li of t.posLineItems) {
      const descBase = `${li.itemName} (${li.itemType})`;
      const desc =
        li.quantity !== 1 ? `${descBase} — Qty ${li.quantity}` : descBase;
      const gross = roundMoney(
        Number(li.lineSubtotal ?? (Number(li.quantity) || 0) * Number(li.unitPrice))
      );
      rows.push({
        description: desc,
        unitPrice: li.unitPrice,
        amount: gross,
      });
      const dpu = Number(li.discountPerUnit ?? (li as { discount_per_unit?: number }).discount_per_unit ?? 0);
      if (dpu > 0.0005) {
        hasPerLineDiscount = true;
        const lineDisc = roundMoney(dpu * (Number(li.quantity) || 0));
        if (lineDisc > 0.005) {
          rows.push({
            description: `Less: discount (${li.quantity} × ₱${dpu.toFixed(2)} / unit)`,
            unitPrice: 0,
            amount: -lineDisc,
          });
        }
      }
    }
    if (!hasPerLineDiscount) {
      const sub =
        t.subtotalBeforeDiscount != null
          ? roundMoney(t.subtotalBeforeDiscount)
          : roundMoney(
              t.posLineItems.reduce(
                (s, li) =>
                  s +
                  roundMoney(
                    Number(li.lineSubtotal ?? (Number(li.quantity) || 0) * Number(li.unitPrice))
                  ),
                0
              )
            );
      let disc = 0;
      if (t.discountAmount != null && t.discountAmount > 0) {
        disc = roundMoney(t.discountAmount);
      } else if (t.discountPercent != null && t.discountPercent > 0) {
        disc = roundMoney(sub * (Math.min(100, Math.max(0, t.discountPercent)) / 100));
      }
      if (disc > 0.005) {
        rows.push({
          description:
            t.discountPercent != null && t.discountPercent > 0
              ? `Less: discount (${t.discountPercent}%)`
              : 'Less: transaction discount',
          unitPrice: 0,
          amount: -disc,
        });
      }
    }
  } else {
    rows.push({
      description: t.itemName || '—',
      unitPrice: t.unitPriceAtTime,
      amount: roundMoney(t.totalValue),
    });
  }
  return rows;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export interface BuildTransactionBillingHtmlOptions {
  showVatBreakdown: boolean;
  /** Inclusive basis; net = total / (1 + rate/100), vat = total − net. */
  vatRatePercent?: number;
  /**
   * When true AND the statement fits on the pre-printed BIR-style invoice
   * form (≤ {@link BILLING_LINES_PER_PAGE} actual item lines), only the
   * variable values are printed, positioned to overlay the pre-printed paper.
   * When the statement does not fit (more than {@link BILLING_LINES_PER_PAGE}
   * lines), the full letterhead billing statement is produced instead.
   */
  prePrintedForm?: boolean;
  /** Millimeter shift for pre-printed overlay alignment (per printer). */
  overlayCalibration?: PrePrintedOverlayCalibration;
  /** Preview overlay with dashed field guides (screen only). */
  overlayPreview?: boolean;
}

function computeVatBreakdown(totalVatInclusive: number, vatRatePercent: number) {
  const rate = Math.max(0, vatRatePercent);
  const divisor = 1 + rate / 100;
  const net = divisor > 0 ? roundMoney(totalVatInclusive / divisor) : roundMoney(totalVatInclusive);
  const vat = roundMoney(totalVatInclusive - net);
  return {
    totalSalesVatInclusive: roundMoney(totalVatInclusive),
    vatAmount: vat,
    netOfVat: net,
  };
}

export interface BillingStatementBodyInput {
  lineRows: BillingPrintLineRow[];
  totalDue: number;
  footerRef: string;
  footerDate: string;
  /** Customer / "Sold To" name — used in pre-printed BIR form fill mode. */
  customerName?: string;
  /** Customer TIN on SOLD TO line (pre-printed overlay). */
  customerTin?: string;
  /** Customer business address on SOLD TO line (pre-printed overlay). */
  customerAddress?: string;
  /** Serial on pre-printed invoice (e.g. 000152). */
  invoiceNumber?: string;
  /** Charge vs cash — marks the correct checkbox on the physical form. */
  isChargeSale?: boolean;
  /** Document date — used in pre-printed BIR form fill mode. Falls back to footerDate. */
  documentDate?: string;
}

/** Treat a row whose amount is negative as a discount / adjustment line. */
function isAdjustmentRow(row: BillingPrintLineRow): boolean {
  return Number(row.amount) < 0;
}

export function buildBillingStatementHtml(
  body: BillingStatementBodyInput,
  letterhead: BillingLetterhead,
  options: BuildTransactionBillingHtmlOptions
): string {
  // Pre-printed-form fill mode: produce a near-blank A4 with only variable
  // values positioned to overlay the customer's pre-printed BIR invoice form.
  // Only applicable when the actual item lines fit on the form (≤ 9 rows).
  if (options.prePrintedForm) {
    const itemRows = body.lineRows.filter((r) => !isAdjustmentRow(r));
    if (itemRows.length <= BILLING_LINES_PER_PAGE) {
      return buildPrePrintedFormFillHtml(body, options);
    }
  }
  const lines = body.lineRows;
  const pages = chunk(lines, BILLING_LINES_PER_PAGE);
  const totalPages = Math.max(1, pages.length);
  const totalDue = roundMoney(body.totalDue);
  const vatRate = options.vatRatePercent ?? BILLING_VAT_RATE;
  const vatBlock = options.showVatBreakdown
    ? computeVatBreakdown(totalDue, vatRate)
    : null;

  const name = escapeHtml(letterhead.registeredName.trim()) || '—';
  const tinRaw = letterhead.tin.trim();
  const tin = tinRaw ? escapeHtml(tinRaw) : '';
  const addr = escapeHtml(letterhead.businessAddress.trim()) || '—';

  const letterheadBlock = `
    <div class="letterhead">
      <div class="reg-name">${name}</div>
      ${tin ? `<div class="tin">TIN: ${tin}</div>` : ''}
      <div class="addr">${addr.replace(/\n/g, '<br/>')}</div>
    </div>
    <div class="doc-title">BILLING STATEMENT</div>
  `;

  const footerRefEsc = escapeHtml(body.footerRef);
  const footerDateEsc = escapeHtml(body.footerDate);

  const pageSheets: string[] = pages.map((pageLines, pageIndex) => {
    const isLast = pageIndex === pages.length - 1;
    const padded: (BillingPrintLineRow | null)[] = [...pageLines];
    while (padded.length < BILLING_LINES_PER_PAGE) padded.push(null);

    const bodyRows = padded
      .map((row) => {
        if (!row) {
          return `<tr><td class="c-desc">&nbsp;</td><td class="c-price">&nbsp;</td><td class="c-amt">&nbsp;</td></tr>`;
        }
        return `<tr>
          <td class="c-desc">${escapeHtml(row.description)}</td>
          <td class="c-price">${formatPhp(row.unitPrice)}</td>
          <td class="c-amt">${formatPhp(row.amount)}</td>
        </tr>`;
      })
      .join('');

    const summaryHtml =
      isLast && vatBlock
        ? `
      <table class="vat-table" aria-label="VAT summary">
        <tr><td>Total Sales (VAT inclusive)</td><td class="num">${formatPhp(vatBlock.totalSalesVatInclusive)}</td></tr>
        <tr><td>Less: VAT (${vatRate}%)</td><td class="num">${formatPhp(vatBlock.vatAmount)}</td></tr>
        <tr><td><strong>Amount: Net of VAT</strong></td><td class="num"><strong>${formatPhp(vatBlock.netOfVat)}</strong></td></tr>
      </table>`
        : '';

    const totalRow =
      isLast
        ? `
      <div class="total-due-wrap">
        <span class="total-due-label">Total Amount Due</span>
        <span class="total-due-val">${formatPhp(totalDue)}</span>
      </div>
      ${summaryHtml}
      <div class="footer-note">Ref. ${footerRefEsc} · ${footerDateEsc}</div>
      `
        : `<div class="continued">Continued on next page…</div>`;

    return `
    <section class="sheet">
      ${letterheadBlock}
      <div class="page-meta">Page ${pageIndex + 1} of ${totalPages}</div>
      <table class="grid" aria-label="Line items">
        <thead>
          <tr>
            <th class="c-desc">Item / nature of service</th>
            <th class="c-price">Unit price</th>
            <th class="c-amt">Amount</th>
          </tr>
        </thead>
        <tbody>
          ${bodyRows}
        </tbody>
      </table>
      ${totalRow}
    </section>`;
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <title>Billing Statement</title>
  <style>
    @page { size: A4 portrait; margin: 12mm; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Arial, Helvetica, sans-serif;
      font-size: 11px;
      color: #111;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .sheet {
      page-break-after: always;
      min-height: 0;
      padding-bottom: 8mm;
    }
    .sheet:last-of-type { page-break-after: auto; }
    .letterhead { margin-bottom: 10px; }
    .reg-name { font-weight: 700; font-size: 13px; text-transform: uppercase; letter-spacing: 0.02em; }
    .tin { margin-top: 2px; font-size: 10px; }
    .addr { margin-top: 4px; font-size: 10px; line-height: 1.35; max-width: 100%; }
    .doc-title {
      text-align: center;
      font-weight: 700;
      font-size: 14px;
      margin: 12px 0 10px;
      letter-spacing: 0.04em;
    }
    .page-meta { text-align: right; font-size: 9px; color: #555; margin-bottom: 6px; }
    table.grid {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 12px;
    }
    table.grid th, table.grid td {
      border: 1px solid #000;
      padding: 6px 8px;
      vertical-align: top;
    }
    table.grid th {
      font-weight: 700;
      text-align: left;
      background: #f3f3f3;
    }
    th.c-price, td.c-price, th.c-amt, td.c-amt { text-align: right; width: 22%; }
    td.c-desc { text-align: left; }
    .continued { font-style: italic; color: #444; margin-top: 8px; }
    .total-due-wrap {
      display: flex;
      justify-content: flex-end;
      align-items: center;
      gap: 12px;
      margin-top: 10px;
      padding: 8px 10px;
      background: #e8e8e8;
      border: 1px solid #000;
    }
    .total-due-label { font-weight: 700; font-size: 12px; }
    .total-due-val { font-weight: 700; font-size: 13px; }
    table.vat-table {
      width: 100%;
      max-width: 360px;
      margin-left: auto;
      margin-top: 10px;
      border-collapse: collapse;
      font-size: 10px;
    }
    table.vat-table td {
      border: 1px solid #ccc;
      padding: 5px 8px;
    }
    table.vat-table td.num { text-align: right; width: 38%; }
    .footer-note { margin-top: 14px; font-size: 9px; color: #666; }
  </style>
</head>
<body>
  ${pageSheets.join('\n')}
</body>
</html>`;
}

/**
 * Pre-printed BIR-form fill mode.
 *
 * Produces a near-blank A4 portrait page with only the variable values
 * absolute-positioned to overlay the customer's pre-printed invoice form.
 * Positions are calibrated to a standard Philippine BIR sales-invoice form
 * (Motor World style) — you may need to tweak the offsets below by ±1-2 mm
 * to match your specific printer / paper combination.
 */
/** Format a number as plain "1,234.56" — no currency prefix (the form pre-prints the unit). */
function formatNumberOnly(n: number): string {
  const v = roundMoney(n);
  const neg = v < 0;
  const abs = Math.abs(v);
  const parts = abs.toFixed(2).split('.');
  const intPart = parts[0]!.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${neg ? '−' : ''}${intPart}.${parts[1]}`;
}

function escapeOverlayText(s: string): string {
  return escapeHtml(s);
}

export function buildPrePrintedFormFillHtml(
  body: BillingStatementBodyInput,
  options: BuildTransactionBillingHtmlOptions
): string {
  const itemRows = body.lineRows.filter((r) => !isAdjustmentRow(r));
  const discountRows = body.lineRows.filter(isAdjustmentRow);
  const discountAmount = roundMoney(
    discountRows.reduce((s, r) => s + Math.abs(Number(r.amount) || 0), 0)
  );
  const subtotalBeforeDiscount = roundMoney(
    itemRows.reduce((s, r) => s + Number(r.amount || 0), 0)
  );
  const totalDue = roundMoney(body.totalDue);

  const vatRate = options.vatRatePercent ?? BILLING_VAT_RATE;
  const vat = options.showVatBreakdown ? computeVatBreakdown(totalDue, vatRate) : null;

  const dateValue =
    body.documentDate?.trim() ||
    body.footerDate?.trim() ||
    new Date().toLocaleDateString();

  const overlayLines = itemRows.slice(0, BILLING_LINES_PER_PAGE).map((row) => {
    const qtyMatch = String(row.description).match(/—\s*Qty\s+(\d+(?:\.\d+)?)$/i);
    const qty = qtyMatch ? qtyMatch[1]! : '1';
    const desc = row.description.replace(/\s*—\s*Qty\s+\d+(?:\.\d+)?$/i, '');
    return {
      description: escapeOverlayText(desc),
      qty: escapeOverlayText(qty),
      unitPrice: row.unitPrice ? formatNumberOnly(row.unitPrice) : '',
      amount: formatNumberOnly(row.amount),
    };
  });

  const overlayData: PrePrintedOverlayData = {
    invoiceNumber: body.invoiceNumber ? escapeOverlayText(body.invoiceNumber) : undefined,
    date: escapeOverlayText(dateValue),
    isChargeSale: body.isChargeSale ?? false,
    soldToName: escapeOverlayText((body.customerName || '').trim()),
    soldToTin: body.customerTin ? escapeOverlayText(body.customerTin) : undefined,
    soldToAddress: body.customerAddress ? escapeOverlayText(body.customerAddress) : undefined,
    lines: overlayLines,
    totalSalesVatInclusive: formatNumberOnly(vat ? vat.totalSalesVatInclusive : subtotalBeforeDiscount || totalDue),
    lessVat: vat ? formatNumberOnly(vat.vatAmount) : undefined,
    netOfVat: vat ? formatNumberOnly(vat.netOfVat) : undefined,
    lessDiscount: discountAmount > 0 ? formatNumberOnly(discountAmount) : undefined,
    totalAmountDue: formatNumberOnly(totalDue),
    vatableSales: vat ? formatNumberOnly(vat.netOfVat) : undefined,
    vatAmount: vat ? formatNumberOnly(vat.vatAmount) : undefined,
    zeroRatedSales: vat ? formatNumberOnly(0) : undefined,
    vatExemptSales: vat ? formatNumberOnly(0) : undefined,
  };

  const cal = options.overlayCalibration ?? DEFAULT_OVERLAY_CALIBRATION;
  return buildPrePrintedOverlayHtml(overlayData, cal, { preview: options.overlayPreview });
}

function transactionIsChargeSale(t: Transaction): boolean {
  const m = String(t.modeOfPayment || 'Cash').trim();
  return m !== 'Cash';
}

export function buildTransactionBillingStatementHtml(
  t: Transaction,
  letterhead: BillingLetterhead,
  options: BuildTransactionBillingHtmlOptions,
  extra?: Pick<
    BillingStatementBodyInput,
    'invoiceNumber' | 'customerTin' | 'customerAddress'
  >
): string {
  return buildBillingStatementHtml(
    {
      lineRows: extractBillingLineRows(t),
      totalDue: roundMoney(t.totalValue),
      footerRef: `Transaction ${t.id.slice(0, 12)}`,
      footerDate: new Date(t.timestamp).toLocaleString(),
      customerName: t.recipient || undefined,
      customerTin: extra?.customerTin,
      customerAddress: extra?.customerAddress,
      invoiceNumber: extra?.invoiceNumber,
      isChargeSale: transactionIsChargeSale(t),
      documentDate: new Date(t.timestamp).toLocaleDateString(),
    },
    letterhead,
    options
  );
}

/**
 * Print billing HTML using a hidden iframe (avoids Electron `about:blank` issues on Windows).
 */
export function printBillingStatementHtml(html: string): void {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.cssText =
    'position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;pointer-events:none;';
  iframe.srcdoc = html;
  document.body.appendChild(iframe);

  const cleanup = () => {
    iframe.remove();
  };

  let printed = false;
  const runPrint = () => {
    if (printed) return;
    printed = true;
    const w = iframe.contentWindow;
    if (!w) {
      cleanup();
      return;
    }
    w.focus();
    setTimeout(() => {
      try {
        w.print();
      } finally {
        setTimeout(cleanup, 400);
      }
    }, 150);
  };

  iframe.onload = runPrint;
  if (iframe.contentDocument?.readyState === 'complete') {
    runPrint();
  }
}
