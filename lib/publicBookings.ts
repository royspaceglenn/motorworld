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
  const res = await fetch('/api/public/motorworld/bookings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || 'Could not submit booking.');
  }
  return {
    bookingId: String((data as { bookingId?: string }).bookingId || ''),
    message: String((data as { message?: string }).message || 'Booking received.'),
  };
}
