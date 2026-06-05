import express from 'express';
import { requireAdmin } from '../middleware/rbac.js';
import {
  createAndPostPayrollRun,
  createEmployee,
  deleteEmployee,
  getEmployees,
  getPayrollRunById,
  getPayrollRuns,
  previewPayrollFromDtr,
  updateEmployee,
} from '../db/store.js';
import { logActivity } from '../services/activityLogger.js';
import { notifyAdminsAboutAction } from '../services/notificationService.js';
import { scheduleViewerSync } from '../services/firebaseViewerSync.js';

const router = express.Router();

router.get('/employees', async (_req, res) => {
  try {
    return res.json({ employees: await getEmployees() });
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'Failed to load employees.' });
  }
});

router.post('/employees', requireAdmin, async (req, res) => {
  try {
    const created = await createEmployee(req.body || {});
    await logActivity(req.user.id, 'ADD_EMPLOYEE', { employeeId: created.id, name: created.fullName });
    scheduleViewerSync();
    return res.status(201).json({ employee: created });
  } catch (e) {
    return res.status(400).json({ error: e?.message || 'Failed to add employee.' });
  }
});

router.patch('/employees/:id', requireAdmin, async (req, res) => {
  try {
    const updated = await updateEmployee(String(req.params.id), req.body || {});
    if (!updated) return res.status(404).json({ error: 'Employee not found.' });
    await logActivity(req.user.id, 'UPDATE_EMPLOYEE', { employeeId: updated.id });
    scheduleViewerSync();
    return res.json({ employee: updated });
  } catch (e) {
    return res.status(400).json({ error: e?.message || 'Failed to update employee.' });
  }
});

router.delete('/employees/:id', requireAdmin, async (req, res) => {
  try {
    const ok = await deleteEmployee(String(req.params.id));
    if (!ok) return res.status(404).json({ error: 'Employee not found.' });
    await logActivity(req.user.id, 'DELETE_EMPLOYEE', { employeeId: req.params.id });
    scheduleViewerSync();
    return res.json({ success: true });
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'Failed to delete employee.' });
  }
});

router.get('/runs', async (_req, res) => {
  try {
    return res.json({ runs: await getPayrollRuns() });
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'Failed to load payroll runs.' });
  }
});

router.get('/runs/:id', async (req, res) => {
  const run = await getPayrollRunById(String(req.params.id));
  if (!run) return res.status(404).json({ error: 'Payroll run not found.' });
  return res.json({ run });
});

router.post('/preview', requireAdmin, async (req, res) => {
  try {
    const body = req.body || {};
    const preview = await previewPayrollFromDtr({
      summaries: body.summaries,
      periodStart: body.periodStart,
      periodEnd: body.periodEnd,
      periodLabel: body.periodLabel,
    });
    return res.json(preview);
  } catch (e) {
    return res.status(400).json({ error: e?.message || 'Failed to compute payroll.' });
  }
});

router.post('/runs/post', requireAdmin, async (req, res) => {
  try {
    const body = req.body || {};
    const run = await createAndPostPayrollRun(body, {
      postedBy: req.user.displayName,
      recordedBy: req.user.displayName,
      recordedByUserId: req.user.id,
    });
    await logActivity(req.user.id, 'POST_PAYROLL', {
      payrollRunId: run.id,
      periodLabel: run.periodLabel,
      totalNet: run.totalNet,
      expenseCount: run.expenseIds?.length ?? 0,
    });
    await notifyAdminsAboutAction(
      req.user,
      'POST_PAYROLL',
      `posted payroll ${run.periodLabel} (₱${run.totalNet.toFixed(2)} → ${run.expenseIds?.length ?? 0} salary expenses)`
    );
    scheduleViewerSync();
    return res.status(201).json({ run });
  } catch (e) {
    return res.status(400).json({ error: e?.message || 'Failed to post payroll.' });
  }
});

export default router;
