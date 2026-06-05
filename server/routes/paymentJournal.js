import express from 'express';
import { getPaymentJournal } from '../db/store.js';

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const limit = Number(req.query.limit || 200);
    const offset = Number(req.query.offset || 0);
    const entries = await getPaymentJournal({ limit, offset });
    return res.json({ entries, total: entries.length });
  } catch (error) {
    const msg = error?.message || 'Failed to load payment journal.';
    return res.status(500).json({ error: msg });
  }
});

export default router;
