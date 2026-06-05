import React, { useState, useMemo } from 'react';
import { InventoryItem, Transaction, STOCK_PURPOSE_META, normalizeStockPurpose } from '../types';
import { StatsCard } from './StatsCard';
import { DashboardSurface } from './ui/DashboardPrimitives';
import { Package, TrendingUp, TrendingDown, DollarSign, AlertOctagon, CalendarClock, ChevronDown } from 'lucide-react';

interface ItemDetailsProps {
  items: InventoryItem[];
  transactions: Transaction[];
}

function itemPickerLabel(item: InventoryItem): string {
  const code = item.itemCode?.trim();
  const name = item.brand ? `${item.name} (${item.brand})` : item.name;
  return code ? `${code} · ${name}` : name;
}

export const ItemDetails: React.FC<ItemDetailsProps> = ({ items, transactions }) => {
  const [selectedItemId, setSelectedItemId] = useState<string>('');
  const [searchInput, setSearchInput] = useState('');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  const selectedItem = items.find((i) => i.id === selectedItemId);

  const sortedItems = useMemo(
    () => [...items].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })),
    [items]
  );

  const filteredItems = useMemo(() => {
    const q = searchInput.trim().toLowerCase();
    if (!q) return sortedItems;
    return sortedItems.filter((item) => {
      const hay = [item.itemCode, item.name, item.brand, item.category, item.description]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [sortedItems, searchInput]);

  const itemStats = useMemo(() => {
    if (!selectedItem) return null;
    const itemTrans = transactions.filter(t => t.itemId === selectedItemId);
    
    const totalAdded = itemTrans
        .filter(t => t.type === 'ADDITION')
        .reduce((acc, t) => acc + t.quantityChange, 0);
        
    const totalReleased = itemTrans
        .filter(t => t.type === 'RELEASE' || t.type === 'ISSUE')
        .reduce((acc, t) => acc + Math.abs(t.quantityChange), 0);

    const totalReleasedValue = itemTrans
        .filter(t => t.type === 'RELEASE' || t.type === 'ISSUE')
        .reduce((acc, t) => acc + t.totalValue, 0);

    const totalReturned = itemTrans
        .filter(t => t.type === 'RETURN' || t.type === 'RETURN_FROM_SALES')
        .reduce((acc, t) => acc + Math.abs(t.quantityChange), 0);

    return {
        totalAdded: totalAdded + totalReturned,
        totalReleased,
        totalReleasedValue
    };
  }, [selectedItem, transactions, selectedItemId]);

  const itemAddedTimestamp = useMemo(() => {
    if (!selectedItem) return null;
    if (selectedItem.createdAt) return selectedItem.createdAt;
    const additions = transactions.filter((t) => t.itemId === selectedItem.id && t.type === 'ADDITION');
    if (additions.length === 0) return selectedItem.lastUpdated;
    return additions.reduce((earliest, t) =>
      new Date(t.timestamp) < new Date(earliest) ? t.timestamp : earliest,
      additions[0].timestamp
    );
  }, [selectedItem, transactions]);

  const itemAddedLabel = useMemo(() => {
    if (!itemAddedTimestamp) return '—';
    try {
      return new Date(itemAddedTimestamp).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    } catch {
      return '—';
    }
  }, [itemAddedTimestamp]);

  const itemHistory = useMemo(() => {
      if (!selectedItemId) return [];
      return transactions.filter(t => t.itemId === selectedItemId).sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }, [selectedItemId, transactions]);

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
        <label className="block text-sm font-medium text-slate-700 mb-2">Select Item to View Details</label>
        <div className="relative w-full md:max-w-xl">
          <input
            type="text"
            className="w-full px-4 py-2.5 pr-10 bg-white text-slate-900 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all shadow-sm placeholder:text-slate-400"
            placeholder="Search or select an item…"
            value={
              selectedItemId && !isDropdownOpen && selectedItem
                ? itemPickerLabel(selectedItem)
                : searchInput
            }
            onChange={(e) => {
              setSearchInput(e.target.value);
              setSelectedItemId('');
              setIsDropdownOpen(true);
            }}
            onFocus={() => {
              setIsDropdownOpen(true);
              if (selectedItemId && selectedItem) {
                setSearchInput(itemPickerLabel(selectedItem));
              }
            }}
            onBlur={() => setTimeout(() => setIsDropdownOpen(false), 200)}
            autoComplete="off"
          />
          <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
          {isDropdownOpen && (
            <div className="absolute z-20 w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-64 overflow-y-auto">
              {filteredItems.length === 0 ? (
                <div className="px-4 py-3 text-sm text-slate-500">No items match your search.</div>
              ) : (
                filteredItems.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`w-full text-left px-4 py-2.5 hover:bg-indigo-50 text-sm border-b border-slate-50 last:border-0 ${
                      item.id === selectedItemId ? 'bg-indigo-50/80' : ''
                    }`}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      setSelectedItemId(item.id);
                      setSearchInput(itemPickerLabel(item));
                      setIsDropdownOpen(false);
                    }}
                  >
                    <div className="font-medium text-slate-800">{itemPickerLabel(item)}</div>
                    <div className="text-xs text-slate-500 mt-0.5 flex flex-wrap gap-x-2">
                      <span>{item.category}</span>
                      <span>
                        Stock: {item.quantity} {item.unit || 'pcs'}
                      </span>
                    </div>
                  </button>
                ))
              )}
            </div>
          )}
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Type to filter the list, then pick an item below to view stock stats and transaction history.
        </p>
      </div>

      {selectedItem && itemStats && (
        <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-6">
                 <StatsCard 
                  title="Current Stock" 
                  value={`${selectedItem.quantity} ${selectedItem.unit || 'pcs'}`}
                  icon={Package} 
                  colorClass="bg-blue-500"
                />
                 <StatsCard 
                  title="Defective (Inventory for Return)" 
                  value={(selectedItem.defectiveQuantity ?? 0) > 0 ? `${selectedItem.defectiveQuantity} ${selectedItem.unit || 'pcs'}` : '0'}
                  icon={AlertOctagon} 
                  colorClass="bg-amber-500"
                />
                 <StatsCard 
                  title="Current Total Value" 
                  value={`₱${(selectedItem.quantity * selectedItem.unitPrice).toFixed(2)}`} 
                  icon={DollarSign} 
                  colorClass="bg-green-500"
                />
                 <StatsCard 
                  title="Total Added (Lifetime)" 
                  value={itemStats.totalAdded} 
                  icon={TrendingUp} 
                  colorClass="bg-indigo-500"
                />
                 <StatsCard 
                  title="Total Released (Lifetime)" 
                  value={itemStats.totalReleased} 
                  icon={TrendingDown} 
                  colorClass="bg-orange-500"
                />
                <DashboardSurface className="p-5 sm:p-6">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-600">Added to system</p>
                      <p className="mt-2 text-sm font-semibold leading-snug text-slate-900 sm:text-base">{itemAddedLabel}</p>
                      <p className="mt-2 text-xs text-slate-500">
                        When this SKU was first recorded. Older data may use the earliest stock addition or last update.
                      </p>
                    </div>
                    <div className="shrink-0 rounded-2xl bg-slate-100 p-2 text-slate-600">
                      <CalendarClock className="h-5 w-5" />
                    </div>
                  </div>
                </DashboardSurface>
            </div>

            {selectedItem && (
              <div className="rounded-xl border border-slate-100 bg-slate-50/80 px-4 py-3 text-sm text-slate-700">
                <span className="font-medium text-slate-600">Stock use: </span>
                <span
                  className={`ml-1 inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                    STOCK_PURPOSE_META[normalizeStockPurpose(selectedItem.stockPurpose)].badgeClass
                  }`}
                >
                  {STOCK_PURPOSE_META[normalizeStockPurpose(selectedItem.stockPurpose)].label}
                </span>
                <span className="mt-1 block text-xs text-slate-500">
                  {STOCK_PURPOSE_META[normalizeStockPurpose(selectedItem.stockPurpose)].hint}
                </span>
              </div>
            )}

            <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
                <div className="p-6 border-b border-slate-100">
                    <h3 className="font-bold text-slate-800">Transaction History: {selectedItem.name}</h3>
                    {selectedItem.brand && <p className="text-sm text-slate-500">Brand: {selectedItem.brand}</p>}
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                    <thead className="bg-slate-50">
                        <tr>
                        <th className="py-3 px-6 text-xs font-semibold uppercase text-slate-500">Date</th>
                        <th className="py-3 px-6 text-xs font-semibold uppercase text-slate-500">Type</th>
                        <th className="py-3 px-6 text-xs font-semibold uppercase text-slate-500 text-right">Quantity</th>
                        <th className="py-3 px-6 text-xs font-semibold uppercase text-slate-500 text-right">Unit Price</th>
                        <th className="py-3 px-6 text-xs font-semibold uppercase text-slate-500 text-right">Total</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {itemHistory.length === 0 ? (
                            <tr><td colSpan={5} className="py-4 text-center text-slate-400">No history found.</td></tr>
                        ) : (
                            itemHistory.map(t => (
                                <tr key={t.id} className="hover:bg-slate-50">
                                    <td className="py-3 px-6 text-sm text-slate-600">{new Date(t.timestamp).toLocaleDateString()}</td>
                                    <td className="py-3 px-6">
                                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium 
                                            ${t.type === 'ADDITION' ? 'bg-green-100 text-green-700' : 
                                                t.type === 'RETURN' || t.type === 'RETURN_FROM_SALES' ? 'bg-teal-100 text-teal-700' :
                                                t.type === 'RELEASE' ? 'bg-orange-100 text-orange-700' : 
                                                t.type === 'ISSUE' ? 'bg-indigo-100 text-indigo-700' : 'bg-blue-100 text-blue-700'}`}>
                                            {t.type === 'RETURN_FROM_SALES' ? 'Return from Sales' : t.type === 'ADDITION' ? 'ADDITION (restock)' : t.type}
                                        </span>
                                        {t.type === 'ADDITION' && t.editedAt && (
                                            <div className="text-[10px] text-amber-800 font-medium mt-1">
                                                Edited {new Date(t.editedAt).toLocaleString()}
                                                {t.editNote ? <span className="font-normal text-slate-600"> — {t.editNote}</span> : null}
                                            </div>
                                        )}
                                        {(t.returnReasonText || t.note) && (
                                            <div className="text-[10px] text-slate-500 mt-1">Reason: {t.returnReasonText || t.note}</div>
                                        )}
                                    </td>
                                    <td className="py-3 px-6 text-sm text-right text-slate-700">{Math.abs(t.quantityChange)}</td>
                                    <td className="py-3 px-6 text-sm text-right text-slate-600">₱{t.unitPriceAtTime.toFixed(2)}</td>
                                    <td className="py-3 px-6 text-sm text-right font-medium text-slate-800">₱{t.totalValue.toFixed(2)}</td>
                                </tr>
                            ))
                        )}
                    </tbody>
                    </table>
                </div>
            </div>
        </>
      )}
    </div>
  );
};