import express from 'express';
import { requireAdmin } from '../middleware/rbac.js';
import { deleteCollectionsByShopPrefix } from '../db/shopCollections.js';
import { deleteAllNonUserCollections } from '../db/collectionsBackend.js';
import { isValidShopId, SHOP_IDS, DEFAULT_SHOP_ID } from '../lib/shops.js';
import { runWithShop } from '../lib/shopContext.js';
import { logActivity } from '../services/activityLogger.js';
import { scheduleViewerSync } from '../services/firebaseViewerSync.js';

const router = express.Router();

const CLEAR_ALL_BUSINESS_CONFIRM = 'DELETE_ALL_BUSINESS_DATA';

/**
 * Wipe every business collection (all stores + legacy unprefixed keys). Keeps `users` only.
 * Admin only; body must include `"confirm": "DELETE_ALL_BUSINESS_DATA"`.
 */
router.post('/clear-all-business-data', requireAdmin, async (req, res) => {
  try {
    const confirm = String(req.body?.confirm || '').trim();
    if (confirm !== CLEAR_ALL_BUSINESS_CONFIRM) {
      return res.status(400).json({
        error: `Send JSON { "confirm": "${CLEAR_ALL_BUSINESS_CONFIRM}" } to wipe all inventory and business data.`,
      });
    }
    const result = await deleteAllNonUserCollections();
    await runWithShop(DEFAULT_SHOP_ID, async () => {
      await logActivity(req.user.id, 'CLEAR_ALL_BUSINESS_DATA', {
        collectionsRemoved: result.removed,
        mode: result.mode,
      });
    });
    scheduleViewerSync();
    return res.json({ ok: true, ...result });
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'Failed to wipe all business data.' });
  }
});

/**
 * Wipe all business data for one store (inventory, transactions, receivables, etc.).
 * Does not delete user accounts. Admin only; pass `shopId` in JSON body.
 */
router.post('/clear-store-data', requireAdmin, async (req, res) => {
  try {
    const shopId = String(req.body?.shopId || '').trim();
    if (!isValidShopId(shopId)) {
      return res.status(400).json({ error: `shopId must be one of: ${SHOP_IDS.join(', ')}` });
    }
    const allowed = new Set(req.user.shops || []);
    if (!allowed.has(shopId)) {
      return res.status(403).json({ error: 'You are not allowed to clear this store.' });
    }
    const removed = await deleteCollectionsByShopPrefix(shopId);
    await runWithShop(shopId, async () => {
      await logActivity(req.user.id, 'CLEAR_STORE_DATA', { shopId, collectionsRemoved: removed });
    });
    scheduleViewerSync();
    return res.json({ ok: true, shopId, collectionsRemoved: removed });
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'Failed to clear store data.' });
  }
});

export default router;
