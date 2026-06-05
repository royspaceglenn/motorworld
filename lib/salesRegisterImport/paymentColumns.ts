const TYPE_LINE_RE = /^(A\/R|P\.O\.|CASH|CHEQUE)$/i;
const TERMS_LINE_RE = /^(\d+\s*DAYS(?:\s+IN-HOUSE)?|IN-HOUSE)$/i;

export function parseDueDaysFromTerms(terms: string): number {
  const m = String(terms || '').match(/(\d+)\s*DAYS/i);
  return m ? Number(m[1]) : 0;
}

export function normalizeRegisterPaymentType(raw: string): string {
  const t = String(raw || '').trim().toUpperCase();
  if (t === 'A/R') return 'A/R';
  if (t === 'P.O.') return 'P.O.';
  if (t === 'CHEQUE') return 'CHEQUE';
  if (t === 'CASH') return 'CASH';
  return '';
}

export function resolveRegisterPaymentMode(
  typeLabel: string,
  terms: string,
  sale: { poNo?: string } = {}
): string {
  const type = normalizeRegisterPaymentType(typeLabel);
  if (type === 'A/R') return 'Credit';
  if (type === 'P.O.') return 'Purchase Order';
  if (type === 'CHEQUE') return 'Cheque';
  if (sale.poNo && sale.poNo !== '—') return 'Purchase Order';

  const termText = String(terms || '').trim();
  const dueDays = parseDueDaysFromTerms(termText);
  if (dueDays > 0 || /IN-HOUSE/i.test(termText)) return 'Credit';

  return 'Cash';
}

export function extractRegisterPaymentColumns(rawText: string) {
  const terms: string[] = [];
  const types: string[] = [];
  for (const line of String(rawText || '').split('\n')) {
    const normalized = line.trim().replace(/\s+/g, ' ');
    if (!normalized) continue;
    if (TYPE_LINE_RE.test(normalized)) {
      types.push(normalized.toUpperCase());
      continue;
    }
    if (TERMS_LINE_RE.test(normalized)) {
      terms.push(normalized.toUpperCase());
    }
  }
  return { terms, types };
}

export function attachPaymentColumnsToLines<T extends { terms?: string; transactionType?: string }>(
  lines: T[],
  rawText: string
): T[] {
  const { terms, types } = extractRegisterPaymentColumns(rawText);
  return lines.map((line, index) => ({
    ...line,
    terms: terms[index] || line.terms || '—',
    transactionType: types[index] || line.transactionType || 'CASH',
  }));
}
