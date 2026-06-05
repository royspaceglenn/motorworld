import type { OnlineBooking } from '../types';

export type PosPaymentType = 'Cash' | 'Purchase Order' | 'Accounts Receivable' | 'Cheque';

export interface PosBookingTransfer {
  bookingId: string;
  fullName: string;
  personId?: string | null;
  vehicleId?: string | null;
  serviceLabel: string;
  quotedAmount?: number | null;
  modeOfPayment?: string | null;
  confirmNote?: string | null;
  preferredDate?: string | null;
  bookingNotes?: string | null;
  dueDays?: number | null;
}

export function posPaymentFromBookingMode(mode?: string | null): PosPaymentType {
  const m = String(mode || 'Cash').trim().toLowerCase();
  if (m === 'credit' || m.includes('receivable')) return 'Accounts Receivable';
  if (m === 'cheque') return 'Cheque';
  if (m === 'purchase order') return 'Purchase Order';
  return 'Cash';
}

export function posTransferFromOnlineBooking(booking: OnlineBooking): PosBookingTransfer {
  return {
    bookingId: booking.id,
    fullName: booking.fullName,
    personId: booking.personId,
    vehicleId: booking.vehicleId,
    serviceLabel: booking.serviceLabel,
    quotedAmount: booking.quotedAmount,
    modeOfPayment: booking.modeOfPayment,
    confirmNote: booking.confirmNote,
    preferredDate: booking.preferredDate,
    bookingNotes: booking.notes,
    dueDays: booking.dueDays,
  };
}
