import type { Transaction } from '../types';
import { getReceiptBranding } from '../lib/receiptBranding';
import { getStoredActiveShopId } from '../lib/api/client';

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function paymentLabel(tx: Transaction): string {
  const m = (tx.modeOfPayment || 'Cash').trim();
  if (m === 'Credit') return 'Accounts Receivable';
  if (m === 'Purchase Order') return 'Purchase Order';
  if (m === 'Cheque') return 'Cheque (receivable)';
  return m;
}

export function buildReceiptHtml(transaction: Transaction): string {
  function round2(n: number) {
    return Math.round(n * 100) / 100;
  }
  const branding = getReceiptBranding(transaction.shopId);
  const idShort = (transaction.id || '').slice(0, 8);
  const payment = paymentLabel(transaction);
  const extraRows: string[] = [];
  if (transaction.modeOfPayment === 'Purchase Order') {
    if (transaction.invoiceNumber)
      extraRows.push(
        `<div class="row"><span>Invoice #</span><span>${esc(String(transaction.invoiceNumber))}</span></div>`
      );
    if (transaction.dueDate)
      extraRows.push(
        `<div class="row"><span>Due date</span><span>${esc(String(transaction.dueDate))}</span></div>`
      );
    if (transaction.terms)
      extraRows.push(
        `<div class="row" style="align-items:flex-start"><span>Terms</span><span style="text-align:right;max-width:65%">${esc(String(transaction.terms))}</span></div>`
      );
  }
  if (transaction.modeOfPayment === 'Cheque') {
    if (transaction.chequeExpectedClearDate) {
      extraRows.push(
        `<div class="row"><span>Expected clearance</span><span>${esc(String(transaction.chequeExpectedClearDate).slice(0, 10))}</span></div>`
      );
    }
    if (transaction.chequeReference) {
      extraRows.push(`<div class="row"><span>Cheque ref.</span><span>${esc(String(transaction.chequeReference))}</span></div>`);
    }
    if (transaction.chequeStatus) {
      extraRows.push(`<div class="row"><span>Cheque status</span><span>${esc(String(transaction.chequeStatus))}</span></div>`);
    }
  }

  const posLines = transaction.posLineItems && transaction.posLineItems.length > 0 ? transaction.posLineItems : null;

  const hasPerLineDiscount =
    !!posLines && posLines.some((line) => Number(line.discountPerUnit ?? 0) > 0.0005);

  const lineRowsHtml = posLines
    ? posLines
        .map((line) => {
          const namePart = `${esc(line.itemName)} (${esc(line.itemType)})`;
          const gross = Number(line.lineSubtotal ?? line.quantity * line.unitPrice);
          const dpu = Number(line.discountPerUnit ?? 0);
          const lineDisc = dpu > 0.0005 ? round2(dpu * line.quantity) : 0;
          const netLine = round2(gross - lineDisc);
          const mainRow = `<div class="row" style="flex-wrap:wrap"><span style="max-width:58%">${namePart}</span><span style="text-align:right">${line.quantity} × ₱${Number(line.unitPrice).toFixed(2)} = ₱${gross.toFixed(2)}</span></div>`;
          if (dpu > 0.0005 && lineDisc > 0.005) {
            return `${mainRow}<div class="row" style="padding-left:10px;font-size:12px;color:#555"><span>Less: discount (${line.quantity} × ₱${dpu.toFixed(2)}/unit)</span><span>−₱${lineDisc.toFixed(2)}</span></div><div class="row" style="padding-left:10px;font-size:12px"><span>Line net</span><span>₱${netLine.toFixed(2)}</span></div>`;
          }
          return mainRow;
        })
        .join('')
    : `<div class="row"><span>${esc(transaction.itemName || 'Item')}</span><span>× ${Math.abs(transaction.quantityChange || 0)}</span></div>
  <div class="row"><span>Unit price</span><span>₱${(transaction.unitPriceAtTime ?? 0).toFixed(2)}</span></div>`;

  const discountRows: string[] = [];
  const hasGlobalDiscount =
    !hasPerLineDiscount &&
    ((transaction.discountAmount != null && Number(transaction.discountAmount) > 0) ||
      (transaction.discountPercent != null && Number(transaction.discountPercent) > 0));
  if (transaction.subtotalBeforeDiscount != null && Number(transaction.subtotalBeforeDiscount) > 0 && hasGlobalDiscount) {
    discountRows.push(
      `<div class="row"><span>Subtotal</span><span>₱${Number(transaction.subtotalBeforeDiscount).toFixed(2)}</span></div>`
    );
  }
  if (!hasPerLineDiscount && transaction.discountPercent != null && Number(transaction.discountPercent) > 0) {
    discountRows.push(
      `<div class="row"><span>Discount</span><span>${Number(transaction.discountPercent).toFixed(2)}%</span></div>`
    );
  }
  if (!hasPerLineDiscount && transaction.discountAmount != null && Number(transaction.discountAmount) > 0) {
    discountRows.push(
      `<div class="row"><span>Discount (amount)</span><span>₱${Number(transaction.discountAmount).toFixed(2)}</span></div>`
    );
  }
  if (hasPerLineDiscount && transaction.subtotalBeforeDiscount != null && Number(transaction.subtotalBeforeDiscount) > 0) {
    const sumDisc =
      posLines?.reduce((s, line) => {
        const dpu = Number(line.discountPerUnit ?? 0);
        return s + (dpu > 0 ? round2(dpu * line.quantity) : 0);
      }, 0) ?? 0;
    if (sumDisc > 0.005) {
      discountRows.push(
        `<div class="row"><span>Subtotal (before discounts)</span><span>₱${Number(transaction.subtotalBeforeDiscount).toFixed(2)}</span></div>`
      );
      discountRows.push(`<div class="row"><span>Total line discounts</span><span>−₱${sumDisc.toFixed(2)}</span></div>`);
    }
  }

  const cogsRow =
    transaction.totalCostAtTime != null && Number.isFinite(Number(transaction.totalCostAtTime))
      ? `<div class="row"><span>COGS</span><span>₱${Number(transaction.totalCostAtTime).toFixed(2)}</span></div>`
      : '';
  const netRow =
    transaction.netIncome != null && Number.isFinite(Number(transaction.netIncome))
      ? `<div class="row"><span>Gross profit (this sale)</span><span>₱${Number(transaction.netIncome).toFixed(2)}</span></div>`
      : '';

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Receipt #${idShort}</title>
  <style>
    body { font-family: 'Helvetica', Arial, sans-serif; padding: 24px; max-width: 360px; margin: 0 auto; color: #111; font-size: 14px; }
    .brand { text-align: center; font-size: 18px; font-weight: bold; margin-bottom: 4px; color: ${branding.accentColor}; }
    .sub { text-align: center; font-size: 11px; color: #666; margin-bottom: 8px; }
    .store-tag { text-align: center; font-size: 10px; font-weight: 700; letter-spacing: 0.12em; color: ${branding.accentColor}; margin-bottom: 12px; }
    .line { border-top: 1px dashed #ccc; margin: 12px 0; }
    .row { display: flex; justify-content: space-between; margin: 6px 0; gap: 8px; }
    .total { font-size: 16px; font-weight: bold; margin-top: 12px; }
    .thanks { text-align: center; margin-top: 24px; font-size: 12px; color: #666; }
    @media print { body { padding: 12px; } }
  </style>
</head>
<body>
  <div class="brand">${esc(branding.businessName)}</div>
  <div class="sub">${esc(branding.receiptSubtitle)}</div>
  <div class="store-tag">${esc(branding.storeCode)}</div>
  <div class="line"></div>
  <div class="row"><span>Date</span><span>${esc(new Date(transaction.timestamp).toLocaleString())}</span></div>
  <div class="row"><span>Receipt #</span><span>#${esc(idShort)}</span></div>
  <div class="row"><span>Customer</span><span>${esc(transaction.recipient || '—')}</span></div>
  <div class="row"><span>Payment</span><span>${esc(payment)}</span></div>
  ${extraRows.join('')}
  <div class="line"></div>
  ${lineRowsHtml}
  <div class="line"></div>
  ${discountRows.join('')}
  ${cogsRow}
  ${netRow}
  <div class="row total"><span>Total</span><span>₱${(transaction.totalValue ?? 0).toFixed(2)}</span></div>
  <div class="thanks">Thank you for your purchase!</div>
</body>
</html>`;
}

/**
 * Prints a POS sale receipt without window.open(), so Electron’s window-open handler
 * does not send about:/blank URLs to the OS (which triggers "Get an app to open this about link" on Windows).
 */
export function printReceipt(transaction: Transaction): void {
  printHtmlInHiddenIframe(buildReceiptHtml(transaction));
}

export interface PaymentReceiptInput {
  /** ISO timestamp for when the payment was received. */
  paidAt: string;
  /** Money received in this payment. */
  amountPaid: number;
  /** cash / cheque / card or freeform. */
  method: string;
  reference?: string | null;
  note?: string | null;
  customerName: string;
  /** UUID of the underlying sale transaction this payment is against. */
  originalTransactionId: string;
  /** Grand total of the original sale (the receivable's face value). */
  originalTransactionTotal: number;
  /** Optional summary of what was bought, for context on the receipt. */
  originalItemSummary?: string;
  /** Cumulative paid INCLUDING this payment. */
  totalPaidIncludingThis: number;
  /** Remaining balance AFTER this payment. */
  remainingBalance: number;
  /** Optional short id for the payment, falls back to a generated short id. */
  paymentId?: string;
  /** Optional; falls back to active session store. */
  shopId?: string | null;
}

export function buildPaymentReceiptHtml(input: PaymentReceiptInput): string {
  const idShort = (input.paymentId || input.originalTransactionId || '')
    .replace(/-/g, '')
    .slice(0, 8)
    .toUpperCase();
  const txShort = (input.originalTransactionId || '').slice(0, 8);
  const isFullySettled = (input.remainingBalance ?? 0) <= 0.005;
  const statusLabel = isFullySettled ? 'FULLY PAID' : 'PARTIAL PAYMENT';
  const statusColor = isFullySettled ? '#15803d' : '#b45309';
  const methodLabel = (() => {
    const m = (input.method || '').toLowerCase();
    if (m === 'cash') return 'Cash';
    if (m === 'cheque') return 'Cheque';
    if (m === 'card') return 'Card terminal';
    return input.method || '—';
  })();
  const referenceRow = input.reference
    ? `<div class="row"><span>Reference</span><span>${esc(String(input.reference))}</span></div>`
    : '';
  const noteRow = input.note
    ? `<div class="row" style="align-items:flex-start"><span>Note</span><span style="text-align:right;max-width:65%">${esc(String(input.note))}</span></div>`
    : '';
  const itemRow = input.originalItemSummary
    ? `<div class="row" style="align-items:flex-start"><span>For</span><span style="text-align:right;max-width:65%">${esc(input.originalItemSummary)}</span></div>`
    : '';

  const branding = getReceiptBranding(input.shopId ?? getStoredActiveShopId());

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Official Receipt #${esc(idShort)}</title>
  <style>
    body { font-family: 'Helvetica', Arial, sans-serif; padding: 24px; max-width: 360px; margin: 0 auto; color: #111; font-size: 14px; }
    .brand { text-align: center; font-size: 18px; font-weight: bold; margin-bottom: 4px; color: ${branding.accentColor}; }
    .sub { text-align: center; font-size: 11px; color: #666; margin-bottom: 6px; }
    .store-tag { text-align: center; font-size: 10px; font-weight: 700; letter-spacing: 0.12em; color: ${branding.accentColor}; margin-bottom: 10px; }
    .status { text-align: center; font-size: 11px; font-weight: 700; letter-spacing: 0.06em; margin-bottom: 16px; color: ${statusColor}; }
    .line { border-top: 1px dashed #ccc; margin: 12px 0; }
    .row { display: flex; justify-content: space-between; margin: 6px 0; gap: 8px; }
    .amount { font-size: 18px; font-weight: bold; margin-top: 10px; }
    .totals { font-size: 12px; color: #444; }
    .totals .row { margin: 4px 0; }
    .thanks { text-align: center; margin-top: 24px; font-size: 12px; color: #666; }
    @media print { body { padding: 12px; } }
  </style>
</head>
<body>
  <div class="brand">${esc(branding.businessName)}</div>
  <div class="sub">Official Receipt — Payment Received</div>
  <div class="store-tag">${esc(branding.storeCode)}</div>
  <div class="status">${statusLabel}</div>
  <div class="row"><span>Date</span><span>${esc(new Date(input.paidAt).toLocaleString())}</span></div>
  <div class="row"><span>OR #</span><span>#${esc(idShort)}</span></div>
  <div class="row"><span>Ref. sale</span><span>#${esc(txShort)}</span></div>
  <div class="row"><span>Received from</span><span>${esc(input.customerName || '—')}</span></div>
  <div class="row"><span>Method</span><span>${esc(methodLabel)}</span></div>
  ${referenceRow}
  ${itemRow}
  ${noteRow}
  <div class="line"></div>
  <div class="row amount"><span>Amount received</span><span>₱${Number(input.amountPaid).toFixed(2)}</span></div>
  <div class="line"></div>
  <div class="totals">
    <div class="row"><span>Total billed</span><span>₱${Number(input.originalTransactionTotal).toFixed(2)}</span></div>
    <div class="row"><span>Total paid to date</span><span>₱${Number(input.totalPaidIncludingThis).toFixed(2)}</span></div>
    <div class="row"><span>Remaining balance</span><span>₱${Math.max(0, Number(input.remainingBalance)).toFixed(2)}</span></div>
  </div>
  <div class="thanks">${isFullySettled ? 'Thank you — account fully settled.' : 'Thank you for your payment.'}</div>
</body>
</html>`;
}

/** Print an Official Receipt for a payment received (works for full OR partial payments). */
export function printPaymentReceipt(input: PaymentReceiptInput): void {
  printHtmlInHiddenIframe(buildPaymentReceiptHtml(input));
}

function printHtmlInHiddenIframe(html: string): void {
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
