import { publicApiUrl, readPublicApiError } from './publicApi';

export interface SubmitOnlineBookingPayload {
  fullName: string;
  phone: string;
  email: string;
  serviceKey: string;
  serviceLabel: string;
  preferredDate?: string;
  vehicleDescription?: string;
  notes?: string;
}

export async function submitMotorWorldOnlineBooking(
  payload: SubmitOnlineBookingPayload
): Promise<{ bookingId: string; message: string }> {
  const res = await fetch(publicApiUrl('/api/public/motorworld/bookings'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(await readPublicApiError(res, 'Could not submit booking.'));
  }
  const data = (await res.json().catch(() => ({}))) as { bookingId?: string; message?: string };
  return {
    bookingId: String(data.bookingId || ''),
    message: String(data.message || 'Booking received.'),
  };
}
