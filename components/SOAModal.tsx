import React, { useEffect, useState } from 'react';
import { X, AlertCircle, Banknote } from 'lucide-react';
import { soaApi } from '../lib/api/adminData';
import type { StatementOfAccount } from '../types';
import { Button } from './ui/Button';
import { InlineAlert } from './ui/InlineAlert';
import { buildPaymentReceiptHtml } from './ReceiptPrint';
import { openDocumentPreview } from '../lib/documentPreviewBus';

interface SOAModalProps {
  transactionId: string;
  onClose: () => void;
}

export const SOAModal: React.FC<SOAModalProps> = ({ transactionId, onClose }) => {
  const [soa, setSoa] = useState<StatementOfAccount | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'cheque' | 'card'>('cash');
  const [paymentPaidAt, setPaymentPaidAt] = useState(() => new Date().toISOString().slice(0, 16));
  const [paymentReference, setPaymentReference] = useState('');
  const [paymentNote, setPaymentNote] = useState('');
  const [paymentSubmitting, setPaymentSubmitting] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    soaApi
      .getByTransactionId(transactionId)
      .then(setSoa)
      .catch((err) => setError(err?.message || 'Failed to load Statement of Account'))
      .finally(() => setLoading(false));
  }, [transactionId]);

  const handlePaymentStatusChange = (newStatus: 'Unpaid' | 'Partially Paid' | 'Paid' | 'Overdue') => {
    if (!soa) return;
    setUpdating(true);
    setError(null);
    soaApi
      .updatePaymentStatus(soa.id, newStatus)
      .then(setSoa)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to update payment status.'))
      .finally(() => setUpdating(false));
  };

  const handleRecordPayment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!soa || soa.paymentSource !== 'soa') return;
    const amount = Number(paymentAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setPaymentError('Enter a valid positive amount.');
      return;
    }
    const remaining = soa.remainingBalance ?? soa.totalAmountDue ?? 0;
    if (amount > remaining) {
      setPaymentError('Payment cannot exceed remaining balance.');
      return;
    }
    setPaymentSubmitting(true);
    setPaymentError(null);
    soaApi
      .addPayment(soa.id, {
        amount,
        method: paymentMethod,
        paidAt: new Date(paymentPaidAt).toISOString(),
        reference: paymentReference.trim() || undefined,
        note: paymentNote.trim() || undefined,
      })
      .then((res) => {
        setSoa(res.soa);
        setPaymentAmount('');
        setPaymentReference('');
        setPaymentNote('');
        // Every payment received (full OR partial) prints an Official
        // Receipt — the company is acknowledging money received.
        const input = {
          paidAt: new Date(paymentPaidAt).toISOString(),
          amountPaid: amount,
          method: paymentMethod,
          reference: paymentReference.trim() || undefined,
          note: paymentNote.trim() || undefined,
          customerName: res.soa.customerName,
          originalTransactionId: res.soa.transactionId,
          originalTransactionTotal: res.soa.totalAmountDue,
          originalItemSummary: res.soa.itemName,
          totalPaidIncludingThis: res.soa.totalPaid ?? amount,
          remainingBalance: res.soa.remainingBalance ?? 0,
          shopId: res.soa.shopId,
        };
        openDocumentPreview({
          html: buildPaymentReceiptHtml(input),
          title: 'Official receipt (preview)',
          filename: `payment-or-${(res.soa.transactionId || '').slice(0, 8)}.pdf`,
        });
      })
      .catch((err) => setPaymentError(err?.message || 'Failed to record payment'))
      .finally(() => setPaymentSubmitting(false));
  };

  // Billing breakdown: subtotal (qty * srp), then discount, then tax, then total
  const subtotal = soa ? soa.quantity * soa.srp : 0;
  const discountVal = soa?.discountPercent != null
    ? subtotal * (soa.discountPercent / 100)
    : (soa?.discountAmount ?? 0);
  const afterDiscount = subtotal - discountVal;
  const taxVal = soa?.taxPercent != null
    ? afterDiscount * (soa.taxPercent / 100)
    : (soa?.taxAmount ?? 0);
  const displayTotal = soa?.totalAmountDue ?? afterDiscount + taxVal;
  const effectiveStatus = soa?.status ?? soa?.paymentStatus ?? 'Unpaid';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/20 backdrop-blur-sm overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden animate-fade-in-up my-auto">
        <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-indigo-50 shrink-0">
          <h2 className="text-lg font-bold text-slate-800">Statement of Account</h2>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-6 overflow-y-auto flex-1">
          {loading && <p className="text-slate-500 text-sm">Loading...</p>}
          {error && <InlineAlert message={error} />}
          {soa && !loading && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <span className="text-slate-500 block">Customer</span>
                  <span className="font-medium text-slate-800">{soa.customerName}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Transaction ID</span>
                  <span className="font-medium text-slate-800">#{soa.transactionId.slice(0, 8)}</span>
                </div>
                {(soa.itemType === 'Service' || soa.itemType === 'Product') && (
                  <div>
                    <span className="text-slate-500 block">Availed</span>
                    <span className={`inline-flex px-1.5 py-0.5 rounded text-xs font-medium ${soa.itemType === 'Service' ? 'bg-violet-100 text-violet-700' : 'bg-slate-100 text-slate-600'}`}>
                      {soa.itemType === 'Service' ? 'Servicing' : soa.itemType}
                    </span>
                  </div>
                )}
                <div>
                  <span className="text-slate-500 block">Transaction date</span>
                  <span className="font-medium text-slate-800">{new Date(soa.transactionDate).toLocaleString()}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Due date</span>
                  <span className="font-medium text-slate-800">{new Date(soa.dueDate).toLocaleDateString()}</span>
                </div>
                {soa.vehiclePlateNumber && (
                  <div className="col-span-2">
                    <span className="text-slate-500 block">Vehicle</span>
                    <span className="font-medium text-slate-800">{soa.vehiclePlateNumber}</span>
                  </div>
                )}
              </div>

              {/* Billing breakdown */}
              <div className="border-t border-slate-100 pt-4">
                <span className="text-slate-700 font-medium block mb-2">Billing breakdown</span>
                <table className="w-full text-left border border-slate-200 rounded-lg overflow-hidden">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="py-2 px-3 text-xs font-semibold text-slate-500">Item</th>
                      <th className="py-2 px-3 text-xs font-semibold text-slate-500 text-right">Qty</th>
                      <th className="py-2 px-3 text-xs font-semibold text-slate-500 text-right">SRP (₱)</th>
                      <th className="py-2 px-3 text-xs font-semibold text-slate-500 text-right">Total (₱)</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="py-2 px-3 text-slate-800">{soa.itemName}</td>
                      <td className="py-2 px-3 text-right text-slate-800">{soa.quantity}</td>
                      <td className="py-2 px-3 text-right text-slate-800">{soa.srp.toFixed(2)}</td>
                      <td className="py-2 px-3 text-right text-slate-800">{subtotal.toFixed(2)}</td>
                    </tr>
                  </tbody>
                </table>
                <div className="mt-2 space-y-1 text-slate-600">
                  {(soa.discountPercent != null || soa.discountAmount != null) && (
                    <div className="flex justify-between">
                      <span>Discount{soa.discountPercent != null ? ` (${soa.discountPercent}%)` : ''}</span>
                      <span>- ₱{discountVal.toFixed(2)}</span>
                    </div>
                  )}
                  {(soa.taxPercent != null || soa.taxAmount != null) && (
                    <div className="flex justify-between">
                      <span>Tax{soa.taxPercent != null ? ` (${soa.taxPercent}%)` : ''}</span>
                      <span>₱{taxVal.toFixed(2)}</span>
                    </div>
                  )}
                </div>
                <div className="flex justify-end font-bold text-slate-800 mt-2 pt-2 border-t border-slate-100">
                  Total amount due: ₱{displayTotal.toFixed(2)}
                </div>
              </div>

              {/* Payments made & remaining balance */}
              <div className="border-t border-slate-100 pt-4">
                <span className="text-slate-700 font-medium block mb-2">Payments made</span>
                {soa.paymentsMade && soa.paymentsMade.length > 0 ? (
                  <>
                    <table className="w-full text-left border border-slate-200 rounded-lg overflow-hidden">
                      <thead className="bg-slate-50">
                        <tr>
                          <th className="py-2 px-3 text-xs font-semibold text-slate-500">Date</th>
                          <th className="py-2 px-3 text-xs font-semibold text-slate-500 text-right">Amount (₱)</th>
                          {soa.paymentSource === 'soa' && <th className="py-2 px-3 text-xs font-semibold text-slate-500">Method</th>}
                          {soa.paymentSource === 'soa' && <th className="py-2 px-3 text-xs font-semibold text-slate-500">Reference</th>}
                          <th className="py-2 px-3 text-xs font-semibold text-slate-500">Note</th>
                        </tr>
                      </thead>
                      <tbody>
                        {soa.paymentsMade.map((p: any) => (
                          <tr key={p.id} className="border-t border-slate-100">
                            <td className="py-2 px-3 text-slate-800">{new Date(p.paidAt).toLocaleDateString()}</td>
                            <td className="py-2 px-3 text-right font-medium text-slate-800">₱{p.amountPaid.toFixed(2)}</td>
                            {soa.paymentSource === 'soa' && <td className="py-2 px-3 text-slate-600">{p.method === 'card' ? 'Card terminal' : (p.method ?? '—')}</td>}
                            {soa.paymentSource === 'soa' && <td className="py-2 px-3 text-slate-600">{p.reference ?? '—'}</td>}
                            <td className="py-2 px-3 text-slate-600">{p.note ?? '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div className="flex justify-end font-medium text-slate-700 mt-2">
                      Total paid: ₱{(soa.totalPaid ?? 0).toFixed(2)}
                    </div>
                  </>
                ) : (
                  <p className="text-slate-500">No payments recorded yet.</p>
                )}
                <div className="flex justify-end font-bold text-slate-800 mt-2 pt-2 border-t border-slate-100">
                  Remaining balance: ₱{(soa.remainingBalance ?? displayTotal).toFixed(2)}
                </div>

                {/* Record payment (Purchase Order / SOA without loan) */}
                {soa.paymentSource === 'soa' && (soa.remainingBalance ?? 0) > 0 && (
                  <form onSubmit={handleRecordPayment} className="border-t border-slate-100 pt-4 mt-4 space-y-3">
                    <span className="text-slate-700 font-medium flex items-center gap-2">
                      <Banknote className="w-4 h-4" />
                      Record payment (Payment journal)
                    </span>
                    {paymentError && <InlineAlert message={paymentError} />}
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs text-slate-500 mb-0.5">Amount (₱) *</label>
                        <input
                          type="number"
                          min={0.01}
                          step={0.01}
                          className="w-full px-3 py-2 border border-slate-200 rounded-lg text-slate-800"
                          value={paymentAmount}
                          onChange={(e) => setPaymentAmount(e.target.value)}
                          required
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-slate-500 mb-0.5">Method</label>
                        <select
                          className="w-full px-3 py-2 border border-slate-200 rounded-lg text-slate-800"
                          value={paymentMethod}
                          onChange={(e) => setPaymentMethod(e.target.value as 'cash' | 'cheque' | 'card')}
                        >
                          <option value="cash">Cash</option>
                          <option value="cheque">Cheque</option>
                          <option value="card">Card terminal</option>
                        </select>
                      </div>
                      <div className="col-span-2">
                        <label className="block text-xs text-slate-500 mb-0.5">Date & time</label>
                        <input
                          type="datetime-local"
                          className="w-full px-3 py-2 border border-slate-200 rounded-lg text-slate-800"
                          value={paymentPaidAt}
                          onChange={(e) => setPaymentPaidAt(e.target.value)}
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-slate-500 mb-0.5">Reference</label>
                        <input
                          type="text"
                          placeholder="e.g. cheque no."
                          className="w-full px-3 py-2 border border-slate-200 rounded-lg text-slate-800"
                          value={paymentReference}
                          onChange={(e) => setPaymentReference(e.target.value)}
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-slate-500 mb-0.5">Note</label>
                        <input
                          type="text"
                          className="w-full px-3 py-2 border border-slate-200 rounded-lg text-slate-800"
                          value={paymentNote}
                          onChange={(e) => setPaymentNote(e.target.value)}
                        />
                      </div>
                    </div>
                    <Button
                      type="submit"
                      size="sm"
                      disabled={paymentSubmitting}
                    >
                      {paymentSubmitting ? 'Recording...' : 'Record payment'}
                    </Button>
                  </form>
                )}
              </div>

              {/* Status */}
              <div className="border-t border-slate-100 pt-4 flex flex-wrap items-center gap-3">
                <span className="text-slate-500">Status</span>
                <span
                  className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${
                    effectiveStatus === 'Paid'
                      ? 'bg-green-100 text-green-800'
                      : effectiveStatus === 'Overdue'
                        ? 'bg-red-100 text-red-800'
                        : effectiveStatus === 'Partially Paid'
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-slate-100 text-slate-800'
                  }`}
                >
                  {effectiveStatus === 'Overdue' && <AlertCircle className="w-3.5 h-3.5 mr-1" />}
                  {effectiveStatus}
                </span>
                <select
                  value={effectiveStatus}
                  onChange={(e) => handlePaymentStatusChange(e.target.value as 'Unpaid' | 'Partially Paid' | 'Paid' | 'Overdue')}
                  disabled={updating}
                  className="px-3 py-1.5 border border-slate-200 rounded-lg text-slate-800 bg-white text-sm"
                >
                  <option value="Unpaid">Unpaid</option>
                  <option value="Partially Paid">Partially Paid</option>
                  <option value="Paid">Paid</option>
                  <option value="Overdue">Overdue</option>
                </select>
                <span className="text-xs text-slate-400">Totals are synced from Billing; status updates with payments.</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
