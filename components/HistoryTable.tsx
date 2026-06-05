import React, { useState, useMemo } from 'react';
import { Transaction, Person, Vehicle } from '../types';
import {
  ArrowUpRight,
  ArrowDownLeft,
  RefreshCcw,
  Printer,
  Send,
  RotateCcw,
  FileText,
  ScrollText,
  Pencil,
} from 'lucide-react';
import { SOAModal } from './SOAModal';
import { DashboardSurface } from './ui/DashboardPrimitives';
import { openDocumentPreview } from '../lib/documentPreviewBus';
import { buildReceiptHtml } from './ReceiptPrint';

interface HistoryTableProps {
  transactions: Transaction[];
  persons?: Person[];
  vehicles?: Vehicle[];
  /** When user clicks Return on a RELEASE row, open Return-from-Sales with this release pre-selected. Admin only. */
  onReturnFromSalesClick?: (releaseTransactionId: string) => void;
  /** A4 billing statement (letterhead + line table, paginated). */
  onOpenBillingStatementPrint?: (transaction: Transaction) => void;
  /** Admin: correct a saved ADDITION (restock) row; inventory is rebuilt from the ledger on the server. */
  onEditAddition?: (transaction: Transaction) => void;
}

function historyPaymentLabel(t: Transaction): string {
  if (t.type !== 'RELEASE') return '—';
  if (t.modeOfPayment === 'Others' && t.modeOfPaymentOther) return t.modeOfPaymentOther;
  if (t.modeOfPayment === 'Credit') return 'Accounts Receivable';
  return t.modeOfPayment || '—';
}

export const HistoryTable: React.FC<HistoryTableProps> = ({
  transactions,
  persons = [],
  vehicles = [],
  onReturnFromSalesClick,
  onOpenBillingStatementPrint,
  onEditAddition,
}) => {
  const [soaTransactionId, setSoaTransactionId] = useState<string | null>(null);
  const getPerson = (id: string | null | undefined) => (id ? persons.find((p) => p.id === id) : null);
  const getVehicle = (id: string | null | undefined) => (id ? vehicles.find((v) => v.id === id) : null);

  /** For each RELEASE row: can show Return button only if Product, valid itemId, quantityReleased > 0, not fully returned. */
  const returnableReleaseIds = useMemo(() => {
    const set = new Set<string>();
    for (const t of transactions) {
      if (t.type !== 'RELEASE' || t.itemType !== 'Product' || !t.itemId) continue;
      if (t.bundledSale === true) continue;
      if (t.posLineItems && t.posLineItems.length > 1) continue;
      const quantityReleased = Math.abs(Number(t.quantityChange)) || 0;
      if (quantityReleased <= 0) continue;
      const alreadyReturned = transactions
        .filter((x) => x.type === 'RETURN_FROM_SALES' && x.releaseTransactionId === t.id)
        .reduce((s, x) => s + Math.abs(Number(x.quantityChange) || 0), 0);
      if (alreadyReturned < quantityReleased) set.add(t.id);
    }
    return set;
  }, [transactions]);

  const printPosReceipt = (transaction: Transaction) => {
    openDocumentPreview({
      html: buildReceiptHtml(transaction),
      title: 'POS receipt (reprint)',
      filename: `pos-receipt-${transaction.id.slice(0, 8)}.pdf`,
    });
  };

  const printTransaction = (transaction: Transaction) => {
    const safeRecipient = (transaction.recipient || 'NoRecipient').replace(/[^a-zA-Z0-9-_ ]/g, '').trim();
    const title = `Transaction-${transaction.id}-${safeRecipient}`;
    const html = `
        <html>
        <head>
            <title>${title}</title>
            <style>
            body { font-family: 'Helvetica', 'Arial', sans-serif; padding: 40px; max-width: 800px; margin: 0 auto; color: #333; }
            .header { text-align: center; margin-bottom: 40px; border-bottom: 2px solid #eee; padding-bottom: 20px; }
            .logo { font-size: 24px; font-weight: bold; color: #333; margin-bottom: 5px; }
            .sub-header { color: #666; font-size: 14px; }
            .title { font-size: 20px; font-weight: bold; margin-bottom: 20px; text-transform: uppercase; letter-spacing: 1px; color: #f97316; }
            .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 30px; }
            .info-item { margin-bottom: 10px; }
            .label { font-weight: bold; font-size: 12px; color: #888; text-transform: uppercase; display: block; margin-bottom: 4px; }
            .value { font-size: 16px; }
            .table { width: 100%; border-collapse: collapse; margin-bottom: 30px; }
            .table th { text-align: left; padding: 12px; border-bottom: 2px solid #eee; font-size: 12px; text-transform: uppercase; color: #888; }
            .table td { padding: 12px; border-bottom: 1px solid #eee; }
            .total-section { text-align: right; margin-top: 20px; font-size: 18px; font-weight: bold; }
            .footer { margin-top: 60px; padding-top: 20px; border-top: 1px solid #eee; font-size: 12px; color: #888; text-align: center; }
            .signatures { margin-top: 60px; display: flex; justify-content: space-between; }
            .sig-block { text-align: center; width: 40%; border-top: 1px solid #ccc; padding-top: 10px; }
            @media print {
                body { padding: 0; }
                .no-print { display: none; }
            }
            </style>
        </head>
        <body>
            <div class="header">
            <div class="logo">Motor World Auto Services & Sales Corporation</div>
            <div class="sub-header">Official Inventory Transaction Record</div>
            </div>

            <div class="title">Release Voucher</div>

            <div class="info-grid">
            <div class="info-item">
                <span class="label">Transaction ID</span>
                <span class="value">#${transaction.id}</span>
            </div>
            <div class="info-item">
                <span class="label">Date & Time</span>
                <span class="value">${new Date(transaction.timestamp).toLocaleString()}</span>
            </div>
            <div class="info-item">
                <span class="label">Recipient</span>
                <span class="value">${transaction.recipient || 'N/A'}</span>
            </div>
            <div class="info-item">
                <span class="label">Type</span>
                <span class="value">Stock Release</span>
            </div>
            <div class="info-item">
                <span class="label">Mode of Payment</span>
                <span class="value">${transaction.type === 'RELEASE' ? historyPaymentLabel(transaction) : 'N/A'}</span>
            </div>
            </div>

            <table class="table">
            <thead>
                <tr>
                <th>Item Details</th>
                <th style="text-align: right;">Quantity</th>
                <th style="text-align: right;">Unit Price</th>
                <th style="text-align: right;">Total</th>
                </tr>
            </thead>
            <tbody>
                <tr>
                <td>${transaction.itemName}</td>
                <td style="text-align: right;">${Math.abs(transaction.quantityChange)}</td>
                <td style="text-align: right;">₱${transaction.unitPriceAtTime.toFixed(2)}</td>
                <td style="text-align: right;">₱${transaction.totalValue.toFixed(2)}</td>
                </tr>
            </tbody>
            </table>

            <div class="total-section">
            Total Value: ₱${transaction.totalValue.toFixed(2)}
            </div>

            <div class="info-item" style="margin-top: 20px;">
            <span class="label">Notes</span>
            <span class="value" style="font-style: italic;">${transaction.note || 'No additional notes.'}</span>
            </div>

            <div class="signatures">
            <div class="sig-block">Issued By</div>
            <div class="sig-block">Received By</div>
            </div>

            <div class="footer">
            This is a system generated document. Motor World Auto Services & Sales Corporation Management System.
            </div>
        </body>
        </html>
    `;
    openDocumentPreview({
      html,
      title: 'Release voucher (preview)',
      filename: `release-${transaction.id.slice(0, 8)}.pdf`,
    });
  };

  return (
    <DashboardSurface className="overflow-hidden">
      <div className="border-b border-slate-100 px-6 py-5">
        <h3 className="font-bold text-slate-800">Transaction history</h3>
        <p className="mt-1 text-xs text-slate-500">
          Search, review, and reprint POS receipts or release vouchers for any sale.
        </p>
      </div>
      <div className="overflow-x-auto max-h-[500px]">
        <table className="w-full text-left border-collapse">
          <thead className="sticky top-0 z-10 bg-slate-50/95 backdrop-blur-sm">
            <tr>
              <th className="py-3 px-6 text-xs font-semibold uppercase text-slate-500">Date/ID</th>
              <th className="py-3 px-6 text-xs font-semibold uppercase text-slate-500">Type</th>
              <th className="py-3 px-6 text-xs font-semibold uppercase text-slate-500">Item</th>
              <th className="py-3 px-6 text-xs font-semibold uppercase text-slate-500 text-right">Qty</th>
              <th className="py-3 px-6 text-xs font-semibold uppercase text-slate-500 text-right">Total</th>
              <th className="py-3 px-6 text-xs font-semibold uppercase text-slate-500">Mode of Payment</th>
              <th className="py-3 px-6 text-xs font-semibold uppercase text-slate-500 text-center">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {transactions.map((t) => (
              <tr key={t.id} className="hover:bg-slate-50">
                <td className="py-3 px-6 text-sm text-slate-600">
                  <div className="font-medium text-slate-900">#{t.id.slice(0,8)}</div>
                  <div className="text-xs text-slate-400">{new Date(t.timestamp).toLocaleDateString()}</div>
                  {t.receiptNumber && (
                      <div className="text-[10px] text-indigo-600 font-medium mt-0.5">OR#: {t.receiptNumber}</div>
                  )}
                </td>
                <td className="py-3 px-6">
                  <span
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium 
                      ${t.type === 'ADDITION' ? 'bg-green-100 text-green-700' : 
                        t.type === 'RETURN' || t.type === 'RETURN_FROM_SALES' ? 'bg-teal-100 text-teal-700' :
                        t.type === 'RELEASE' ? 'bg-orange-100 text-orange-700' : 
                        t.type === 'ISSUE' ? 'bg-indigo-100 text-indigo-700' : 'bg-blue-100 text-blue-700'}`}
                  >
                    {t.type === 'ADDITION' && <ArrowDownLeft className="w-3 h-3" />}
                    {(t.type === 'RETURN' || t.type === 'RETURN_FROM_SALES') && <RotateCcw className="w-3 h-3" />}
                    {t.type === 'RELEASE' && <ArrowUpRight className="w-3 h-3" />}
                    {t.type === 'ISSUE' && <Send className="w-3 h-3" />}
                    {t.type === 'ADJUSTMENT' && <RefreshCcw className="w-3 h-3" />}
                    {t.type === 'RETURN_FROM_SALES' ? 'Return from Sales' : t.type === 'ADDITION' ? 'ADDITION (restock)' : t.type}
                  </span>
                  {t.type === 'ADDITION' && t.editedAt && (
                    <div className="text-[10px] text-amber-800 font-medium mt-1">
                      Edited {new Date(t.editedAt).toLocaleString()}
                      {t.editNote ? <span className="font-normal text-slate-600"> — {t.editNote}</span> : null}
                    </div>
                  )}
                  {(t.recipient && (t.type === 'RELEASE' || t.type === 'ISSUE')) && (
                      <div className="text-[10px] text-slate-500 mt-1">To: {t.recipient}</div>
                  )}
                  {t.type === 'RELEASE' && (
                      <div className="text-[10px] text-slate-500 mt-0.5 space-y-0.5">
                        {(t.personId || t.vehicleId) && (getPerson(t.personId) || getVehicle(t.vehicleId)) && (
                          <div>
                            {getPerson(t.personId) && <span className="font-medium text-slate-600">Responsible: {getPerson(t.personId)!.fullName}</span>}
                            {getPerson(t.personId) && getVehicle(t.vehicleId) && ' · '}
                            {getVehicle(t.vehicleId) && <span>Vehicle: {getVehicle(t.vehicleId)!.plateNumber}</span>}
                          </div>
                        )}
                        {t.releasedBy && <div>Released by: {t.releasedBy}</div>}
                      </div>
                  )}
                  {((t.type === 'RETURN_FROM_SALES' && (t.returnReasonText || t.note)) || (t.note && t.type !== 'RETURN_FROM_SALES')) && (
                      <div className="text-[10px] text-slate-500 mt-1">Reason: {t.returnReasonText || t.note}</div>
                  )}
                </td>
                <td className="py-3 px-6 text-sm font-medium text-slate-800">
                  <div>{t.itemName}</div>
                  {t.type === 'RELEASE' && (t.itemType === 'Service' || t.itemType === 'Product') && (
                    <span className={`inline-flex mt-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium ${t.itemType === 'Service' ? 'bg-violet-100 text-violet-700' : 'bg-slate-100 text-slate-600'}`}>
                      {t.itemType === 'Service' ? 'Servicing' : t.itemType}
                    </span>
                  )}
                </td>
                <td className="py-3 px-6 text-sm text-right text-slate-700">
                  {Math.abs(t.quantityChange)}
                </td>
                <td className="py-3 px-6 text-sm text-right font-medium text-slate-800">
                  ₱{t.totalValue.toFixed(2)}
                </td>
                <td className="py-3 px-6 text-sm text-slate-600">
                  {t.type === 'RELEASE' || t.type === 'ISSUE' ? (
                    <>
                      {historyPaymentLabel(t)}
                      {t.type === 'RELEASE' && t.modeOfPayment === 'Credit' && (
                        <span className="ml-1.5 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800">
                          Credit
                        </span>
                      )}
                      {t.type === 'RELEASE' && t.modeOfPayment === 'Cheque' && (
                        <span className="ml-1.5 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-violet-100 text-violet-800">
                          {t.chequeStatus === 'bounced' ? 'Bounced' : t.chequeStatus === 'cleared' ? 'Cleared' : 'Pending'}
                        </span>
                      )}
                    </>
                  ) : '—'}
                </td>
                <td className="py-3 px-6 text-center">
                  <div className="flex items-center justify-center gap-0.5 flex-wrap">
                    {t.type === 'ADDITION' && onEditAddition && t.itemId && (
                      <button
                        type="button"
                        onClick={() => onEditAddition(t)}
                        className="rounded-xl bg-slate-100 p-1.5 text-amber-600 transition-colors hover:bg-amber-50 hover:text-amber-800"
                        title="Edit restock (correct quantity or cost)"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                    )}
                    {(t.type === 'RELEASE' || t.type === 'ISSUE') && (
                      <>
                        {t.type === 'RELEASE' && returnableReleaseIds.has(t.id) && onReturnFromSalesClick && (
                          <button
                            type="button"
                            onClick={() => onReturnFromSalesClick(t.id)}
                            className="rounded-xl bg-slate-100 p-1.5 text-amber-600 transition-colors hover:bg-amber-50 hover:text-amber-700"
                            title="Return from Sales"
                          >
                            <RotateCcw className="w-4 h-4" />
                          </button>
                        )}
                        {t.type === 'RELEASE' && (t.modeOfPayment === 'Credit' || t.modeOfPayment === 'Cheque') && (
                          <button
                            type="button"
                            onClick={() => setSoaTransactionId(t.id)}
                            className="rounded-xl bg-slate-100 p-1.5 text-slate-500 transition-colors hover:bg-indigo-50 hover:text-indigo-600"
                            title="View Statement of Account"
                          >
                            <FileText className="w-4 h-4" />
                          </button>
                        )}
                        {t.type === 'RELEASE' && onOpenBillingStatementPrint && (
                          <button
                            type="button"
                            onClick={() => onOpenBillingStatementPrint(t)}
                            className="rounded-xl bg-slate-100 p-1.5 text-slate-500 transition-colors hover:bg-emerald-50 hover:text-emerald-700"
                            title="Print billing statement (A4)"
                          >
                            <ScrollText className="w-4 h-4" />
                          </button>
                        )}
                        {t.type === 'RELEASE' && (
                          <button
                            type="button"
                            onClick={() => printPosReceipt(t)}
                            className="rounded-xl bg-slate-100 p-1.5 text-slate-500 transition-colors hover:bg-orange-50 hover:text-orange-700"
                            title="Reprint POS receipt"
                          >
                            <FileText className="w-4 h-4" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => printTransaction(t)}
                          className="rounded-xl bg-slate-100 p-1.5 text-slate-500 transition-colors hover:bg-indigo-50 hover:text-indigo-600"
                            title="Preview / print release voucher"
                        >
                          <Printer className="w-4 h-4" />
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {transactions.length === 0 && (
              <tr>
                <td colSpan={7} className="py-8 text-center text-slate-400">
                  No transactions recorded yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {soaTransactionId && (
        <SOAModal transactionId={soaTransactionId} onClose={() => setSoaTransactionId(null)} />
      )}
    </DashboardSurface>
  );
};