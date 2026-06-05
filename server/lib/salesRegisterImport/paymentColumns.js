const TYPE_LINE_RE = /^(A\/R|P\.O\.|CASH|CHEQUE)$/i;
const TERMS_LINE_RE = /^(\d+\s*DAYS(?:\s+IN-HOUSE)?|IN-HOUSE)$/i;

export function parseDueDaysFromTerms(terms) {
  const m = String(terms || '').match(/(\d+)\s*DAYS/i);
  return m ? Number(m[1]) : 0;
}

export function normalizeRegisterPaymentType(raw) {
  const t = String(raw || '').trim().toUpperCase();
  if (t === 'A/R') return 'A/R';
  if (t === 'P.O.') return 'P.O.';
  if (t === 'CHEQUE') return 'CHEQUE';
  if (t === 'CASH') return 'CASH';
  return '';
}

export function resolveRegisterPaymentMode(typeLabel, terms, sale = {}) {
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

/** Pull parallel TERMS and TYPE columns that pdf-parse emits on separate lines. */
export function extractRegisterPaymentColumns(rawText) {
  const terms = [];
  const types = [];
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

export function attachPaymentColumnsToLines(lines, rawText) {
  const { terms, types } = extractRegisterPaymentColumns(rawText);
  return lines.map((line, index) => ({
    ...line,
    terms: terms[index] || line.terms || '—',
    transactionType: types[index] || line.transactionType || 'CASH',
  }));
}

export function applyPaymentModeToSales(sales, rawText) {
  const { terms, types } = extractRegisterPaymentColumns(rawText);
  let termIdx = 0;
  let typeIdx = 0;

  return sales.map((sale) => {
    const first = sale.lines?.[0];
    const termFromLine = first?.terms && first.terms !== '—' ? first.terms : null;
    const typeFromLine = first?.transactionType || null;
    const termsLabel = termFromLine || terms[termIdx] || '—';
    const typeLabel = typeFromLine || types[typeIdx] || 'CASH';
    if (!termFromLine && terms[termIdx]) termIdx += 1;
    if (!typeFromLine && types[typeIdx]) typeIdx += 1;

    const modeOfPayment = resolveRegisterPaymentMode(typeLabel, termsLabel, sale);
    const dueDays = parseDueDaysFromTerms(termsLabel) || (modeOfPayment === 'Credit' ? 30 : 0);

    return {
      ...sale,
      terms: termsLabel,
      transactionType: typeLabel,
      modeOfPayment,
      dueDays,
    };
  });
}

export function buildReceivablePayloadFromSale(sale, personId, vehicleId) {
  const mode = String(sale.modeOfPayment || 'Cash').trim();
  const payload = {
    personId: personId ?? null,
    vehicleId: vehicleId ?? null,
    dueDays: sale.dueDays || parseDueDaysFromTerms(sale.terms) || 30,
    discountAmount: sale.totalDiscount > 0 ? sale.totalDiscount : null,
    terms: sale.terms && sale.terms !== '—' ? sale.terms : null,
  };

  if (mode === 'Cheque') {
    const base = new Date(sale.saleDateIso || Date.now());
    base.setDate(base.getDate() + 7);
    payload.chequeExpectedClearDate = base.toISOString().slice(0, 10);
  }

  if (mode === 'Purchase Order') {
    const base = new Date(sale.saleDateIso || Date.now());
    const days = payload.dueDays || 30;
    base.setDate(base.getDate() + days);
    payload.dueDate = base.toISOString().slice(0, 10);
  }

  return payload;
}
