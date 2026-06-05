import type { InventoryPriceListRow } from './inventoryPriceListImport';
import { normalizePriceListUom } from './inventoryPriceListImport';

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Fields that must all match before two inventory lines are merged into one stock. */
export type InventoryMergeSnapshot = {
  itemCode: string;
  name: string;
  brand: string;
  category: string;
  unit: string;
  unitPrice: number;
  capitalPrice: number;
  stockPurpose: 'for_sale' | 'for_supply';
  minStockLevel: number;
};

export function inventoryMergeKeyFromSnapshot(snapshot: InventoryMergeSnapshot): string {
  return JSON.stringify({
    itemCode: snapshot.itemCode.trim().toUpperCase(),
    name: snapshot.name.trim(),
    brand: snapshot.brand.trim(),
    category: snapshot.category.trim() || 'Uncategorized',
    unit: snapshot.unit.trim().toLowerCase() || 'pcs',
    unitPrice: roundMoney(snapshot.unitPrice),
    capitalPrice: roundMoney(snapshot.capitalPrice),
    stockPurpose: snapshot.stockPurpose === 'for_supply' ? 'for_supply' : 'for_sale',
    minStockLevel: Math.round(snapshot.minStockLevel),
  });
}

export function inventoryMergeKeyFromPriceListRow(row: InventoryPriceListRow): string {
  return inventoryMergeKeyFromSnapshot({
    itemCode: row.itemCode,
    name: row.productName,
    brand: row.brand,
    category: row.productType || 'Uncategorized',
    unit: normalizePriceListUom(row.uom),
    unitPrice: row.srpPrice,
    capitalPrice: row.unitCost || row.srpPrice,
    stockPurpose: 'for_sale',
    minStockLevel: 0,
  });
}

export function inventoryMergeKeyFromItemLike(item: {
  itemCode?: string;
  name?: string;
  brand?: string;
  category?: string;
  unit?: string;
  unitPrice?: number;
  capitalPrice?: number;
  stockPurpose?: string;
  minStockLevel?: number;
}): string {
  const cap = Number(item.capitalPrice ?? item.unitPrice ?? 0);
  return inventoryMergeKeyFromSnapshot({
    itemCode: String(item.itemCode ?? '').trim().toUpperCase(),
    name: String(item.name ?? '').trim(),
    brand: String(item.brand ?? '').trim(),
    category: String(item.category ?? '').trim() || 'Uncategorized',
    unit: String(item.unit ?? 'pcs').trim().toLowerCase() || 'pcs',
    unitPrice: Number(item.unitPrice ?? 0),
    capitalPrice: Number.isFinite(cap) ? cap : 0,
    stockPurpose: item.stockPurpose === 'for_supply' ? 'for_supply' : 'for_sale',
    minStockLevel: Number(item.minStockLevel ?? 0),
  });
}

/** Combine import rows that are identical on every field except quantity. */
export function mergeIdenticalPriceListRows(rows: InventoryPriceListRow[]): {
  rows: InventoryPriceListRow[];
  mergedCount: number;
} {
  const map = new Map<string, InventoryPriceListRow>();
  let mergedCount = 0;

  for (const row of rows) {
    const key = inventoryMergeKeyFromPriceListRow(row);
    const existing = map.get(key);
    if (existing) {
      existing.beginningStock += row.beginningStock;
      mergedCount += 1;
    } else {
      map.set(key, { ...row });
    }
  }

  return { rows: Array.from(map.values()), mergedCount };
}
