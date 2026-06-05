import React, { useMemo, useRef, useState } from 'react';
import { salesUploadApi, sr1ImportApi } from '../lib/api/adminData';
import { extractTextFromPdfFile } from '../lib/sr1PdfExtract';
import {
  parseSalesRegisterText,
  SALES_REGISTER_FORMAT_OPTIONS,
  type SalesRegisterFormatId,
  type SalesRegisterParseResult,
} from '../lib/salesRegisterImport';
import { Button } from './ui/Button';
import { InlineAlert } from './ui/InlineAlert';
import { CheckCircle2, FileUp, Loader2, Upload } from 'lucide-react';

interface Sr1ImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImported: () => void;
}

type ImportStep = 'upload' | 'review' | 'done';

function stepBadgeClass(active: boolean, complete: boolean): string {
  if (active) return 'bg-indigo-600 text-white';
  if (complete) return 'bg-emerald-100 text-emerald-800';
  return 'bg-slate-200 text-slate-500';
}

function money(n: number) {
  return `₱${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatError(e: unknown, fallback: string): string {
  if (e instanceof Error && e.message.trim()) return e.message.trim();
  if (typeof e === 'string' && e.trim()) return e.trim();
  return fallback;
}

export const Sr1ImportModal: React.FC<Sr1ImportModalProps> = ({ isOpen, onClose, onImported }) => {
  const [step, setStep] = useState<ImportStep>('upload');
  const [fileName, setFileName] = useState('');
  const [formatId, setFormatId] = useState<SalesRegisterFormatId>('auto');
  const [parsed, setParsed] = useState<SalesRegisterParseResult | null>(null);
  const [skipDuplicates, setSkipDuplicates] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const uploadFileRef = useRef<File | null>(null);

  const previewSales = useMemo(() => parsed?.sales.slice(0, 12) ?? [], [parsed]);
  const migrationPlan = parsed?.migrationPlan;

  function paymentLabel(mode: string) {
    const m = String(mode || 'Cash').trim();
    if (m === 'Credit') return 'A/R';
    if (m === 'Purchase Order') return 'P.O.';
    if (m === 'Cheque') return 'Cheque';
    return 'Cash';
  }

  if (!isOpen) return null;

  const reset = () => {
    setStep('upload');
    setFileName('');
    setParsed(null);
    setFormatId('auto');
    setSkipDuplicates(false);
    setBusy(false);
    setError(null);
    setResult(null);
    uploadFileRef.current = null;
  };

  const finishAndClose = () => {
    reset();
    onClose();
  };

  const handleFile = async (file: File) => {
    setBusy(true);
    setError(null);
    setFileName(file.name);
    uploadFileRef.current = file;
    try {
      try {
        const uploaded = await salesUploadApi.uploadReport(file, { apply: false, formatId });
        if (uploaded.lineCount === 0 || !uploaded.sales?.length) {
          throw new Error('Could not read sale lines from this PDF on the server.');
        }
        setParsed({
          fileName: uploaded.fileName,
          lineCount: uploaded.lineCount,
          saleCount: uploaded.saleCount,
          warnings: uploaded.warnings,
          parseErrors: uploaded.parseErrors,
          sales: uploaded.sales as SalesRegisterParseResult['sales'],
          customers: uploaded.customers,
          dateRange: uploaded.dateRange,
          formatId: uploaded.formatId as SalesRegisterFormatId,
          formatLabel: uploaded.formatLabel,
          migrationPlan: uploaded.migrationPlan,
        });
        setStep('review');
        return;
      } catch {
        /* fall back to browser PDF parse when API is offline */
      }

      const text = await extractTextFromPdfFile(file);
      const res = parseSalesRegisterText(text, file.name, formatId);
      if (res.lineCount === 0) {
        const hint = SALES_REGISTER_FORMAT_OPTIONS.find((o) => o.id === formatId)?.hint ?? '';
        throw new Error(
          `Could not read sale lines from this PDF.${hint ? ` ${hint}` : ''} Try another format or export.`
        );
      }
      setParsed(res);
      setStep('review');
    } catch (e) {
      setError(formatError(e, 'Failed to read PDF. Check the register format and try again.'));
    } finally {
      setBusy(false);
    }
  };

  const applyImport = async () => {
    if (!parsed || parsed.sales.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const file = uploadFileRef.current;
      if (file) {
        const uploaded = await salesUploadApi.uploadReport(file, {
          apply: true,
          formatId,
          skipDuplicates,
        });
        const res = uploaded.import;
        if (!res) throw new Error('Import did not return a result.');
        const msg = [
          `${res.created} sale(s) recorded on original PDF dates`,
          res.receivablesCreated > 0 ? `${res.receivablesCreated} receivable(s) in Receivables` : '',
          res.stockUnitsDeducted > 0 ? `${res.stockUnitsDeducted} unit(s) deducted from stock` : '',
          res.skipped > 0 ? `${res.skipped} skipped (already imported)` : '',
          res.personsCreated > 0 ? `${res.personsCreated} customer(s) added` : '',
          res.vehiclesCreated > 0 ? `${res.vehiclesCreated} vehicle(s) added` : '',
          res.errors.length > 0 ? `${res.errors.length} error(s)` : '',
        ]
          .filter(Boolean)
          .join(' · ');
        setResult(msg);
        setStep('done');
        onImported();
        return;
      }

      const res = await sr1ImportApi.apply({
        sales: parsed.sales as unknown as Record<string, unknown>[],
        sourceFileName: fileName || parsed.fileName,
        formatId: parsed.formatId,
        formatLabel: parsed.formatLabel,
        skipDuplicates,
      });
      const msg = [
        `${res.created} sale(s) recorded on original PDF dates`,
        res.receivablesCreated > 0 ? `${res.receivablesCreated} receivable(s) in Receivables` : '',
        res.stockUnitsDeducted > 0 ? `${res.stockUnitsDeducted} unit(s) deducted from stock` : '',
        res.skipped > 0 ? `${res.skipped} skipped (already imported)` : '',
        res.personsCreated > 0 ? `${res.personsCreated} customer(s) added` : '',
        res.vehiclesCreated > 0 ? `${res.vehiclesCreated} vehicle(s) added` : '',
        res.errors.length > 0 ? `${res.errors.length} error(s)` : '',
      ]
        .filter(Boolean)
        .join(' · ');
      setResult(msg);
      setStep('done');
      onImported();
    } catch (e) {
      setError(formatError(e, 'Import failed. Check that the API server is running and try again.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/50 p-4">
      <div
        className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
        role="dialog"
        aria-labelledby="sr1-import-title"
      >
        <div className="border-b border-slate-200 px-5 py-4 sm:px-6">
          <h2 id="sr1-import-title" className="text-lg font-semibold text-slate-900">
            Import sales register (PDF)
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Upload a sales register PDF to record sales, customers, vehicles, and line items. SR-1 is supported today;
            more register types can be added later. Migration mode imports every sale; enable duplicate skip only when
            re-applying the same file intentionally.
          </p>
          <div className="mt-4 flex flex-wrap gap-2 text-xs font-semibold uppercase tracking-wide">
            <span className={`rounded-full px-3 py-1 ${stepBadgeClass(step === 'upload', step !== 'upload')}`}>
              1. Upload PDF
            </span>
            <span className={`rounded-full px-3 py-1 ${stepBadgeClass(step === 'review', step === 'done')}`}>
              2. Review
            </span>
            <span className={`rounded-full px-3 py-1 ${stepBadgeClass(step === 'done', false)}`}>3. Done</span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 sm:px-6">
          {error && <InlineAlert message={error} variant="error" className="mb-4" />}

          {step === 'upload' && (
            <div className="space-y-4">
              <div>
                <label htmlFor="register-format" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Register format
                </label>
                <select
                  id="register-format"
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-200"
                  value={formatId}
                  onChange={(e) => setFormatId(e.target.value as SalesRegisterFormatId)}
                  disabled={busy}
                >
                  {SALES_REGISTER_FORMAT_OPTIONS.filter((o) => o.available).map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <p className="mt-1.5 text-xs text-slate-500">
                  {SALES_REGISTER_FORMAT_OPTIONS.find((o) => o.id === formatId)?.hint}
                </p>
              </div>

              <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-6 py-12 transition hover:border-indigo-400 hover:bg-indigo-50/40">
                <Upload className="mb-3 h-10 w-10 text-indigo-600" aria-hidden />
                <span className="text-sm font-semibold text-slate-800">Choose sales register PDF</span>
                <span className="mt-1 text-xs text-slate-500">SR-1, exports, and future register layouts</span>
                <input
                  type="file"
                  accept="application/pdf,.pdf"
                  className="sr-only"
                  disabled={busy}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void handleFile(f);
                    e.target.value = '';
                  }}
                />
              </label>
              {busy && (
                <p className="flex items-center gap-2 text-sm text-slate-600">
                  <Loader2 className="h-4 w-4 animate-spin" /> Reading PDF…
                </p>
              )}
            </div>
          )}

          {step === 'review' && parsed && (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Format</p>
                  <p className="text-sm font-medium text-slate-900">{parsed.formatLabel}</p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 sm:col-span-2 lg:col-span-1">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">File</p>
                  <p className="text-sm font-medium text-slate-900 truncate">{fileName || parsed.fileName}</p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Sales</p>
                  <p className="text-sm font-medium text-slate-900">{parsed.saleCount}</p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Line items</p>
                  <p className="text-sm font-medium text-slate-900">{parsed.lineCount}</p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Customers</p>
                  <p className="text-sm font-medium text-slate-900">{parsed.customers.length}</p>
                </div>
              </div>

              {parsed.dateRange && (
                <p className="text-sm text-slate-600">
                  When it happened: sales dated <strong>{parsed.dateRange.start}</strong> through{' '}
                  <strong>{parsed.dateRange.end}</strong> (Philippines time, from the PDF).
                </p>
              )}

              {migrationPlan && (
                <div className="rounded-lg border border-indigo-100 bg-indigo-50/50 p-4">
                  <h3 className="text-xs font-bold uppercase tracking-wide text-indigo-800">
                    Where this migration goes in the system
                  </h3>
                  <ul className="mt-3 space-y-2.5">
                    {migrationPlan.destinations.map((d) => (
                      <li key={d.id} className="text-xs text-slate-700">
                        <span className="font-semibold text-slate-900">{d.systemArea}</span>
                        <span className="text-slate-500"> — </span>
                        {d.description}
                        <span className="ml-1 font-medium text-indigo-700">({d.count})</span>
                        {d.detail && <span className="block text-[11px] text-slate-500 mt-0.5">{d.detail}</span>}
                      </li>
                    ))}
                  </ul>
                  {migrationPlan.paymentBreakdown.length > 0 && (
                    <p className="mt-3 text-[11px] text-slate-600">
                      Payment split:{' '}
                      {migrationPlan.paymentBreakdown
                        .map((p) => `${paymentLabel(p.mode)} ${p.count} (${money(p.total)})`)
                        .join(' · ')}
                    </p>
                  )}
                </div>
              )}

              <label className="flex items-start gap-2 rounded-lg border border-slate-200 bg-white px-3 py-3 text-sm text-slate-700">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={skipDuplicates}
                  onChange={(e) => setSkipDuplicates(e.target.checked)}
                />
                <span>
                  <strong>Skip duplicates</strong> (optional) when re-applying the same PDF. Leave off for migration so
                  every sale is recorded.
                </span>
              </label>

              {(parsed.warnings.length > 0 || parsed.parseErrors.length > 0) && (
                <InlineAlert
                  variant="info"
                  message={[
                    parsed.parseErrors.length > 0
                      ? `${parsed.parseErrors.length} row(s) could not be parsed and were skipped.`
                      : '',
                    ...parsed.warnings.slice(0, 3),
                  ]
                    .filter(Boolean)
                    .join(' ')}
                />
              )}

              <div className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="w-full min-w-[720px] text-left text-xs">
                  <thead className="bg-slate-50 text-slate-600">
                    <tr>
                      <th className="px-2 py-2 font-semibold">Date</th>
                      <th className="px-2 py-2 font-semibold">Customer</th>
                      <th className="px-2 py-2 font-semibold">Payment</th>
                      <th className="px-2 py-2 font-semibold">BS / CR</th>
                      <th className="px-2 py-2 font-semibold">Lines</th>
                      <th className="px-2 py-2 font-semibold text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {previewSales.map((s) => (
                      <tr key={s.key}>
                        <td className="px-2 py-2 whitespace-nowrap">{s.saleDate}</td>
                        <td className="px-2 py-2 max-w-[200px] truncate" title={s.customerName}>
                          {s.customerName}
                        </td>
                        <td className="px-2 py-2 whitespace-nowrap">
                          {paymentLabel(s.modeOfPayment)}
                          {s.terms && s.terms !== '—' ? (
                            <span className="block text-[10px] text-slate-500">{s.terms}</span>
                          ) : null}
                        </td>
                        <td className="px-2 py-2 font-mono text-[11px]">
                          {s.bsNo || '—'} / {s.crNo || '—'}
                        </td>
                        <td className="px-2 py-2">{s.lines.length}</td>
                        <td className="px-2 py-2 text-right font-medium">{money(s.totalValue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {parsed.saleCount > previewSales.length && (
                <p className="text-xs text-slate-500">
                  Showing first {previewSales.length} of {parsed.saleCount} sales.
                </p>
              )}

              <p className="text-xs text-slate-500 leading-relaxed">
                After <strong>Apply to system</strong>, check <strong>History</strong> (dated sales),{' '}
                <strong>Sales summary</strong> (P&amp;L), <strong>Receivables</strong> (credit/P.O.),{' '}
                <strong>Accounts</strong> (customers), and <strong>Inventory</strong> (stock). Dates and payment type
                come from the PDF.
              </p>
            </div>
          )}

          {step === 'done' && (
            <div className="flex flex-col items-center py-8 text-center">
              <CheckCircle2 className="h-12 w-12 text-emerald-600" aria-hidden />
              <p className="mt-4 text-base font-semibold text-slate-900">Sales register import complete</p>
              {result && <p className="mt-2 max-w-lg text-sm text-slate-600">{result}</p>}
              <p className="mt-3 text-sm text-slate-500">
                Check <strong>History</strong>, <strong>Sales summary</strong>, <strong>Receivables</strong>,{' '}
                <strong>Accounts</strong>, and <strong>Inventory</strong> — each section should match the migration map
                above.
              </p>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 px-5 py-4 sm:px-6">
          {step !== 'done' && (
            <Button type="button" variant="ghost" onClick={finishAndClose} disabled={busy}>
              Cancel
            </Button>
          )}
          {step === 'upload' && (
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50">
              <FileUp className="h-4 w-4" />
              Select PDF
              <input
                type="file"
                accept="application/pdf,.pdf"
                className="sr-only"
                disabled={busy}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleFile(f);
                  e.target.value = '';
                }}
              />
            </label>
          )}
          {step === 'review' && (
            <Button type="button" onClick={() => void applyImport()} disabled={busy || !parsed?.sales.length}>
              {busy ? (
                <>
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Applying…
                </>
              ) : (
                'Apply to system'
              )}
            </Button>
          )}
          {step === 'done' && (
            <Button type="button" onClick={finishAndClose}>
              Done
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};
