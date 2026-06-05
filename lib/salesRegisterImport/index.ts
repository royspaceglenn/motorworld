import { parseSr1Text, type Sr1ParseResult } from '../sr1ImportParse';

export type SalesRegisterFormatId = 'auto' | 'sr1';

export type SalesRegisterParseResult = Sr1ParseResult & {
  formatId: SalesRegisterFormatId;
  formatLabel: string;
};

export const SALES_REGISTER_FORMAT_OPTIONS: {
  id: SalesRegisterFormatId;
  label: string;
  hint: string;
  available: boolean;
}[] = [
  {
    id: 'auto',
    label: 'Auto-detect',
    hint: 'Best match for the uploaded PDF (SR-1 and similar Motor World registers today).',
    available: true,
  },
  {
    id: 'sr1',
    label: 'Sales register (SR-1)',
    hint: 'Motor World SR-1 line-by-line sales register.',
    available: true,
  },
];

function looksLikeSr1Register(text: string): boolean {
  const t = String(text || '');
  return (
    /DATE\s*COVERED|SR[\s-]?1|SALES\s*REGISTER|PO\s*NO/i.test(t) ||
    /(?:January|February|March|April|May|June|July|August|September|October|November|December).{0,80}PHP/i.test(
      t
    )
  );
}

function resolveFormat(formatId: SalesRegisterFormatId, text: string): 'sr1' {
  if (formatId === 'sr1') return 'sr1';
  if (looksLikeSr1Register(text)) return 'sr1';
  return 'sr1';
}

/** Add new register parsers here when you have another PDF layout. */
const REGISTER_PARSERS: Record<
  Exclude<SalesRegisterFormatId, 'auto'>,
  (text: string, fileName: string) => Sr1ParseResult
> = {
  sr1: parseSr1Text,
};

export function parseSalesRegisterText(
  text: string,
  fileName: string,
  formatId: SalesRegisterFormatId = 'auto'
): SalesRegisterParseResult {
  const resolved = resolveFormat(formatId, text);
  const parse = REGISTER_PARSERS[resolved];
  const res = parse(text, fileName);
  const option = SALES_REGISTER_FORMAT_OPTIONS.find((o) => o.id === resolved);
  return {
    ...res,
    formatId: formatId === 'auto' ? 'auto' : resolved,
    formatLabel: option?.label ?? 'Sales register',
  };
}
