import express from 'express';
import { requireAdmin } from '../middleware/rbac.js';
import {
  addTransaction,
  createItem,
  deleteItem,
  getAllItems,
  getItemById,
  importInventoryPriceList,
  updateItem,
} from '../db/store.js';
import { logActivity } from '../services/activityLogger.js';
import { notifyAdminsAboutAction } from '../services/notificationService.js';
import { scheduleViewerSync } from '../services/firebaseViewerSync.js';

const router = express.Router();

router.get('/', async (_req, res) => {
  return res.json({ items: await getAllItems() });
});

router.post('/', requireAdmin, async (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Item name is required.' });

  const created = await createItem(req.body);
  if (created.quantity > 0) {
    const cap = Number(created.capitalPrice ?? created.unitPrice);
    await addTransaction({
      id: crypto.randomUUID(),
      itemId: created.id,
      itemName: created.name,
      type: 'ADDITION',
      quantityChange: created.quantity,
      unitPriceAtTime: cap,
      sellingPriceAtTime: Number(created.unitPrice),
      totalValue: created.quantity * cap,
      timestamp: created.createdAt ?? created.lastUpdated,
      note: 'Initial Stock',
      receiptNumber: created.receiptNumber,
      itemType: 'Product',
    });
  }
  await logActivity(req.user.id, 'ADD_ITEM', { itemId: created.id, itemName: created.name });
  await notifyAdminsAboutAction(req.user, 'ADD_ITEM', `added item: ${created.name}`);
  scheduleViewerSync();
  return res.status(201).json(created);
});

router.put('/:id', requireAdmin, async (req, res) => {
  const existing = await getItemById(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Item not found.' });
  const updated = await updateItem(req.params.id, req.body);
  if (!updated) return res.status(404).json({ error: 'Item not found.' });

  if (updated.quantity !== existing.quantity) {
    const cap = Number(updated.capitalPrice ?? updated.unitPrice);
    await addTransaction({
      id: crypto.randomUUID(),
      itemId: updated.id,
      itemName: updated.name,
      type: 'ADJUSTMENT',
      quantityChange: updated.quantity - existing.quantity,
      unitPriceAtTime: cap,
      totalValue: (updated.quantity - existing.quantity) * cap,
      timestamp: updated.lastUpdated,
      note: 'Manual adjustment via Edit',
      receiptNumber: updated.receiptNumber,
      itemType: 'Product',
    });
  }

  const changes = [];
  if (existing.name !== updated.name) changes.push({ field: 'Name', from: existing.name, to: updated.name });
  if (existing.quantity !== updated.quantity) changes.push({ field: 'Quantity', from: existing.quantity, to: updated.quantity });
  if (existing.unitPrice !== updated.unitPrice) changes.push({ field: 'Selling price', from: existing.unitPrice, to: updated.unitPrice });
  if (existing.capitalPrice !== updated.capitalPrice) changes.push({ field: 'Capital price', from: existing.capitalPrice, to: updated.capitalPrice });

  await logActivity(req.user.id, 'EDIT_ITEM', { itemId: updated.id, itemName: updated.name, changes });
  await notifyAdminsAboutAction(req.user, 'EDIT_ITEM', `edited item: ${updated.name}`);
  scheduleViewerSync();
  return res.json(updated);
});

router.post('/import-price-list', requireAdmin, async (req, res) => {
  try {
    const body = req.body || {};
    const rows = Array.isArray(body.rows) ? body.rows : [];
    if (!rows.length) {
      return res.status(400).json({ error: 'No rows to import. Upload a price list Excel file first.' });
    }
    const result = await importInventoryPriceList(rows, {
      mode: body.mode === 'createOnly' ? 'createOnly' : 'upsert',
      sourceLabel: body.sourceLabel ? String(body.sourceLabel) : 'Inventory price list import',
    });
    await logActivity(req.user.id, 'IMPORT_INVENTORY_PRICE_LIST', {
      created: result.created,
      updated: result.updated,
      skipped: result.skipped,
      errors: result.errors.length,
    });
    await notifyAdminsAboutAction(
      req.user,
      'IMPORT_INVENTORY_PRICE_LIST',
      `imported inventory price list (${result.created} new, ${result.updated} updated)`
    );
    scheduleViewerSync();
    return res.json({
      ...result,
      items: await getAllItems(),
    });
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'Import failed.' });
  }
});

router.delete('/:id', requireAdmin, async (req, res) => {
  const existing = await getItemById(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Item not found.' });
  await deleteItem(req.params.id);
  await logActivity(req.user.id, 'DELETE_ITEM', { itemId: existing.id, itemName: existing.name });
  await notifyAdminsAboutAction(req.user, 'DELETE_ITEM', `deleted item: ${existing.name}`);
  scheduleViewerSync();
  return res.json({ success: true });
});

export default router;
