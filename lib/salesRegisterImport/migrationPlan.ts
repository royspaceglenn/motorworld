import type { SalesRegisterParseResult } from './index';

export type MigrationDestination =
  | 'history'
  | 'sales_summary'
  | 'sr1_register'
  | 'receivables'
  | 'accounts'
  | 'inventory'
  | 'document_archives';

export interface MigrationDestinationRow {
  id: MigrationDestination;
  label: string;
  systemArea: string;
  description: string;
  count: number;
  detail?: string;
}

export interface MigrationPlan {
  destinations: MigrationDestinationRow[];
  paymentBreakdown: { mode: string; count: number; total: number }[];
  dateRange: { start: string; end: string } | null;
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

export function computeMigrationPlan(parsed: SalesRegisterParseResult): MigrationPlan {
  const sales = parsed.sales || [];
  const lineCount = parsed.lineCount || 0;
  const customerCount = parsed.customers?.length || 0;

  const vehicleCount = new Set(
    sales.map((s) => s.plateNo).filter((p) => p && p !== '—')
  ).size;

  const receivableSales = sales.filter((s) => {
    const m = String(s.modeOfPayment || 'Cash').trim();
    return m !== 'Cash';
  });

  const cashSales = sales.filter((s) => String(s.modeOfPayment || 'Cash').trim() === 'Cash');

  const productLines = sales.reduce(
    (n, s) => n + (s.lines || []).filter((l) => String(l.uom || '').toLowerCase() !== 'lot').length,
    0
  );

  const paymentMap = new Map<string, { count: number; total: number }>();
  for (const s of sales) {
    const mode = String(s.modeOfPayment || 'Cash').trim() || 'Cash';
    const cur = paymentMap.get(mode) || { count: 0, total: 0 };
    cur.count += 1;
    cur.total = round2(cur.total + Number(s.totalValue || 0));
    paymentMap.set(mode, cur);
  }

  const paymentBreakdown = [...paymentMap.entries()]
    .map(([mode, v]) => ({ mode, ...v }))
    .sort((a, b) => b.total - a.total);

  const destinations: MigrationDestinationRow[] = [
    {
      id: 'history',
      label: 'Sales history',
      systemArea: 'History',
      description: 'Each sale on its original PDF date as a RELEASE (POS) record.',
      count: sales.length,
      detail: parsed.dateRange
        ? `${parsed.dateRange.start} → ${parsed.dateRange.end}`
        : undefined,
    },
    {
      id: 'sales_summary',
      label: 'Sales summary / P&L',
      systemArea: 'Sales summary',
      description: 'Revenue, cash vs on-account, COGS, and discounts in the period report.',
      count: sales.length,
    },
    {
      id: 'sr1_register',
      label: 'SR-1 register',
      systemArea: 'Sales summary → Print SR-1',
      description: 'Line-by-line register rebuilt from imported sales.',
      count: lineCount,
    },
    {
      id: 'receivables',
      label: 'Accounts receivable',
      systemArea: 'Receivables',
      description: 'Credit, Purchase Order, and Cheque sales with terms from the PDF.',
      count: receivableSales.length,
      detail: receivableSales.length > 0 ? `${cashSales.length} cash sale(s) skip receivables` : 'All cash — none',
    },
    {
      id: 'accounts',
      label: 'Customers & vehicles',
      systemArea: 'Accounts',
      description: 'Customer names, addresses, plates, and vehicle models from the register.',
      count: customerCount,
      detail: vehicleCount > 0 ? `${vehicleCount} vehicle(s) with plate no.` : undefined,
    },
    {
      id: 'inventory',
      label: 'Inventory stock',
      systemArea: 'Inventory',
      description: 'Matched product lines deduct stock (may go negative during migration).',
      count: productLines,
    },
    {
      id: 'document_archives',
      label: 'Receipt archive',
      systemArea: 'Document archives',
      description: 'POS receipt snapshots linked to each imported sale.',
      count: sales.length,
    },
  ];

  return {
    destinations,
    paymentBreakdown,
    dateRange: parsed.dateRange,
  };
}
