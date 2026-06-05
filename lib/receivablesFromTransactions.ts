import type { LoanApi } from './api/client';
import type { Transaction } from '../types';

function isReceivableSale(t: Transaction): boolean {
  if (t.type !== 'RELEASE') return false;
  const mode = String(t.modeOfPayment || 'Cash').trim();
  return mode !== 'Cash' && mode !== 'Others';
}

/** When /api/loans is unreachable, show receivable sales from already-loaded transactions. */
export function deriveReceivableLoansFromTransactions(
  transactions: Transaction[],
  customerFilter = '',
  statusFilter = ''
): LoanApi[] {
  const needle = customerFilter.trim().toLowerCase();
  let rows = transactions.filter(isReceivableSale);

  if (needle) {
    rows = rows.filter((t) => String(t.recipient || '').toLowerCase().includes(needle));
  }

  const loans: LoanApi[] = rows.map((t) => {
    const mode = String(t.modeOfPayment || 'Credit').trim();
    const total = Number(t.totalValue || 0);
    const status =
      mode === 'Cheque' && t.chequeStatus === 'cleared'
        ? 'paid'
        : mode === 'Cheque' && t.chequeStatus === 'bounced'
          ? 'overdue'
          : 'unpaid';

    return {
      id: `tx-${t.id}`,
      transactionId: t.id,
      customerName: t.recipient || 'Customer',
      totalAmount: total,
      downPayment: 0,
      remainingBalance: total,
      interestRate: null,
      startDate: t.timestamp,
      dueDate: t.dueDate || t.timestamp,
      paymentSchedule: 'monthly',
      status,
      createdAt: t.timestamp,
      updatedAt: t.timestamp,
      personId: t.personId ?? null,
      vehicleId: t.vehicleId ?? null,
      vehiclePlateNumber: null,
      payments: [],
    };
  });

  if (statusFilter) {
    return loans.filter((l) => l.status === statusFilter);
  }
  return loans.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}
