import express from 'express';
import { requireAdmin } from '../middleware/rbac.js';
import {
  addPurchasePayment,
  addTransaction,
  createPurchase,
  getItemById,
  getPurchaseById,
  getPurchases,
} from '../db/store.js';
import { logActivity } from '../services/activityLogger.js';
import { notifyAdminsAboutAction } from '../services/notificationService.js';
import { scheduleViewerSync } from '../services/firebaseViewerSync.js';

const router = express.Router();

router.get('/', async (req, res) => {
  return res.json({
    purchases: await getPurchases({ status: req.query.status ? String(req.query.status) : undefined }),
  });
});

router.get('/:id', async (req, res) => {
  const purchase = await getPurchaseById(req.params.id);
  if (!purchase) return res.status(404).json({ error: 'Purchase not found.' });
  return res.json({ purchase });
});

router.post('/', requireAdmin, async (req, res) => {
  try {
    const lineItems = Array.isArray(req.body?.lineItems) ? req.body.lineItems : [];
    if (!req.body?.supplierId || !req.body?.supplierName || lineItems.length === 0) {
      return res.status(400).json({ error: 'supplierId, supplierName, and lineItems are required.' });
    }

    const modeRaw = String(req.body?.purchaseDiscountMode || 'none').toLowerCase();
    const purchaseDiscountMode = ['none', 'percent', 'amount'].includes(modeRaw) ? modeRaw : 'none';
    const purchaseDiscountValue = Math.max(0, Number(req.body?.purchaseDiscountValue || 0));

    const normalizedLines = [];
    let merchandiseSubtotal = 0;
    let expectedRevenue = 0;

    for (const line of lineItems) {
      const itemId = String(line.itemId || '').trim();
      const itemName = String(line.itemName || '').trim();
      const quantity = Math.max(0, Number(line.quantity || 0));
      const unitCost = Math.max(0, Number(line.unitCost || 0));
      if (!itemId || quantity <= 0) {
        return res.status(400).json({ error: 'Each line must include itemId, quantity > 0, and unit cost.' });
      }
      const inv = await getItemById(itemId);
      const sellingPrice = Math.max(
        0,
        Number(line.sellingPrice != null && line.sellingPrice !== '' ? line.sellingPrice : inv?.unitPrice ?? 0)
      );
      const lineMerchTotal = quantity * unitCost;
      merchandiseSubtotal += lineMerchTotal;
      expectedRevenue += quantity * sellingPrice;
      normalizedLines.push({
        itemId,
        itemName: itemName || inv?.name || 'Item',
        quantity,
        unitCost,
        sellingPrice,
        total: lineMerchTotal,
      });
    }

    const totalReceiveQuantity = normalizedLines.reduce((s, l) => s + l.quantity, 0);
    let discountTotal = 0;
    if (purchaseDiscountMode === 'percent' && purchaseDiscountValue > 0) {
      const pct = Math.min(100, purchaseDiscountValue);
      discountTotal = merchandiseSubtotal * (pct / 100);
    } else if (purchaseDiscountMode === 'amount' && purchaseDiscountValue > 0) {
      const rawAmountDiscount = purchaseDiscountValue * totalReceiveQuantity;
      discountTotal = Math.min(merchandiseSubtotal, rawAmountDiscount);
    }
    discountTotal = Math.min(discountTotal, merchandiseSubtotal);
    const netMerchandiseCost = merchandiseSubtotal - discountTotal;
    const expectedNetProfit = expectedRevenue - netMerchandiseCost;

    const enrichedLines = normalizedLines.map((line) => {
      const share =
        merchandiseSubtotal > 0 ? discountTotal * (line.total / merchandiseSubtotal) : 0;
      const effLineCost = line.total - share;
      const effectiveUnitCost = line.quantity > 0 ? effLineCost / line.quantity : line.unitCost;
      return {
        ...line,
        effectiveUnitCost,
      };
    });

    const totalAmount = netMerchandiseCost;

    const purchase = await createPurchase({
      ...req.body,
      lineItems: enrichedLines,
      totalAmount,
      status: req.body?.paymentType === 'cash' ? 'paid' : 'unpaid',
      purchaseDiscountMode,
      purchaseDiscountValue,
      merchandiseSubtotal,
      discountTotal,
      expectedRevenueAtSrp: expectedRevenue,
      expectedNetProfit,
      payments:
        req.body?.paymentType === 'cash'
          ? [
              {
                id: crypto.randomUUID(),
                amount: totalAmount,
                method: 'cash',
                paidAt: req.body?.purchaseDate || new Date().toISOString(),
              },
            ]
          : [],
    });

    for (const line of enrichedLines) {
      await addTransaction({
        id: crypto.randomUUID(),
        itemId: line.itemId,
        itemName: line.itemName,
        type: 'ADDITION',
        quantityChange: Number(line.quantity || 0),
        unitPriceAtTime: Number(line.effectiveUnitCost || 0),
        sellingPriceAtTime: Number(line.sellingPrice || 0),
        totalValue: Number(line.quantity || 0) * Number(line.effectiveUnitCost || 0),
        timestamp: purchase.purchaseDate,
        note: `Received from supplier ${purchase.supplierName}`,
        receiptNumber: purchase.receiptNumber,
        purchaseId: purchase.id,
        itemType: 'Product',
      });
    }

    await logActivity(req.user.id, 'CREATE_PURCHASE', {
      purchaseId: purchase.id,
      supplierId: purchase.supplierId,
      supplierName: purchase.supplierName,
      totalAmount: purchase.totalAmount,
    });
    await notifyAdminsAboutAction(req.user, 'CREATE_PURCHASE', `received items from supplier ${purchase.supplierName}`);
    scheduleViewerSync();
    return res.status(201).json(purchase);
  } catch (error) {
    return res.status(500).json({ error: error?.message || 'Failed to create purchase.' });
  }
});

router.post('/:id/payments', requireAdmin, async (req, res) => {
  const amount = Number(req.body?.amount || 0);
  if (amount <= 0) return res.status(400).json({ error: 'Amount must be greater than zero.' });
  const updated = await addPurchasePayment(req.params.id, req.body);
  if (!updated) return res.status(404).json({ error: 'Purchase not found.' });
  await logActivity(req.user.id, 'ADD_PURCHASE_PAYMENT', {
    purchaseId: updated.id,
    amount,
    supplierName: updated.supplierName,
  });
  await notifyAdminsAboutAction(req.user, 'ADD_PURCHASE_PAYMENT', `recorded supplier payment for ${updated.supplierName}`);
  scheduleViewerSync();
  return res.json(updated);
});

export default router;
