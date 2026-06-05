import type { DtrEmployeeSummary } from './dtrExcelParser';
import type { Employee, PayrollLine } from '../types';

function normName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function matchEmployee(
  employees: Employee[],
  code: string,
  name: string
): Employee | null {
  const c = code.trim().toLowerCase();
  const n = normName(name);
  const byCode = employees.find((e) => e.employeeCode.trim().toLowerCase() === c && c);
  if (byCode) return byCode;
  const byName = employees.find((e) => normName(e.fullName) === n && n);
  if (byName) return byName;
  const partial = employees.find(
    (e) => n && (normName(e.fullName).includes(n) || n.includes(normName(e.fullName)))
  );
  return partial ?? null;
}

export function computePayrollLine(
  summary: DtrEmployeeSummary,
  employee: Employee | null
): PayrollLine {
  const dailyRate = employee?.dailyRate ?? 0;
  const stdHours = employee?.standardHoursPerDay ?? 8;
  const otMult = employee?.overtimeMultiplier ?? 1.25;
  const hourlyRate = stdHours > 0 ? dailyRate / stdHours : 0;

  let grossPay = 0;
  if (summary.daysWorked > 0 && dailyRate > 0) {
    grossPay += summary.daysWorked * dailyRate;
  } else if (summary.regularHours > 0 && hourlyRate > 0) {
    grossPay += summary.regularHours * hourlyRate;
  }
  if (summary.overtimeHours > 0 && hourlyRate > 0) {
    grossPay += summary.overtimeHours * hourlyRate * otMult;
  }

  const lateDeduction =
    summary.lateMinutes > 0 && hourlyRate > 0 ? (summary.lateMinutes / 60) * hourlyRate : 0;
  const deductions = Math.round(lateDeduction * 100) / 100;
  const netPay = Math.max(0, Math.round((grossPay - deductions) * 100) / 100);

  return {
    employeeId: employee?.id ?? null,
    employeeCode: summary.employeeCode,
    employeeName: summary.employeeName,
    daysWorked: summary.daysWorked,
    regularHours: Math.round(summary.regularHours * 100) / 100,
    overtimeHours: Math.round(summary.overtimeHours * 100) / 100,
    lateMinutes: summary.lateMinutes,
    absentDays: summary.absentDays,
    totalHours: Math.round(summary.totalHours * 100) / 100,
    dailyRate,
    hourlyRate: Math.round(hourlyRate * 100) / 100,
    grossPay: Math.round(grossPay * 100) / 100,
    deductions,
    netPay,
    matched: Boolean(employee),
  };
}

export function computePayrollFromDtr(
  employees: Employee[],
  summaries: DtrEmployeeSummary[]
): PayrollLine[] {
  return summaries.map((summary) => {
    const employee = matchEmployee(employees, summary.employeeCode, summary.employeeName);
    return computePayrollLine(summary, employee);
  });
}
