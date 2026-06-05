function normName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

export function matchEmployee(employees, code, name) {
  const c = String(code || '').trim().toLowerCase();
  const n = normName(name);
  const byCode = employees.find((e) => String(e.employee_code ?? e.employeeCode ?? '').trim().toLowerCase() === c && c);
  if (byCode) return byCode;
  const byName = employees.find((e) => normName(e.full_name ?? e.fullName) === n && n);
  if (byName) return byName;
  return (
    employees.find((e) => {
      const fn = normName(e.full_name ?? e.fullName);
      return n && (fn.includes(n) || n.includes(fn));
    }) ?? null
  );
}

export function computePayrollLine(summary, employeeRow) {
  const dailyRate = Number(employeeRow?.daily_rate ?? employeeRow?.dailyRate ?? 0);
  const stdHours = Number(employeeRow?.standard_hours_per_day ?? employeeRow?.standardHoursPerDay ?? 8) || 8;
  const otMult = Number(employeeRow?.overtime_multiplier ?? employeeRow?.overtimeMultiplier ?? 1.25) || 1.25;
  const hourlyRate = stdHours > 0 ? dailyRate / stdHours : 0;

  let grossPay = 0;
  const daysWorked = Number(summary.daysWorked ?? summary.days_worked ?? 0);
  const regularHours = Number(summary.regularHours ?? summary.regular_hours ?? 0);
  const overtimeHours = Number(summary.overtimeHours ?? summary.overtime_hours ?? 0);
  const lateMinutes = Number(summary.lateMinutes ?? summary.late_minutes ?? 0);
  const absentDays = Number(summary.absentDays ?? summary.absent_days ?? 0);
  const totalHours = Number(summary.totalHours ?? summary.total_hours ?? 0);

  if (daysWorked > 0 && dailyRate > 0) {
    grossPay += daysWorked * dailyRate;
  } else if (regularHours > 0 && hourlyRate > 0) {
    grossPay += regularHours * hourlyRate;
  }
  if (overtimeHours > 0 && hourlyRate > 0) {
    grossPay += overtimeHours * hourlyRate * otMult;
  }

  const lateDeduction = lateMinutes > 0 && hourlyRate > 0 ? (lateMinutes / 60) * hourlyRate : 0;
  const deductions = Math.round(lateDeduction * 100) / 100;
  const netPay = Math.max(0, Math.round((grossPay - deductions) * 100) / 100);

  return {
    employeeId: employeeRow?.id ?? null,
    employeeCode: String(summary.employeeCode ?? summary.employee_code ?? '').trim(),
    employeeName: String(summary.employeeName ?? summary.employee_name ?? '').trim(),
    daysWorked,
    regularHours: Math.round(regularHours * 100) / 100,
    overtimeHours: Math.round(overtimeHours * 100) / 100,
    lateMinutes,
    absentDays,
    totalHours: Math.round(totalHours * 100) / 100,
    dailyRate,
    hourlyRate: Math.round(hourlyRate * 100) / 100,
    grossPay: Math.round(grossPay * 100) / 100,
    deductions,
    netPay,
    matched: Boolean(employeeRow),
    expenseId: null,
  };
}

export function computePayrollFromDtr(employees, summaries) {
  return (summaries || []).map((summary) => {
    const employee = matchEmployee(
      employees,
      summary.employeeCode ?? summary.employee_code,
      summary.employeeName ?? summary.employee_name
    );
    return computePayrollLine(summary, employee);
  });
}
