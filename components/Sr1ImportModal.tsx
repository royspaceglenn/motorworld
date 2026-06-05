import React, { useMemo, useState } from 'react';
import { sr1ImportApi } from '../lib/api/adminData';
import { extractTextFromPdfFile } from '../lib/sr1PdfExtract';
import { parseSr1Text, type Sr1ParseResult } from '../lib/sr1ImportParse';
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
  const [parsed, setParsed] = useState<Sr1ParseResult | null>(null);
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const previewSales = useMemo(() => parsed?.sales.slice(0, 12) ?? [], [parsed]);

  if (!isOpen) return null;

  const reset = () => {
    setStep('upload');
    setFileName('');
    setParsed(null);
    setSkipDuplicates(true);
    setBusy(false);
    setError(null);
    setResult(null);
  };

  const finishAndClose = () => {
    reset();
    onClose();
  };

  const handleFile = async (file: File) => {
    setBusy(true);
    setError(null);
    setFileName(file.name);
    try {
      const text = await extractTextFromPdfFile(file);
      const res = parseSr1Text(text, file.name);
      if (res.lineCount === 0) {
        throw new Error('Could not read sale lines from this PDF. Use a Motor World SR-1 sales register export.');
      }
      setParsed(res);
      setStep('review');
    } catch (e) {
      setError(formatError(e, 'Failed to read PDF. Try SR-1.pdf from Motor World exports.'));
    } finally {
      setBusy(false);
    }
  };

  const applyImport = async () => {
    if (!parsed || parsed.sales.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const res = await sr1ImportApi.apply({
        sales: parsed.sales as unknown as Record<string, unknown>[],
        sourceFileName: fileName || parsed.fileName,
        skipDuplicates,
      });
      const msg = [
        `${res.created} sale(s) recorded`,
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
            Import SR-1 sales register (PDF)
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Upload your <strong>SR-1.pdf</strong> to record historical sales, customers, vehicles, and line items in
            the system. Re-uploading the same file skips duplicates when that option is on.
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
              <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-6 py-12 transition hover:border-indigo-400 hover:bg-indigo-50/40">
                <Upload className="mb-3 h-10 w-10 text-indigo-600" aria-hidden />
                <span className="text-sm font-semibold text-slate-800">Choose SR-1.pdf</span>
                <span className="mt-1 text-xs text-slate-500">Motor World sales register export</span>
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
                  Date range: <strong>{parsed.dateRange.start}</strong> to <strong>{parsed.dateRange.end}</strong>
                </p>
              )}

              <label className="flex items-start gap-2 rounded-lg border border-slate-200 bg-white px-3 py-3 text-sm text-slate-700">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={skipDuplicates}
                  onChange={(e) => setSkipDuplicates(e.target.checked)}
                />
                <span>
                  <strong>Skip duplicates</strong> when applying the same PDF again (matched by SR-1 key, receipt no.,
                  date, and customer).
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
                Sales are imported as <strong>RELEASE</strong> records and <strong>inventory is deducted</strong> for
                matched product lines (same as POS). Customers and vehicles are created when missing. Sales with
                insufficient stock are skipped and listed in errors.
              </p>
            </div>
          )}

          {step === 'done' && (
            <div className="flex flex-col items-center py-8 text-center">
              <CheckCircle2 className="h-12 w-12 text-emerald-600" aria-hidden />
              <p className="mt-4 text-base font-semibold text-slate-900">SR-1 import complete</p>
              {result && <p className="mt-2 max-w-lg text-sm text-slate-600">{result}</p>}
              <p className="mt-3 text-sm text-slate-500">
                View imported sales in <strong>History</strong>, <strong>SR-1 register</strong>, and customer accounts.
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
