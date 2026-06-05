import express from 'express';
import { requireAdmin } from '../middleware/rbac.js';
import {
  addTransaction,
  getItemById,
  getReturnedQuantityForRelease,
  getSoaByTransactionId,
  getTransactionById,
  getTransactions,
  rebuildProductItemInventoryFromLedger,
  resolveChequeForRelease,
  syncReceivablesForRelease,
  updateItem,
  updateTransaction,
  upsertDocumentArchivesForRelease,
} from '../db/store.js';
import { logActivity } from '../services/activityLogger.js';
import { notifyAdminsAboutAction } from '../services/notificationService.js';
import { scheduleViewerSync } from '../services/firebaseViewerSync.js';

const router = express.Router();

function resolveTransactionTimestamp(body) {
  const ts = String(body?.timestamp || '').trim();
  if (ts) {
    const d = new Date(ts);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  const td = String(body?.transactionDate || '').trim();
  if (td) {
    const d = new Date(td.length === 10 ? `${td}T12:00:00` : td);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return new Date().toISOString();
}

router.get('/', async (_req, res) => {
  return res.json({ transactions: await getTransactions() });
});

router.patch('/:id/metadata', requireAdmin, async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    const existing = await getTransactionById(id);
    if (!existing || (existing.type !== 'RELEASE' && existing.type !== 'ISSUE')) {
      return res.status(400).json({ error: 'Only RELEASE or ISSUE transactions support metadata correction here.' });
    }
    const b = req.body || {};
    const patch = {};
    if (b.recipient !== undefined) patch.recipient = String(b.recipient ?? '').trim() || null;
    if (b.note !== undefined) patch.note = String(b.note ?? '').trim() || null;
    if (b.invoiceNumber !== undefined) patch.invoice_number = String(b.invoiceNumber ?? '').trim() || null;
    if (b.dueDate !== undefined) patch.due_date = String(b.dueDate ?? '').trim() || null;
    if (b.terms !== undefined) patch.terms = String(b.terms ?? '').trim() || null;
    if (b.chequeExpectedClearDate !== undefined) {
      patch.cheque_expected_clear_date = String(b.chequeExpectedClearDate ?? '').trim() || null;
    }
    if (b.chequeReference !== undefined) patch.cheque_reference = String(b.chequeReference ?? '').trim() || null;
    if (b.modeOfPaymentOther !== undefined) {
      patch.mode_of_payment_other = String(b.modeOfPaymentOther ?? '').trim() || null;
    }
    if (b.releasedBy !== undefined) patch.released_by = String(b.releasedBy ?? '').trim() || null;
    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ error: 'No allowed fields to update.' });
    }
    await updateTransaction(id, patch);
    const updated = await getTransactionById(id);
    const soa = await getSoaByTransactionId(id);
    await upsertDocumentArchivesForRelease(updated, req.user.id, { soaId: soa?.id ?? null });
    await logActivity(req.user.id, 'EDIT_POS_METADATA', {
      transactionId: id,
      fields: Object.keys(patch),
    });
    scheduleViewerSync();
    return res.json(updated);
  } catch (error) {
    return res.status(500).json({ error: error?.message || 'Failed to update transaction metadata.' });
  }
});

router.patch('/:id', requireAdmin, async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    const existing = await getTransactionById(id);
    if (!existing || existing.type !== 'ADDITION') {
      return res.status(400).json({ error: 'Only ADDITION (stock-in / restock) records can be edited here.' });
    }
    if (!existing.itemId) {
      return res.status(400).json({ error: 'This addition is not linked to an inventory item.' });
    }

    const qty = Math.abs(Number(req.body?.quantityChange ?? existing.quantityChange));
    if (!Number.isFinite(qty) || qty <= 0) {
      return res.status(400).json({ error: 'Quantity must be greater than zero.' });
    }

    const cap = Number(req.body?.unitPriceAtTime ?? existing.unitPriceAtTime);
    if (!Number.isFinite(cap) || cap < 0) {
      return res.status(400).json({ error: 'Capital cost per unit must be a valid non-negative number.' });
    }

    const sellIn = req.body?.sellingPriceAtTime;
    const sellResolved =
      sellIn !== undefined && sellIn !== '' && Number.isFinite(Number(sellIn))
        ? Number(sellIn)
        : existing.sellingPriceAtTime != null && Number.isFinite(Number(existing.sellingPriceAtTime))
          ? Number(existing.sellingPriceAtTime)
          : null;

    const note = req.body?.note !== undefined ? String(req.body.note ?? '') : existing.note ?? '';
    const receipt =
      req.body?.receiptNumber !== undefined ? String(req.body.receiptNumber ?? '') : existing.receiptNumber ?? '';
    const editSummary =
      String(req.body?.editSummary || '').trim() || 'Stock addition (restock) corrected.';
    const now = new Date().toISOString();

    await updateTransaction(id, {
      quantity_change: qty,
      unit_price_at_time: cap,
      selling_price_at_time: sellResolved,
      total_value: qty * cap,
      note: note || null,
      receipt_number: receipt || null,
      edited_at: now,
      edit_note: editSummary,
    });

    await rebuildProductItemInventoryFromLedger(existing.itemId);

    await logActivity(req.user.id, 'EDIT_ADDITION', {
      transactionId: id,
      itemId: existing.itemId,
      itemName: existing.itemName,
      quantity: qty,
    });
    await notifyAdminsAboutAction(
      req.user,
      'EDIT_ADDITION',
      `corrected restock #${id.slice(0, 8)} for ${existing.itemName}`
    );
    scheduleViewerSync();

    const updated = await getTransactionById(id);
    return res.json(updated);
  } catch (error) {
    return res.status(500).json({ error: error?.message || 'Failed to update addition.' });
  }
});

router.post('/resolve-cheque', requireAdmin, async (req, res) => {
  try {
    const releaseTransactionId = String(req.body?.releaseTransactionId || '').trim();
    const outcome = String(req.body?.outcome || '').trim().toLowerCase();
    const result = await resolveChequeForRelease(releaseTransactionId, outcome);
    await logActivity(req.user.id, outcome === 'cleared' ? 'CHEQUE_CLEARED' : 'CHEQUE_BOUNCED', {
      transactionId: releaseTransactionId,
    });
    scheduleViewerSync();
    return res.json(result);
  } catch (error) {
    const msg = error?.message || 'Failed to resolve cheque.';
    const status = msg.includes('not found') ? 404 : msg.includes('Only cheque') || msg.includes('already cleared') ? 400 : 500;
    return res.status(status).json({ error: msg });
  }
});

router.post('/', requireAdmin, async (req, res) => {
  try {
    const payload = req.body || {};
    const itemType = payload.itemType === 'Service' ? 'Service' : 'Product';
    const quantity = Math.abs(Number(payload.quantityChange ?? 0));
    const type = String(payload.type || '');
    const posLines = Array.isArray(payload.posLineItems) ? payload.posLineItems : [];
    const historicalSale = Boolean(payload.historicalSale);
    const hasPosBasket = posLines.length > 0;
    const hasPosProductLines = posLines.some((l) => l.itemType === 'Product' && (l.itemId || historicalSale));
    const item = payload.itemId ? await getItemById(payload.itemId) : null;

    if (itemType === 'Product' && !item && !(type === 'RELEASE' && (hasPosBasket || historicalSale))) {
      return res.status(404).json({ error: 'Inventory item not found.' });
    }
    if (quantity <= 0) {
      return res.status(400).json({ error: 'Quantity must be greater than zero.' });
    }

    if (type === 'RELEASE' || type === 'ISSUE') {
      payload.timestamp = resolveTransactionTimestamp(payload);
    }

    if (type === 'RELEASE' && hasPosProductLines && !historicalSale) {
      for (const line of posLines) {
        if (line.itemType !== 'Product' || !line.itemId) continue;
        const lineQty = Math.abs(Number(line.quantity) || 0);
        if (lineQty <= 0) continue;
        const inv = await getItemById(line.itemId);
        if (!inv) return res.status(404).json({ error: `Inventory item not found: ${line.itemId}` });
        if (inv.quantity < lineQty) {
          return res.status(400).json({ error: `Insufficient stock for ${inv.name}.` });
        }
      }
    } else if ((type === 'RELEASE' || type === 'ISSUE') && item && !historicalSale && item.quantity < quantity) {
      return res.status(400).json({ error: 'Insufficient stock.' });
    }

    if (type === 'RELEASE' && hasPosProductLines && !historicalSale) {
      const saleTimestamp = payload.timestamp;
      for (const line of posLines) {
        if (line.itemType !== 'Product' || !line.itemId) continue;
        const lineQty = Math.abs(Number(line.quantity) || 0);
        if (lineQty <= 0) continue;
        const inv = await getItemById(line.itemId);
        await updateItem(inv.id, {
          quantity: inv.quantity - lineQty,
          unitPrice: inv.unitPrice,
          lastUpdated: saleTimestamp,
          receiptNumber: payload.receiptNumber ?? inv.receiptNumber ?? null,
        });
      }
    } else if (item && ['RELEASE', 'ISSUE', 'RETURN', 'ADDITION'].includes(type)) {
      const delta = Number(payload.quantityChange ?? 0);
      if (type === 'ADDITION') {
        const addQty = Math.abs(delta);
        const cost = Number(payload.unitPriceAtTime ?? item.capitalPrice ?? item.unitPrice);
        const sellInput = payload.sellingPriceAtTime ?? payload.selling_price_at_time;
        const sell =
          sellInput != null && sellInput !== ''
            ? Number(sellInput)
            : Number(item.unitPrice);
        const q0 = Number(item.quantity);
        const q1 = q0 + addQty;
        const oldCap = Number(item.capitalPrice ?? item.unitPrice);
        const oldSell = Number(item.unitPrice);
        const newCap = q1 > 0 ? (q0 * oldCap + addQty * cost) / q1 : cost;
        const newSell =
          sellInput != null && sellInput !== '' && Number.isFinite(Number(sellInput))
            ? (q0 * oldSell + addQty * sell) / q1
            : oldSell;
        await updateItem(item.id, {
          quantity: q1,
          unitPrice: newSell,
          capitalPrice: newCap,
          lastUpdated: payload.timestamp,
          receiptNumber: payload.receiptNumber ?? item.receiptNumber ?? null,
        });
      } else {
        await updateItem(item.id, {
          quantity: item.quantity + delta,
          unitPrice: item.unitPrice,
          lastUpdated: payload.timestamp,
          receiptNumber: payload.receiptNumber ?? item.receiptNumber ?? null,
        });
      }
    }

    const mode = String(payload.modeOfPayment || '').trim();
    const created = await addTransaction({
      ...payload,
      itemType,
      historicalSale: historicalSale || undefined,
      bundledSale: hasPosBasket && posLines.length > 1 ? true : payload.bundledSale,
      releasedBy: req.user.displayName,
      chequeExpectedClearDate:
        mode === 'Cheque' ? String(payload.chequeExpectedClearDate || '').trim() || null : null,
      chequeReference:
        mode === 'Cheque' && payload.chequeReference
          ? String(payload.chequeReference).trim()
          : null,
      chequeStatus: mode === 'Cheque' ? 'pending' : null,
      chequeClearedAt: null,
    });

    let soaIdForArchive = null;
    if (type === 'RELEASE' && created.recipient) {
      try {
        const receivable = await syncReceivablesForRelease(created, payload);
        soaIdForArchive = receivable.soaId;
        if (soaIdForArchive) {
          await logActivity(req.user.id, 'CREATE_SOA', {
            soaId: soaIdForArchive,
            transactionId: created.id,
            customerName: created.recipient,
            modeOfPayment: created.modeOfPayment,
          });
        }
      } catch (receivableErr) {
        return res.status(400).json({
          error: receivableErr?.message || 'Failed to create receivable records for this sale.',
        });
      }
    }

    if (type === 'RELEASE') {
      await upsertDocumentArchivesForRelease(created, req.user.id, { soaId: soaIdForArchive });
    }

    await logActivity(req.user.id, created.type, {
      transactionId: created.id,
      itemId: created.itemId,
      itemName: created.itemName,
      quantity,
      recipient: created.recipient,
      ...(created.type === 'RELEASE'
        ? {
            totalValue: created.totalValue,
            modeOfPayment: created.modeOfPayment,
            posLineCount: Array.isArray(created.posLineItems) ? created.posLineItems.length : 0,
          }
        : {}),
    });
    const actionText =
      created.type === 'ISSUE'
        ? `issued ${quantity} of ${created.itemName} to ${created.recipient || 'internal use'}`
        : created.type === 'RETURN'
          ? `returned ${quantity} of ${created.itemName}`
          : created.type === 'ADDITION'
            ? `added stock for ${created.itemName}`
            : `released ${quantity} of ${created.itemName} to ${created.recipient || 'customer'}`;
    await notifyAdminsAboutAction(req.user, created.type, actionText);
    scheduleViewerSync();
    return res.status(201).json(created);
  } catch (error) {
    return res.status(500).json({ error: error?.message || 'Failed to create transaction.' });
  }
});

router.post('/return-from-sales', requireAdmin, async (req, res) => {
  try {
    const releaseTransactionId = String(req.body?.releaseTransactionId || '').trim();
    const returnQuantity = Number(req.body?.returnQuantity || 0);
    const reason = req.body?.reason || 'others';
    const condition = req.body?.condition === 'defective' ? 'defective' : 'restock';
    const returnReasonText = String(req.body?.returnReasonText || '').trim();

    const release = await getTransactionById(releaseTransactionId);
    if (!release || release.type !== 'RELEASE') {
      return res.status(404).json({ error: 'Release transaction not found.' });
    }
    if (returnQuantity <= 0) {
      return res.status(400).json({ error: 'Return quantity must be greater than zero.' });
    }

    const releasedQty = Math.abs(Number(release.quantityChange));
    const alreadyReturned = await getReturnedQuantityForRelease(releaseTransactionId);
    if (returnQuantity > releasedQty - alreadyReturned) {
      return res.status(400).json({ error: 'Return quantity exceeds the remaining released quantity.' });
    }

    const item = release.itemId ? await getItemById(release.itemId) : null;
    if (!item) return res.status(404).json({ error: 'Item not found.' });

    if (condition === 'restock') {
      await updateItem(item.id, { quantity: item.quantity + returnQuantity, lastUpdated: nowIso() });
    } else {
      await updateItem(item.id, {
        defectiveQuantity: (item.defectiveQuantity || 0) + returnQuantity,
        lastUpdated: nowIso(),
      });
    }

    const created = await addTransaction({
      id: crypto.randomUUID(),
      itemId: release.itemId,
      itemName: release.itemName,
      type: 'RETURN_FROM_SALES',
      quantityChange: returnQuantity,
      unitPriceAtTime: release.unitPriceAtTime,
      totalValue: returnQuantity * release.unitPriceAtTime,
      timestamp: nowIso(),
      recipient: release.recipient,
      note: returnReasonText || null,
      releaseTransactionId,
      returnReason: reason,
      returnReasonText,
      condition,
      returnProcessedBy: req.user.displayName,
      itemType: 'Product',
    });

    await logActivity(req.user.id, 'RETURN_FROM_SALES', {
      itemId: created.itemId,
      itemName: created.itemName,
      quantity: returnQuantity,
      returnReason: returnReasonText,
    });
    await notifyAdminsAboutAction(
      req.user,
      'RETURN_FROM_SALES',
      `returned ${returnQuantity} of ${created.itemName} from sales`
    );
    scheduleViewerSync();
    return res.status(201).json(created);
  } catch (error) {
    return res.status(500).json({ error: error?.message || 'Failed to process return from sales.' });
  }
});

function nowIso() {
  return new Date().toISOString();
}

export default router;
