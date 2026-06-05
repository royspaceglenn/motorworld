import express from 'express';
import { requireAdmin } from '../middleware/rbac.js';
import { addLoanPayment, getLoanById, getLoanByTransactionId, getLoans, updateLoanStatus } from '../db/store.js';
import { logActivity } from '../services/activityLogger.js';
import { notifyAdminsAboutAction } from '../services/notificationService.js';

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const limit = req.query.limit ? Number(req.query.limit) : 500;
    const offset = req.query.offset ? Number(req.query.offset) : 0;
    const { loans, total } = await getLoans({
      status: req.query.status ? String(req.query.status) : undefined,
      customerName: req.query.customerName ? String(req.query.customerName) : undefined,
      limit,
      offset,
      includePayments: false,
    });
    return res.json({ loans, total });
  } catch (error) {
    const msg = error?.message || 'Failed to load receivable accounts.';
    return res.status(500).json({ error: msg });
  }
});

router.get('/by-transaction/:transactionId', async (req, res) => {
  const loan = await getLoanByTransactionId(req.params.transactionId);
  if (!loan) return res.status(404).json({ error: 'Loan not found.' });
  return res.json(loan);
});

router.get('/:id', async (req, res) => {
  const loan = await getLoanById(req.params.id);
  if (!loan) return res.status(404).json({ error: 'Loan not found.' });
  return res.json(loan);
});

router.post('/:id/payments', requireAdmin, async (req, res) => {
  const amountPaid = Number(req.body?.amountPaid ?? req.body?.amount ?? 0);
  if (amountPaid <= 0) return res.status(400).json({ error: 'amountPaid is required.' });
  const loan = await addLoanPayment(req.params.id, req.body);
  if (!loan) return res.status(404).json({ error: 'Loan not found.' });
  await logActivity(req.user.id, 'ADD_LOAN_PAYMENT', { loanId: loan.id, amountPaid });
  await notifyAdminsAboutAction(req.user, 'ADD_LOAN_PAYMENT', `recorded loan payment for ${loan.customerName}`);
  return res.json({ loan, payment: loan.payments?.[0] || null });
});

router.patch('/:id', requireAdmin, async (req, res) => {
  const status = String(req.body?.status || '').trim();
  if (!status) return res.status(400).json({ error: 'status is required.' });
  const loan = await updateLoanStatus(req.params.id, status);
  if (!loan) return res.status(404).json({ error: 'Loan not found.' });
  await logActivity(req.user.id, 'UPDATE_LOAN_STATUS', { loanId: loan.id, status });
  await notifyAdminsAboutAction(req.user, 'UPDATE_LOAN_STATUS', `updated loan status for ${loan.customerName}`);
  return res.json(loan);
});

export default router;
