/**
 * Parse Motor World SR-1 sales register PDF text into structured sales + line items.
 */

const MONTHS =
  'January|February|March|April|May|June|July|August|September|October|November|December';
const MONTH_RE = new RegExp(`(?:${MONTHS})`, 'i');
const DATE_START_RE = new RegExp(`(?:${MONTHS}) \\d{1,2}, \\d{4}`, 'gi');
const DATE_COVERED_RE = new RegExp(`(?:${MONTHS}) \\d{1,2}-\\d{1,2}, \\d{4}`, 'i');

const UOM_RE = '(?:PC/S|PC/SP|lot|BOTTLE/S|BOTTLE/SP|DRUM|BOTS/S|BOTS/SP)';

const ROW_TAIL_RE = new RegExp(
  `(\\d+(?:\\.\\d+)?)\\s+(${UOM_RE})(?:PHP|\\s+PHP\\s*)?` +
    `([\\d,]+(?:\\.\\d+)?)PHP([\\d,]+(?:\\.\\d+)?)PHP([\\d,]+(?:\\.\\d+)?)PHP([\\d,]+(?:\\.\\d+)?)\\s+` +
    `PHP([\\d,]+(?:\\.\\d+)?)(?:PHP([\\d,]+(?:\\.\\d+)?))?(?:\\s+([\\d.]+)%)?\\s*$`,
  'i'
);

const ITEM_CODE_RE = /\b([A-Z]{1,4}-\d{2,5}[A-Z]?)\b/;
const CAR_MODEL_RE = /\b([A-Z][A-Z0-9]*\/[A-Z][A-Z0-9]+)\b/;
const PLATE_RE = /\b([A-Z]{2,4}\s?\d{3,4})\b/;

function parseMoney(raw: string): number {
  const n = Number(String(raw || '').replace(/,/g, '').trim());
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function parseSaleDateToIso(saleDate: string): string {
  const d = new Date(`${saleDate.trim()} 12:00:00`);
  if (Number.isNaN(d.getTime())) return new Date().toISOString();
  return d.toISOString();
}

function parseSaleDateToYmd(saleDate: string): string {
  const d = new Date(`${saleDate.trim()} 12:00:00`);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export interface Sr1ParsedLine {
  saleDate: string;
  saleDateIso: string;
  dateCovered: string;
  crNo: string;
  bsNo: string;
  poNo: string;
  invoiceRef: string;
  customerName: string;
  address: string;
  carModel: string;
  plateNo: string;
  supplierName: string;
  itemCode: string;
  description: string;
  qty: number;
  uom: string;
  costPerUnit: number;
  totalCost: number;
  unitPrice: number;
  totalPrice: number;
  transactionTotal: number;
  discountPeso: number;
  discountPercent: number;
  rawHead: string;
}

export interface Sr1ParsedSale {
  key: string;
  saleDate: string;
  saleDateIso: string;
  dateCovered: string;
  crNo: string;
  bsNo: string;
  poNo: string;
  invoiceRef: string;
  customerName: string;
  address: string;
  carModel: string;
  plateNo: string;
  modeOfPayment: string;
  terms: string;
  lines: Sr1ParsedLine[];
  subtotalBeforeDiscount: number;
  totalDiscount: number;
  totalValue: number;
  totalCost: number;
}

export interface Sr1ParseResult {
  fileName: string;
  lineCount: number;
  saleCount: number;
  warnings: string[];
  parseErrors: string[];
  sales: Sr1ParsedSale[];
  customers: string[];
  dateRange: { start: string; end: string } | null;
}

function stripPdfHeader(text: string): string {
  const marker = text.indexOf('DISCOUNTJanuary');
  if (marker >= 0) {
    return text.slice(marker).replace(/^.*?DISCOUNT/i, '');
  }
  const alt = text.search(DATE_START_RE);
  return alt >= 0 ? text.slice(alt) : text;
}

function splitRows(text: string): string[] {
  const parts = text.split(new RegExp(`(?=(?:${MONTHS}) \\d{1,2}, \\d{4})`, 'i'));
  return parts.map((p) => p.trim()).filter((p) => p.length > 40);
}

function parseHeadPrefix(head: string): Omit<
  Sr1ParsedLine,
  | 'qty'
  | 'uom'
  | 'costPerUnit'
  | 'totalCost'
  | 'unitPrice'
  | 'totalPrice'
  | 'transactionTotal'
  | 'discountPeso'
  | 'discountPercent'
  | 'description'
  | 'itemCode'
  | 'supplierName'
> & { rest: string; rawHead: string } {
  let work = head.trim();
  let saleDate = '';
  let dateCovered = '';
  let crNo = '';
  let bsNo = '';
  let poNo = '';
  let invoiceRef = '';

  const dateMatch = work.match(new RegExp(`^((?:${MONTHS}) \\d{1,2}, \\d{4})`, 'i'));
  if (dateMatch) {
    saleDate = dateMatch[1];
    work = work.slice(dateMatch[0].length);
  }

  const coveredMatch = work.match(new RegExp(`^((?:${MONTHS}) \\d{1,2}-\\d{1,2}, \\d{4})`, 'i'));
  if (coveredMatch) {
    dateCovered = coveredMatch[1].toUpperCase();
    work = work.slice(coveredMatch[0].length);
  }

  work = work.trim();

  const bsPoMatch = work.match(/^(\d{5,6})\s+-\s+(\d{6})\s+(.+)$/);
  if (bsPoMatch) {
    bsNo = bsPoMatch[1];
    poNo = bsPoMatch[2];
    work = bsPoMatch[3].trim();
  } else {
    const sixSixMatch = work.match(/^(\d{6})\s+(\d{6})\s+(.+)$/);
    if (sixSixMatch) {
      crNo = sixSixMatch[1].slice(0, 3);
      bsNo = sixSixMatch[1].slice(3, 6);
      invoiceRef = sixSixMatch[2];
      work = sixSixMatch[3].trim();
    } else {
      const sixMatch = work.match(/^(\d{6})\s+(.+)$/);
      if (sixMatch) {
        crNo = sixMatch[1].slice(0, 3);
        bsNo = sixMatch[1].slice(3, 6);
        work = sixMatch[2].trim();
      } else {
        const tripleMatch = work.match(/^(\d{3})(\d{3})\s+(\d{6})\s+(.+)$/);
        if (tripleMatch) {
          crNo = tripleMatch[1];
          bsNo = tripleMatch[2];
          invoiceRef = tripleMatch[3];
          work = tripleMatch[4].trim();
        }
      }
    }
  }

  const fields = parseCustomerVehicleItem(work);

  return {
    saleDate,
    saleDateIso: saleDate ? parseSaleDateToIso(saleDate) : new Date().toISOString(),
    dateCovered,
    crNo,
    bsNo,
    poNo,
    invoiceRef,
    customerName: fields.customerName,
    address: fields.address,
    carModel: fields.carModel,
    plateNo: fields.plateNo,
    supplierName: fields.supplierName,
    rawHead: head,
    rest: work,
  };
}

function parseCustomerVehicleItem(rest: string): {
  customerName: string;
  address: string;
  carModel: string;
  plateNo: string;
  supplierName: string;
} {
  let work = rest.trim();
  let supplierName = '';
  let customerName = '';
  let address = '';
  let carModel = '';
  let plateNo = '';

  const invPrefix = work.match(/^(\d{6})\s+(.+)$/);
  if (invPrefix && !work.includes(' - ')) {
    work = invPrefix[2].trim();
  }

  const carMatch = work.match(CAR_MODEL_RE);
  if (carMatch) {
    carModel = carMatch[1];
    const idx = work.indexOf(carModel);
    const before = work.slice(0, idx).trim();
    const after = work.slice(idx + carModel.length).trim();
    const plateMatch = after.match(PLATE_RE);
    if (plateMatch) {
      plateNo = plateMatch[1].replace(/\s+/g, ' ').trim();
    }
    const commaParts = before.split(/,\s*/);
    if (commaParts.length >= 2) {
      customerName = commaParts.slice(0, -1).join(', ').trim();
      address = commaParts[commaParts.length - 1].trim();
    } else {
      const words = before.split(/\s+/);
      if (words.length > 3) {
        customerName = words.slice(0, Math.ceil(words.length / 2)).join(' ');
        address = words.slice(Math.ceil(words.length / 2)).join(' ');
      } else {
        customerName = before;
      }
    }
  } else {
    const commaIdx = work.indexOf(',');
    if (commaIdx > 0) {
      customerName = work.slice(0, commaIdx).trim();
      const afterComma = work.slice(commaIdx + 1).trim();
      const cityMatch = afterComma.match(
        /^(.+?(?:CITY|COTABATO|OCCIDENTAL|G\.S\.C\.|SILWAY)[^.]*?)(?:\s+[A-Z0-9/]|\s+D\d)/i
      );
      if (cityMatch) {
        address = cityMatch[1].trim();
      } else {
        const parts = afterComma.split(/\s+(?=[A-Z]{2,}[\d/])/);
        address = parts[0]?.trim() || '';
      }
    } else {
      const tokens = work.split(/\s+/);
      customerName = tokens.slice(0, Math.min(4, tokens.length)).join(' ');
    }
    if (!customerName && work) customerName = work.split(/\s+/).slice(0, 3).join(' ');
  }

  if (/SUPPLY|CORP|TRADING|BUILDER|INC\.?|VENTURES/i.test(customerName)) {
    supplierName = customerName;
  }

  return {
    customerName: customerName || '—',
    address: address || '—',
    carModel: carModel || '—',
    plateNo: plateNo || '—',
    supplierName: supplierName || '—',
  };
}

function extractDescription(rest: string, itemCode: string): string {
  let desc = rest.trim();
  if (itemCode) {
    const idx = desc.indexOf(itemCode);
    if (idx >= 0) desc = desc.slice(idx + itemCode.length).trim();
  }
  desc = desc.replace(/\s+\d+(?:\.\d+)?\s*$/i, '').trim();
  return desc || rest.trim() || '—';
}

function parseLine(chunk: string): Sr1ParsedLine | null {
  const tail = ROW_TAIL_RE.exec(chunk);
  if (!tail) return null;

  const head = chunk.slice(0, tail.index);
  const prefix = parseHeadPrefix(head);
  const qty = Number(tail[1]);
  const uom = tail[2].toUpperCase().replace(/\/SP$/i, '/SP');
  const costPerUnit = parseMoney(tail[3]);
  const totalCost = parseMoney(tail[4]);
  const unitPrice = parseMoney(tail[5]);
  const totalPrice = parseMoney(tail[6]);
  const transactionTotal = parseMoney(tail[7]);
  const discountPeso = tail[8] ? parseMoney(tail[8]) : 0;
  const discountPercent = tail[9] ? Number(tail[9]) : 0;

  const itemCodeMatch = prefix.rest.match(ITEM_CODE_RE);
  const itemCode = itemCodeMatch ? itemCodeMatch[1] : '';
  const description = extractDescription(prefix.rest, itemCode);

  return {
    saleDate: prefix.saleDate,
    saleDateIso: prefix.saleDateIso,
    dateCovered: prefix.dateCovered,
    crNo: prefix.crNo,
    bsNo: prefix.bsNo,
    poNo: prefix.poNo,
    invoiceRef: prefix.invoiceRef,
    customerName: prefix.customerName,
    address: prefix.address,
    carModel: prefix.carModel,
    plateNo: prefix.plateNo,
    supplierName: prefix.supplierName,
    itemCode,
    description,
    qty,
    uom,
    costPerUnit,
    totalCost,
    unitPrice,
    totalPrice,
    transactionTotal,
    discountPeso,
    discountPercent,
    rawHead: prefix.rawHead,
  };
}

export function buildSr1SaleKey(line: Sr1ParsedLine): string {
  return [
    line.saleDate,
    line.crNo || '—',
    line.bsNo || '—',
    line.poNo || '—',
    line.invoiceRef || '—',
    line.customerName.trim().toUpperCase(),
  ].join('|');
}

function inferPaymentMode(sale: { poNo: string; invoiceRef: string }): string {
  if (sale.poNo && sale.poNo !== '—') return 'Purchase Order';
  return 'Cash';
}

function groupLinesIntoSales(lines: Sr1ParsedLine[]): Sr1ParsedSale[] {
  const map = new Map<string, Sr1ParsedLine[]>();
  for (const line of lines) {
    const key = buildSr1SaleKey(line);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(line);
  }

  const sales: Sr1ParsedSale[] = [];
  for (const [key, group] of map) {
    const first = group[0];
    const subtotalBeforeDiscount = group.reduce((s, l) => s + l.totalPrice, 0);
    const totalDiscount = group.reduce((s, l) => s + l.discountPeso, 0);
    const totalValue = first.transactionTotal || Math.max(0, subtotalBeforeDiscount - totalDiscount);
    const totalCost = group.reduce((s, l) => s + l.totalCost, 0);

    sales.push({
      key,
      saleDate: first.saleDate,
      saleDateIso: first.saleDateIso,
      dateCovered: first.dateCovered,
      crNo: first.crNo,
      bsNo: first.bsNo,
      poNo: first.poNo,
      invoiceRef: first.invoiceRef,
      customerName: first.customerName,
      address: first.address,
      carModel: first.carModel,
      plateNo: first.plateNo,
      modeOfPayment: inferPaymentMode(first),
      terms: '—',
      lines: group,
      subtotalBeforeDiscount: Math.round(subtotalBeforeDiscount * 100) / 100,
      totalDiscount: Math.round(totalDiscount * 100) / 100,
      totalValue: Math.round(totalValue * 100) / 100,
      totalCost: Math.round(totalCost * 100) / 100,
    });
  }

  return sales.sort((a, b) => new Date(a.saleDateIso).getTime() - new Date(b.saleDateIso).getTime());
}

export function parseSr1Text(text: string, fileName = 'SR-1.pdf'): Sr1ParseResult {
  const cleaned = stripPdfHeader(text);
  const chunks = splitRows(cleaned);
  const warnings: string[] = [];
  const parseErrors: string[] = [];
  const lines: Sr1ParsedLine[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const line = parseLine(chunks[i]);
    if (!line) {
      parseErrors.push(`Row ${i + 1}: could not parse prices/UOM tail.`);
      continue;
    }
    if (!line.saleDate) warnings.push(`Row ${i + 1}: missing sale date — used today.`);
    lines.push(line);
  }

  const sales = groupLinesIntoSales(lines);
  const customers = [...new Set(sales.map((s) => s.customerName).filter((n) => n && n !== '—'))].sort();
  const ymds = sales.map((s) => parseSaleDateToYmd(s.saleDate)).filter(Boolean).sort();
  const dateRange =
    ymds.length > 0 ? { start: ymds[0], end: ymds[ymds.length - 1] } : null;

  if (lines.length === 0) {
    warnings.push('No line items were parsed. Check that the file is a Motor World SR-1 sales register PDF.');
  }

  return {
    fileName,
    lineCount: lines.length,
    saleCount: sales.length,
    warnings,
    parseErrors,
    sales,
    customers,
    dateRange,
  };
}

export function sr1ImportSourceNote(fileName: string, sale: Sr1ParsedSale): string {
  return `[SR-1 import · ${fileName} · key:${sale.key}]`;
}
