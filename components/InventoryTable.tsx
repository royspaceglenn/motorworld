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
  const colSpan = canEdit ? 10 : 9;
  return (
    <DashboardSurface className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/90">
              <th className="px-6 py-4 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Item Name</th>
              <th className="px-6 py-4 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Category</th>
              <th className="px-6 py-4 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Stock use</th>
              <th className="px-6 py-4 text-right text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Stock</th>
              <th className="px-6 py-4 text-right text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                <span className="inline-flex items-center gap-1" title="Items marked as defective (e.g. from Return from Sales)">
                  Defective
                </span>
              </th>
              <th className="px-6 py-4 text-right text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                <span title="Total capital (cost) for quantity on hand: qty × cost per unit.">Capital</span>
              </th>
              <th className="px-6 py-4 text-right text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                <span title="Total retail value for quantity on hand: qty × SRP per unit.">Retail price</span>
              </th>
              <th className="px-6 py-4 text-right text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                <span title="Gross profit on stock: extended retail − extended capital.">Profit</span>
              </th>
              <th className="px-6 py-4 text-right text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                <span
                  className="inline-block max-w-[8rem] text-right leading-tight"
                  title="When this item was first added to the system. Older records may match the last update time."
                >
                  Added on
                </span>
              </th>
              {canEdit && <th className="px-6 py-4 text-center text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Actions</th>}
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
                  <tr key={item.id} className="hover:bg-slate-50 transition-colors">
                    <td className="py-4 px-6">
                      <div className="flex items-center gap-3">
                        <div className="font-medium text-slate-800">{item.name}</div>
                        {isLowStock && (
                          <div className="group relative">
                            <AlertTriangle className="w-4 h-4 text-amber-500 cursor-help" />
                            <span className="absolute left-6 top-0 w-max bg-slate-800 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity z-10">
                              Low stock — at or below alert level ({alertLabel})
                            </span>
                          </div>
                        )}
                      </div>
                      {item.brand && <div className="text-xs text-slate-500 font-medium">{item.brand}</div>}
                      <div className="text-xs text-slate-400 truncate max-w-[200px]">{item.description}</div>
                    </td>
                    <td className="py-4 px-6">
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-indigo-50 text-indigo-700">
                        {item.category}
                      </span>
                    </td>
                    <td className="py-4 px-6">
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
                    <td className="py-4 px-6 text-right font-medium text-slate-700">
                      <div>{item.quantity} <span className="text-xs text-slate-400 font-normal">{item.unit || 'pcs'}</span></div>
                      {alertLabel !== 'Off' && (
                        <div className="text-xs font-normal text-slate-400">Alert ≤ {alertLabel}</div>
                      )}
                    </td>
                    <td className="py-4 px-6 text-right">
                      {(item.defectiveQuantity ?? 0) > 0 ? (
                        <span className="inline-flex items-center gap-1 font-medium text-amber-700 bg-amber-50 px-2 py-0.5 rounded text-sm" title="Inventory for return / defective">
                          {item.defectiveQuantity} <span className="text-xs text-amber-600 font-normal">{item.unit || 'pcs'}</span>
                        </span>
                      ) : (
                        <span className="text-slate-400 text-sm">—</span>
                      )}
                    </td>
                    <td
                      className="py-4 px-6 text-right font-medium text-slate-700 tabular-nums"
                      title={`Per unit: ₱${itemCapitalPerUnit(item).toFixed(2)} × ${item.quantity} ${item.unit || 'pcs'}`}
                    >
                      ₱{(item.quantity * itemCapitalPerUnit(item)).toFixed(2)}
                    </td>
                    <td
                      className="py-4 px-6 text-right font-medium text-slate-800 tabular-nums"
                      title={`Per unit: ₱${itemRetailPerUnit(item).toFixed(2)} × ${item.quantity} ${item.unit || 'pcs'}`}
                    >
                      ₱{(item.quantity * itemRetailPerUnit(item)).toFixed(2)}
                    </td>
                    <td
                      className={`py-4 px-6 text-right font-semibold tabular-nums ${
                        itemStockGrossProfit(item) >= 0 ? 'text-emerald-700' : 'text-rose-600'
                      }`}
                      title={`Per unit profit: ₱${itemUnitGrossProfit(item).toFixed(2)} × ${item.quantity} ${item.unit || 'pcs'}`}
                    >
                      ₱{itemStockGrossProfit(item).toFixed(2)}
                    </td>
                    <td className="py-4 px-6 text-right text-sm text-slate-600 whitespace-nowrap" title={item.createdAt ?? item.lastUpdated}>
                      {formatItemAddedOn(item)}
                    </td>
                    {canEdit && (
                      <td className="py-4 px-6 text-center">
                        <div className="flex items-center justify-center gap-1.5 flex-wrap">
                          <button
                            onClick={() => onAddStock(item)}
                            className="rounded-xl bg-slate-100 p-2 text-slate-500 transition-colors hover:bg-green-50 hover:text-green-600"
                            title="Restock / add stock"
                          >
                            <PackagePlus className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => onRelease(item)}
                            className="rounded-xl bg-slate-100 p-2 text-slate-500 transition-colors hover:bg-orange-50 hover:text-orange-600"
                            title="Release Stock"
                          >
                            <PackageMinus className="w-4 h-4" />
                          </button>
                          {onIssue && (
                            <button
                              onClick={() => onIssue(item)}
                              className="rounded-xl bg-slate-100 p-2 text-slate-500 transition-colors hover:bg-indigo-50 hover:text-indigo-600"
                              title="Issue Item"
                            >
                              <Send className="w-4 h-4" />
                            </button>
                          )}
                          {onReturn && (
                            <button
                              onClick={() => onReturn(item)}
                              className="rounded-xl bg-slate-100 p-2 text-slate-500 transition-colors hover:bg-teal-50 hover:text-teal-600"
                              title="Return Item"
                            >
                              <RotateCcw className="w-4 h-4" />
                            </button>
                          )}
                          <button
                            onClick={() => onEdit(item)}
                            className="rounded-xl bg-slate-100 p-2 text-slate-500 transition-colors hover:bg-blue-50 hover:text-blue-600"
                            title="Edit Item"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => onDelete(item.id)}
                            className="rounded-xl bg-slate-100 p-2 text-slate-500 transition-colors hover:bg-red-50 hover:text-red-600"
                            title="Delete Item"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
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