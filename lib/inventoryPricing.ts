import type { InventoryItem } from '../types';

function num(x: unknown, fallback = 0): number {
  const v = Number(x);
  return Number.isFinite(v) ? v : fallback;
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

/** Retail / SRP per unit (selling price). */
export function itemRetailPerUnit(item: Pick<InventoryItem, 'unitPrice'>): number {
  return num(item.unitPrice);
}

/**
 * Capital (cost / COGS) per unit.
 * When unset, defaults to retail so implied unit profit is zero (legacy rows).
 */
export function itemCapitalPerUnit(item: Pick<InventoryItem, 'unitPrice' | 'capitalPrice'>): number {
  if (item.capitalPrice != null && Number.isFinite(Number(item.capitalPrice))) {
    return num(item.capitalPrice);
  }
  return itemRetailPerUnit(item);
}

/** Gross profit per unit: retail − capital. */
export function itemUnitGrossProfit(item: Pick<InventoryItem, 'unitPrice' | 'capitalPrice'>): number {
  return round2(itemRetailPerUnit(item) - itemCapitalPerUnit(item));
}

/** Gross profit for current on-hand qty: qty × (retail − capital) per unit. */
export function itemStockGrossProfit(item: InventoryItem): number {
  return round2(itemUnitGrossProfit(item) * num(item.quantity));
}

/** Raw retail − capital (e.g. form preview). */
export function grossProfitPerUnitNumbers(retail: number, capital: number): number {
  return round2(num(retail) - num(capital));
}

/** `minStockLevel < 0` disables low-stock alerts. Otherwise alert when on-hand qty ≤ threshold. */
export function isLowStockItem(item: Pick<InventoryItem, 'quantity' | 'minStockLevel'>): boolean {
  const min = num(item.minStockLevel, 0);
  if (min < 0) return false;
  return num(item.quantity) <= min;
}

export function formatLowStockAlertThreshold(minStockLevel: number | undefined | null): string {
  const min = num(minStockLevel, 0);
  if (min < 0) return 'Off';
  return String(min);
}
