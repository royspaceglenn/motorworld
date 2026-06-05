/**
 * Motor World BIR pre-printed invoice overlay — positions dynamic values on blank A4
 * so they align with the physical form when fed through a standard printer.
 *
 * Tweak DEFAULT_FIELD_MAP or use saved calibration offsets (mm) per printer/paper.
 */

export interface PrePrintedOverlayCalibration {
  /** Shift entire overlay right (+) or left (−), in millimeters. */
  offsetX: number;
  /** Shift entire overlay down (+) or up (−), in millimeters. */
  offsetY: number;
}

export const DEFAULT_OVERLAY_CALIBRATION: PrePrintedOverlayCalibration = {
  offsetX: 0,
  offsetY: 0,
};

const CALIBRATION_STORAGE_KEY = 'mw_preprinted_overlay_calibration';

export function loadOverlayCalibration(): PrePrintedOverlayCalibration {
  try {
    const raw = localStorage.getItem(CALIBRATION_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_OVERLAY_CALIBRATION };
    const parsed = JSON.parse(raw) as Partial<PrePrintedOverlayCalibration>;
    return {
      offsetX: Number(parsed.offsetX) || 0,
      offsetY: Number(parsed.offsetY) || 0,
    };
  } catch {
    return { ...DEFAULT_OVERLAY_CALIBRATION };
  }
}

export function saveOverlayCalibration(cal: PrePrintedOverlayCalibration): void {
  try {
    localStorage.setItem(
      CALIBRATION_STORAGE_KEY,
      JSON.stringify({
        offsetX: Number(cal.offsetX) || 0,
        offsetY: Number(cal.offsetY) || 0,
      })
    );
  } catch {
    /* ignore */
  }
}

/** Absolute positions (mm from top-left of A4) for the Motor World LGMC-style invoice. */
export const MOTOR_WORLD_OVERLAY_FIELDS = {
  invoiceNumber: { left: 158, top: 31, width: 38 },
  date: { left: 168, top: 39, width: 36 },
  cashSalesMark: { left: 48, top: 52, width: 6 },
  chargeSalesMark: { left: 78, top: 52, width: 6 },
  soldToName: { left: 52, top: 63, width: 130 },
  soldToTin: { left: 52, top: 71, width: 90 },
  soldToAddress: { left: 52, top: 79, width: 130 },
  table: {
    topFirstRow: 95,
    rowAdvance: 8.5,
    maxRows: 9,
    cols: {
      desc: { left: 14, width: 72 },
      qty: { left: 88, width: 16 },
      unitPrice: { left: 106, width: 28 },
      amount: { left: 156, width: 36 },
    },
  },
  totals: {
    valueRight: 196,
    valueWidth: 42,
    totalSalesVatInclusive: 178,
    lessVat: 186,
    netOfVat: 194,
    lessDiscount: 202,
    addVat: 210,
    lessWithholdingTax: 218,
    totalAmountDue: 230,
  },
  vatSummary: {
    left: 14,
    width: 42,
    vatableSales: 248,
    vat: 256,
    zeroRated: 264,
    vatExempt: 272,
  },
} as const;

export interface OverlayLineRow {
  description: string;
  qty: string;
  unitPrice: string;
  amount: string;
}

export interface PrePrintedOverlayData {
  invoiceNumber?: string;
  date: string;
  isChargeSale: boolean;
  soldToName: string;
  soldToTin?: string;
  soldToAddress?: string;
  lines: OverlayLineRow[];
  totalSalesVatInclusive: string;
  lessVat?: string;
  netOfVat?: string;
  lessDiscount?: string;
  addVat?: string;
  lessWithholdingTax?: string;
  totalAmountDue: string;
  vatableSales?: string;
  vatAmount?: string;
  zeroRatedSales?: string;
  vatExemptSales?: string;
}

export function buildOverlayPrintCss(cal: PrePrintedOverlayCalibration, preview = false): string {
  const ox = cal.offsetX;
  const oy = cal.offsetY;
  return `
    @page { size: A4 portrait; margin: 0; }
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      padding: 0;
      width: 210mm;
      height: 297mm;
      background: ${preview ? '#f8fafc' : '#fff'};
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    @media print {
      html, body { background: #fff !important; }
      .no-print, .overlay-calibration-hint { display: none !important; }
    }
    .receipt-print-wrapper {
      --print-offset-x: ${ox}mm;
      --print-offset-y: ${oy}mm;
      position: relative;
      width: 210mm;
      height: 297mm;
      overflow: hidden;
      page-break-after: avoid;
    }
    .receipt-print-layer {
      position: absolute;
      left: var(--print-offset-x);
      top: var(--print-offset-y);
      width: 210mm;
      height: 297mm;
    }
    .fld {
      position: absolute;
      font-family: Arial, Helvetica, sans-serif;
      font-size: 10.5pt;
      line-height: 1;
      color: #000;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
      overflow: hidden;
      background: transparent;
      border: none;
      padding: 0;
      margin: 0;
    }
    .fld.right { text-align: right; }
    .fld.center { text-align: center; }
    .fld.bold { font-weight: 700; font-size: 11pt; }
    .fld.mark { font-size: 12pt; font-weight: 700; }
    ${preview ? '.fld { outline: 1px dashed rgba(99,102,241,0.25); }' : ''}
  `;
}

function fieldDiv(
  left: number,
  top: number,
  width: number,
  align: 'left' | 'right' | 'center',
  content: string,
  extraClass = ''
): string {
  const cls = `fld ${align === 'right' ? 'right ' : align === 'center' ? 'center ' : ''}${extraClass}`.trim();
  return `<div class="${cls}" style="left:${left}mm;top:${top}mm;width:${width}mm;">${content}</div>`;
}

export function buildPrePrintedOverlayHtml(
  data: PrePrintedOverlayData,
  cal: PrePrintedOverlayCalibration = DEFAULT_OVERLAY_CALIBRATION,
  options?: { preview?: boolean }
): string {
  const F = MOTOR_WORLD_OVERLAY_FIELDS;
  const preview = options?.preview ?? false;

  const lineHtml = data.lines
    .slice(0, F.table.maxRows)
    .map((row, i) => {
      const top = F.table.topFirstRow + i * F.table.rowAdvance;
      const c = F.table.cols;
      return [
        fieldDiv(c.desc.left, top, c.desc.width, 'left', row.description),
        fieldDiv(c.qty.left, top, c.qty.width, 'center', row.qty),
        fieldDiv(c.unitPrice.left, top, c.unitPrice.width, 'right', row.unitPrice),
        fieldDiv(c.amount.left, top, c.amount.width, 'right', row.amount),
      ].join('');
    })
    .join('');

  const t = F.totals;
  const totalLeft = t.valueRight - t.valueWidth;

  const totalsHtml = [
    fieldDiv(totalLeft, t.totalSalesVatInclusive, t.valueWidth, 'right', data.totalSalesVatInclusive),
    data.lessVat ? fieldDiv(totalLeft, t.lessVat, t.valueWidth, 'right', data.lessVat) : '',
    data.netOfVat ? fieldDiv(totalLeft, t.netOfVat, t.valueWidth, 'right', data.netOfVat) : '',
    data.lessDiscount ? fieldDiv(totalLeft, t.lessDiscount, t.valueWidth, 'right', data.lessDiscount) : '',
    data.addVat ? fieldDiv(totalLeft, t.addVat, t.valueWidth, 'right', data.addVat) : '',
    data.lessWithholdingTax
      ? fieldDiv(totalLeft, t.lessWithholdingTax, t.valueWidth, 'right', data.lessWithholdingTax)
      : '',
    fieldDiv(totalLeft, t.totalAmountDue, t.valueWidth, 'right', data.totalAmountDue, 'bold'),
  ].join('');

  const v = F.vatSummary;
  const vatLeftHtml = [
    data.vatableSales ? fieldDiv(v.left, v.vatableSales, v.width, 'right', data.vatableSales) : '',
    data.vatAmount ? fieldDiv(v.left, v.vat, v.width, 'right', data.vatAmount) : '',
    data.zeroRatedSales ? fieldDiv(v.left, v.zeroRated, v.width, 'right', data.zeroRatedSales) : '',
    data.vatExemptSales ? fieldDiv(v.left, v.vatExempt, v.width, 'right', data.vatExemptSales) : '',
  ].join('');

  const hint = preview
    ? `<p class="overlay-calibration-hint no-print" style="position:fixed;bottom:8px;left:8px;font:11px Arial;color:#64748b;max-width:280px;">
        Preview mode — dashed boxes show field areas. Calibration: X ${cal.offsetX}mm, Y ${cal.offsetY}mm.
        Load pre-printed paper before printing; only ink inside the boxes should appear.
      </p>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <title>Invoice overlay</title>
  <style>${buildOverlayPrintCss(cal, preview)}</style>
</head>
<body>
  <div class="receipt-print-wrapper">
    <div class="receipt-print-layer">
      ${data.invoiceNumber ? fieldDiv(F.invoiceNumber.left, F.invoiceNumber.top, F.invoiceNumber.width, 'left', data.invoiceNumber) : ''}
      ${fieldDiv(F.date.left, F.date.top, F.date.width, 'left', data.date)}
      ${data.isChargeSale
        ? fieldDiv(F.chargeSalesMark.left, F.chargeSalesMark.top, F.chargeSalesMark.width, 'center', 'X', 'mark')
        : fieldDiv(F.cashSalesMark.left, F.cashSalesMark.top, F.cashSalesMark.width, 'center', 'X', 'mark')}
      ${fieldDiv(F.soldToName.left, F.soldToName.top, F.soldToName.width, 'left', data.soldToName)}
      ${data.soldToTin ? fieldDiv(F.soldToTin.left, F.soldToTin.top, F.soldToTin.width, 'left', data.soldToTin) : ''}
      ${data.soldToAddress ? fieldDiv(F.soldToAddress.left, F.soldToAddress.top, F.soldToAddress.width, 'left', data.soldToAddress) : ''}
      ${lineHtml}
      ${totalsHtml}
      ${vatLeftHtml}
    </div>
  </div>
  ${hint}
</body>
</html>`;
}
