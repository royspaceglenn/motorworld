import React, { useMemo, useState } from 'react';
import { itemsApi } from '../lib/api/adminData';
import type { InventoryItem } from '../types';
import {
  parseInventoryPriceListFile,
  type InventoryPriceListRow,
} from '../lib/inventoryPriceListImport';
import { Button } from './ui/Button';
import { InlineAlert } from './ui/InlineAlert';
import { X, Upload, FileSpreadsheet, Loader2, Trash2, Pencil, CheckCircle2 } from 'lucide-react';

interface InventoryImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImported: (items: InventoryItem[]) => void;
}

type ImportStep = 'upload' | 'review' | 'done';

function rowKey(r: InventoryPriceListRow, index: number): string {
  return `${r.sourceRow ?? index}-${r.itemCode}-${index}`;
}

function validateRows(rows: InventoryPriceListRow[]): string[] {
  const issues: string[] = [];
  const codes = new Map<string, number>();
  rows.forEach((r, i) => {
    const label = r.sourceRow ? `Row ${r.sourceRow}` : `Line ${i + 1}`;
    if (!r.itemCode.trim()) issues.push(`${label}: item code is required.`);
    if (!r.productName.trim()) issues.push(`${label}: product name is required.`);
    const code = r.itemCode.trim().toUpperCase();
    if (code) {
      const prev = codes.get(code);
      if (prev != null) {
        issues.push(`Duplicate item code “${code}” (rows ${prev} and ${r.sourceRow ?? i + 1}).`);
      } else {
        codes.set(code, r.sourceRow ?? i + 1);
      }
    }
  });
  return issues;
}

const inputCls =
  'w-full min-w-0 rounded border border-slate-200 bg-white px-1.5 py-1 text-xs text-slate-900 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400';

export const InventoryImportModal: React.FC<InventoryImportModalProps> = ({
  isOpen,
  onClose,
  onImported,
}) => {
  const [step, setStep] = useState<ImportStep>('upload');
  const [rows, setRows] = useState<InventoryPriceListRow[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [fileName, setFileName] = useState('');
  const [sheetName, setSheetName] = useState('');
  const [mode, setMode] = useState<'upsert' | 'createOnly'>('upsert');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const validationIssues = useMemo(() => validateRows(rows), [rows]);

  if (!isOpen) return null;

  const reset = () => {
    setStep('upload');
    setRows([]);
    setWarnings([]);
    setFileName('');
    setSheetName('');
    setError(null);
    setResult(null);
  };

  const updateRow = (index: number, patch: Partial<InventoryPriceListRow>) => {
    setRows((prev) =>
      prev.map((r, i) => {
        if (i !== index) return r;
        const next = { ...r, ...patch };
        if (patch.itemCode != null) next.itemCode = patch.itemCode.trim().toUpperCase();
        if (patch.beginningStock != null) next.beginningStock = Math.max(0, Number(patch.beginningStock) || 0);
        if (patch.unitCost != null) next.unitCost = Math.max(0, Number(patch.unitCost) || 0);
        if (patch.srpPrice != null) next.srpPrice = Math.max(0, Number(patch.srpPrice) || 0);
        return next;
      })
    );
  };

  const removeRow = (index: number) => {
    setRows((prev) => prev.filter((_, i) => i !== index));
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const parsed = await parseInventoryPriceListFile(file);
      if (!parsed.rows.length) {
        setError(parsed.warnings.join(' ') || 'No rows found in this file.');
        return;
      }
      setRows(parsed.rows);
      setWarnings(parsed.warnings);
      setFileName(file.name);
      setSheetName(parsed.sheetName);
      setStep('review');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read Excel file.');
    } finally {
      setBusy(false);
    }
  };

  const handleImport = async () => {
    if (!rows.length) return;
    if (validationIssues.length) {
      setError('Fix the highlighted issues before applying to inventory.');
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await itemsApi.importPriceList({
        rows: rows.map((r) => ({
          itemCode: r.itemCode.trim().toUpperCase(),
          productType: r.productType.trim(),
          productName: r.productName.trim(),
          brand: r.brand.trim(),
          uom: r.uom.trim(),
          beginningStock: r.beginningStock,
          unitCost: r.unitCost,
          srpPrice: r.srpPrice,
          sourceRow: r.sourceRow,
        })),
        mode,
        sourceLabel: fileName ? `Price list: ${fileName}` : 'Inventory price list import',
      });
      onImported((res.items ?? []).map((i) => i as InventoryItem));
      const errNote = res.errors?.length ? ` ${res.errors.length} row(s) had errors.` : '';
      setResult(
        `Applied to inventory — ${res.created} new, ${res.updated} updated, ${res.skipped} skipped.${errNote}`
      );
      if (res.errors?.length) setWarnings((w) => [...w, ...res.errors]);
      setStep('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-900/40 p-4">
      <div className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
        <div className="flex shrink-0 items-center justify-between border-b border-slate-100 bg-slate-50 px-6 py-4">
          <div>
            <h2 className="text-lg font-bold text-slate-800">Import inventory price list</h2>
            <p className="text-sm text-slate-500">
              Upload Excel → review and edit every row → apply to inventory when ready
            </p>
            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              <span
                className={`rounded-full px-2.5 py-0.5 font-medium ${
                  step === 'upload' ? 'bg-indigo-600 text-white' : 'bg-slate-200 text-slate-600'
                }`}
              >
                1. Upload
              </span>
              <span
                className={`rounded-full px-2.5 py-0.5 font-medium ${
                  step === 'review' ? 'bg-indigo-600 text-white' : 'bg-slate-200 text-slate-600'
                }`}
              >
                2. Review &amp; edit
              </span>
              <span
                className={`rounded-full px-2.5 py-0.5 font-medium ${
                  step === 'done' ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-600'
                }`}
              >
                3. Done
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              reset();
              onClose();
            }}
            className="text-slate-400 hover:text-slate-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-6">
          {error && <InlineAlert message={error} />}
          {result && <InlineAlert message={result} variant="success" />}

          {step === 'upload' && (
            <>
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-indigo-300 bg-indigo-50/50 px-4 py-3 text-sm font-medium text-indigo-800 hover:bg-indigo-50">
                <FileSpreadsheet className="h-5 w-5" />
                {busy ? 'Reading…' : 'Choose Excel file (.xlsx)'}
                <input type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFile} disabled={busy} />
              </label>
              <p className="text-xs text-slate-500">
                Expected columns: Item code, Product type, Product description, Brand, UOM, Beginning stocks, Unit
                cost, SRP price
              </p>
            </>
          )}

          {(step === 'review' || step === 'done') && (
            <>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-slate-700">
                  <strong>{fileName}</strong>
                  {sheetName ? ` · “${sheetName}”` : ''} —{' '}
                  <span className="font-semibold text-indigo-700">{rows.length} item(s)</span> to review
                </p>
                {step === 'review' && (
                  <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs font-medium text-indigo-700 underline-offset-2 hover:underline">
                    <FileSpreadsheet className="h-3.5 w-3.5" />
                    Upload different file
                    <input type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFile} disabled={busy} />
                  </label>
                )}
              </div>

              {step === 'review' && (
                <div className="rounded-lg border border-indigo-100 bg-indigo-50/50 px-3 py-2 text-sm text-indigo-900 flex items-start gap-2">
                  <Pencil className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>
                    Edit any cell below before applying. Remove wrong rows with the trash icon. Nothing is saved to
                    inventory until you click <strong>Apply to inventory</strong>.
                  </span>
                </div>
              )}

              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">
                  If item code already exists in inventory
                </p>
                <div className="flex flex-wrap gap-4 text-sm">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="importMode"
                      checked={mode === 'upsert'}
                      onChange={() => setMode('upsert')}
                      disabled={step === 'done'}
                    />
                    Update prices &amp; stock
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="importMode"
                      checked={mode === 'createOnly'}
                      onChange={() => setMode('createOnly')}
                      disabled={step === 'done'}
                    />
                    Skip — only add new codes
                  </label>
                </div>
              </div>

              {validationIssues.length > 0 && step === 'review' && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 max-h-32 overflow-y-auto">
                  {validationIssues.map((issue) => (
                    <div key={issue}>{issue}</div>
                  ))}
                </div>
              )}

              {warnings.length > 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 max-h-28 overflow-y-auto">
                  {warnings.map((w) => (
                    <div key={w}>{w}</div>
                  ))}
                </div>
              )}

              <div className="overflow-x-auto rounded-lg border border-slate-200 max-h-[50vh] overflow-y-auto">
                <table className="w-full text-left text-sm border-collapse">
                  <thead className="bg-slate-50 text-[10px] uppercase text-slate-500 sticky top-0 z-10">
                    <tr>
                      <th className="px-2 py-2 w-8">#</th>
                      <th className="px-2 py-2 min-w-[72px]">Code</th>
                      <th className="px-2 py-2 min-w-[100px]">Type</th>
                      <th className="px-2 py-2 min-w-[180px]">Product</th>
                      <th className="px-2 py-2 min-w-[72px]">Brand</th>
                      <th className="px-2 py-2 min-w-[64px]">UOM</th>
                      <th className="px-2 py-2 min-w-[56px] text-right">Qty</th>
                      <th className="px-2 py-2 min-w-[80px] text-right">Cost</th>
                      <th className="px-2 py-2 min-w-[80px] text-right">SRP</th>
                      {step === 'review' && <th className="px-2 py-2 w-10" />}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rows.map((r, index) => {
                      const rowInvalid = !r.itemCode.trim() || !r.productName.trim();
                      return (
                        <tr
                          key={rowKey(r, index)}
                          className={rowInvalid && step === 'review' ? 'bg-red-50/60' : 'hover:bg-slate-50/80'}
                        >
                          <td className="px-2 py-1.5 text-xs text-slate-400 tabular-nums">
                            {r.sourceRow ?? index + 1}
                          </td>
                          {step === 'review' ? (
                            <>
                              <td className="px-2 py-1">
                                <input
                                  className={`${inputCls} font-mono uppercase`}
                                  value={r.itemCode}
                                  onChange={(e) => updateRow(index, { itemCode: e.target.value })}
                                />
                              </td>
                              <td className="px-2 py-1">
                                <input
                                  className={inputCls}
                                  value={r.productType}
                                  onChange={(e) => updateRow(index, { productType: e.target.value })}
                                />
                              </td>
                              <td className="px-2 py-1">
                                <input
                                  className={inputCls}
                                  value={r.productName}
                                  onChange={(e) => updateRow(index, { productName: e.target.value })}
                                />
                              </td>
                              <td className="px-2 py-1">
                                <input
                                  className={inputCls}
                                  value={r.brand}
                                  onChange={(e) => updateRow(index, { brand: e.target.value })}
                                />
                              </td>
                              <td className="px-2 py-1">
                                <input
                                  className={inputCls}
                                  value={r.uom}
                                  onChange={(e) => updateRow(index, { uom: e.target.value })}
                                />
                              </td>
                              <td className="px-2 py-1">
                                <input
                                  type="number"
                                  min={0}
                                  step={1}
                                  className={`${inputCls} text-right`}
                                  value={r.beginningStock}
                                  onChange={(e) =>
                                    updateRow(index, { beginningStock: Number(e.target.value) })
                                  }
                                />
                              </td>
                              <td className="px-2 py-1">
                                <input
                                  type="number"
                                  min={0}
                                  step={0.01}
                                  className={`${inputCls} text-right`}
                                  value={r.unitCost}
                                  onChange={(e) => updateRow(index, { unitCost: Number(e.target.value) })}
                                />
                              </td>
                              <td className="px-2 py-1">
                                <input
                                  type="number"
                                  min={0}
                                  step={0.01}
                                  className={`${inputCls} text-right`}
                                  value={r.srpPrice}
                                  onChange={(e) => updateRow(index, { srpPrice: Number(e.target.value) })}
                                />
                              </td>
                              <td className="px-2 py-1 text-center">
                                <button
                                  type="button"
                                  className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                                  title="Remove row"
                                  onClick={() => removeRow(index)}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              </td>
                            </>
                          ) : (
                            <>
                              <td className="px-2 py-2 font-mono text-xs">{r.itemCode}</td>
                              <td className="px-2 py-2 text-xs">{r.productType}</td>
                              <td className="px-2 py-2">{r.productName}</td>
                              <td className="px-2 py-2">{r.brand}</td>
                              <td className="px-2 py-2">{r.uom}</td>
                              <td className="px-2 py-2 text-right tabular-nums">{r.beginningStock}</td>
                              <td className="px-2 py-2 text-right tabular-nums">
                                {r.unitCost.toLocaleString()}
                              </td>
                              <td className="px-2 py-2 text-right tabular-nums">
                                {r.srpPrice.toLocaleString()}
                              </td>
                            </>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {rows.length === 0 && (
                  <p className="px-4 py-8 text-center text-sm text-slate-500">All rows removed. Upload a file again.</p>
                )}
              </div>
            </>
          )}
        </div>

        <div className="flex shrink-0 gap-2 border-t border-slate-100 bg-slate-50 px-6 py-4">
          {step === 'review' && (
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setStep('upload');
                setRows([]);
                setFileName('');
              }}
              disabled={busy}
            >
              Back
            </Button>
          )}
          <Button
            type="button"
            variant="secondary"
            fullWidth
            onClick={() => {
              reset();
              onClose();
            }}
            disabled={busy}
          >
            {step === 'done' ? 'Close' : 'Cancel'}
          </Button>
          {step === 'review' && (
            <Button
              type="button"
              fullWidth
              onClick={handleImport}
              disabled={busy || rows.length === 0 || validationIssues.length > 0}
              className="bg-emerald-600 hover:bg-emerald-700"
            >
              {busy ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Applying…
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4" />
                  Apply {rows.length} item(s) to inventory
                </>
              )}
            </Button>
          )}
          {step === 'done' && (
            <Button
              type="button"
              fullWidth
              onClick={() => {
                reset();
                onClose();
              }}
            >
              Done
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};
