import express from 'express';
import { requireAdmin } from '../middleware/rbac.js';
import {
  cancelOnlineBooking,
  confirmOnlineBooking,
  getOnlineBookingById,
  getOnlineBookings,
} from '../db/store.js';
import { logActivity } from '../services/activityLogger.js';
import { notifyAdminsAboutAction } from '../services/notificationService.js';
import { scheduleViewerSync } from '../services/firebaseViewerSync.js';

const router = express.Router();

router.get('/', requireAdmin, async (req, res) => {
  try {
    const status = req.query.status ? String(req.query.status) : undefined;
    return res.json({ bookings: await getOnlineBookings({ status }) });
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'Failed to load bookings.' });
  }
});

router.get('/:id', requireAdmin, async (req, res) => {
  const booking = await getOnlineBookingById(String(req.params.id || '').trim());
  if (!booking) return res.status(404).json({ error: 'Booking not found.' });
  return res.json({ booking });
});

router.post('/:id/confirm', requireAdmin, async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    const body = req.body || {};
    const result = await confirmOnlineBooking(id, {
      quotedAmount: body.quotedAmount,
      modeOfPayment: body.modeOfPayment,
      dueDays: body.dueDays,
      confirmNote: body.confirmNote,
      confirmedBy: req.user.displayName,
    });
    await logActivity(req.user.id, 'CONFIRM_ONLINE_BOOKING', {
      bookingId: id,
      transactionId: result.transaction.id,
      customerName: result.booking.fullName,
      serviceLabel: result.booking.serviceLabel,
    });
    await notifyAdminsAboutAction(
      req.user,
      'CONFIRM_ONLINE_BOOKING',
      `confirmed online booking for ${result.booking.fullName} (${result.booking.serviceLabel})`
    );
    scheduleViewerSync();
    return res.json(result);
  } catch (e) {
    const msg = e?.message || 'Failed to confirm booking.';
    const status = msg.includes('not found') ? 404 : msg.includes('Only pending') ? 400 : 500;
    return res.status(status).json({ error: msg });
  }
});

router.post('/:id/cancel', requireAdmin, async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    const booking = await cancelOnlineBooking(id, {
      cancelledBy: req.user.displayName,
      reason: req.body?.reason,
    });
    await logActivity(req.user.id, 'CANCEL_ONLINE_BOOKING', { bookingId: id });
    scheduleViewerSync();
    return res.json({ booking });
  } catch (e) {
    const msg = e?.message || 'Failed to cancel booking.';
    const status = msg.includes('not found') ? 404 : msg.includes('Only pending') ? 400 : 500;
    return res.status(status).json({ error: msg });
  }
});

export default router;
