import express from 'express';
import { requireAdmin } from '../middleware/rbac.js';
import { deleteCollectionsByShopPrefix } from '../db/shopCollections.js';
import { isValidShopId, SHOP_IDS } from '../lib/shops.js';
import { runWithShop } from '../lib/shopContext.js';
import { logActivity } from '../services/activityLogger.js';
import { scheduleViewerSync } from '../services/firebaseViewerSync.js';

const router = express.Router();

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
