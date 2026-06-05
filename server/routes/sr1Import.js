import { Router } from 'express';
import { requireAdmin } from '../middleware/rbac.js';
import { applySr1Import } from '../lib/sr1ImportService.js';
import { scheduleViewerSync } from '../services/firebaseViewerSync.js';

const router = Router();

router.post('/apply', requireAdmin, async (req, res) => {
  try {
    const result = await applySr1Import(req.body || {}, req.user);
    scheduleViewerSync();
    return res.json(result);
  } catch (error) {
    const msg = error?.message || 'SR-1 import failed.';
    const status = msg.includes('No sales') ? 400 : 500;
    return res.status(status).json({ error: msg });
  }
});

export default router;
