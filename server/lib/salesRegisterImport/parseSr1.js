import { normalizeSalesRegisterPdfText } from './normalizePdfText.js';
import {
  attachPaymentColumnsToLines,
  parseDueDaysFromTerms,
  resolveRegisterPaymentMode,
} from './paymentColumns.js';
import { parseRegisterSaleDateToIso, parseRegisterSaleDateToYmd } from './saleDates.js';

const MONTHS =
  'January|February|March|April|May|June|July|August|September|October|November|December';
const DATE_START_RE = new RegExp(`^(?:${MONTHS}) \\d{1,2}, \\d{4}`, 'i');
const DATE_COVERED_RE = new RegExp(`^(?:${MONTHS}) \\d{1,2}-\\d{1,2}, \\d{4}`, 'i');
const UOM_RE = /^(?:PC\/S|PC\/SP|lot|BOTTLE\/S|BOTTLE\/SP|DRUM|BOTS\/S|BOTS\/SP)$/i;
const CAR_MODEL_RE = /^[A-Z][A-Z0-9]*\/[A-Z][A-Z0-9]+$/;
const PLATE_RE = /^[A-Z]{2,4}\s?\d{3,4}$/i;
const ITEM_CODE_RE = /\b([A-Z]{1,4}-\d{2,5}[A-Z]?)\b/;

function round2(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

function parseMoney(raw) {
  const n = Number(String(raw || '').replace(/PHP/gi, '').replace(/,/g, '').trim());
  return Number.isFinite(n) ? round2(n) : 0;
}

const parseSaleDateToIso = parseRegisterSaleDateToIso;
const parseSaleDateToYmd = parseRegisterSaleDateToYmd;

function buildSr1SaleKey(line) {
  return [
    line.saleDate,
    line.crNo || '—',
    line.bsNo || '—',
    line.poNo || '—',
    line.invoiceRef || '—',
    line.customerName.trim().toUpperCase(),
  ].join('|');
}

function parseHeadFields(parts, startIdx, endIdx) {
  let poNo = '—';
  let invoiceRef = '—';
  let customerName = '—';
  let address = '—';
  let carModel = '—';
  let plateNo = '—';
  let supplierName = '—';
  let description = '—';
  let itemCode = '';

  const head = parts.slice(startIdx, endIdx + 1);
  if (head.length === 0) {
    return { poNo, invoiceRef, customerName, address, carModel, plateNo, supplierName, description, itemCode };
  }

  let cursor = 0;
  const poMatch = head[cursor]?.match(/^(\d{5,6})\s*-\s*(\d{6})$/);
  if (poMatch) {
    poNo = poMatch[1];
    invoiceRef = poMatch[2];
    cursor += 1;
  } else if (/^\d{6}$/.test(head[cursor] || '')) {
    invoiceRef = head[cursor];
    cursor += 1;
  } else if (/^\d{5,6}$/.test(head[cursor] || '')) {
    invoiceRef = head[cursor];
    cursor += 1;
  }

  if (cursor < head.length) {
    customerName = head[cursor] || '—';
    cursor += 1;
  }
  if (cursor < head.length && !CAR_MODEL_RE.test(head[cursor]) && !UOM_RE.test(head[cursor])) {
    address = head[cursor] || '—';
    cursor += 1;
  }
  if (cursor < head.length && CAR_MODEL_RE.test(head[cursor])) {
    carModel = head[cursor];
    cursor += 1;
  }
  if (cursor < head.length && PLATE_RE.test(head[cursor])) {
    plateNo = head[cursor].replace(/\s+/g, ' ').trim();
    cursor += 1;
  }

  const descParts = head.slice(cursor);
  description = descParts.join(' ').trim() || '—';
  const codeMatch = description.match(ITEM_CODE_RE);
  if (codeMatch) itemCode = codeMatch[1];

  if (/SUPPLY|CORP|TRADING|BUILDER|INC\.?|VENTURES/i.test(customerName)) {
    supplierName = customerName;
  }

  return { poNo, invoiceRef, customerName, address, carModel, plateNo, supplierName, description, itemCode };
}

function splitRowParts(line) {
  if (line.includes('\t')) {
    return line.split('\t').map((p) => p.trim()).filter((p) => p.length > 0);
  }
  return line.split(/\s{2,}/).map((p) => p.trim()).filter((p) => p.length > 0);
}

function parseFallbackRow(line) {
  if (!DATE_START_RE.test(line) || !/PHP/i.test(line)) return null;

  const saleDate = line.match(DATE_START_RE)?.[0];
  if (!saleDate) return null;

  const tail = line.match(
    /(\d+(?:\.\d+)?)\s+(PC\/S|PC\/SP|lot|BOTTLE\/S|BOTTLE\/SP|DRUM|BOTS\/S|BOTS\/SP)\s+(?:PHP\s*)?([\d,]+(?:\.\d+)?)\s*PHP\s*([\d,]+(?:\.\d+)?)\s*PHP\s*([\d,]+(?:\.\d+)?)\s*PHP\s*([\d,]+(?:\.\d+)?)\s*PHP\s*([\d,]+(?:\.\d+)?)(?:\s*PHP\s*([\d,]+(?:\.\d+)?))?(?:\s*([\d.]+)%)?/i
  );
  if (!tail) return null;

  const head = line.slice(0, tail.index).replace(saleDate, '').trim();
  const covered = head.match(DATE_COVERED_RE);
  const dateCovered = covered ? covered[0].toUpperCase() : '';
  const afterCovered = covered ? head.replace(covered[0], '').trim() : head;
  const nums = afterCovered.match(/\b\d{3,6}\b/g) || [];
  const crNo = nums[0] || '';
  const bsNo = nums[1] || crNo || '';
  const invoiceRef = nums[2] || '—';
  const textBits = afterCovered
    .replace(/\b\d{3,6}\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return {
    saleDate,
    saleDateIso: parseSaleDateToIso(saleDate),
    dateCovered,
    crNo,
    bsNo,
    poNo: '—',
    invoiceRef,
    customerName: textBits.split(/\s{2,}|, /)[0]?.trim() || 'Migration import',
    address: '—',
    carModel: '—',
    plateNo: '—',
    supplierName: '—',
    itemCode: '',
    description: textBits || 'Imported register line',
    qty: Number(tail[1]),
    uom: String(tail[2]).toUpperCase(),
    costPerUnit: parseMoney(tail[3]),
    totalCost: parseMoney(tail[4]),
    unitPrice: parseMoney(tail[5]),
    totalPrice: parseMoney(tail[6]),
    transactionTotal: parseMoney(tail[7]),
    discountPeso: tail[8] ? parseMoney(tail[8]) : 0,
    discountPercent: tail[9] ? Number(tail[9]) : 0,
    rawHead: head,
  };
}

function parseTabRow(line) {
  const parts = splitRowParts(line);
  if (parts.length < 8 || !DATE_START_RE.test(parts[0])) return null;

  let idx = 1;
  let dateCovered = '';
  if (idx < parts.length && DATE_COVERED_RE.test(parts[idx])) {
    dateCovered = parts[idx].toUpperCase();
    idx += 1;
  }

  const crNo = parts[idx] || '';
  const bsNo = parts[idx + 1] || '';
  idx += 2;

  let j = parts.length - 1;
  let discountPercent = 0;
  let discountPeso = 0;

  if (parts[j]?.endsWith('%')) {
    discountPercent = Number(String(parts[j]).replace('%', '')) || 0;
    j -= 1;
  }
  if (j >= idx && /PHP/i.test(parts[j])) {
    discountPeso = parseMoney(parts[j]);
    j -= 1;
  }

  const transactionTotal = j >= idx ? parseMoney(parts[j--]) : 0;
  const totalPrice = j >= idx ? parseMoney(parts[j--]) : 0;
  const unitPrice = j >= idx ? parseMoney(parts[j--]) : 0;
  const totalCost = j >= idx ? parseMoney(parts[j--]) : 0;
  const costPerUnit = j >= idx ? parseMoney(parts[j--]) : 0;
  const uom = j >= idx ? String(parts[j--]).toUpperCase() : '';
  const qty = j >= idx ? Number(parts[j--]) : 0;

  if (!Number.isFinite(qty) || qty <= 0 || !uom) return null;

  const head = parseHeadFields(parts, idx, j);

  return {
    saleDate: parts[0],
    saleDateIso: parseSaleDateToIso(parts[0]),
    dateCovered,
    crNo,
    bsNo,
    poNo: head.poNo,
    invoiceRef: head.invoiceRef,
    customerName: head.customerName,
    address: head.address,
    carModel: head.carModel,
    plateNo: head.plateNo,
    supplierName: head.supplierName,
    itemCode: head.itemCode,
    description: head.description,
    qty,
    uom,
    costPerUnit,
    totalCost,
    unitPrice,
    totalPrice,
    transactionTotal,
    discountPeso,
    discountPercent,
    rawHead: parts.slice(0, j + 1).join('\t'),
  };
}

const ROW_TAIL_RE = new RegExp(
  `(\\d+(?:\\.\\d+)?)\\s+(${[
    'PC/S',
    'PC/SP',
    'lot',
    'BOTTLE/S',
    'BOTTLE/SP',
    'DRUM',
    'BOTS/S',
    'BOTS/SP',
  ].join('|')})(?:PHP|\\s+PHP\\s*)?` +
    `([\\d,]+(?:\\.\\d+)?)PHP([\\d,]+(?:\\.\\d+)?)PHP([\\d,]+(?:\\.\\d+)?)PHP([\\d,]+(?:\\.\\d+)?)\\s+` +
    `PHP([\\d,]+(?:\\.\\d+)?)(?:PHP([\\d,]+(?:\\.\\d+)?))?(?:\\s+([\\d.]+)%)?\\s*$`,
  'i'
);

function parseRegexRow(chunk) {
  const tail = chunk.match(ROW_TAIL_RE);
  if (!tail || tail.index == null) return null;

  const head = chunk.slice(0, tail.index).trim();
  const parts = head.split(/\s{2,}|\t/).map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0 || !DATE_START_RE.test(parts[0])) return null;

  const synthetic = [
    parts[0],
    ...(DATE_COVERED_RE.test(parts[1] || '') ? [parts[1]] : []),
    ...parts.slice(DATE_COVERED_RE.test(parts[1] || '') ? 2 : 1),
    tail[1],
    tail[2],
    `PHP ${tail[3]}`,
    `PHP${tail[4]}`,
    `PHP${tail[5]}`,
    `PHP${tail[6]}`,
    `PHP${tail[7]}`,
    tail[8] ? `PHP${tail[8]}` : '',
    tail[9] ? `${tail[9]}%` : '',
  ]
    .filter(Boolean)
    .join('\t');

  return parseTabRow(synthetic);
}

function groupLinesIntoSales(lines) {
  const map = new Map();
  for (const line of lines) {
    const key = buildSr1SaleKey(line);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(line);
  }

  const sales = [];
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
      modeOfPayment: resolveRegisterPaymentMode(first.transactionType, first.terms, first),
      terms: first.terms || '—',
      dueDays:
        parseDueDaysFromTerms(first.terms) ||
        (resolveRegisterPaymentMode(first.transactionType, first.terms, first) === 'Credit' ? 30 : 0),
      transactionType: first.transactionType || 'CASH',
      lines: group,
      subtotalBeforeDiscount: round2(subtotalBeforeDiscount),
      totalDiscount: round2(totalDiscount),
      totalValue: round2(totalValue),
      totalCost: round2(totalCost),
    });
  }

  return sales.sort((a, b) => new Date(a.saleDateIso).getTime() - new Date(b.saleDateIso).getTime());
}

/**
 * Parse SR-1 / Motor World sales register PDF text into structured sales.
 */
export function parseSr1Text(text, fileName = 'register.pdf') {
  const raw = String(text || '');
  const warnings = [];
  const parseErrors = [];
  const lines = [];

  const rowLines = raw
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => DATE_START_RE.test(l) && /PHP/i.test(l));

  for (let i = 0; i < rowLines.length; i++) {
    const tabLine = parseTabRow(rowLines[i]);
    if (tabLine) {
      lines.push(tabLine);
      continue;
    }
    const regexLine = parseRegexRow(normalizeSalesRegisterPdfText(rowLines[i]));
    if (regexLine) {
      lines.push(regexLine);
      continue;
    }
    const fallbackLine = parseFallbackRow(rowLines[i]);
    if (fallbackLine) {
      lines.push(fallbackLine);
      warnings.push(`Row ${i + 1}: imported with fallback parser.`);
      continue;
    }
    parseErrors.push(`Row ${i + 1}: could not parse columns.`);
  }

  if (lines.length === 0) {
    const normalized = normalizeSalesRegisterPdfText(raw);
    const chunks = normalized.split(new RegExp(`(?=(?:${MONTHS}) \\d{1,2}, \\d{4})`, 'i'));
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i].trim();
      if (chunk.length < 24) continue;
      const parsed = parseRegexRow(chunk);
      if (parsed) lines.push(parsed);
    }
    if (lines.length > 0) {
      warnings.push('Used alternate row detection for this PDF layout.');
    }
  }

  const linesWithPayment = attachPaymentColumnsToLines(lines, raw);
  const sales = groupLinesIntoSales(linesWithPayment);
  const customers = [...new Set(sales.map((s) => s.customerName).filter((n) => n && n !== '—'))].sort();
  const ymds = sales.map((s) => parseSaleDateToYmd(s.saleDate)).filter(Boolean).sort();
  const dateRange = ymds.length > 0 ? { start: ymds[0], end: ymds[ymds.length - 1] } : null;

  if (lines.length === 0) {
    warnings.push('No sale lines were found. Use a Motor World SR-1 sales register export.');
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
