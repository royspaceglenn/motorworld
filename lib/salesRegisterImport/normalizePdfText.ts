const MONTHS =
  'January|February|March|April|May|June|July|August|September|October|November|December';

/** Normalize PDF text runs (pdf.js often omits spaces between columns). */
export function normalizeSalesRegisterPdfText(text: string): string {
  let t = String(text || '');

  t = t.replace(/(PC\/SP)(PHP)/gi, '$1 $2');
  t = t.replace(/(PC\/S)(PHP)/gi, '$1 $2');
  t = t.replace(/(BOTTLE\/SP)(PHP)/gi, '$1 $2');
  t = t.replace(/(BOTTLE\/S)(PHP)/gi, '$1 $2');
  t = t.replace(/(BOTS\/SP)(PHP)/gi, '$1 $2');
  t = t.replace(/(BOTS\/S)(PHP)/gi, '$1 $2');
  t = t.replace(/(DRUM)(PHP)/gi, '$1 $2');
  t = t.replace(/(lot)(PHP)/gi, '$1 $2');

  t = t.replace(/(DISCOUNT)\s*(January|February|March|April|May|June|July|August|September|October|November|December)/gi, '$1 $2');
  t = t.replace(/(\d{4})\s*(January|February|March|April|May|June|July|August|September|October|November|December)/gi, '$1 $2');
  t = t.replace(
    /(%)\s*(January|February|March|April|May|June|July|August|September|October|November|December)/gi,
    '$1\n$2'
  );

  t = t.replace(new RegExp(`(?<=[^\\n])\\s*((?:${MONTHS}) \\d{1,2}, \\d{4})`, 'gi'), '\n$1');

  return t;
}
