const MONTH_INDEX = {
  january: 0,
  february: 1,
  march: 2,
  april: 3,
  may: 4,
  june: 5,
  july: 6,
  august: 7,
  september: 8,
  october: 9,
  november: 10,
  december: 11,
};

/** Parse SR-1 sale date as noon Philippines time (UTC+8) for consistent migration timestamps. */
export function parseRegisterSaleDateToIso(saleDate) {
  const m = String(saleDate || '')
    .trim()
    .match(/^([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})$/);
  if (!m) {
    const fallback = new Date(`${String(saleDate || '').trim()} 12:00:00`);
    return Number.isNaN(fallback.getTime()) ? new Date().toISOString() : fallback.toISOString();
  }
  const month = MONTH_INDEX[m[1].toLowerCase()];
  if (month == null) return new Date().toISOString();
  const day = Number(m[2]);
  const year = Number(m[3]);
  return new Date(Date.UTC(year, month, day, 4, 0, 0, 0)).toISOString();
}

export function parseRegisterSaleDateToYmd(saleDate) {
  return parseRegisterSaleDateToIso(saleDate).slice(0, 10);
}
