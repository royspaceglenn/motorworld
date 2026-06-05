import * as XLSX from 'xlsx';

export interface DtrEmployeeSummary {
  employeeCode: string;
  employeeName: string;
  daysWorked: number;
  regularHours: number;
  overtimeHours: number;
  lateMinutes: number;
  absentDays: number;
  totalHours: number;
}

export interface DtrParseResult {
  summaries: DtrEmployeeSummary[];
  periodStart: string | null;
  periodEnd: string | null;
  format: 'summary' | 'punches';
  warnings: string[];
}

type ColMap = {
  code?: number;
  name?: number;
  date?: number;
  time?: number;
  status?: number;
  days?: number;
  hours?: number;
  regularHours?: number;
  overtime?: number;
  late?: number;
  absent?: number;
};

function normHeader(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function cellStr(row: unknown[], idx?: number): string {
  if (idx == null || idx < 0) return '';
  const v = row[idx];
  if (v == null || v === '') return '';
  return String(v).trim();
}

function parseNumber(value: unknown): number {
  const n = Number(String(value ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function excelDateToIso(value: unknown): string | null {
  if (value == null || value === '') return null;
  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed) return null;
    const y = parsed.y;
    const m = String(parsed.m).padStart(2, '0');
    const d = String(parsed.d).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const raw = String(value).trim();
  const slash = raw.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (slash) {
    const dd = slash[1].padStart(2, '0');
    const mm = slash[2].padStart(2, '0');
    let yy = slash[3];
    if (yy.length === 2) yy = `20${yy}`;
    return `${yy}-${mm}-${dd}`;
  }
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dt = new Date(raw);
  if (!Number.isNaN(dt.getTime())) {
    return dt.toISOString().slice(0, 10);
  }
  return null;
}

function excelTimeToHm(value: unknown): string | null {
  if (value == null || value === '') return null;
  if (typeof value === 'number' && value < 1) {
    const totalMin = Math.round(value * 24 * 60);
    const h = Math.floor(totalMin / 60) % 24;
    const m = totalMin % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
  const raw = String(value).trim();
  const m = raw.match(/^(\d{1,2}):(\d{2})/);
  if (m) return `${m[1].padStart(2, '0')}:${m[2]}`;
  return null;
}

function timeToMinutes(hm: string): number {
  const [h, m] = hm.split(':').map((x) => Number(x));
  return (h || 0) * 60 + (m || 0);
}

function detectColumns(headers: string[]): ColMap {
  const map: ColMap = {};
  headers.forEach((h, i) => {
    if (!h) return;
    if (!map.code && /(user id|userid|emp(?:loyee)?(?:\s*no|\s*id|\s*code)?|ac-?no|badge|enroll)/i.test(h)) {
      map.code = i;
    }
    if (!map.name && /(name|employee)/i.test(h) && !/user id|emp code/i.test(h)) {
      map.name = i;
    }
    if (!map.date && /date/i.test(h)) map.date = i;
    if (!map.time && /(time|clock|check)/i.test(h)) map.time = i;
    if (!map.status && /(status|in\/out|state|type)/i.test(h)) map.status = i;
    if (!map.days && /(days|present|work day)/i.test(h)) map.days = i;
    if (!map.regularHours && /(regular|work)\s*(hour|hr|h)/i.test(h)) map.regularHours = i;
    if (!map.hours && map.regularHours == null && /(total\s*)?(hour|hr|h)/i.test(h) && !/over/i.test(h)) {
      map.hours = i;
    }
    if (!map.overtime && /(overtime|ot\s*hour|ot\s*hr|\bot\b)/i.test(h)) map.overtime = i;
    if (!map.late && /late/i.test(h)) map.late = i;
    if (!map.absent && /absent/i.test(h)) map.absent = i;
  });
  return map;
}

function findHeaderRow(rows: unknown[][]): { headerIndex: number; cols: ColMap } | null {
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const headers = (rows[i] || []).map(normHeader);
    const cols = detectColumns(headers);
    const isSummary = cols.code != null && cols.name != null && (cols.days != null || cols.hours != null);
    const isPunch = cols.code != null && cols.date != null && cols.time != null;
    if (isSummary || isPunch) return { headerIndex: i, cols };
  }
  return null;
}

function aggregatePunches(
  rows: unknown[][],
  headerIndex: number,
  cols: ColMap,
  warnings: string[]
): { summaries: DtrEmployeeSummary[]; periodStart: string | null; periodEnd: string | null } {
  type DayPunch = { times: string[]; statuses: string[] };
  const byEmpDay = new Map<string, DayPunch>();
  const names = new Map<string, string>();

  for (let r = headerIndex + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const code = cellStr(row, cols.code);
    if (!code) continue;
    const name = cellStr(row, cols.name) || names.get(code) || code;
    names.set(code, name);
    const date = excelDateToIso(row[cols.date!]);
    const time = excelTimeToHm(row[cols.time!]);
    if (!date || !time) continue;
    const key = `${code}::${date}`;
    const bucket = byEmpDay.get(key) ?? { times: [], statuses: [] };
    bucket.times.push(time);
    if (cols.status != null) bucket.statuses.push(normHeader(row[cols.status]));
    byEmpDay.set(key, bucket);
  }

  const byEmp = new Map<string, DtrEmployeeSummary>();
  const dates: string[] = [];

  for (const [key, bucket] of byEmpDay) {
    const [code, date] = key.split('::');
    dates.push(date);
    const sorted = [...bucket.times].sort((a, b) => timeToMinutes(a) - timeToMinutes(b));
    let inMin = timeToMinutes(sorted[0]);
    let outMin = timeToMinutes(sorted[sorted.length - 1]);
    if (bucket.statuses.length) {
      const ins = bucket.times.filter((_, i) => /in|check.?in|start/i.test(bucket.statuses[i] || ''));
      const outs = bucket.times.filter((_, i) => /out|check.?out|end/i.test(bucket.statuses[i] || ''));
      if (ins.length) inMin = timeToMinutes(ins.sort((a, b) => timeToMinutes(a) - timeToMinutes(b))[0]);
      if (outs.length) outMin = timeToMinutes(outs.sort((a, b) => timeToMinutes(b) - timeToMinutes(a))[0]);
    }
    let workedMin = Math.max(0, outMin - inMin);
    if (workedMin <= 0 && sorted.length >= 2) {
      workedMin = Math.max(0, timeToMinutes(sorted[sorted.length - 1]) - timeToMinutes(sorted[0]));
    }
    const workedHours = workedMin / 60;
    const regular = Math.min(8, workedHours);
    const ot = Math.max(0, workedHours - 8);
    const late = inMin > 8 * 60 + 15 ? inMin - (8 * 60 + 15) : 0;

    const existing =
      byEmp.get(code) ??
      ({
        employeeCode: code,
        employeeName: names.get(code) || code,
        daysWorked: 0,
        regularHours: 0,
        overtimeHours: 0,
        lateMinutes: 0,
        absentDays: 0,
        totalHours: 0,
      } satisfies DtrEmployeeSummary);

    if (workedHours > 0) {
      existing.daysWorked += 1;
      existing.regularHours += regular;
      existing.overtimeHours += ot;
      existing.lateMinutes += late;
      existing.totalHours += workedHours;
    }
    byEmp.set(code, existing);
  }

  if (!byEmp.size) {
    warnings.push('No punch rows found. Check that the Excel has employee ID, date, and time columns.');
  }

  const sortedDates = [...new Set(dates)].sort();
  return {
    summaries: [...byEmp.values()],
    periodStart: sortedDates[0] ?? null,
    periodEnd: sortedDates[sortedDates.length - 1] ?? null,
  };
}

function parseSummaryRows(
  rows: unknown[][],
  headerIndex: number,
  cols: ColMap,
  warnings: string[]
): DtrEmployeeSummary[] {
  const out: DtrEmployeeSummary[] = [];
  for (let r = headerIndex + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const code = cellStr(row, cols.code);
    const name = cellStr(row, cols.name);
    if (!code && !name) continue;
    const days = parseNumber(row[cols.days!]);
    const regular = parseNumber(row[cols.regularHours ?? cols.hours!]);
    const ot = parseNumber(row[cols.overtime!]);
    const late = parseNumber(row[cols.late!]);
    const absent = parseNumber(row[cols.absent!]);
    const total = regular + ot || parseNumber(row[cols.hours!]);
    if (!code && !name && total <= 0 && days <= 0) continue;
    out.push({
      employeeCode: code || name,
      employeeName: name || code,
      daysWorked: days,
      regularHours: regular,
      overtimeHours: ot,
      lateMinutes: late,
      absentDays: absent,
      totalHours: total,
    });
  }
  if (!out.length) warnings.push('No employee summary rows found in the DTR sheet.');
  return out;
}

export function parseDtrExcelBuffer(buffer: ArrayBuffer): DtrParseResult {
  const warnings: string[] = [];
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: false });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    return { summaries: [], periodStart: null, periodEnd: null, format: 'summary', warnings: ['Workbook has no sheets.'] };
  }
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' }) as unknown[][];
  const header = findHeaderRow(rows);
  if (!header) {
    return {
      summaries: [],
      periodStart: null,
      periodEnd: null,
      format: 'summary',
      warnings: ['Could not detect DTR columns. Expected headers like Employee ID, Name, Date, Time (or Work Days / Hours).'],
    };
  }

  const isPunch = header.cols.date != null && header.cols.time != null;
  if (isPunch) {
    const punchResult = aggregatePunches(rows, header.headerIndex, header.cols, warnings);
    return {
      summaries: punchResult.summaries,
      periodStart: punchResult.periodStart,
      periodEnd: punchResult.periodEnd,
      format: 'punches',
      warnings,
    };
  }

  const summaries = parseSummaryRows(rows, header.headerIndex, header.cols, warnings);
  return { summaries, periodStart: null, periodEnd: null, format: 'summary', warnings };
}

export async function parseDtrExcelFile(file: File): Promise<DtrParseResult> {
  const buffer = await file.arrayBuffer();
  return parseDtrExcelBuffer(buffer);
}
