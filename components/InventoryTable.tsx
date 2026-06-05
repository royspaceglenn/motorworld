import React from 'react';
import { InventoryItem, STOCK_PURPOSE_META, normalizeStockPurpose } from '../types';
import {
  formatLowStockAlertThreshold,
  isLowStockItem,
  itemCapitalPerUnit,
  itemRetailPerUnit,
  itemStockGrossProfit,
  itemUnitGrossProfit,
} from '../lib/inventoryPricing';
import { Edit2, PackageMinus, Trash2, AlertTriangle, PackagePlus, Send, RotateCcw } from 'lucide-react';
import { DashboardSurface } from './ui/DashboardPrimitives';

function formatItemAddedOn(item: InventoryItem): string {
  const iso = item.createdAt ?? item.lastUpdated;
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return '—';
  }
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

export const InventoryTable: React.FC<InventoryTableProps> = ({ items, onEdit, onRelease, onIssue, onReturn, onAddStock, onDelete, canEdit = true }) => {
  const colSpan = canEdit ? 13 : 12;
  return (
    <DashboardSurface className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/90">
              <th className="px-4 py-4 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 whitespace-nowrap">Item code</th>
              <th className="px-4 py-4 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 whitespace-nowrap">Product type</th>
              <th className="px-4 py-4 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 whitespace-nowrap">Product name</th>
              <th className="px-4 py-4 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 whitespace-nowrap">Brand</th>
              <th className="px-4 py-4 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 whitespace-nowrap">UOM</th>
              <th className="px-4 py-4 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Stock use</th>
              <th className="px-4 py-4 text-right text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Stock</th>
              <th className="px-4 py-4 text-right text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                <span className="inline-flex items-center gap-1" title="Items marked as defective (e.g. from Return from Sales)">
                  Defective
                </span>
              </th>
              <th className="px-4 py-4 text-right text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                <span title="Total capital (cost) for quantity on hand: qty × cost per unit.">Capital</span>
              </th>
              <th className="px-4 py-4 text-right text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                <span title="Total retail value for quantity on hand: qty × SRP per unit.">Retail price</span>
              </th>
              <th className="px-4 py-4 text-right text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                <span title="Gross profit on stock: extended retail − extended capital.">Profit</span>
              </th>
              <th className="px-4 py-4 text-right text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                <span
                  className="inline-block max-w-[8rem] text-right leading-tight"
                  title="When this item was first added to the system. Older records may match the last update time."
                >
                  Added on
                </span>
              </th>
              {canEdit && (
                <th className="sticky right-0 z-20 bg-slate-50/95 px-3 py-4 text-center text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 shadow-[-6px_0_12px_-8px_rgba(15,23,42,0.25)]">
                  Actions
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
                return (
                  <tr key={item.id} className="group hover:bg-slate-50 transition-colors">
                    <td className="py-4 px-4 font-mono text-sm font-medium text-slate-700 whitespace-nowrap">
                      {item.itemCode?.trim() || '—'}
                    </td>
                    <td className="py-4 px-4">
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-indigo-50 text-indigo-700">
                        {item.category || '—'}
                      </span>
                    </td>
                    <td className="py-4 px-4">
                      <div className="flex items-center gap-2">
                        {canEdit ? (
                          <button
                            type="button"
                            onClick={() => onEdit(item)}
                            className="font-medium text-slate-800 text-left hover:text-indigo-700 hover:underline underline-offset-2"
                            title="Edit item"
                          >
                            {item.name}
                          </button>
                        ) : (
                          <div className="font-medium text-slate-800">{item.name}</div>
                        )}
                        {isLowStock && (
                          <div className="group relative shrink-0">
                            <AlertTriangle className="w-4 h-4 text-amber-500 cursor-help" />
                            <span className="absolute left-6 top-0 w-max bg-slate-800 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity z-10">
                              Low stock — at or below alert level ({alertLabel})
                            </span>
                          </div>
                        )}
                      </div>
                      {item.description ? (
                        <div className="text-xs text-slate-400 truncate max-w-[220px]">{item.description}</div>
                      ) : null}
                    </td>
                    <td className="py-4 px-4 text-sm text-slate-700">{item.brand?.trim() || '—'}</td>
                    <td className="py-4 px-4 text-sm text-slate-600 uppercase">{item.unit || 'pcs'}</td>
                    <td className="py-4 px-4">
                      {(() => {
                        const p = normalizeStockPurpose(item.stockPurpose);
                        const meta = STOCK_PURPOSE_META[p];
                        return (
                          <span
                            className={`inline-flex max-w-[11rem] rounded-full px-2.5 py-0.5 text-xs font-medium ${meta.badgeClass}`}
                            title={meta.hint}
                          >
                            {meta.label}
                          </span>
                        );
                      })()}
                    </td>
                    <td className="py-4 px-4 text-right font-medium text-slate-700">
                      <div>{item.quantity}</div>
                      {alertLabel !== 'Off' && (
                        <div className="text-xs font-normal text-slate-400">Alert ≤ {alertLabel}</div>
                      )}
                    </td>
                    <td className="py-4 px-4 text-right">
                      {(item.defectiveQuantity ?? 0) > 0 ? (
                        <span className="inline-flex items-center gap-1 font-medium text-amber-700 bg-amber-50 px-2 py-0.5 rounded text-sm" title="Inventory for return / defective">
                          {item.defectiveQuantity}
                        </span>
                      ) : (
                        <span className="text-slate-400 text-sm">—</span>
                      )}
                    </td>
                    <td
                      className="py-4 px-4 text-right font-medium text-slate-700 tabular-nums"
                      title={`Per unit: ₱${itemCapitalPerUnit(item).toFixed(2)} × ${item.quantity} ${item.unit || 'pcs'}`}
                    >
                      ₱{(item.quantity * itemCapitalPerUnit(item)).toFixed(2)}
                    </td>
                    <td
                      className="py-4 px-4 text-right font-medium text-slate-800 tabular-nums"
                      title={`Per unit: ₱${itemRetailPerUnit(item).toFixed(2)} × ${item.quantity} ${item.unit || 'pcs'}`}
                    >
                      ₱{(item.quantity * itemRetailPerUnit(item)).toFixed(2)}
                    </td>
                    <td
                      className={`py-4 px-4 text-right font-semibold tabular-nums ${
                        itemStockGrossProfit(item) >= 0 ? 'text-emerald-700' : 'text-rose-600'
                      }`}
                      title={`Per unit profit: ₱${itemUnitGrossProfit(item).toFixed(2)} × ${item.quantity} ${item.unit || 'pcs'}`}
                    >
                      ₱{itemStockGrossProfit(item).toFixed(2)}
                    </td>
                    <td className="py-4 px-4 text-right text-sm text-slate-600 whitespace-nowrap" title={item.createdAt ?? item.lastUpdated}>
                      {formatItemAddedOn(item)}
                    </td>
                    {canEdit && (
                      <td className="sticky right-0 z-10 bg-white py-4 px-3 text-center shadow-[-6px_0_12px_-8px_rgba(15,23,42,0.18)] group-hover:bg-slate-50">
                        <div className="flex min-w-[7.5rem] flex-col items-stretch gap-2">
                          <div className="flex items-center justify-center gap-1">
                            <button
                              type="button"
                              onClick={() => onAddStock(item)}
                              className="rounded-lg bg-slate-100 p-1.5 text-slate-500 transition-colors hover:bg-green-50 hover:text-green-600"
                              title="Restock / add stock"
                            >
                              <PackagePlus className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => onRelease(item)}
                              className="rounded-lg bg-slate-100 p-1.5 text-slate-500 transition-colors hover:bg-orange-50 hover:text-orange-600"
                              title="Release stock"
                            >
                              <PackageMinus className="w-3.5 h-3.5" />
                            </button>
                            {onIssue && (
                              <button
                                type="button"
                                onClick={() => onIssue(item)}
                                className="rounded-lg bg-slate-100 p-1.5 text-slate-500 transition-colors hover:bg-indigo-50 hover:text-indigo-600"
                                title="Issue item"
                              >
                                <Send className="w-3.5 h-3.5" />
                              </button>
                            )}
                            {onReturn && (
                              <button
                                type="button"
                                onClick={() => onReturn(item)}
                                className="rounded-lg bg-slate-100 p-1.5 text-slate-500 transition-colors hover:bg-teal-50 hover:text-teal-600"
                                title="Return item"
                              >
                                <RotateCcw className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                          <div className="flex gap-1">
                            <button
                              type="button"
                              onClick={() => onEdit(item)}
                              className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700 transition-colors hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700"
                              title="Edit item details"
                            >
                              <Edit2 className="w-3 h-3" />
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => onDelete(item.id)}
                              className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-xs font-medium text-red-700 transition-colors hover:bg-red-100"
                              title="Delete item from inventory"
                            >
                              <Trash2 className="w-3 h-3" />
                              Delete
                            </button>
                          </div>
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
