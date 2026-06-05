import React, { useEffect, useRef, useState } from 'react';
import { InventoryItem, STOCK_PURPOSE_META, normalizeStockPurpose } from '../types';
import {
  formatLowStockAlertThreshold,
  isLowStockItem,
  itemCapitalPerUnit,
  itemRetailPerUnit,
  itemStockGrossProfit,
  itemUnitGrossProfit,
} from '../lib/inventoryPricing';
import {
  Edit2,
  PackageMinus,
  Trash2,
  AlertTriangle,
  PackagePlus,
  Send,
  RotateCcw,
  MoreVertical,
} from 'lucide-react';
import { DashboardSurface } from './ui/DashboardPrimitives';

function isRedundantDescription(item: InventoryItem): boolean {
  const desc = (item.description ?? '').trim();
  if (!desc) return true;
  const category = (item.category ?? '').trim();
  const brand = (item.brand ?? '').trim();
  const patterns = [
    `${category} — ${brand}`,
    `${category} -- ${brand}`,
    `${category} —`,
    `${category} --`,
    `${category} - ${brand}`,
    category,
  ].map((s) => s.trim());
  return patterns.includes(desc);
}

function formatMoney(value: number): string {
  return `₱${value.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

interface InventoryTableProps {
  items: InventoryItem[];
  onEdit: (item: InventoryItem) => void;
  onRelease: (item: InventoryItem) => void;
  onIssue?: (item: InventoryItem) => void;
  onReturn?: (item: InventoryItem) => void;
  onAddStock: (item: InventoryItem) => void;
  onDelete: (id: string) => void;
  /** When false, actions column is hidden (view-only mode, e.g. overseer). */
  canEdit?: boolean;
}

export const InventoryTable: React.FC<InventoryTableProps> = ({
  items,
  onEdit,
  onRelease,
  onIssue,
  onReturn,
  onAddStock,
  onDelete,
  canEdit = true,
}) => {
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const colSpan = canEdit ? 9 : 8;

  useEffect(() => {
    if (!openMenuId) return;
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpenMenuId(null);
      }
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [openMenuId]);

  return (
    <DashboardSurface className="overflow-visible">
      <div className="border-b border-slate-100 bg-slate-50/60 px-4 py-2 text-xs text-slate-500">
        Tip: scroll sideways if the table is wider than your screen.
      </div>
      <div className="overflow-x-auto overscroll-x-contain">
        <table className="w-full min-w-[920px] table-fixed border-collapse text-left text-sm">
          <colgroup>
            <col className="w-[5.5rem]" />
            <col className="w-[11rem]" />
            <col className="w-[6.5rem]" />
            <col className="w-[5rem]" />
            <col className="w-[3rem]" />
            <col className="w-[4.5rem]" />
            <col className="w-[5.5rem]" />
            <col className="w-[5.5rem]" />
            {canEdit && <col className="w-[3.25rem]" />}
          </colgroup>
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/90">
              <th className="sticky left-0 z-20 bg-slate-50/95 px-2 py-3 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                Code
              </th>
              <th className="px-2 py-3 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                Product
              </th>
              <th className="px-2 py-3 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                Type
              </th>
              <th className="px-2 py-3 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                Brand
              </th>
              <th className="px-2 py-3 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                UOM
              </th>
              <th className="px-2 py-3 text-right text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                Stock
              </th>
              <th
                className="px-2 py-3 text-right text-[10px] font-semibold uppercase tracking-wide text-slate-500"
                title="Total capital (cost) on hand"
              >
                Cost
              </th>
              <th
                className="px-2 py-3 text-right text-[10px] font-semibold uppercase tracking-wide text-slate-500"
                title="Total retail (SRP) on hand"
              >
                SRP
              </th>
              {canEdit && (
                <th className="sticky right-0 z-20 bg-slate-50/95 px-1 py-3 text-center text-[10px] font-semibold uppercase tracking-wide text-slate-500 shadow-[-4px_0_8px_-6px_rgba(15,23,42,0.2)]">
                  ···
                </th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {items.length === 0 ? (
              <tr>
                <td colSpan={colSpan} className="py-8 text-center text-slate-400">
                  No items in inventory. Add your first item!
                </td>
              </tr>
            ) : (
              items.map((item) => {
                const isLowStock = isLowStockItem(item);
                const alertLabel = formatLowStockAlertThreshold(item.minStockLevel);
                const stockPurpose = normalizeStockPurpose(item.stockPurpose);
                const purposeMeta = STOCK_PURPOSE_META[stockPurpose];
                const showDescription = !isRedundantDescription(item);
                const capitalTotal = item.quantity * itemCapitalPerUnit(item);
                const retailTotal = item.quantity * itemRetailPerUnit(item);
                const profitTotal = itemStockGrossProfit(item);
                const menuOpen = openMenuId === item.id;

                return (
                  <tr key={item.id} className="group hover:bg-slate-50/80">
                    <td
                      className="sticky left-0 z-10 bg-white px-2 py-2.5 font-mono text-xs font-semibold text-slate-700 shadow-[4px_0_8px_-6px_rgba(15,23,42,0.12)] group-hover:bg-slate-50/80"
                      title={item.itemCode?.trim() || undefined}
                    >
                      <span className="block truncate">{item.itemCode?.trim() || '—'}</span>
                    </td>
                    <td className="px-2 py-2.5">
                      <div className="flex min-w-0 items-start gap-1">
                        {canEdit ? (
                          <button
                            type="button"
                            onClick={() => onEdit(item)}
                            className="min-w-0 truncate text-left font-medium text-slate-800 hover:text-indigo-700 hover:underline"
                            title={item.name}
                          >
                            {item.name}
                          </button>
                        ) : (
                          <span className="min-w-0 truncate font-medium text-slate-800" title={item.name}>
                            {item.name}
                          </span>
                        )}
                        {isLowStock && (
                          <AlertTriangle
                            className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500"
                            title={`Low stock — at or below ${alertLabel}`}
                          />
                        )}
                      </div>
                      {showDescription && (
                        <div className="truncate text-[11px] text-slate-400" title={item.description}>
                          {item.description}
                        </div>
                      )}
                    </td>
                    <td className="px-2 py-2.5">
                      <span
                        className="inline-block max-w-full truncate rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700"
                        title={item.category || undefined}
                      >
                        {item.category || '—'}
                      </span>
                      <div className="mt-0.5 truncate text-[10px] text-slate-400" title={purposeMeta.hint}>
                        {purposeMeta.label}
                      </div>
                    </td>
                    <td className="truncate px-2 py-2.5 text-xs text-slate-600" title={item.brand?.trim() || undefined}>
                      {item.brand?.trim() || '—'}
                    </td>
                    <td className="px-2 py-2.5 text-xs uppercase text-slate-600">{item.unit || 'pcs'}</td>
                    <td className="px-2 py-2.5 text-right tabular-nums">
                      <div className="font-semibold text-slate-800">{item.quantity}</div>
                      {(item.defectiveQuantity ?? 0) > 0 && (
                        <div className="text-[10px] font-medium text-amber-700" title="Defective qty">
                          {item.defectiveQuantity} def.
                        </div>
                      )}
                      {alertLabel !== 'Off' && (
                        <div className="text-[10px] text-slate-400">≤{alertLabel}</div>
                      )}
                    </td>
                    <td
                      className="truncate px-2 py-2.5 text-right text-xs font-medium tabular-nums text-slate-700"
                      title={`Unit cost ₱${itemCapitalPerUnit(item).toFixed(2)} × ${item.quantity}`}
                    >
                      {formatMoney(capitalTotal)}
                    </td>
                    <td
                      className="truncate px-2 py-2.5 text-right text-xs font-medium tabular-nums text-slate-800"
                      title={`Unit SRP ₱${itemRetailPerUnit(item).toFixed(2)} × ${item.quantity} · Profit ${formatMoney(profitTotal)} (₱${itemUnitGrossProfit(item).toFixed(2)}/unit)`}
                    >
                      {formatMoney(retailTotal)}
                    </td>
                    {canEdit && (
                      <td className="sticky right-0 z-10 bg-white px-1 py-2 text-center shadow-[-4px_0_8px_-6px_rgba(15,23,42,0.15)] group-hover:bg-slate-50/80">
                        <div className="relative inline-block" ref={menuOpen ? menuRef : undefined}>
                          <button
                            type="button"
                            onClick={() => setOpenMenuId(menuOpen ? null : item.id)}
                            className="rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800"
                            title="Item actions"
                            aria-expanded={menuOpen}
                          >
                            <MoreVertical className="h-4 w-4" />
                          </button>
                          {menuOpen && (
                            <div className="absolute right-0 top-full z-30 mt-1 w-44 rounded-xl border border-slate-200 bg-white py-1 text-left text-sm shadow-lg">
                              <button
                                type="button"
                                className="flex w-full items-center gap-2 px-3 py-2 text-slate-700 hover:bg-indigo-50 hover:text-indigo-700"
                                onClick={() => {
                                  setOpenMenuId(null);
                                  onEdit(item);
                                }}
                              >
                                <Edit2 className="h-3.5 w-3.5" />
                                Edit item
                              </button>
                              <button
                                type="button"
                                className="flex w-full items-center gap-2 px-3 py-2 text-red-700 hover:bg-red-50"
                                onClick={() => {
                                  setOpenMenuId(null);
                                  onDelete(item.id);
                                }}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                                Delete item
                              </button>
                              <div className="my-1 border-t border-slate-100" />
                              <button
                                type="button"
                                className="flex w-full items-center gap-2 px-3 py-2 text-slate-700 hover:bg-green-50 hover:text-green-700"
                                onClick={() => {
                                  setOpenMenuId(null);
                                  onAddStock(item);
                                }}
                              >
                                <PackagePlus className="h-3.5 w-3.5" />
                                Add stock
                              </button>
                              <button
                                type="button"
                                className="flex w-full items-center gap-2 px-3 py-2 text-slate-700 hover:bg-orange-50 hover:text-orange-700"
                                onClick={() => {
                                  setOpenMenuId(null);
                                  onRelease(item);
                                }}
                              >
                                <PackageMinus className="h-3.5 w-3.5" />
                                Release
                              </button>
                              {onIssue && (
                                <button
                                  type="button"
                                  className="flex w-full items-center gap-2 px-3 py-2 text-slate-700 hover:bg-indigo-50"
                                  onClick={() => {
                                    setOpenMenuId(null);
                                    onIssue(item);
                                  }}
                                >
                                  <Send className="h-3.5 w-3.5" />
                                  Issue
                                </button>
                              )}
                              {onReturn && (
                                <button
                                  type="button"
                                  className="flex w-full items-center gap-2 px-3 py-2 text-slate-700 hover:bg-teal-50"
                                  onClick={() => {
                                    setOpenMenuId(null);
                                    onReturn(item);
                                  }}
                                >
                                  <RotateCcw className="h-3.5 w-3.5" />
                                  Return
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </DashboardSurface>
  );
};
