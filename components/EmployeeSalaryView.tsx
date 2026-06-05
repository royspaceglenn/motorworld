import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { Employee, PayrollLine, PayrollRun } from '../types';
import { payrollApi } from '../lib/api/adminData';
import { parseDtrExcelFile } from '../lib/dtrExcelParser';
import { DashboardSurface } from './ui/DashboardPrimitives';
import { Button } from './ui/Button';
import { InlineAlert } from './ui/InlineAlert';
import {
  Upload,
  Users,
  Calculator,
  FileSpreadsheet,
  Plus,
  Pencil,
  Trash2,
  Loader2,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';

interface EmployeeSalaryViewProps {
  canEdit: boolean;
  onPayrollPosted?: () => void;
}

type TabId = 'employees' | 'payroll';

const emptyEmployee = (): Partial<Employee> => ({
  employeeCode: '',
  fullName: '',
  position: '',
  dailyRate: 0,
  standardHoursPerDay: 8,
  overtimeMultiplier: 1.25,
  isActive: true,
});

export const EmployeeSalaryView: React.FC<EmployeeSalaryViewProps> = ({ canEdit, onPayrollPosted }) => {
  const [tab, setTab] = useState<TabId>('payroll');
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [runs, setRuns] = useState<PayrollRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [employeeForm, setEmployeeForm] = useState<Partial<Employee> | null>(null);
  const [periodLabel, setPeriodLabel] = useState('');
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [sourceFileName, setSourceFileName] = useState('');
  const [parseWarnings, setParseWarnings] = useState<string[]>([]);
  const [previewLines, setPreviewLines] = useState<PayrollLine[] | null>(null);
  const [previewTotals, setPreviewTotals] = useState({ gross: 0, net: 0 });

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    Promise.all([payrollApi.listEmployees(), payrollApi.listRuns()])
      .then(([empRes, runRes]) => {
        setEmployees(empRes.employees ?? []);
        setRuns(runRes.runs ?? []);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load payroll data.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const unmatchedCount = useMemo(
    () => (previewLines ?? []).filter((l) => !l.matched).length,
    [previewLines]
  );

  const handleSaveEmployee = async () => {
    if (!employeeForm) return;
    setBusy(true);
    setError(null);
    try {
      const payload = {
        ...employeeForm,
        employeeCode: String(employeeForm.employeeCode ?? '').trim().toUpperCase(),
        fullName: String(employeeForm.fullName ?? '').trim(),
        dailyRate: Math.max(0, Number(employeeForm.dailyRate) || 0),
        standardHoursPerDay: Math.max(1, Number(employeeForm.standardHoursPerDay) || 8),
        overtimeMultiplier: Math.max(1, Number(employeeForm.overtimeMultiplier) || 1.25),
      };
      if (employeeForm.id) {
        const res = await payrollApi.updateEmployee(employeeForm.id, payload);
        setEmployees((prev) => prev.map((e) => (e.id === res.employee.id ? res.employee : e)));
      } else {
        const res = await payrollApi.createEmployee(payload);
        setEmployees((prev) => [res.employee, ...prev]);
      }
      setEmployeeForm(null);
      setSuccess('Employee saved.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save employee.');
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteEmployee = async (id: string) => {
    if (!window.confirm('Remove this employee profile?')) return;
    setBusy(true);
    setError(null);
    try {
      await payrollApi.deleteEmployee(id);
      setEmployees((prev) => prev.filter((e) => e.id !== id));
      setSuccess('Employee removed.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete employee.');
    } finally {
      setBusy(false);
    }
  };

  const handleDtrUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError(null);
    setSuccess(null);
    setParseWarnings([]);
    setPreviewLines(null);
    setBusy(true);
    try {
      const parsed = await parseDtrExcelFile(file);
      setSourceFileName(file.name);
      setParseWarnings(parsed.warnings);
      if (parsed.periodStart) setPeriodStart(parsed.periodStart);
      if (parsed.periodEnd) setPeriodEnd(parsed.periodEnd);
      if (!periodLabel && parsed.periodStart && parsed.periodEnd) {
        setPeriodLabel(`${parsed.periodStart} – ${parsed.periodEnd}`);
      }
      if (!parsed.summaries.length) {
        setError('No employee rows found in the Excel file.');
        return;
      }
      const preview = await payrollApi.preview({
        summaries: parsed.summaries,
        periodStart: parsed.periodStart || periodStart,
        periodEnd: parsed.periodEnd || periodEnd,
        periodLabel: periodLabel || file.name,
      });
      setPreviewLines(preview.lines);
      setPreviewTotals({ gross: preview.totalGross, net: preview.totalNet });
      if (!periodStart && preview.periodStart) setPeriodStart(preview.periodStart);
      if (!periodEnd && preview.periodEnd) setPeriodEnd(preview.periodEnd);
      setSuccess(`Loaded ${preview.lines.length} employee row(s) from DTR. Review amounts, then post as expenses.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to read DTR file.');
    } finally {
      setBusy(false);
    }
  };

  const handlePostPayroll = async () => {
    if (!previewLines?.length) return;
    if (!periodLabel.trim() || !periodStart || !periodEnd) {
      setError('Set pay period label, start date, and end date before posting.');
      return;
    }
    if (unmatchedCount > 0) {
      setError(`Match all ${unmatchedCount} employee(s) to staff profiles before posting.`);
      return;
    }
    if (!window.confirm(`Post ₱${previewTotals.net.toFixed(2)} as Salary expenses for ${previewLines.length} employee(s)?`)) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await payrollApi.postRun({
        periodLabel: periodLabel.trim(),
        periodStart,
        periodEnd,
        sourceFileName,
        lines: previewLines,
        totalGross: previewTotals.gross,
        totalNet: previewTotals.net,
      });
      setRuns((prev) => [res.run, ...prev]);
      setPreviewLines(null);
      setSuccess(`Payroll posted — ${res.run.expenseIds?.length ?? 0} salary expense(s) created.`);
      onPayrollPosted?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to post payroll.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="animate-fade-in space-y-6">
      <div>
        <h2 className="text-xl font-bold text-slate-800">Employee salary</h2>
        <p className="text-sm text-slate-500">
          Import DTR Excel from your biometric device, compute pay from attendance, and post each salary as a company
          expense.
        </p>
      </div>

      {error && <InlineAlert message={error} />}
      {success && <InlineAlert message={success} variant="success" />}

      <div className="flex flex-wrap gap-2">
        {(
          [
            { id: 'payroll' as TabId, label: 'Process DTR / payroll', icon: FileSpreadsheet },
            { id: 'employees' as TabId, label: 'Employees', icon: Users },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition ${
              tab === t.id ? 'bg-indigo-600 text-white' : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
            }`}
          >
            <t.icon className="h-4 w-4" />
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-slate-500 py-8">
          <Loader2 className="h-5 w-5 animate-spin" />
          Loading…
        </div>
      ) : tab === 'employees' ? (
        <div className="space-y-4">
          {canEdit && (
            <Button type="button" onClick={() => setEmployeeForm(emptyEmployee())}>
              <Plus className="h-4 w-4" />
              Add employee
            </Button>
          )}
          <DashboardSurface className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="px-4 py-3 text-xs font-semibold uppercase text-slate-500">DTR code</th>
                    <th className="px-4 py-3 text-xs font-semibold uppercase text-slate-500">Name</th>
                    <th className="px-4 py-3 text-xs font-semibold uppercase text-slate-500">Position</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase text-slate-500">Daily rate</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase text-slate-500">Std hrs</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold uppercase text-slate-500">Status</th>
                    {canEdit && <th className="px-4 py-3 text-center text-xs font-semibold uppercase text-slate-500">Actions</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {employees.length === 0 ? (
                    <tr>
                      <td colSpan={canEdit ? 7 : 6} className="px-4 py-8 text-center text-slate-500">
                        No employees yet. Add staff with their DTR device ID and daily rate.
                      </td>
                    </tr>
                  ) : (
                    employees.map((emp) => (
                      <tr key={emp.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3 font-mono text-sm">{emp.employeeCode}</td>
                        <td className="px-4 py-3 font-medium text-slate-800">{emp.fullName}</td>
                        <td className="px-4 py-3 text-sm text-slate-600">{emp.position || '—'}</td>
                        <td className="px-4 py-3 text-right tabular-nums">₱{emp.dailyRate.toFixed(2)}</td>
                        <td className="px-4 py-3 text-right text-sm">{emp.standardHoursPerDay ?? 8}h</td>
                        <td className="px-4 py-3 text-center">
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                              emp.isActive !== false ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-600'
                            }`}
                          >
                            {emp.isActive !== false ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        {canEdit && (
                          <td className="px-4 py-3 text-center">
                            <div className="flex justify-center gap-1">
                              <button
                                type="button"
                                className="rounded-lg p-2 text-slate-500 hover:bg-blue-50 hover:text-blue-600"
                                onClick={() => setEmployeeForm(emp)}
                                title="Edit"
                              >
                                <Pencil className="h-4 w-4" />
                              </button>
                              <button
                                type="button"
                                className="rounded-lg p-2 text-slate-500 hover:bg-red-50 hover:text-red-600"
                                onClick={() => handleDeleteEmployee(emp.id)}
                                title="Delete"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </DashboardSurface>
        </div>
      ) : (
        <div className="space-y-6">
          <DashboardSurface className="p-5 space-y-4">
            <h3 className="font-semibold text-slate-800 flex items-center gap-2">
              <Upload className="h-5 w-5 text-indigo-600" />
              Import DTR Excel
            </h3>
            <p className="text-sm text-slate-600">
              Export attendance from your DTR / biometric device as <strong>.xlsx</strong>. Supports punch logs (Employee
              ID, Date, Time) or summary sheets (Work days, Hours, OT, Late).
            </p>
            {parseWarnings.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                {parseWarnings.map((w) => (
                  <div key={w}>{w}</div>
                ))}
              </div>
            )}
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Pay period label</label>
                <input
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  value={periodLabel}
                  onChange={(e) => setPeriodLabel(e.target.value)}
                  placeholder="e.g. May 1–15, 2026"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Period start</label>
                <input
                  type="date"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  value={periodStart}
                  onChange={(e) => setPeriodStart(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Period end</label>
                <input
                  type="date"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  value={periodEnd}
                  onChange={(e) => setPeriodEnd(e.target.value)}
                />
              </div>
            </div>
            {canEdit && (
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-indigo-300 bg-indigo-50/50 px-4 py-3 text-sm font-medium text-indigo-700 hover:bg-indigo-50">
                <FileSpreadsheet className="h-5 w-5" />
                {busy ? 'Reading file…' : 'Choose DTR Excel file'}
                <input type="file" accept=".xlsx,.xls" className="hidden" onChange={handleDtrUpload} disabled={busy} />
              </label>
            )}
          </DashboardSurface>

          {previewLines && (
            <DashboardSurface className="overflow-hidden">
              <div className="flex flex-col gap-3 border-b border-slate-200 bg-slate-50 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 className="font-semibold text-slate-800 flex items-center gap-2">
                    <Calculator className="h-5 w-5 text-emerald-600" />
                    Computed payroll
                  </h3>
                  <p className="text-sm text-slate-500">
                    Gross ₱{previewTotals.gross.toFixed(2)} · Net ₱{previewTotals.net.toFixed(2)}
                    {unmatchedCount > 0 && (
                      <span className="ml-2 text-amber-700 font-medium">
                        · {unmatchedCount} unmatched — add under Employees tab
                      </span>
                    )}
                  </p>
                </div>
                {canEdit && (
                  <Button
                    type="button"
                    onClick={handlePostPayroll}
                    disabled={busy || unmatchedCount > 0}
                    className="bg-emerald-600 hover:bg-emerald-700"
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    Post as salary expenses
                  </Button>
                )}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-white border-b border-slate-200">
                    <tr>
                      <th className="px-4 py-3 text-xs font-semibold uppercase text-slate-500">Code</th>
                      <th className="px-4 py-3 text-xs font-semibold uppercase text-slate-500">Employee</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold uppercase text-slate-500">Days</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold uppercase text-slate-500">Reg hrs</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold uppercase text-slate-500">OT hrs</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold uppercase text-slate-500">Late (min)</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold uppercase text-slate-500">Gross</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold uppercase text-slate-500">Deductions</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold uppercase text-slate-500">Net pay</th>
                      <th className="px-4 py-3 text-center text-xs font-semibold uppercase text-slate-500">Match</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {previewLines.map((line, idx) => (
                      <tr key={`${line.employeeCode}-${idx}`} className={!line.matched ? 'bg-amber-50/60' : ''}>
                        <td className="px-4 py-3 font-mono">{line.employeeCode}</td>
                        <td className="px-4 py-3 font-medium">{line.employeeName}</td>
                        <td className="px-4 py-3 text-right">{line.daysWorked}</td>
                        <td className="px-4 py-3 text-right">{line.regularHours}</td>
                        <td className="px-4 py-3 text-right">{line.overtimeHours}</td>
                        <td className="px-4 py-3 text-right">{line.lateMinutes}</td>
                        <td className="px-4 py-3 text-right tabular-nums">₱{line.grossPay.toFixed(2)}</td>
                        <td className="px-4 py-3 text-right tabular-nums">₱{line.deductions.toFixed(2)}</td>
                        <td className="px-4 py-3 text-right font-semibold tabular-nums">₱{line.netPay.toFixed(2)}</td>
                        <td className="px-4 py-3 text-center">
                          {line.matched ? (
                            <CheckCircle2 className="inline h-4 w-4 text-emerald-600" />
                          ) : (
                            <AlertTriangle className="inline h-4 w-4 text-amber-600" title="Add employee profile" />
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </DashboardSurface>
          )}

          <DashboardSurface className="overflow-hidden">
            <div className="border-b border-slate-200 bg-slate-50 px-5 py-4">
              <h3 className="font-semibold text-slate-800">Posted payroll history</h3>
            </div>
            {runs.length === 0 ? (
              <p className="px-5 py-8 text-center text-slate-500">No payroll posted yet.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {runs.map((run) => (
                  <li key={run.id} className="px-5 py-4 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="font-medium text-slate-800">{run.periodLabel}</p>
                      <p className="text-xs text-slate-500">
                        {run.periodStart} → {run.periodEnd} · {run.lines.length} employees ·{' '}
                        {run.expenseIds?.length ?? 0} expenses
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold text-emerald-700">₱{run.totalNet.toFixed(2)}</p>
                      <p className="text-xs text-slate-400">
                        Posted {run.postedAt ? new Date(run.postedAt).toLocaleString() : '—'}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </DashboardSurface>
        </div>
      )}

      {employeeForm && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-slate-900">
              {employeeForm.id ? 'Edit employee' : 'Add employee'}
            </h3>
            <div className="mt-4 space-y-3">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">DTR / device ID *</label>
                <input
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm uppercase"
                  value={employeeForm.employeeCode ?? ''}
                  onChange={(e) => setEmployeeForm({ ...employeeForm, employeeCode: e.target.value.toUpperCase() })}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Full name *</label>
                <input
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  value={employeeForm.fullName ?? ''}
                  onChange={(e) => setEmployeeForm({ ...employeeForm, fullName: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Position</label>
                <input
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  value={employeeForm.position ?? ''}
                  onChange={(e) => setEmployeeForm({ ...employeeForm, position: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Daily rate (₱) *</label>
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                    value={employeeForm.dailyRate ?? 0}
                    onChange={(e) => setEmployeeForm({ ...employeeForm, dailyRate: Number(e.target.value) })}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Standard hrs/day</label>
                  <input
                    type="number"
                    min={1}
                    max={24}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                    value={employeeForm.standardHoursPerDay ?? 8}
                    onChange={(e) =>
                      setEmployeeForm({ ...employeeForm, standardHoursPerDay: Number(e.target.value) })
                    }
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">OT multiplier</label>
                <input
                  type="number"
                  min={1}
                  step={0.05}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  value={employeeForm.overtimeMultiplier ?? 1.25}
                  onChange={(e) =>
                    setEmployeeForm({ ...employeeForm, overtimeMultiplier: Number(e.target.value) })
                  }
                />
              </div>
              <label className="flex items-center gap-2 text-sm text-slate-600">
                <input
                  type="checkbox"
                  checked={employeeForm.isActive !== false}
                  onChange={(e) => setEmployeeForm({ ...employeeForm, isActive: e.target.checked })}
                />
                Active employee
              </label>
            </div>
            <div className="mt-6 flex gap-2">
              <Button type="button" variant="secondary" fullWidth onClick={() => setEmployeeForm(null)} disabled={busy}>
                Cancel
              </Button>
              <Button type="button" fullWidth onClick={handleSaveEmployee} disabled={busy}>
                {busy ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
