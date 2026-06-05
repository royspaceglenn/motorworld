import React, { useState, useEffect, useMemo } from 'react';
import { InventoryItem, STOCK_PURPOSE_META } from '../types';
import { formatLowStockAlertThreshold, grossProfitPerUnitNumbers } from '../lib/inventoryPricing';
import { X, Sparkles, ChevronDown } from 'lucide-react';
import { generateItemDescription } from '../services/geminiService';
import { Button } from './ui/Button';
import { InlineAlert } from './ui/InlineAlert';

/** Digits only; strip leading zeros so the field shows what the user means (e.g. 255 not 0255). */
function sanitizeIntInput(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  return digits.replace(/^0+/, '');
}

/** Allow digits and one dot; strip leading zeros on the integer part (e.g. 0255.5 → 255.5). */
function sanitizeDecimalInput(raw: string): string {
  let s = raw.replace(/[^0-9.]/g, '');
  const dot = s.indexOf('.');
  if (dot !== -1) {
    s = s.slice(0, dot + 1) + s.slice(dot + 1).replace(/\./g, '');
  }
  return s.replace(/^0+(?=\d)/, '');
}

const PREDEFINED_UNITS = [
  'pcs',
  'kg',
  'liters',
  'box',
  'ream',
  'set',
  'roll',
  'meter',
  'pack',
  'bottle',
  'can',
  'pair',
  'pad',
  'booklet',
  'bundle',
  'sack',
  'gallon'
];

interface AddItemModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (item: Partial<InventoryItem>) => void | Promise<void>;
  editItem?: InventoryItem;
  existingItems: InventoryItem[];
}

const AutocompleteInput = ({ label, value, onChange, options, placeholder, required, type = "text" }: any) => {
    const [isOpen, setIsOpen] = useState(false);
    
    // Simple filter
    const filtered = options.filter((opt: string) => 
        opt.toLowerCase().includes(String(value).toLowerCase())
    );

    return (
        <div className="relative">
            {label && <label className="block text-sm font-medium text-slate-700 mb-1">{label}</label>}
            <div className="relative">
                <input
                    type={type}
                    required={required}
                    className="w-full pl-3 pr-10 py-2 bg-white text-slate-900 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 placeholder-slate-400 transition-all shadow-sm"
                    value={value}
                    onChange={(e) => {
                        onChange(e.target.value);
                        setIsOpen(true);
                    }}
                    onFocus={() => setIsOpen(true)}
                    onBlur={() => setTimeout(() => setIsOpen(false), 200)}
                    placeholder={placeholder}
                    autoComplete="off"
                />
                <button
                    type="button"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1"
                    onClick={() => setIsOpen(!isOpen)}
                    tabIndex={-1}
                >
                    <ChevronDown className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                </button>
            </div>
             {isOpen && filtered.length > 0 && (
                <div className="absolute z-50 w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-48 overflow-y-auto animate-fade-in">
                    {filtered.map((opt: string) => (
                        <button
                            key={opt}
                            type="button"
                            className="w-full text-left px-4 py-2 hover:bg-indigo-50 text-sm text-slate-700 focus:bg-indigo-50 focus:outline-none block"
                            onClick={() => {
                                onChange(opt);
                                setIsOpen(false);
                            }}
                            onMouseDown={(e) => e.preventDefault()}
                        >
                            {opt}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
};

export const AddItemModal: React.FC<AddItemModalProps> = ({ isOpen, onClose, onSave, editItem, existingItems }) => {
  const [formData, setFormData] = useState<Partial<InventoryItem>>({
    itemCode: '',
    name: '',
    brand: '',
    category: '',
    unit: 'pcs',
    quantity: 0,
    unitPrice: 0,
    capitalPrice: 0,
    description: '',
    minStockLevel: 0,
    receiptNumber: '',
    stockPurpose: 'for_sale',
  });
  const [generating, setGenerating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Text inputs avoid browser number quirks (e.g. leading 0 before digits). */
  const [qtyInput, setQtyInput] = useState('');
  const [priceInput, setPriceInput] = useState('');
  const [capitalInput, setCapitalInput] = useState('');
  const [minStockInput, setMinStockInput] = useState('');
  const [lowStockAlertOff, setLowStockAlertOff] = useState(false);

  useEffect(() => {
    setError(null);
    setSubmitting(false);
    if (editItem) {
      setFormData(editItem);
      setQtyInput(String(editItem.quantity ?? 0));
      setPriceInput(String(editItem.unitPrice ?? 0));
      setCapitalInput(String(editItem.capitalPrice ?? editItem.unitPrice ?? 0));
      const min = Number(editItem.minStockLevel ?? 0);
      setLowStockAlertOff(min < 0);
      setMinStockInput(min < 0 ? '0' : String(min));
    } else {
      setFormData({
        itemCode: '',
        name: '',
        brand: '',
        category: '',
        unit: 'pcs',
        quantity: 0,
        unitPrice: 0,
        capitalPrice: 0,
        description: '',
        minStockLevel: 0,
        receiptNumber: '',
        stockPurpose: 'for_sale',
      });
      setQtyInput('');
      setPriceInput('');
      setCapitalInput('');
      setMinStockInput('0');
      setLowStockAlertOff(false);
    }
  }, [editItem, isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!String(formData.itemCode ?? '').trim()) {
      setError('Item code is required.');
      return;
    }
    setSubmitting(true);
    try {
      const cap =
        capitalInput.trim() === ''
          ? Number(formData.unitPrice ?? 0)
          : Number(formData.capitalPrice ?? formData.unitPrice ?? 0);
      const qtyRaw = qtyInput.trim() === '' ? '0' : sanitizeIntInput(qtyInput);
      const qtyParsed = parseInt(qtyRaw === '' ? '0' : qtyRaw, 10);
      const quantity = Number.isNaN(qtyParsed) ? 0 : Math.max(0, qtyParsed);
      let minStockLevel = -1;
      if (!lowStockAlertOff) {
        const minRaw = minStockInput.trim() === '' ? '0' : sanitizeIntInput(minStockInput);
        const minParsed = parseInt(minRaw === '' ? '0' : minRaw, 10);
        minStockLevel = Number.isNaN(minParsed) ? 0 : Math.max(0, minParsed);
      }
      await Promise.resolve(
        onSave({
          ...formData,
          itemCode: String(formData.itemCode ?? '').trim().toUpperCase(),
          quantity,
          capitalPrice: cap,
          minStockLevel,
        })
      );
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save item.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleGenerateDescription = async () => {
      if (!formData.name || !formData.category) return;
      setGenerating(true);
      const desc = await generateItemDescription(formData.name, formData.category);
      if (desc) {
          setFormData(prev => ({ ...prev, description: desc }));
      }
      setGenerating(false);
  }

  const uniqueItemCodes = Array.from(
    new Set(existingItems.map((i) => i.itemCode).filter((c): c is string => Boolean(c)))
  ).sort();
  const uniqueNames = Array.from(new Set(existingItems.map(i => i.name))).sort();
  const uniqueBrands = Array.from(new Set(existingItems.map(i => i.brand).filter(b => b))).sort();
  const uniqueCategories = Array.from(new Set(existingItems.map(i => i.category))).sort();

  const unitProfitPreview = useMemo(() => {
    const retail = Number(formData.unitPrice ?? 0);
    const cap =
      capitalInput.trim() === ''
        ? retail
        : (() => {
            const n = parseFloat(capitalInput);
            return Number.isFinite(n) ? n : Number(formData.capitalPrice ?? retail);
          })();
    return grossProfitPerUnitNumbers(retail, cap);
  }, [formData.unitPrice, formData.capitalPrice, capitalInput]);
  
  // Merge predefined units with any custom units already in use
  const existingUnits = Array.from(new Set(existingItems.map(i => i.unit || '').filter(u => u)));
  const uniqueUnits = Array.from(new Set([...PREDEFINED_UNITS, ...existingUnits])).sort();

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[1050] flex items-center justify-center p-4 bg-slate-900/20 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg overflow-hidden animate-fade-in-up">
        <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
          <h2 className="text-lg font-bold text-slate-800">
            {editItem ? 'Edit Inventory Item' : 'Add New Item'}
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="overflow-y-auto max-h-[80vh]">
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
            {error && <InlineAlert message={error} />}
            <div className="grid grid-cols-2 gap-4">
                <div>
                    <AutocompleteInput
                        label="Item code"
                        value={formData.itemCode ?? ''}
                        onChange={(val: string) => setFormData({ ...formData, itemCode: val.toUpperCase() })}
                        options={uniqueItemCodes}
                        required
                        placeholder="e.g. MW-OIL-001"
                    />
                </div>

                <div>
                     <AutocompleteInput 
                        label="Product type"
                        value={formData.category}
                        onChange={(val: string) => setFormData({ ...formData, category: val })}
                        options={uniqueCategories}
                        required
                        placeholder="e.g. Engine oil"
                    />
                </div>

                <div className="col-span-2">
                    <AutocompleteInput 
                        label="Product name"
                        value={formData.name}
                        onChange={(val: string) => setFormData({ ...formData, name: val })}
                        options={uniqueNames}
                        required
                        placeholder="e.g. 5W-30 Synthetic 4L"
                    />
                </div>

                <div>
                    <AutocompleteInput 
                        label="Brand"
                        value={formData.brand}
                        onChange={(val: string) => setFormData({ ...formData, brand: val })}
                        options={uniqueBrands}
                        placeholder="e.g. Castrol"
                    />
                </div>

                <div>
                    <AutocompleteInput 
                        label="UOM"
                        value={formData.unit}
                        onChange={(val: string) => setFormData({ ...formData, unit: val })}
                        options={uniqueUnits}
                        placeholder="e.g. pcs, bottle"
                    />
                </div>

                <div className="col-span-2">
                  <span className="block text-sm font-medium text-slate-700 mb-2">Stock use</span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {(['for_sale', 'for_supply'] as const).map((key) => {
                      const meta = STOCK_PURPOSE_META[key];
                      const selected = (formData.stockPurpose ?? 'for_sale') === key;
                      return (
                        <label
                          key={key}
                          className={`flex cursor-pointer flex-col rounded-xl border p-3 transition-colors ${
                            selected
                              ? 'border-indigo-500 bg-indigo-50/60 ring-2 ring-indigo-500/30'
                              : 'border-slate-200 bg-white hover:border-slate-300'
                          }`}
                        >
                          <div className="flex items-start gap-2">
                            <input
                              type="radio"
                              name="stockPurpose"
                              className="mt-1 text-indigo-600"
                              checked={selected}
                              onChange={() => setFormData({ ...formData, stockPurpose: key })}
                            />
                            <span>
                              <span className="block text-sm font-semibold text-slate-800">{meta.label}</span>
                              <span className="mt-0.5 block text-xs text-slate-600">{meta.hint}</span>
                            </span>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>

                <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Quantity</label>
                <input
                    required
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    autoComplete="off"
                    className="w-full px-3 py-2 bg-white text-slate-900 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 placeholder-slate-400 transition-all shadow-sm disabled:bg-slate-50 disabled:text-slate-500"
                    value={qtyInput}
                    onChange={(e) => {
                      const next = sanitizeIntInput(e.target.value);
                      setQtyInput(next);
                      const n = next === '' ? 0 : parseInt(next, 10);
                      setFormData((prev) => ({ ...prev, quantity: Number.isNaN(n) ? 0 : n }));
                    }}
                />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Low stock alert at (qty)
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    autoComplete="off"
                    disabled={lowStockAlertOff}
                    className="w-full px-3 py-2 bg-white text-slate-900 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 placeholder-slate-400 transition-all shadow-sm disabled:bg-slate-100 disabled:text-slate-500"
                    value={minStockInput}
                    onChange={(e) => {
                      const next = sanitizeIntInput(e.target.value);
                      setMinStockInput(next);
                      const n = next === '' ? 0 : parseInt(next, 10);
                      setFormData((prev) => ({
                        ...prev,
                        minStockLevel: Number.isNaN(n) ? 0 : n,
                      }));
                    }}
                    placeholder="e.g. 2"
                  />
                  <p className="text-xs text-slate-500 mt-1">
                    Alert when stock is at or below this number. Use <strong>0</strong> for slow movers (only warns when
                    out of stock). Use <strong>1–2</strong> for items you always keep a small qty of.
                  </p>
                  <label className="mt-2 flex items-center gap-2 cursor-pointer text-sm text-slate-600">
                    <input
                      type="checkbox"
                      className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                      checked={lowStockAlertOff}
                      onChange={(e) => {
                        setLowStockAlertOff(e.target.checked);
                        if (e.target.checked) {
                          setFormData((prev) => ({ ...prev, minStockLevel: -1 }));
                        } else {
                          const n = parseInt(minStockInput || '0', 10);
                          setFormData((prev) => ({
                            ...prev,
                            minStockLevel: Number.isNaN(n) ? 0 : Math.max(0, n),
                          }));
                        }
                      }}
                    />
                    No low stock alert for this item
                  </label>
                  {!lowStockAlertOff && (
                    <p className="text-xs text-indigo-700/80 mt-1">
                      Current setting: warn at ≤ {formatLowStockAlertThreshold(formData.minStockLevel)} on hand
                    </p>
                  )}
                </div>

                <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Selling price (₱)</label>
                <input
                    required
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    className="w-full px-3 py-2 bg-white text-slate-900 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 placeholder-slate-400 transition-all shadow-sm"
                    value={priceInput}
                    onChange={(e) => {
                      const next = sanitizeDecimalInput(e.target.value);
                      setPriceInput(next);
                      if (next === '' || next === '.') {
                        setFormData((prev) => ({ ...prev, unitPrice: 0 }));
                        return;
                      }
                      const n = parseFloat(next);
                      setFormData((prev) => ({
                        ...prev,
                        unitPrice: Number.isFinite(n) ? n : 0,
                      }));
                    }}
                />
                </div>

                <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Capital cost (₱)</label>
                <input
                    required
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    className="w-full px-3 py-2 bg-white text-slate-900 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 placeholder-slate-400 transition-all shadow-sm"
                    value={capitalInput}
                    onChange={(e) => {
                      const next = sanitizeDecimalInput(e.target.value);
                      setCapitalInput(next);
                      if (next === '' || next === '.') {
                        setFormData((prev) => ({ ...prev, capitalPrice: 0 }));
                        return;
                      }
                      const n = parseFloat(next);
                      setFormData((prev) => ({
                        ...prev,
                        capitalPrice: Number.isFinite(n) ? n : 0,
                      }));
                    }}
                />
                <p className="text-xs text-slate-400 mt-1">Your cost per unit (COGS). Can match selling if margin is zero.</p>
                <p className="mt-2 text-sm text-slate-700">
                  <span className="font-medium text-slate-600">Unit profit (retail − capital):</span>{' '}
                  <span className={unitProfitPreview >= 0 ? 'font-semibold text-emerald-700' : 'font-semibold text-rose-600'}>
                    ₱{unitProfitPreview.toFixed(2)}
                  </span>
                </p>
                </div>

                <div className="col-span-2">
                    <label className="block text-sm font-medium text-slate-700 mb-1">Official Receipt / Invoice No. (Optional)</label>
                    <input
                        type="text"
                        className="w-full px-3 py-2 bg-white text-slate-900 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 placeholder-slate-400 transition-all shadow-sm"
                        value={formData.receiptNumber || ''}
                        onChange={(e) => setFormData({ ...formData, receiptNumber: e.target.value })}
                        placeholder="e.g. OR-12345"
                    />
                </div>

                <div className="col-span-2">
                <div className="flex justify-between items-center mb-1">
                    <label className="block text-sm font-medium text-slate-700">Description</label>
                    <button 
                        type="button" 
                        onClick={handleGenerateDescription}
                        disabled={generating || !formData.name}
                        className="text-xs flex items-center gap-1 text-indigo-600 hover:text-indigo-700 disabled:opacity-50 transition-colors"
                    >
                        <Sparkles className="w-3 h-3" />
                        {generating ? 'Generating...' : 'Auto-Generate'}
                    </button>
                </div>
                <textarea
                    className="w-full px-3 py-2 bg-white text-slate-900 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 placeholder-slate-400 h-20 resize-none transition-all shadow-sm"
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    placeholder="Optional description..."
                />
                </div>
            </div>

            <div className="flex gap-3 mt-6">
                <Button
                type="button"
                variant="secondary"
                fullWidth
                onClick={onClose}
                >
                Cancel
                </Button>
                <Button
                type="submit"
                fullWidth
                disabled={submitting}
                >
                {submitting ? 'Saving...' : editItem ? 'Save Changes' : 'Add Item'}
                </Button>
            </div>
            </form>
        </div>
      </div>
    </div>
  );
};