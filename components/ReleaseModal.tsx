import React, { useState, useEffect } from 'react';
import { InventoryItem, Person, Vehicle } from '../types';
import { personsApi, vehiclesApi } from '../lib/api/adminData';
import { todayDateInputValue } from '../lib/transactionDate';
import { X, ArrowUpRight, ChevronDown } from 'lucide-react';
import { Button } from './ui/Button';
import { InlineAlert } from './ui/InlineAlert';

const MODE_OF_PAYMENT_OPTIONS = ['Cash', 'Credit', 'GCash', 'Bank Transfer', 'Others'] as const;

export type SaleItemType = 'Product' | 'Service';

interface ReleaseModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (
    itemType: SaleItemType,
    itemId: string | null,
    itemName: string,
    quantity: number,
    price: number,
    recipient: string,
    note: string,
    modeOfPayment: string,
    modeOfPaymentOther?: string,
    dueDays?: number,
    creditOptions?: { downPayment: number; interestRate: number; paymentSchedule: 'weekly' | 'monthly' },
    personId?: string,
    vehicleId?: string,
    /** YYYY-MM-DD — actual sale date for reports and receivables. */
    transactionDate?: string
  ) => void | Promise<void>;
  item: InventoryItem | null;
  items: InventoryItem[];
  persons: Person[];
  vehicles: Vehicle[];
  /** Called when a new person is created from a typed customer name (so parent can refetch persons). */
  onPersonCreated?: () => void;
  /** Called when a new vehicle is created from a typed plate (so parent can refetch vehicles). */
  onVehicleCreated?: () => void;
}

export const ReleaseModal: React.FC<ReleaseModalProps> = ({ isOpen, onClose, onConfirm, item, items, persons, vehicles, onPersonCreated, onVehicleCreated }) => {
  const [selectedItemId, setSelectedItemId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [price, setPrice] = useState(0);
  const [selectedPersonId, setSelectedPersonId] = useState('');
  const [selectedVehicleId, setSelectedVehicleId] = useState('');
  const [vehicleInput, setVehicleInput] = useState('');
  const [customerInput, setCustomerInput] = useState('');
  const [recipient, setRecipient] = useState('');
  const [note, setNote] = useState('');
  const [modeOfPayment, setModeOfPayment] = useState<string>('');
  const [modeOfPaymentOther, setModeOfPaymentOther] = useState('');
  const [dueDays, setDueDays] = useState(30);
  const [downPayment, setDownPayment] = useState(0);
  const [interestRate, setInterestRate] = useState<number | ''>('');
  const [paymentSchedule, setPaymentSchedule] = useState<'weekly' | 'monthly'>('monthly');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isPersonDropdownOpen, setIsPersonDropdownOpen] = useState(false);
  const [isVehicleDropdownOpen, setIsVehicleDropdownOpen] = useState(false);
  const [itemSearch, setItemSearch] = useState('');
  const [itemType, setItemType] = useState<SaleItemType>('Product');
  const [serviceName, setServiceName] = useState('');
  const [servicePrice, setServicePrice] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transactionDate, setTransactionDate] = useState(todayDateInputValue);

  const vehiclesForSelectedPerson = selectedPersonId
    ? vehicles.filter((v) => v.personId === selectedPersonId)
    : [];

  // Determine which item is active (either passed as prop or selected via dropdown)
  const activeItem = item || items.find(i => i.id === selectedItemId);

  // Reset or initialize values when modal opens or item changes
  useEffect(() => {
    if (isOpen) {
      setSubmitting(false);
      setError(null);
      setTransactionDate(todayDateInputValue());
      if (item) {
        setItemType('Product');
        setPrice(item.unitPrice);
        setQuantity(1);
        setServiceName('');
        setServicePrice(0);
        setNote('');
        setSelectedPersonId('');
        setCustomerInput('');
        setSelectedVehicleId('');
        setVehicleInput('');
        setRecipient('');
        setModeOfPayment('');
        setModeOfPaymentOther('');
        setDueDays(30);
        setDownPayment(0);
        setInterestRate('');
        setPaymentSchedule('monthly');
        setSelectedItemId(item.id);
        setItemSearch(item.name);
      } else {
        setItemType('Product');
        setPrice(0);
        setQuantity(1);
        setServiceName('');
        setServicePrice(0);
        setNote('');
        setSelectedPersonId('');
        setCustomerInput('');
        setSelectedVehicleId('');
        setVehicleInput('');
        setRecipient('');
        setModeOfPayment('');
        setModeOfPaymentOther('');
        setDueDays(30);
        setDownPayment(0);
        setInterestRate('');
        setPaymentSchedule('monthly');
        setSelectedItemId('');
        setItemSearch('');
      }
    }
  }, [item, isOpen]);

  // Update price when a new item is selected in dropdown
  useEffect(() => {
      const i = items.find(it => it.id === selectedItemId);
      if (i) {
          setPrice(i.unitPrice);
      }
  }, [selectedItemId, items]);


  if (!isOpen) return null;

  const resolvePersonId = (): Promise<string | null> => {
    if (selectedPersonId) return Promise.resolve(selectedPersonId);
    const name = customerInput.trim();
    if (!name) return Promise.resolve(null);
    const found = persons.find((p) => (p.fullName ?? '').trim().toLowerCase() === name.toLowerCase());
    if (found) return Promise.resolve(found.id);
    return personsApi.create({ fullName: name, contactNumber: '' })
      .then((saved) => {
        onPersonCreated?.();
        return saved.id;
      })
      .catch(() => null);
  };

  const resolveVehicleId = (personId: string): Promise<string | undefined> => {
    if (selectedVehicleId) {
      const v = vehicles.find((x) => x.id === selectedVehicleId && x.personId === personId);
      if (v) return Promise.resolve(v.id);
    }
    const plate = vehicleInput.trim();
    if (!plate) return Promise.resolve(undefined);
    const forPerson = vehicles.filter((v) => v.personId === personId);
    const found = forPerson.find(
      (v) => v.plateNumber.trim().toLowerCase() === plate.toLowerCase()
    );
    if (found) return Promise.resolve(found.id);
    return vehiclesApi.create({ personId, plateNumber: plate })
      .then((saved) => {
        onVehicleCreated?.();
        return saved.id;
      })
      .catch((err) => {
        throw new Error(err instanceof Error ? err.message : 'Could not save vehicle.');
      });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!modeOfPayment) return;
    const hasCustomer = selectedPersonId || customerInput.trim();
    if (!hasCustomer) return;
    setError(null);
    setSubmitting(true);
    try {
      const personId = await resolvePersonId();
      if (!personId) throw new Error('Could not resolve customer.');

      const vehicleId = await resolveVehicleId(personId);
      const selectedPerson = persons.find((p) => p.id === personId);
      const recipientName = recipient.trim() || selectedPerson?.fullName || customerInput.trim();
      const other = modeOfPayment === 'Others' ? modeOfPaymentOther : undefined;
      const days = modeOfPayment === 'Credit' ? dueDays : undefined;
      const creditOpts = modeOfPayment === 'Credit'
        ? { downPayment, interestRate: Number(interestRate) || 0, paymentSchedule }
        : undefined;

      if (itemType === 'Product') {
        if (!activeItem || quantity <= 0 || quantity > (activeItem?.quantity ?? 0)) {
          throw new Error('Select a valid item and quantity.');
        }
        await Promise.resolve(
          onConfirm(
            itemType,
            activeItem.id,
            activeItem.name,
            quantity,
            price,
            recipientName,
            note,
            modeOfPayment,
            other,
            days,
            creditOpts,
            personId,
            vehicleId,
            transactionDate
          )
        );
      } else {
        const name = serviceName.trim();
        const qty = Math.max(1, quantity);
        const pr = servicePrice >= 0 ? servicePrice : 0;
        if (!name) throw new Error('Enter a servicing name.');
        await Promise.resolve(
          onConfirm(
            itemType,
            null,
            name,
            qty,
            pr,
            recipientName,
            note,
            modeOfPayment,
            other,
            days,
            creditOpts,
            personId,
            vehicleId,
            transactionDate
          )
        );
      }

      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save release.');
    } finally {
      setSubmitting(false);
    }
  };

  const productValid = itemType === 'Product' && activeItem && quantity > 0 && quantity <= (activeItem?.quantity ?? 0);
  const serviceValid = itemType === 'Service' && serviceName.trim().length > 0;
  const hasCustomer = selectedPersonId || customerInput.trim();
  const canSubmit =
    transactionDate.trim() &&
    modeOfPayment &&
    (modeOfPayment !== 'Others' || modeOfPaymentOther.trim()) &&
    hasCustomer &&
    (modeOfPayment !== 'Credit' ||
      recipient.trim() ||
      persons.find((p) => p.id === selectedPersonId)?.fullName ||
      customerInput.trim()) &&
    (productValid || serviceValid);

  const personSuggestions = customerInput.trim()
    ? persons.filter((p) => (p.fullName ?? '').toLowerCase().includes(customerInput.trim().toLowerCase()))
    : persons;

  const vehicleSearchLower = vehicleInput.trim().toLowerCase();
  const vehicleSuggestions = vehicleSearchLower
    ? vehiclesForSelectedPerson.filter(
        (v) =>
          (v.plateNumber && v.plateNumber.toLowerCase().includes(vehicleSearchLower)) ||
          (v.brand && v.brand.toLowerCase().includes(vehicleSearchLower)) ||
          (v.model && v.model.toLowerCase().includes(vehicleSearchLower))
      )
    : vehiclesForSelectedPerson;

  const filteredItems = items.filter((i) =>
    (i.name ?? '').toLowerCase().includes(itemSearch.toLowerCase()) ||
    (i.brand && i.brand.toLowerCase().includes(itemSearch.toLowerCase()))
  );

  return (
    <div className="fixed inset-0 z-[1050] flex items-center justify-center p-4 bg-slate-900/20 backdrop-blur-sm overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[min(90vh,40rem)] flex flex-col overflow-hidden animate-fade-in-up my-auto">
        <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-orange-50 shrink-0">
          <div className="flex items-center gap-2">
             <div className="bg-orange-100 p-2 rounded-lg">
                <ArrowUpRight className="w-5 h-5 text-orange-600" />
             </div>
             <div>
                <h2 className="text-lg font-bold text-slate-800">Release Stock</h2>
                <p className="text-xs text-slate-500">Create release transaction</p>
             </div>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col min-h-0 flex-1 overflow-hidden">
          <div className="p-6 space-y-4 overflow-y-auto min-h-0 flex-1">
          {error && <InlineAlert message={error} />}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">What to avail <span className="text-red-500">*</span></label>
            <select
              required
              className="w-full px-3 py-2 bg-white text-slate-900 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 transition-all shadow-sm"
              value={itemType}
              onChange={(e) => {
                setItemType(e.target.value as SaleItemType);
                if (e.target.value === 'Service') {
                  setSelectedItemId('');
                  setItemSearch('');
                }
              }}
              disabled={!!item}
            >
              <option value="Product">Product</option>
              <option value="Service">Servicing</option>
            </select>
            {item ? <p className="text-xs text-slate-500 mt-0.5">Opened from inventory: Product.</p> : <p className="text-xs text-slate-500 mt-0.5">Client chooses product (stock item) or servicing.</p>}
          </div>

          {itemType === 'Service' ? (
            <>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Servicing name <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  required={itemType === 'Service'}
                  className="w-full px-3 py-2 bg-white text-slate-900 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 placeholder-slate-400"
                  value={serviceName}
                  onChange={(e) => setServiceName(e.target.value)}
                  placeholder="e.g. Consulting, Delivery"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Quantity (optional)</label>
                  <input
                    type="number"
                    min={1}
                    className="w-full px-3 py-2 bg-white text-slate-900 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
                    value={quantity}
                    onChange={(e) => setQuantity(Math.max(1, Number(e.target.value) || 1))}
                  />
                  <p className="text-xs text-slate-500 mt-0.5">Default 1</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Price (₱) <span className="text-red-500">*</span></label>
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    required={itemType === 'Service'}
                    className="w-full px-3 py-2 bg-white text-slate-900 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
                    value={itemType === 'Service' ? servicePrice : price}
                    onChange={(e) => setServicePrice(Number(e.target.value) || 0)}
                  />
                </div>
              </div>
            </>
          ) : (
            <>
          {/* Item Selection (Only if no item passed) */}
          {!item && (
             <div className="relative">
                <label className="block text-sm font-medium text-slate-700 mb-1">Select Item</label>
                <div className="relative">
                    <input 
                        type="text"
                        className="w-full pl-3 pr-10 py-2 bg-white text-slate-900 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 placeholder-slate-400 text-sm"
                        placeholder="Search item name..."
                        value={itemSearch}
                        onChange={(e) => {
                            setItemSearch(e.target.value);
                            setIsDropdownOpen(true);
                            if (e.target.value === '') setSelectedItemId('');
                        }}
                        onFocus={() => setIsDropdownOpen(true)}
                        onBlur={() => setTimeout(() => setIsDropdownOpen(false), 200)}
                    />
                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                </div>
                {isDropdownOpen && filteredItems.length > 0 && (
                    <div className="absolute z-10 w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                        {filteredItems.map(i => (
                            <button
                                key={i.id}
                                type="button"
                                className="w-full text-left px-4 py-2 hover:bg-orange-50 text-sm text-slate-700 border-b border-slate-50 last:border-0"
                                onMouseDown={(e) => { e.preventDefault(); }}
                                onClick={() => {
                                    setSelectedItemId(i.id);
                                    setItemSearch(i.name);
                                    setIsDropdownOpen(false);
                                }}
                            >
                                <div className="font-medium">{i.name}</div>
                                <div className="text-xs text-slate-500 flex justify-between">
                                    <span>{i.brand || 'No Brand'}</span>
                                    <span>Stock: {i.quantity}</span>
                                </div>
                            </button>
                        ))}
                    </div>
                )}
             </div>
          )}

          {activeItem && (
             <div className="bg-slate-50 p-3 rounded-lg border border-slate-100 text-sm">
                <div className="flex justify-between mb-1">
                   <span className="text-slate-500">Item:</span>
                   <span className="font-medium text-slate-800">{activeItem.name}</span>
                </div>
                <div className="flex justify-between">
                   <span className="text-slate-500">Available Stock:</span>
                   <span className="font-medium text-slate-800">{activeItem.quantity} {activeItem.unit || 'pcs'}</span>
                </div>
             </div>
          )}
          </>
          )}

          <div className="relative">
            <label className="block text-sm font-medium text-slate-700 mb-1">Person (Customer) <span className="text-red-500">*</span></label>
            <input
              type="text"
              required={!selectedPersonId && !customerInput.trim()}
              className="w-full px-3 py-2 pr-10 bg-white text-slate-900 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-orange-500 placeholder-slate-400 transition-all shadow-sm"
              placeholder="Type customer name or select from list"
              value={selectedPersonId ? (persons.find((p) => p.id === selectedPersonId)?.fullName ?? customerInput) : customerInput}
              onChange={(e) => {
                setCustomerInput(e.target.value);
                setSelectedPersonId('');
                setIsPersonDropdownOpen(true);
              }}
              onFocus={() => setIsPersonDropdownOpen(true)}
              onBlur={() => setTimeout(() => setIsPersonDropdownOpen(false), 200)}
            />
            <ChevronDown className="absolute right-3 top-9 w-4 h-4 text-slate-400 pointer-events-none" />
            {isPersonDropdownOpen && personSuggestions.length > 0 && (
              <div className="absolute z-10 w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                {personSuggestions.slice(0, 20).map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="w-full text-left px-4 py-2 hover:bg-orange-50 text-sm text-slate-700 border-b border-slate-50 last:border-0"
                    onMouseDown={(e) => { e.preventDefault(); }}
                    onClick={() => {
                      setSelectedPersonId(p.id);
                      setCustomerInput(p.fullName);
                      setRecipient(p.fullName);
                      setSelectedVehicleId('');
                      setVehicleInput('');
                      setIsPersonDropdownOpen(false);
                    }}
                  >
                    <div className="font-medium">{p.fullName}</div>
                    {(p.contactNumber || p.address) && (
                      <div className="text-xs text-slate-500">
                        {[p.contactNumber, p.address].filter(Boolean).join(' · ')}
                      </div>
                    )}
                  </button>
                ))}
              </div>
            )}
            {persons.length === 0 && !customerInput.trim() && (
              <p className="text-xs text-slate-500 mt-1">Type a name to add a new customer, or add persons in Accounts first.</p>
            )}
          </div>
          <div className="relative">
            <label className="block text-sm font-medium text-slate-700 mb-1">Vehicle (Optional)</label>
            <input
              type="text"
              className="w-full px-3 py-2 pr-10 bg-white text-slate-900 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 placeholder-slate-400 transition-all shadow-sm disabled:bg-slate-50 disabled:text-slate-500"
              placeholder={selectedPersonId ? 'Type plate number or select from list' : 'Select a customer first'}
              value={selectedVehicleId ? (vehicles.find((v) => v.id === selectedVehicleId)?.plateNumber ?? vehicleInput) : vehicleInput}
              disabled={!selectedPersonId}
              onChange={(e) => {
                setVehicleInput(e.target.value);
                setSelectedVehicleId('');
                setIsVehicleDropdownOpen(true);
              }}
              onFocus={() => selectedPersonId && setIsVehicleDropdownOpen(true)}
              onBlur={() => setTimeout(() => setIsVehicleDropdownOpen(false), 200)}
            />
            <ChevronDown className="absolute right-3 top-9 w-4 h-4 text-slate-400 pointer-events-none" />
            {selectedPersonId && isVehicleDropdownOpen && (
              <div className="absolute z-10 w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                <button
                  type="button"
                  className="w-full text-left px-4 py-2 hover:bg-slate-50 text-sm text-slate-500 border-b border-slate-50"
                  onMouseDown={(e) => { e.preventDefault(); }}
                  onClick={() => {
                    setSelectedVehicleId('');
                    setVehicleInput('');
                    setIsVehicleDropdownOpen(false);
                  }}
                >
                  None
                </button>
                {vehicleSuggestions.slice(0, 20).map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    className="w-full text-left px-4 py-2 hover:bg-orange-50 text-sm text-slate-700 border-b border-slate-50 last:border-0"
                    onMouseDown={(e) => { e.preventDefault(); }}
                    onClick={() => {
                      setSelectedVehicleId(v.id);
                      setVehicleInput(v.plateNumber);
                      setIsVehicleDropdownOpen(false);
                    }}
                  >
                    <div className="font-medium">{v.plateNumber}</div>
                    {(v.brand || v.model) && (
                      <div className="text-xs text-slate-500">
                        {[v.brand, v.model].filter(Boolean).join(' ')}
                      </div>
                    )}
                  </button>
                ))}
              </div>
            )}
            {selectedPersonId && vehiclesForSelectedPerson.length === 0 && !vehicleInput.trim() && (
              <p className="text-xs text-slate-500 mt-1">Type a plate number to add a vehicle for this customer; it will appear in the list next time.</p>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Recipient / Note name (optional override)</label>
            <input
              type="text"
              className="w-full px-3 py-2 bg-white text-slate-900 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 placeholder-slate-400 transition-all shadow-sm"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              placeholder="Defaults to selected person name"
            />
          </div>
          {modeOfPayment === 'Credit' && (
            <>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Payment due in (days) <span className="text-red-500">*</span></label>
                <input
                  type="number"
                  min={1}
                  max={365}
                  className="w-full px-3 py-2 bg-white text-slate-900 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
                  value={dueDays}
                  onChange={(e) => setDueDays(Math.min(365, Math.max(1, Number(e.target.value) || 30)))}
                />
                <p className="text-xs text-slate-500 mt-0.5">Due date is required for credit. SOA and receivable account will be generated.</p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Down payment (₱)</label>
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    className="w-full px-3 py-2 bg-white text-slate-900 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
                    value={downPayment}
                    onChange={(e) => setDownPayment(Math.max(0, Number(e.target.value) || 0))}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Interest rate (%)</label>
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    className="w-full px-3 py-2 bg-white text-slate-900 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
                    value={interestRate}
                    onChange={(e) => setInterestRate(e.target.value === '' ? '' : Number(e.target.value))}
                    placeholder="0"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Payment schedule</label>
                <select
                  className="w-full px-3 py-2 bg-white text-slate-900 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
                  value={paymentSchedule}
                  onChange={(e) => setPaymentSchedule(e.target.value as 'weekly' | 'monthly')}
                >
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                </select>
              </div>
            </>
          )}

          {itemType === 'Product' && (
          <div className="grid grid-cols-2 gap-4">
            <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Quantity <span className="text-red-500">*</span></label>
                <input
                required={itemType === 'Product'}
                type="number"
                min="1"
                max={activeItem ? activeItem.quantity : 999999}
                className="w-full px-3 py-2 bg-white text-slate-900 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-orange-500 placeholder-slate-400 transition-all shadow-sm"
                value={quantity}
                onChange={(e) => setQuantity(Number(e.target.value))}
                disabled={!activeItem}
                />
            </div>
            <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Price (₱) <span className="text-red-500">*</span></label>
                <input
                required={itemType === 'Product'}
                type="number"
                min="0"
                step="0.01"
                className="w-full px-3 py-2 bg-white text-slate-900 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-orange-500 placeholder-slate-400 transition-all shadow-sm"
                value={price}
                onChange={(e) => setPrice(Number(e.target.value))}
                disabled={!activeItem}
                />
            </div>
          </div>
          )}

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Sale / transaction date <span className="text-red-500">*</span>
            </label>
            <input
              type="date"
              required
              max={todayDateInputValue()}
              className="w-full px-3 py-2 bg-white text-slate-900 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
              value={transactionDate}
              onChange={(e) => setTransactionDate(e.target.value)}
            />
            <p className="text-xs text-slate-500 mt-1">
              Use the real sale date when recording a past transaction. Sales summary and receivables use this date.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Mode of Payment <span className="text-red-500">*</span></label>
            <select
              required
              className="w-full px-3 py-2 bg-white text-slate-900 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-orange-500 transition-all shadow-sm"
              value={modeOfPayment}
              onChange={(e) => setModeOfPayment(e.target.value)}
            >
              <option value="">Select payment mode</option>
              {MODE_OF_PAYMENT_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
            {modeOfPayment === 'Others' && (
              <input
                required
                type="text"
                className="w-full mt-2 px-3 py-2 bg-white text-slate-900 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 placeholder-slate-400"
                placeholder="Specify payment mode"
                value={modeOfPaymentOther}
                onChange={(e) => setModeOfPaymentOther(e.target.value)}
              />
            )}
          </div>

           <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Note (Optional)</label>
            <textarea
              className="w-full px-3 py-2 bg-white text-slate-900 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-orange-500 placeholder-slate-400 h-20 resize-none transition-all shadow-sm"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Project A Supplies..."
            />
          </div>
          </div>

          <div className="flex gap-3 p-6 pt-0 shrink-0">
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
              disabled={!canSubmit || submitting}
              className="bg-orange-600 hover:bg-orange-700 focus:ring-orange-500"
            >
              {submitting ? 'Saving...' : 'Confirm Release'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};