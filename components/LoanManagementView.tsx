import React, { useEffect, useMemo, useState } from 'react';
import {
  loansApi,
  paymentJournalApi,
  transactionsApi,
  type LoanApi,
  type LoanPaymentApi,
  type PaymentJournalEntry,
} from '../lib/api/adminData';
import { CreditCard, ChevronRight, X, Calendar, Wallet, AlertCircle, BookOpen } from 'lucide-react';
import { Button } from './ui/Button';
import { InlineAlert } from './ui/InlineAlert';
import type { Transaction } from '../types';
import { buildPaymentReceiptHtml } from './ReceiptPrint';
import { openDocumentPreview } from '../lib/documentPreviewBus';

const STATUS_LABELS: Record<string, string> = {
  unpaid: 'Unpaid',
  ongoing: 'Ongoing',
  overdue: 'Overdue',
  paid: 'Paid',
  cash: 'Cash',
};

const STATUS_CLASS: Record<string, string> = {
  unpaid: 'bg-amber-100 text-amber-800',
  ongoing: 'bg-blue-100 text-blue-800',
  overdue: 'bg-red-100 text-red-800',
  paid: 'bg-green-100 text-green-800',
  cash: 'bg-slate-100 text-slate-800',
};

function normCustomerName(s: string | null | undefined) {
  return String(s ?? '')
    .trim()
    .toLowerCase();
}

function chequeExpectedMs(raw: string | null | undefined): number {
  const s = String(raw || '').trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return 0;
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
}

export interface LoanManagementViewProps {
  transactions?: Transaction[];
  onReceivablesChanged?: () => void;
}

export const LoanManagementView: React.FC<LoanManagementViewProps> = ({
  transactions = [],
  onReceivablesChanged,
}) => {
  const [loans, setLoans] = useState<LoanApi[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [customerFilter, setCustomerFilter] = useState('');
  const [selectedLoan, setSelectedLoan] = useState<(LoanApi & { payments?: LoanPaymentApi[] }) | null>(null);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentNote, setPaymentNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [journalEntries, setJournalEntries] = useState<PaymentJournalEntry[]>([]);
  const [journalTotal, setJournalTotal] = useState(0);
  const [journalLoading, setJournalLoading] = useState(false);
  const [journalError, setJournalError] = useState<string | null>(null);
  /** When set, receivable modal shows payment journal rows for this customer (opened via customer name click). */
  const [journalHighlightCustomer, setJournalHighlightCustomer] = useState<string | null>(null);
  const [chequeBusyId, setChequeBusyId] = useState<string | null>(null);
  const [chequeActionError, setChequeActionError] = useState<string | null>(null);

  const chequeQueue = useMemo(() => {
    return transactions
      .filter(
        (t) =>
          t.type === 'RELEASE' &&
          t.modeOfPayment === 'Cheque' &&
          t.chequeStatus &&
          t.chequeStatus !== 'cleared'
      )
      .sort((a, b) => chequeExpectedMs(a.chequeExpectedClearDate) - chequeExpectedMs(b.chequeExpectedClearDate));
  }, [transactions]);

  const loadPaymentJournal = () => {
    setJournalLoading(true);
    setJournalError(null);
    paymentJournalApi
      .list({ limit: 100 })
      .then((res) => {
        setJournalEntries(res.entries);
        setJournalTotal(res.total);
      })
      .catch((err) => setJournalError(err instanceof Error ? err.message : 'Failed to load payment journal.'))
      .finally(() => setJournalLoading(false));
  };

  const loadLoans = () => {
    setLoading(true);
    setLoadError(null);
    loansApi
      .list({ status: statusFilter || undefined, customerName: customerFilter || undefined })
      .then((res) => {
        setLoans(res.loans);
        setTotal(res.total);
      })
      .catch((err) => setLoadError(err instanceof Error ? err.message : 'Failed to load receivables.'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadLoans();
  }, [statusFilter, customerFilter]);

  useEffect(() => {
    loadPaymentJournal();
  }, []);

  const openLoan = (id: string, opts?: { highlightJournalForCustomer?: string | null }) => {
    if (opts?.highlightJournalForCustomer) {
      setJournalHighlightCustomer(opts.highlightJournalForCustomer);
      loadPaymentJournal();
    } else {
      setJournalHighlightCustomer(null);
    }
    loansApi
      .getById(id)
      .then((data) => setSelectedLoan(data))
      .catch(() => setSelectedLoan(null));
    setPaymentAmount('');
    setPaymentNote('');
    setError(null);
  };

  const closeLoanModal = () => {
    setSelectedLoan(null);
    setJournalHighlightCustomer(null);
  };

  const customerJournalRows = journalHighlightCustomer
    ? journalEntries.filter(
        (e) => normCustomerName(e.customerName) === normCustomerName(journalHighlightCustomer)
      )
    : [];

  const handleAddPayment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedLoan) return;
    const amount = Number(paymentAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError('Enter a valid positive amount.');
      return;
    }
    if (amount > selectedLoan.remainingBalance) {
      setError('Payment cannot exceed remaining balance.');
      return;
    }
    setSubmitting(true);
    setError(null);
    loansApi
      .addPayment(selectedLoan.id, amount, paymentNote || undefined)
      .then((res) => {
        setSelectedLoan({ ...res.loan, payments: [res.payment, ...(selectedLoan.payments || [])] });
        setPaymentAmount('');
        setPaymentNote('');
        loadLoans();
        loadPaymentJournal();
        // Every payment received (full OR partial) prints an Official
        // Receipt — the company is acknowledging money received.
        const totalPaid = Math.max(0, Number(res.loan.totalAmount) - Number(res.loan.remainingBalance ?? 0));
        const input = {
          paidAt: res.payment?.paidAt || new Date().toISOString(),
          amountPaid: amount,
          method: 'cash',
          note: paymentNote || undefined,
          customerName: res.loan.customerName,
          originalTransactionId: res.loan.transactionId,
          originalTransactionTotal: Number(res.loan.totalAmount),
          totalPaidIncludingThis: totalPaid,
          remainingBalance: Number(res.loan.remainingBalance ?? 0),
          paymentId: res.payment?.id,
          shopId: res.loan.shopId ?? transactions.find((t) => t.id === res.loan.transactionId)?.shopId,
        };
        openDocumentPreview({
          html: buildPaymentReceiptHtml(input),
          title: 'Official receipt (preview)',
          filename: `loan-payment-${(res.payment?.id || '').slice(0, 8)}.pdf`,
        });
      })
      .catch((err) => setError(err?.message || 'Failed to record payment'))
      .finally(() => setSubmitting(false));
  };

  const handleResolveCheque = (releaseTransactionId: string, outcome: 'cleared' | 'bounced') => {
    setChequeBusyId(releaseTransactionId);
    setChequeActionError(null);
    transactionsApi
      .resolveCheque({ releaseTransactionId, outcome })
      .then(() => {
        loadLoans();
        loadPaymentJournal();
        onReceivablesChanged?.();
        // A cleared cheque is a single full payment received from the bank —
        // print the Official Receipt acknowledging the funds.
        if (outcome === 'cleared') {
          const tx = transactions.find((t) => t.id === releaseTransactionId);
          if (tx) {
            const amount = Number(tx.totalValue || 0);
            const input = {
              paidAt: new Date().toISOString(),
              amountPaid: amount,
              method: 'cheque',
              reference: tx.chequeReference || undefined,
              customerName: tx.recipient || '—',
              originalTransactionId: tx.id,
              originalTransactionTotal: amount,
              originalItemSummary: tx.itemName,
              totalPaidIncludingThis: amount,
              remainingBalance: 0,
              shopId: tx.shopId,
            };
            openDocumentPreview({
              html: buildPaymentReceiptHtml(input),
              title: 'Official receipt (preview)',
              filename: `cheque-cleared-${tx.id.slice(0, 8)}.pdf`,
            });
          }
        }
      })
      .catch((err) => setChequeActionError(err instanceof Error ? err.message : 'Failed to update cheque.'))
      .finally(() => setChequeBusyId(null));
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-wrap items-center gap-4">
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">Status</label>
          <select
            className="px-3 py-2 border border-slate-200 rounded-lg text-slate-800 bg-white text-sm"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="">All</option>
            <option value="unpaid">Unpaid</option>
            <option value="ongoing">Ongoing</option>
            <option value="overdue">Overdue</option>
            <option value="paid">Paid</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">Customer</label>
          <input
            type="text"
            placeholder="Search customer..."
            className="px-3 py-2 border border-slate-200 rounded-lg text-slate-800 bg-white text-sm w-48"
            value={customerFilter}
            onChange={(e) => setCustomerFilter(e.target.value)}
          />
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="p-6 border-b border-slate-100">
          <h3 className="font-bold text-slate-800">Cheques (receivable)</h3>
          <p className="text-sm text-slate-500 mt-0.5">
            Pending and bounced cheque sales stay on accounts receivable until you mark the cheque cleared (bank paid) or bounced.
          </p>
        </div>
        {chequeActionError && <InlineAlert message={chequeActionError} className="mx-6 mt-6" />}
        <div className="overflow-x-auto max-h-[320px]">
          {chequeQueue.length === 0 ? (
            <div className="p-8 text-center text-slate-500">No pending or bounced cheques.</div>
          ) : (
            <table className="w-full text-left border-collapse">
              <thead className="bg-slate-50 sticky top-0 z-10">
                <tr>
                  <th className="py-3 px-6 text-xs font-semibold uppercase text-slate-500">Customer</th>
                  <th className="py-3 px-6 text-xs font-semibold uppercase text-slate-500">Expected clear</th>
                  <th className="py-3 px-6 text-xs font-semibold uppercase text-slate-500 text-right">Amount</th>
                  <th className="py-3 px-6 text-xs font-semibold uppercase text-slate-500">Status</th>
                  <th className="py-3 px-6 text-xs font-semibold uppercase text-slate-500">Ref.</th>
                  <th className="py-3 px-6 text-xs font-semibold uppercase text-slate-500">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {chequeQueue.map((t) => {
                  const busy = chequeBusyId === t.id;
                  const st = t.chequeStatus || 'pending';
                  return (
                    <tr key={t.id}>
                      <td className="py-3 px-6 text-sm font-medium text-slate-800">{t.recipient || '—'}</td>
                      <td className="py-3 px-6 text-sm text-slate-600">
                        {t.chequeExpectedClearDate
                          ? new Date(`${String(t.chequeExpectedClearDate).slice(0, 10)}T12:00:00`).toLocaleDateString()
                          : '—'}
                      </td>
                      <td className="py-3 px-6 text-sm text-right text-slate-800">₱{Number(t.totalValue || 0).toFixed(2)}</td>
                      <td className="py-3 px-6">
                        <span
                          className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${
                            st === 'bounced' ? 'bg-red-100 text-red-800' : 'bg-violet-100 text-violet-800'
                          }`}
                        >
                          {st === 'bounced' ? 'Bounced' : 'Pending clearance'}
                        </span>
                      </td>
                      <td className="py-3 px-6 text-sm text-slate-600 max-w-[140px] truncate" title={t.chequeReference || ''}>
                        {t.chequeReference || '—'}
                      </td>
                      <td className="py-3 px-6">
                        <div className="flex flex-wrap gap-2">
                          <Button
                            type="button"
                            variant="primary"
                            className="text-xs py-1.5 px-3"
                            disabled={busy}
                            onClick={() => handleResolveCheque(t.id, 'cleared')}
                          >
                            Cleared
                          </Button>
                          <Button
                            type="button"
                            variant="secondary"
                            className="text-xs py-1.5 px-3"
                            disabled={busy}
                            onClick={() => handleResolveCheque(t.id, 'bounced')}
                          >
                            Bounced
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="p-6 border-b border-slate-100">
          <h3 className="font-bold text-slate-800">Receivable accounts</h3>
          <p className="text-sm text-slate-500 mt-0.5">
            Balances from credit (Accounts Receivable) and cheque sales until cleared. Click a row for account details, or the
            customer name for that customer’s payment journal.
          </p>
        </div>
        {loadError && <InlineAlert message={loadError} className="mx-6 mt-6" />}
        <div className="overflow-x-auto max-h-[500px]">
          {loading ? (
            <div className="p-8 text-center text-slate-500">Loading...</div>
          ) : loans.length === 0 ? (
            <div className="p-8 text-center text-slate-500">No receivable accounts found.</div>
          ) : (
            <table className="w-full text-left border-collapse">
              <thead className="bg-slate-50 sticky top-0 z-10">
                <tr>
                  <th className="py-3 px-6 text-xs font-semibold uppercase text-slate-500">Customer</th>
                  <th className="py-3 px-6 text-xs font-semibold uppercase text-slate-500">Transaction ID</th>
                  <th className="py-3 px-6 text-xs font-semibold uppercase text-slate-500 text-right">Total</th>
                  <th className="py-3 px-6 text-xs font-semibold uppercase text-slate-500 text-right">Remaining</th>
                  <th className="py-3 px-6 text-xs font-semibold uppercase text-slate-500">Due date</th>
                  <th className="py-3 px-6 text-xs font-semibold uppercase text-slate-500">Status</th>
                  <th className="py-3 px-6 text-xs font-semibold uppercase text-slate-500 w-16"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loans.map((loan) => (
                  <tr
                    key={loan.id}
                    className="hover:bg-slate-50 cursor-pointer"
                    onClick={() => openLoan(loan.id)}
                  >
                    <td className="py-3 px-6">
                      <div>
                        <button
                          type="button"
                          className="font-medium text-indigo-600 hover:text-indigo-800 hover:underline text-left"
                          onClick={(e) => {
                            e.stopPropagation();
                            openLoan(loan.id, { highlightJournalForCustomer: loan.customerName });
                          }}
                        >
                          {loan.customerName}
                        </button>
                        {loan.vehiclePlateNumber && (
                          <div className="text-xs text-slate-500">Vehicle: {loan.vehiclePlateNumber}</div>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-6 text-sm text-slate-600">#{loan.transactionId.slice(0, 8)}</td>
                    <td className="py-3 px-6 text-sm text-right text-slate-800">₱{loan.totalAmount.toFixed(2)}</td>
                    <td className="py-3 px-6 text-sm text-right font-medium text-slate-800">₱{loan.remainingBalance.toFixed(2)}</td>
                    <td className="py-3 px-6 text-sm text-slate-600">{new Date(loan.dueDate).toLocaleDateString()}</td>
                    <td className="py-3 px-6">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${STATUS_CLASS[loan.status] || 'bg-slate-100 text-slate-800'}`}>
                        {loan.status === 'overdue' && <AlertCircle className="w-3 h-3 mr-0.5" />}
                        {STATUS_LABELS[loan.status] || loan.status}
                      </span>
                    </td>
                    <td className="py-3 px-6">
                      <ChevronRight className="w-4 h-4 text-slate-400" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {selectedLoan && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/20 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-indigo-50 shrink-0">
              <h2 className="text-lg font-bold text-slate-800">Receivable details</h2>
              <button type="button" onClick={closeLoanModal} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 overflow-y-auto flex-1">
              <div className="grid grid-cols-2 gap-3 text-sm mb-4">
                <div>
                  <span className="text-slate-500 block">Customer</span>
                  <span className="font-medium text-slate-800">{selectedLoan.customerName}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Transaction ID</span>
                  <span className="font-medium text-slate-800">#{selectedLoan.transactionId.slice(0, 8)}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Total amount</span>
                  <span className="font-medium text-slate-800">₱{selectedLoan.totalAmount.toFixed(2)}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Down payment</span>
                  <span className="font-medium text-slate-800">₱{selectedLoan.downPayment.toFixed(2)}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Remaining balance</span>
                  <span className="font-medium text-slate-800">₱{selectedLoan.remainingBalance.toFixed(2)}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Status</span>
                  <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${STATUS_CLASS[selectedLoan.status] || ''}`}>
                    {STATUS_LABELS[selectedLoan.status] || selectedLoan.status}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block">Start date</span>
                  <span className="font-medium text-slate-800">{new Date(selectedLoan.startDate).toLocaleDateString()}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Due date</span>
                  <span className="font-medium text-slate-800">{new Date(selectedLoan.dueDate).toLocaleDateString()}</span>
                </div>
                {selectedLoan.interestRate != null && (
                  <div>
                    <span className="text-slate-500 block">Interest rate</span>
                    <span className="font-medium text-slate-800">{selectedLoan.interestRate}%</span>
                  </div>
                )}
                <div>
                  <span className="text-slate-500 block">Payment schedule</span>
                  <span className="font-medium text-slate-800 capitalize">{selectedLoan.paymentSchedule}</span>
                </div>
                {selectedLoan.vehiclePlateNumber && (
                  <div>
                    <span className="text-slate-500 block">Vehicle</span>
                    <span className="font-medium text-slate-800">{selectedLoan.vehiclePlateNumber}</span>
                  </div>
                )}
              </div>

              <h4 className="font-semibold text-slate-800 mt-4 mb-2">Payment history</h4>
              {selectedLoan.payments && selectedLoan.payments.length > 0 ? (
                <table className="w-full text-sm border border-slate-200 rounded-lg overflow-hidden">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="py-2 px-3 text-left text-xs font-semibold text-slate-500">Date</th>
                      <th className="py-2 px-3 text-right text-xs font-semibold text-slate-500">Amount paid</th>
                      <th className="py-2 px-3 text-right text-xs font-semibold text-slate-500">Balance after</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedLoan.payments.map((p) => (
                      <tr key={p.id} className="border-t border-slate-100">
                        <td className="py-2 px-3 text-slate-700">{new Date(p.paidAt).toLocaleString()}</td>
                        <td className="py-2 px-3 text-right text-slate-800">₱{p.amountPaid.toFixed(2)}</td>
                        <td className="py-2 px-3 text-right text-slate-800">₱{p.remainingBalanceAfter.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="text-slate-500 text-sm">No payments yet.</p>
              )}

              {journalHighlightCustomer && (
                  <div className="mt-6 pt-4 border-t border-slate-200">
                    <h4 className="font-semibold text-slate-800 mb-2 flex items-center gap-2">
                      <BookOpen className="w-4 h-4 text-indigo-600" />
                      Payment journal (this customer)
                    </h4>
                    <p className="text-xs text-slate-500 mb-2">
                      All recorded payments for <span className="font-medium text-slate-700">{journalHighlightCustomer}</span>{' '}
                      (receivable installments and PO SOA), newest first in this list.
                    </p>
                    {journalLoading ? (
                      <p className="text-slate-500 text-sm">Loading journal…</p>
                    ) : customerJournalRows.length === 0 ? (
                      <p className="text-slate-500 text-sm">No payment journal entries matched this customer yet.</p>
                    ) : (
                      <div className="overflow-x-auto max-h-56 border border-slate-200 rounded-lg">
                        <table className="w-full text-sm">
                          <thead className="bg-slate-50 sticky top-0">
                            <tr>
                              <th className="py-2 px-3 text-left text-xs font-semibold text-slate-500">Date</th>
                              <th className="py-2 px-3 text-left text-xs font-semibold text-slate-500">Type</th>
                              <th className="py-2 px-3 text-right text-xs font-semibold text-slate-500">Amount</th>
                              <th className="py-2 px-3 text-left text-xs font-semibold text-slate-500">Method</th>
                              <th className="py-2 px-3 text-left text-xs font-semibold text-slate-500">Reference</th>
                              <th className="py-2 px-3 text-left text-xs font-semibold text-slate-500">Note</th>
                            </tr>
                          </thead>
                          <tbody>
                            {customerJournalRows.map((e) => (
                              <tr key={e.id} className="border-t border-slate-100">
                                <td className="py-2 px-3 text-slate-700 whitespace-nowrap">{new Date(e.paidAt).toLocaleString()}</td>
                                <td className="py-2 px-3">
                                  <span
                                    className={`inline-flex px-1.5 py-0.5 rounded text-xs font-medium ${
                                      e.type === 'loan' ? 'bg-blue-100 text-blue-800' : 'bg-amber-100 text-amber-800'
                                    }`}
                                  >
                                    {e.type === 'loan' ? 'Receivable' : 'SOA (PO)'}
                                  </span>
                                </td>
                                <td className="py-2 px-3 text-right font-medium text-slate-800">₱{e.amount.toFixed(2)}</td>
                                <td className="py-2 px-3 text-slate-600">{e.method === 'card' ? 'Card terminal' : (e.method ?? '—')}</td>
                                <td className="py-2 px-3 text-slate-600">{e.reference ?? '—'}</td>
                                <td className="py-2 px-3 text-slate-600 max-w-[180px] truncate" title={e.note ?? undefined}>
                                  {e.note ?? '—'}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}

              {selectedLoan.remainingBalance > 0 && (
                <form onSubmit={handleAddPayment} className="mt-6 pt-4 border-t border-slate-100">
                  <h4 className="font-semibold text-slate-800 mb-2">Record payment</h4>
                  {error && <InlineAlert message={error} className="mb-2" />}
                  <div className="flex gap-2 flex-wrap">
                    <input
                      type="number"
                      min={0.01}
                      step={0.01}
                      max={selectedLoan.remainingBalance}
                      placeholder={`Amount (max ₱${selectedLoan.remainingBalance.toFixed(2)})`}
                      className="flex-1 min-w-[120px] px-3 py-2 border border-slate-200 rounded-lg text-slate-800"
                      value={paymentAmount}
                      onChange={(e) => setPaymentAmount(e.target.value)}
                    />
                    <input
                      type="text"
                      placeholder="Note (optional)"
                      className="flex-1 min-w-[120px] px-3 py-2 border border-slate-200 rounded-lg text-slate-800"
                      value={paymentNote}
                      onChange={(e) => setPaymentNote(e.target.value)}
                    />
                    <Button
                      type="submit"
                      disabled={submitting || !paymentAmount}
                    >
                      {submitting ? 'Saving...' : 'Add payment'}
                    </Button>
                  </div>
                  <p className="text-xs text-slate-500 mt-1">Cannot exceed remaining balance: ₱{selectedLoan.remainingBalance.toFixed(2)}</p>
                </form>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Payment journal: SOA + receivable payments */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="p-6 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-indigo-600" />
            <h3 className="font-bold text-slate-800">Payment journal</h3>
          </div>
          <p className="text-sm text-slate-500">All payments (Purchase Order SOA + receivable installments), newest first</p>
        </div>
        {journalError && <InlineAlert message={journalError} className="mx-6 mt-6" />}
        <div className="overflow-x-auto max-h-[400px]">
          {journalLoading ? (
            <p className="p-6 text-slate-500 text-sm">Loading...</p>
          ) : journalEntries.length === 0 ? (
            <p className="p-6 text-slate-500 text-sm">No payment entries yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 sticky top-0">
                <tr>
                  <th className="py-2 px-3 text-left font-semibold text-slate-500">Date</th>
                  <th className="py-2 px-3 text-left font-semibold text-slate-500">Type</th>
                  <th className="py-2 px-3 text-left font-semibold text-slate-500">Customer</th>
                  <th className="py-2 px-3 text-right font-semibold text-slate-500">Amount (₱)</th>
                  <th className="py-2 px-3 text-left font-semibold text-slate-500">Method</th>
                  <th className="py-2 px-3 text-left font-semibold text-slate-500">Reference</th>
                </tr>
              </thead>
              <tbody>
                {journalEntries.map((e) => (
                  <tr key={e.id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="py-2 px-3 text-slate-800">{new Date(e.paidAt).toLocaleString()}</td>
                    <td className="py-2 px-3">
                      <span className={`inline-flex px-1.5 py-0.5 rounded text-xs font-medium ${e.type === 'loan' ? 'bg-blue-100 text-blue-800' : 'bg-amber-100 text-amber-800'}`}>
                        {e.type === 'loan' ? 'Receivable' : 'SOA (PO)'}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-slate-800">{e.customerName}</td>
                    <td className="py-2 px-3 text-right font-medium text-slate-800">₱{e.amount.toFixed(2)}</td>
                    <td className="py-2 px-3 text-slate-600">{e.method === 'card' ? 'Card terminal' : (e.method ?? '—')}</td>
                    <td className="py-2 px-3 text-slate-600">{e.reference ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        {journalTotal > journalEntries.length && (
          <div className="px-6 py-2 border-t border-slate-100 text-xs text-slate-500">
            Showing {journalEntries.length} of {journalTotal} entries
          </div>
        )}
      </div>
    </div>
  );
};
