import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { OnlineBooking } from '../types';
import { bookingsApi } from '../lib/api/adminData';
import { DashboardSurface } from './ui/DashboardPrimitives';
import { Button } from './ui/Button';
import { InlineAlert } from './ui/InlineAlert';
import { CalendarClock, CheckCircle2, Loader2, Phone, Mail, Car, XCircle } from 'lucide-react';

interface OnlineBookingsViewProps {
  canEdit: boolean;
  isMotorWorldShop: boolean;
  onBookingConfirmed?: () => void;
}

const STATUS_TABS: Array<{ id: 'all' | OnlineBooking['status']; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'pending', label: 'Pending' },
  { id: 'confirmed', label: 'Confirmed' },
  { id: 'cancelled', label: 'Cancelled' },
];

function statusBadge(status: OnlineBooking['status']) {
  if (status === 'confirmed') return 'bg-emerald-100 text-emerald-800';
  if (status === 'cancelled') return 'bg-slate-200 text-slate-600';
  return 'bg-amber-100 text-amber-900';
}

export const OnlineBookingsView: React.FC<OnlineBookingsViewProps> = ({
  canEdit,
  isMotorWorldShop,
  onBookingConfirmed,
}) => {
  const [bookings, setBookings] = useState<OnlineBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusTab, setStatusTab] = useState<'all' | OnlineBooking['status']>('pending');
  const [confirmTarget, setConfirmTarget] = useState<OnlineBooking | null>(null);
  const [quotedAmount, setQuotedAmount] = useState('0');
  const [modeOfPayment, setModeOfPayment] = useState('Cash');
  const [dueDays, setDueDays] = useState(30);
  const [confirmNote, setConfirmNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    if (!isMotorWorldShop) {
      setBookings([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    bookingsApi
      .list()
      .then((res) => setBookings(res.bookings ?? []))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load bookings.'))
      .finally(() => setLoading(false));
  }, [isMotorWorldShop]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    if (statusTab === 'all') return bookings;
    return bookings.filter((b) => b.status === statusTab);
  }, [bookings, statusTab]);

  const pendingCount = useMemo(() => bookings.filter((b) => b.status === 'pending').length, [bookings]);

  const openConfirm = (b: OnlineBooking) => {
    setConfirmTarget(b);
    setQuotedAmount('0');
    setModeOfPayment('Cash');
    setDueDays(30);
    setConfirmNote('');
  };

  const handleConfirm = async () => {
    if (!confirmTarget) return;
    setBusy(true);
    setError(null);
    try {
      await bookingsApi.confirm(confirmTarget.id, {
        quotedAmount: Math.max(0, Number(quotedAmount) || 0),
        modeOfPayment,
        dueDays: modeOfPayment === 'Credit' ? dueDays : undefined,
        confirmNote: confirmNote.trim() || undefined,
      });
      setConfirmTarget(null);
      load();
      onBookingConfirmed?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Confirm failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleCancel = async (b: OnlineBooking) => {
    if (!window.confirm(`Cancel booking for ${b.fullName}?`)) return;
    setBusy(true);
    setError(null);
    try {
      await bookingsApi.cancel(b.id);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Cancel failed.');
    } finally {
      setBusy(false);
    }
  };

  if (!isMotorWorldShop) {
    return (
      <div className="animate-fade-in">
        <DashboardSurface className="p-8 text-center text-slate-600">
          <p className="font-medium text-slate-800">Online bookings are for Motor World only.</p>
          <p className="mt-2 text-sm">
            Switch the store picker to <strong>Motor World</strong> to manage website booking requests.
          </p>
        </DashboardSurface>
      </div>
    );
  }

  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-800">Online bookings</h2>
          <p className="text-sm text-slate-500">
            Requests from the public website. Confirm to create the customer, service sale, and history entry.
          </p>
        </div>
        {pendingCount > 0 && (
          <span className="inline-flex items-center rounded-full bg-amber-100 px-3 py-1 text-sm font-semibold text-amber-900">
            {pendingCount} pending
          </span>
        )}
      </div>

      {error && <InlineAlert message={error} />}

      <div className="flex flex-wrap gap-2">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setStatusTab(tab.id)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
              statusTab === tab.id
                ? 'bg-indigo-600 text-white'
                : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-slate-500 py-8">
          <Loader2 className="h-5 w-5 animate-spin" />
          Loading bookings…
        </div>
      ) : filtered.length === 0 ? (
        <DashboardSurface className="p-8 text-center text-slate-500">
          No {statusTab === 'all' ? '' : statusTab} bookings.
        </DashboardSurface>
      ) : (
        <ul className="space-y-4">
          {filtered.map((b) => (
            <li key={b.id}>
              <DashboardSurface className="p-5">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold text-slate-900">{b.fullName}</h3>
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase ${statusBadge(b.status)}`}>
                        {b.status}
                      </span>
                    </div>
                    <p className="text-sm font-medium text-indigo-700">{b.serviceLabel}</p>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-600">
                      <span className="inline-flex items-center gap-1">
                        <Phone className="h-3.5 w-3.5" />
                        {b.phone}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Mail className="h-3.5 w-3.5" />
                        {b.email}
                      </span>
                    </div>
                    {b.preferredDate && (
                      <p className="text-sm text-slate-600 inline-flex items-center gap-1">
                        <CalendarClock className="h-3.5 w-3.5" />
                        Preferred: {b.preferredDate}
                      </p>
                    )}
                    {b.vehicleDescription && (
                      <p className="text-sm text-slate-600 inline-flex items-center gap-1">
                        <Car className="h-3.5 w-3.5" />
                        {b.vehicleDescription}
                      </p>
                    )}
                    {b.notes && <p className="text-sm text-slate-500 border-l-2 border-slate-200 pl-3">{b.notes}</p>}
                    <p className="text-xs text-slate-400">
                      Submitted {new Date(b.createdAt).toLocaleString()}
                    </p>
                    {b.status === 'confirmed' && (
                      <p className="text-xs text-emerald-700">
                        Confirmed {b.confirmedAt ? new Date(b.confirmedAt).toLocaleString() : ''}
                        {b.quotedAmount != null && b.quotedAmount > 0 ? ` · ₱${b.quotedAmount.toFixed(2)}` : ''}
                        {b.transactionId ? ` · Sale #${b.transactionId.slice(0, 8)}` : ''}
                      </p>
                    )}
                  </div>
                  {canEdit && b.status === 'pending' && (
                    <div className="flex shrink-0 flex-wrap gap-2">
                      <Button type="button" onClick={() => openConfirm(b)} className="bg-emerald-600 hover:bg-emerald-700">
                        <CheckCircle2 className="h-4 w-4 mr-1" />
                        Confirm &amp; post sale
                      </Button>
                      <Button type="button" variant="secondary" onClick={() => handleCancel(b)} disabled={busy}>
                        <XCircle className="h-4 w-4 mr-1" />
                        Cancel
                      </Button>
                    </div>
                  )}
                </div>
              </DashboardSurface>
            </li>
          ))}
        </ul>
      )}

      {confirmTarget && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-slate-900">Confirm booking</h3>
            <p className="mt-1 text-sm text-slate-600">
              {confirmTarget.fullName} — {confirmTarget.serviceLabel}
            </p>
            <p className="mt-3 text-xs text-slate-500">
              Creates customer account, optional vehicle, and a <strong>Service</strong> sale in history / sales
              reports. Set quoted amount and payment type.
            </p>
            <div className="mt-4 space-y-3">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Quoted amount (₱)</label>
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2"
                  value={quotedAmount}
                  onChange={(e) => setQuotedAmount(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Payment</label>
                <select
                  className="w-full rounded-lg border border-slate-200 px-3 py-2"
                  value={modeOfPayment}
                  onChange={(e) => setModeOfPayment(e.target.value)}
                >
                  <option value="Cash">Cash</option>
                  <option value="Credit">Accounts Receivable</option>
                  <option value="Cheque">Cheque</option>
                  <option value="Purchase Order">Purchase Order</option>
                </select>
              </div>
              {modeOfPayment === 'Credit' && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Payment due (days)</label>
                  <input
                    type="number"
                    min={1}
                    max={365}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2"
                    value={dueDays}
                    onChange={(e) => setDueDays(Number(e.target.value) || 30)}
                  />
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Staff note (optional)</label>
                <textarea
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  rows={2}
                  value={confirmNote}
                  onChange={(e) => setConfirmNote(e.target.value)}
                />
              </div>
            </div>
            <div className="mt-6 flex gap-2">
              <Button type="button" variant="secondary" fullWidth onClick={() => setConfirmTarget(null)} disabled={busy}>
                Back
              </Button>
              <Button type="button" fullWidth onClick={handleConfirm} disabled={busy} className="bg-emerald-600 hover:bg-emerald-700">
                {busy ? 'Posting…' : 'Confirm'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
