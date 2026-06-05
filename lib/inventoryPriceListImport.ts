import * as XLSX from 'xlsx';

export interface InventoryPriceListRow {
  itemCode: string;
  productType: string;
  productName: string;
  brand: string;
  uom: string;
  beginningStock: number;
  unitCost: number;
  srpPrice: number;
  /** 1-based spreadsheet row for error messages */
  sourceRow?: number;
}

export interface InventoryPriceListParseResult {
  rows: InventoryPriceListRow[];
  sheetName: string;
  warnings: string[];
}

function normHeader(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function parseNumber(value: unknown): number {
  const n = Number(String(value ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

/** Map Motor World price list UOM labels to inventory units. */
export function normalizePriceListUom(raw: string): string {
  const u = String(raw ?? '').trim().toUpperCase();
  if (!u) return 'pcs';
  if (u === 'DRUM') return 'drum';
  if (u === 'PAIL') return 'pail';
  if (u === 'GAL/S' || u === 'GAL') return 'gallon';
  if (u === 'BOTTLE/S' || u === 'BOTTLE') return 'bottle';
  if (u === 'PC/S' || u === 'PC' || u === 'PCS') return 'pcs';
  return u.toLowerCase().replace(/\//g, '-');
}

type ColMap = {
  itemCode?: number;
  productType?: number;
  productName?: number;
  brand?: number;
  uom?: number;
  beginningStock?: number;
  unitCost?: number;
  srpPrice?: number;
};

function detectColumns(headers: string[]): ColMap | null {
  const map: ColMap = {};
  headers.forEach((h, i) => {
    if (!h) return;
    if (map.itemCode == null && /item\s*code/.test(h)) map.itemCode = i;
    if (map.productType == null && /product\s*type/.test(h)) map.productType = i;
    if (map.productName == null && /(product\s*description|product\s*name)/.test(h)) map.productName = i;
    if (map.brand == null && /^brand$/.test(h)) map.brand = i;
    if (map.uom == null && /^(uom|unit)$/.test(h)) map.uom = i;
    if (map.beginningStock == null && /(beginning\s*stock|qty|quantity)/.test(h)) map.beginningStock = i;
    if (map.unitCost == null && /(unit\s*cost|capital|cost)/.test(h) && !/srp|sell|retail/.test(h)) {
      map.unitCost = i;
    }
    if (map.srpPrice == null && /(srp|selling|retail|unit\s*price)/.test(h)) map.srpPrice = i;
  });
  if (map.itemCode == null || map.productName == null) return null;
  return map;
}

function findHeaderRow(rows: unknown[][]): { index: number; cols: ColMap } | null {
  for (let i = 0; i < Math.min(rows.length, 25); i++) {
    const headers = (rows[i] || []).map(normHeader);
    const cols = detectColumns(headers);
    if (cols) return { index: i, cols };
  }
  return null;
}

export function parseInventoryPriceListBuffer(buffer: ArrayBuffer): InventoryPriceListParseResult {
  const warnings: string[] = [];
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: false });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    return { rows: [], sheetName: '', warnings: ['Workbook has no sheets.'] };
  }
  const sheet = workbook.Sheets[sheetName];
  const rawRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' }) as unknown[][];
  const header = findHeaderRow(rawRows);
  if (!header) {
    return {
      rows: [],
      sheetName,
      warnings: [
        'Could not find headers. Expected columns like ITEM CODE, PRODUCT TYPE, PRODUCT DESCRIPTION, BRAND, UOM, BEGINNING STOCKS, UNIT COST, SRP PRICE.',
      ],
    };
  }

  const { cols } = header;
  const rows: InventoryPriceListRow[] = [];

  for (let r = header.index + 1; r < rawRows.length; r++) {
    const row = rawRows[r] || [];
    const itemCode = String(row[cols.itemCode!] ?? '').trim().toUpperCase();
    const productName = String(row[cols.productName!] ?? '').trim();
    if (!itemCode && !productName) continue;
    if (!itemCode) {
      warnings.push(`Row ${r + 1}: skipped — missing item code.`);
      continue;
    }
    if (!productName) {
      warnings.push(`Row ${r + 1} (${itemCode}): skipped — missing product name.`);
      continue;
    }

    rows.push({
      itemCode,
      productType: cols.productType != null ? String(row[cols.productType] ?? '').trim() : '',
      productName,
      brand: cols.brand != null ? String(row[cols.brand] ?? '').trim() : '',
      uom: cols.uom != null ? normalizePriceListUom(String(row[cols.uom] ?? '')) : 'pcs',
      beginningStock: cols.beginningStock != null ? Math.max(0, parseNumber(row[cols.beginningStock])) : 0,
      unitCost: cols.unitCost != null ? Math.max(0, parseNumber(row[cols.unitCost])) : 0,
      srpPrice: cols.srpPrice != null ? Math.max(0, parseNumber(row[cols.srpPrice])) : 0,
      sourceRow: r + 1,
    });
  }

  if (!rows.length) warnings.push('No inventory rows found after the header row.');
  return { rows, sheetName, warnings };
}

export async function parseInventoryPriceListFile(file: File): Promise<InventoryPriceListParseResult> {
  return parseInventoryPriceListBuffer(await file.arrayBuffer());
}
