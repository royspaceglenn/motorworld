import express from 'express';
import { createOnlineBooking, getAllItems, notifyAdminsOnlineBooking } from '../db/store.js';
import { runWithShop } from '../lib/shopContext.js';
import { DEFAULT_SHOP_ID } from '../lib/shops.js';
import { scheduleViewerSync } from '../services/firebaseViewerSync.js';

const router = express.Router();

function normalizeStockPurpose(value) {
  return value === 'for_supply' ? 'for_supply' : 'for_sale';
}

function isPublicRetailItem(item) {
  const category = String(item.category ?? '').trim().toLowerCase();
  if (category === 'supply' || category === 'company supply') return false;
  if (normalizeStockPurpose(item.stockPurpose) !== 'for_sale') return false;
  return Number(item.quantity ?? 0) > 0;
}

function toPublicProduct(item) {
  return {
    id: item.id,
    name: String(item.name ?? '').trim(),
    brand: String(item.brand ?? '').trim(),
    category: String(item.category ?? 'Uncategorized').trim(),
    unitPrice: Number(item.unitPrice ?? 0),
    unit: String(item.unit ?? 'pcs').trim() || 'pcs',
    quantity: Number(item.quantity ?? 0),
    description: String(item.description ?? '').trim(),
  };
}

/**
 * Public read-only catalog for the marketing site (Motor World retail inventory).
 * No auth — exposes only for-sale SKUs with stock on hand (no cost/capital data).
 */
router.get('/motorworld/products', async (_req, res) => {
  try {
    const products = await runWithShop(DEFAULT_SHOP_ID, async () => {
      const items = await getAllItems();
      return items
        .filter(isPublicRetailItem)
        .map(toPublicProduct)
        .sort((a, b) => {
          const cat = a.category.localeCompare(b.category, undefined, { sensitivity: 'base' });
          if (cat !== 0) return cat;
          return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
        });
    });
    return res.json({
      shopId: DEFAULT_SHOP_ID,
      updatedAt: new Date().toISOString(),
      count: products.length,
      products,
    });
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'Failed to load public catalog.' });
  }
});

/**
 * Public website — service booking request (stored for Motor World staff).
 */
router.post('/motorworld/bookings', async (req, res) => {
  try {
    const body = req.body || {};
    const fullName = String(body.fullName || '').trim();
    const phone = String(body.phone || '').trim();
    const email = String(body.email || '').trim();
    const serviceKey = String(body.serviceKey || '').trim();
    const serviceLabel = String(body.serviceLabel || '').trim();

    if (!fullName || !phone || !email || !serviceKey || !serviceLabel) {
      return res.status(400).json({
        error: 'fullName, phone, email, serviceKey, and serviceLabel are required.',
      });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Invalid email address.' });
    }

    const booking = await runWithShop(DEFAULT_SHOP_ID, async () =>
      createOnlineBooking({
        fullName,
        phone,
        email,
        serviceKey,
        serviceLabel,
        preferredDate: body.preferredDate ? String(body.preferredDate).trim() : null,
        vehicleDescription: body.vehicleDescription ? String(body.vehicleDescription).trim() : null,
        notes: body.notes ? String(body.notes).trim() : null,
      })
    );

    await runWithShop(DEFAULT_SHOP_ID, async () => notifyAdminsOnlineBooking(booking));
    scheduleViewerSync();

    return res.status(201).json({ ok: true, bookingId: booking.id, message: 'Booking received.' });
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'Failed to submit booking.' });
  }
});

export default router;
