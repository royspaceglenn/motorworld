import type { Person, Transaction, Vehicle } from '../types';

function norm(s: unknown): string {
  return String(s ?? '')
    .trim()
    .toLowerCase();
}

/** Search transaction history by customer, item, receipt, ID, notes, payment, vehicle, etc. */
export function filterTransactionsForHistory(
  transactions: Transaction[],
  query: string,
  persons: Person[] = [],
  vehicles: Vehicle[] = []
): Transaction[] {
  const q = norm(query);
  if (!q) return transactions;

  const personById = new Map(persons.map((p) => [p.id, p]));
  const vehicleById = new Map(vehicles.map((v) => [v.id, v]));

  return transactions.filter((t) => {
    const parts: string[] = [
      t.id,
      t.type,
      t.recipient ?? '',
      t.itemName ?? '',
      t.receiptNumber ?? '',
      t.invoiceNumber ?? '',
      t.note ?? '',
      t.releasedBy ?? '',
      t.modeOfPayment ?? '',
      t.modeOfPaymentOther ?? '',
      t.returnReasonText ?? '',
      t.chequeReference ?? '',
    ];

    for (const line of t.posLineItems ?? []) {
      parts.push(line.itemName ?? '', line.itemType ?? '');
    }

    if (t.personId) {
      const p = personById.get(t.personId);
      if (p) parts.push(p.fullName, p.contactNumber ?? '', p.address ?? '');
    }
    if (t.vehicleId) {
      const v = vehicleById.get(t.vehicleId);
      if (v) parts.push(v.plateNumber, v.brand ?? '', v.model ?? '');
    }

    return parts.some((p) => norm(p).includes(q));
  });
}
