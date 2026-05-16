import { SHOP_IDS } from '../lib/shops.js';
import { runWithShop } from '../lib/shopContext.js';

function normalizeShops(user) {
  const raw = user?.shops;
  if (Array.isArray(raw) && raw.length) {
    return raw.map((s) => String(s).trim()).filter((s) => SHOP_IDS.includes(s));
  }
  return [SHOP_IDS[0]];
}

/**
 * Reads `X-Motor-Shop-Id` (motorworld | ecfp), validates against JWT/session shops, then runs the rest of the stack
 * with AsyncLocalStorage so DB reads/writes use the correct prefixed collections.
 */
export function shopScopeMiddleware(req, res, next) {
  if (!req.user) return next();
  let shopId = String(req.headers['x-motor-shop-id'] || '').trim().toLowerCase();
  if (!shopId) shopId = SHOP_IDS[0];
  if (!SHOP_IDS.includes(shopId)) {
    return res.status(400).json({
      error: `Invalid X-Motor-Shop-Id. Allowed: ${SHOP_IDS.join(', ')}`,
    });
  }
  const allowed = normalizeShops(req.user);
  if (!allowed.includes(shopId)) {
    return res.status(403).json({ error: 'Your account cannot manage this store.' });
  }
  runWithShop(shopId, () => next());
}
