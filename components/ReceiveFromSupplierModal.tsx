import React, { useState, useEffect } from 'react';
import { Supplier, PurchaseLineItem, InventoryItem, PurchaseDiscountMode } from '../types';
import { suppliersApi } from '../lib/api/adminData';
import { X, PackagePlus, Plus, Trash2, ChevronDown } from 'lucide-react';
import { Button } from './ui/Button';
import { InlineAlert } from './ui/InlineAlert';

interface ReceiveFromSupplierModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (data: {
    supplierId: string;
    supplierName: string;
    paymentType: 'cash' | 'accounts_payable';
    receiptNumber?: string;
    note?: string;
    lineItems: PurchaseLineItem[];
    purchaseDiscountMode: PurchaseDiscountMode;
    purchaseDiscountValue: number;
  }) => void | Promise<void>;
  suppliers: Supplier[];
  items: InventoryItem[];
  onSupplierCreated?: () => void;
}

const emptyLine: PurchaseLineItem = {
  itemId: '',
  itemName: '',
  quantity: 0,
  unitCost: 0,
  sellingPrice: 0,
  total: 0,
};

export const ReceiveFromSupplierModal: React.FC<ReceiveFromSupplierModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  suppliers,
  items,
  onSupplierCreated,
}) => {
  const [supplierInput, setSupplierInput] = useState('');
  const [selectedSupplierId, setSelectedSupplierId] = useState<string | null>(null);
  const [isSupplierDropdownOpen, setIsSupplierDropdownOpen] = useState(false);
  // New supplier fields (when not selecting existing)
  const [newContact, setNewContact] = useState('');
  const [newAddress, setNewAddress] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newTin, setNewTin] = useState('');
  const [paymentType, setPaymentType] = useState<'cash' | 'accounts_payable'>('cash');
  const [receiptNumber, setReceiptNumber] = useState('');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<PurchaseLineItem[]>([{ ...emptyLine }]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [purchaseDiscountMode, setPurchaseDiscountMode] = useState<PurchaseDiscountMode>('none');
  const [purchaseDiscountValue, setPurchaseDiscountValue] = useState(0);

  useEffect(() => {
    if (isOpen) {
      setSupplierInput('');
      setSelectedSupplierId(null);
      setNewContact('');
      setNewAddress('');
      setNewEmail('');
      setNewTin('');
      setPaymentType('cash');
      setReceiptNumber('');
      setNote('');
      setLines([{ ...emptyLine }]);
      setPurchaseDiscountMode('none');
      setPurchaseDiscountValue(0);
      setIsSupplierDropdownOpen(false);
      setError(null);
    }
  }, [isOpen]);

  const selectedSupplier = selectedSupplierId ? suppliers.find((s) => s.id === selectedSupplierId) : null;
  const supplierSuggestions = supplierInput.trim()
    ? suppliers.filter((s) => s.name.toLowerCase().includes(supplierInput.trim().toLowerCase()))
    : suppliers;
  const isNewSupplier = !selectedSupplierId && supplierInput.trim().length > 0;

  const displayName = selectedSupplier ? selectedSupplier.name : supplierInput;

  const updateLine = (index: number, updates: Partial<PurchaseLineItem>) => {
    setLines((prev) => {
      const next = [...prev];
      const line = { ...next[index], ...updates };
      if (line.itemId && line.quantity >= 0 && line.unitCost >= 0) {
        line.total = line.quantity * line.unitCost;
      }
      next[index] = line;
      return next;
    });
  };

  const addLine = () => setLines((prev) => [...prev, { ...emptyLine }]);
  const removeLine = (index: number) => setLines((prev) => prev.filter((_, i) => i !== index));

  const handleItemSelect = (index: number, itemId: string) => {
    const item = items.find((i) => i.id === itemId);
    if (item) {
      const cap = item.capitalPrice ?? item.unitPrice ?? 0;
      const sell = item.unitPrice ?? 0;
      updateLine(index, { itemId: item.id, itemName: item.name, unitCost: cap, sellingPrice: sell });
    } else updateLine(index, { itemId: itemId || '', itemName: '', unitCost: 0, sellingPrice: 0 });
  };

  const validLines = lines.filter((l) => l.itemId && l.quantity > 0 && l.unitCost >= 0);
  const totalReceiveQuantity = validLines.reduce((s, l) => s + l.quantity, 0);
  const merchandiseSubtotal = lines.reduce((s, l) => s + (l.total ?? 0), 0);
  const expectedRevenue = validLines.reduce((s, l) => s + l.quantity * (l.sellingPrice ?? 0), 0);
  let discountTotal = 0;
  if (purchaseDiscountMode === 'percent' && purchaseDiscountValue > 0) {
    discountTotal = merchandiseSubtotal * (Math.min(100, purchaseDiscountValue) / 100);
  } else if (purchaseDiscountMode === 'amount' && purchaseDiscountValue > 0) {
    const rawAmountDiscount = purchaseDiscountValue * totalReceiveQuantity;
    discountTotal = Math.min(merchandiseSubtotal, rawAmountDiscount);
  }
  const netMerchandiseCost = merchandiseSubtotal - discountTotal;
  const expectedNetProfit = expectedRevenue - netMerchandiseCost;
  const hasValidSupplier = selectedSupplierId
    ? true
    : isNewSupplier && supplierInput.trim().length > 0;
  const canSubmit = hasValidSupplier && validLines.length > 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      let supplierId: string;
      let supplierName: string;
      if (selectedSupplierId && selectedSupplier) {
        supplierId = selectedSupplier.id;
        supplierName = selectedSupplier.name;
      } else {
        const created = await suppliersApi.create({
          name: supplierInput.trim(),
          contactNumber: newContact.trim() || undefined,
          address: newAddress.trim() || undefined,
          email: newEmail.trim() || undefined,
          tin: newTin.trim() || undefined,
        });
        supplierId = created.id;
        supplierName = created.name;
        onSupplierCreated?.();
      }
      await Promise.resolve(onConfirm({
        supplierId,
        supplierName,
        paymentType,
        receiptNumber: receiptNumber.trim() || undefined,
        note: note.trim() || undefined,
        lineItems: validLines.map((l) => ({ ...l, total: l.quantity * l.unitCost })),
        purchaseDiscountMode,
        purchaseDiscountValue,
      }));
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to receive items.');
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/20 backdrop-blur-sm overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-hidden animate-fade-in-up my-auto flex flex-col">
        <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-emerald-50 shrink-0">
          <div className="flex items-center gap-2">
            <div className="bg-emerald-100 p-2 rounded-lg">
              <PackagePlus className="w-5 h-5 text-emerald-600" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-800">Receive from Supplier</h2>
              <p className="text-xs text-slate-500">Type supplier name to pick existing or add new; details auto-fill when existing.</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col min-h-0 flex-1 overflow-hidden">
          <div className="p-6 space-y-4 overflow-y-auto min-h-0">
            {error && <InlineAlert message={error} />}
            {/* Supplier: type to search or add new */}
            <div className="relative">
              <label className="block text-sm font-medium text-slate-700 mb-1">Supplier <span className="text-red-500">*</span></label>
              <input
                type="text"
                className="w-full px-3 py-2 pr-10 bg-white border border-slate-200 rounded-lg focus:ring-2 focus:ring-emerald-500"
                placeholder="Type supplier name to search or add new..."
                value={selectedSupplierId ? (suppliers.find((s) => s.id === selectedSupplierId)?.name ?? supplierInput) : supplierInput}
                onChange={(e) => {
                  setSupplierInput(e.target.value);
                  setSelectedSupplierId(null);
                  setIsSupplierDropdownOpen(true);
                }}
                onFocus={() => setIsSupplierDropdownOpen(true)}
                onBlur={() => setTimeout(() => setIsSupplierDropdownOpen(false), 200)}
              />
              <ChevronDown className="absolute right-3 top-9 w-4 h-4 text-slate-400 pointer-events-none" />
              {isSupplierDropdownOpen && supplierSuggestions.length > 0 && (
                <div className="absolute z-10 w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                  {supplierSuggestions.slice(0, 20).map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      className="w-full text-left px-4 py-2.5 hover:bg-emerald-50 text-sm border-b border-slate-50 last:border-0 flex flex-col"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        setSelectedSupplierId(s.id);
                        setSupplierInput(s.name);
                        setIsSupplierDropdownOpen(false);
                      }}
                    >
                      <span className="font-medium text-slate-800">{s.name}</span>
                      {(s.contactNumber || s.tin) && (
                        <span className="text-xs text-slate-500 mt-0.5">
                          {[s.contactNumber, s.tin ? `TIN: ${s.tin}` : ''].filter(Boolean).join(' · ')}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Supplier details: show when existing (read-only) or when new (editable) */}
            {(selectedSupplier || isNewSupplier) && (
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-3">
                <h4 className="text-sm font-medium text-slate-700">Supplier details</h4>
                {selectedSupplier ? (
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div><span className="text-slate-500">Name</span><div className="font-medium text-slate-800">{selectedSupplier.name}</div></div>
                    {selectedSupplier.contactNumber && <div><span className="text-slate-500">Contact</span><div className="text-slate-800">{selectedSupplier.contactNumber}</div></div>}
                    {selectedSupplier.address && <div className="col-span-2"><span className="text-slate-500">Address</span><div className="text-slate-800">{selectedSupplier.address}</div></div>}
                    {selectedSupplier.email && <div><span className="text-slate-500">Email</span><div className="text-slate-800">{selectedSupplier.email}</div></div>}
                    {selectedSupplier.tin && <div><span className="text-slate-500">TIN</span><div className="text-slate-800">{selectedSupplier.tin}</div></div>}
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div className="col-span-2">
                      <label className="block text-slate-500 mb-0.5">Name (from above)</label>
                      <div className="font-medium text-slate-800">{supplierInput.trim() || '—'}</div>
                    </div>
                    <div>
                      <label className="block text-slate-500 mb-0.5">Contact number</label>
                      <input type="text" className="w-full px-2 py-1.5 border border-slate-200 rounded" value={newContact} onChange={(e) => setNewContact(e.target.value)} placeholder="Optional" />
                    </div>
                    <div>
                      <label className="block text-slate-500 mb-0.5">TIN (Tax Identification No.)</label>
                      <input type="text" className="w-full px-2 py-1.5 border border-slate-200 rounded" value={newTin} onChange={(e) => setNewTin(e.target.value)} placeholder="Business TIN" />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-slate-500 mb-0.5">Address</label>
                      <input type="text" className="w-full px-2 py-1.5 border border-slate-200 rounded" value={newAddress} onChange={(e) => setNewAddress(e.target.value)} placeholder="Optional" />
                    </div>
                    <div>
                      <label className="block text-slate-500 mb-0.5">Email</label>
                      <input type="email" className="w-full px-2 py-1.5 border border-slate-200 rounded" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="Optional" />
                    </div>
                  </div>
                )}
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Payment classification <span className="text-red-500">*</span></label>
              <div className="flex gap-6">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="paymentType" value="cash" checked={paymentType === 'cash'} onChange={() => setPaymentType('cash')} className="text-emerald-600 focus:ring-emerald-500" />
                  <span className="text-slate-700">Cash (paid)</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="paymentType" value="accounts_payable" checked={paymentType === 'accounts_payable'} onChange={() => setPaymentType('accounts_payable')} className="text-emerald-600 focus:ring-emerald-500" />
                  <span className="text-slate-700">Accounts Payable (to be paid)</span>
                </label>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Receipt / Invoice #</label>
                <input type="text" className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg focus:ring-2 focus:ring-emerald-500" value={receiptNumber} onChange={(e) => setReceiptNumber(e.target.value)} placeholder="e.g. INV-001" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Note</label>
                <input type="text" className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg focus:ring-2 focus:ring-emerald-500" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Supplier discount</label>
              <div className="flex flex-wrap gap-3 items-end">
                <select
                  className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500"
                  value={purchaseDiscountMode}
                  onChange={(e) => setPurchaseDiscountMode(e.target.value as PurchaseDiscountMode)}
                >
                  <option value="none">No discount</option>
                  <option value="percent">Percentage off merchandise</option>
                  <option value="amount">Fixed amount off per unit (₱)</option>
                </select>
                {purchaseDiscountMode !== 'none' && (
                  <div className="flex-1 min-w-[120px]">
                    <label className="block text-xs text-slate-500 mb-0.5">
                      {purchaseDiscountMode === 'percent' ? 'Percent (0–100)' : 'Amount per unit (₱)'}
                    </label>
                    <input
                      type="number"
                      min={0}
                      step={purchaseDiscountMode === 'percent' ? 0.1 : 0.01}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-emerald-500"
                      value={purchaseDiscountValue || ''}
                      onChange={(e) => setPurchaseDiscountValue(Number(e.target.value) || 0)}
                    />
                  </div>
                )}
              </div>
              <p className="text-xs text-slate-500 mt-1">
                Discount lowers the net cost of this receive; estimated profit uses your selling prices vs. net cost.
                {purchaseDiscountMode === 'amount' && (
                  <span className="block mt-0.5">
                    Fixed amount is <strong>per unit</strong> (multiplied by total quantity across all valid lines,
                    capped at merchandise subtotal).
                  </span>
                )}
              </p>
            </div>

            <div>
              <div className="flex justify-between items-center mb-2">
                <label className="block text-sm font-medium text-slate-700">
                  Line items <span className="text-red-500">*</span>
                </label>
                <button type="button" onClick={addLine} className="text-sm text-emerald-600 hover:text-emerald-700 flex items-center gap-1">
                  <Plus className="w-4 h-4" /> Add line
                </button>
              </div>
              <div className="border border-slate-200 rounded-lg overflow-x-auto">
                <table className="w-full text-sm min-w-[640px]">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="text-left py-2 px-3 font-medium text-slate-600">Item</th>
                      <th className="text-right py-2 px-3 font-medium text-slate-600 w-20">Qty</th>
                      <th className="text-right py-2 px-3 font-medium text-slate-600 w-28">Capital (₱)</th>
                      <th className="text-right py-2 px-3 font-medium text-slate-600 w-28">Selling (₱)</th>
                      <th className="text-right py-2 px-3 font-medium text-slate-600 w-28">Merch. total</th>
                      <th className="text-right py-2 px-3 font-medium text-slate-600 w-28">Est. margin</th>
                      <th className="w-10" />
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((line, idx) => {
                      const lineMerch = (line.quantity ?? 0) * (line.unitCost ?? 0);
                      const lineRev = (line.quantity ?? 0) * (line.sellingPrice ?? 0);
                      const lineMargin = lineRev - lineMerch;
                      return (
                      <tr key={idx} className="border-t border-slate-100">
                        <td className="py-1 px-3">
                          <select className="w-full px-2 py-1.5 border border-slate-200 rounded focus:ring-1 focus:ring-emerald-500" value={line.itemId} onChange={(e) => handleItemSelect(idx, e.target.value)}>
                            <option value="">Select item...</option>
                            {items.map((i) => (
                              <option key={i.id} value={i.id}>{i.name}</option>
                            ))}
                          </select>
                        </td>
                        <td className="py-1 px-3 text-right">
                          <input type="number" min={1} className="w-full px-2 py-1.5 border border-slate-200 rounded text-right focus:ring-1 focus:ring-emerald-500" value={line.quantity || ''} onChange={(e) => updateLine(idx, { quantity: Number(e.target.value) || 0 })} />
                        </td>
                        <td className="py-1 px-3 text-right">
                          <input type="number" min={0} step={0.01} className="w-full px-2 py-1.5 border border-slate-200 rounded text-right focus:ring-1 focus:ring-emerald-500" value={line.unitCost || ''} onChange={(e) => updateLine(idx, { unitCost: Number(e.target.value) || 0 })} />
                        </td>
                        <td className="py-1 px-3 text-right">
                          <input type="number" min={0} step={0.01} className="w-full px-2 py-1.5 border border-slate-200 rounded text-right focus:ring-1 focus:ring-emerald-500" value={line.sellingPrice || ''} onChange={(e) => updateLine(idx, { sellingPrice: Number(e.target.value) || 0 })} />
                        </td>
                        <td className="py-1 px-3 text-right font-medium text-slate-800">₱{lineMerch.toFixed(2)}</td>
                        <td className={`py-1 px-3 text-right font-medium ${lineMargin >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>₱{lineMargin.toFixed(2)}</td>
                        <td className="py-1 px-1">
                          {lines.length > 1 && (
                            <button type="button" onClick={() => removeLine(idx)} className="p-1 text-slate-400 hover:text-red-600">
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50/80 p-3 text-sm space-y-1">
                <div className="flex justify-between text-slate-600">
                  <span>Merchandise subtotal (supplier list)</span>
                  <span className="font-medium">₱{merchandiseSubtotal.toFixed(2)}</span>
                </div>
                {discountTotal > 0 && (
                  <div className="flex justify-between text-amber-800">
                    <span>Invoice discount</span>
                    <span>−₱{discountTotal.toFixed(2)}</span>
                  </div>
                )}
                <div className="flex justify-between font-semibold text-slate-800 border-t border-slate-200 pt-1">
                  <span>Net cost (payable basis)</span>
                  <span>₱{netMerchandiseCost.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>Expected revenue at selling prices</span>
                  <span className="font-medium">₱{expectedRevenue.toFixed(2)}</span>
                </div>
                <div className={`flex justify-between font-semibold ${expectedNetProfit >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                  <span>Est. net profit (after discount)</span>
                  <span>₱{expectedNetProfit.toFixed(2)}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="flex gap-3 p-6 pt-0 shrink-0">
            <Button type="button" variant="secondary" fullWidth onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              fullWidth
              disabled={!canSubmit || submitting}
              className="bg-emerald-600 hover:bg-emerald-700 focus:ring-emerald-500"
            >
              {submitting ? 'Saving...' : 'Receive & Move to Inventory'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};
