/** Local calendar date for `<input type="date">` (YYYY-MM-DD). */
export function todayDateInputValue(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Convert a date picker value to ISO timestamp used by transactions, SOA, and reports. */
export function dateInputToIsoTimestamp(dateStr: string): string {
  const raw = String(dateStr || '').trim();
  if (!raw) return new Date().toISOString();
  const d = new Date(raw.length === 10 ? `${raw}T12:00:00` : raw);
  if (Number.isNaN(d.getTime())) return new Date().toISOString();
  return d.toISOString();
}

export function formatDateInputForDisplay(ymd: string): string {
  const d = new Date(dateInputToIsoTimestamp(ymd));
  if (Number.isNaN(d.getTime())) return ymd;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}
