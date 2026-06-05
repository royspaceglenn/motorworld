import React from 'react';
import type { PrePrintedOverlayCalibration } from '../lib/prePrintedReceiptOverlay';
import { saveOverlayCalibration } from '../lib/prePrintedReceiptOverlay';

interface PrePrintedOverlayCalibrationProps {
  value: PrePrintedOverlayCalibration;
  onChange: (next: PrePrintedOverlayCalibration) => void;
  onPreview?: () => void;
  className?: string;
}

export const PrePrintedOverlayCalibrationPanel: React.FC<PrePrintedOverlayCalibrationProps> = ({
  value,
  onChange,
  onPreview,
  className = '',
}) => {
  const setOffset = (axis: 'offsetX' | 'offsetY', raw: string) => {
    const n = parseFloat(raw);
    const next = { ...value, [axis]: Number.isFinite(n) ? n : 0 };
    onChange(next);
    saveOverlayCalibration(next);
  };

  return (
    <div className={`rounded-lg border border-slate-200 bg-slate-50/80 p-3 space-y-3 ${className}`}>
      <p className="text-xs font-semibold text-slate-700">Print alignment (mm)</p>
      <p className="text-[11px] text-slate-500 leading-snug">
        Feed your pre-printed invoice booklet, then nudge all printed values together if they miss the boxes.
        Offsets are saved for this browser.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <label className="text-xs text-slate-600">
          Left / right (X)
          <input
            type="number"
            step={0.5}
            className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm"
            value={value.offsetX}
            onChange={(e) => setOffset('offsetX', e.target.value)}
          />
        </label>
        <label className="text-xs text-slate-600">
          Up / down (Y)
          <input
            type="number"
            step={0.5}
            className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm"
            value={value.offsetY}
            onChange={(e) => setOffset('offsetY', e.target.value)}
          />
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="text-xs px-2 py-1 rounded border border-slate-200 bg-white hover:bg-slate-100"
          onClick={() => {
            const next = { offsetX: 0, offsetY: 0 };
            onChange(next);
            saveOverlayCalibration(next);
          }}
        >
          Reset
        </button>
        {onPreview && (
          <button
            type="button"
            className="text-xs px-2 py-1 rounded border border-indigo-200 bg-indigo-50 text-indigo-800 hover:bg-indigo-100"
            onClick={onPreview}
          >
            Preview overlay guides
          </button>
        )}
      </div>
    </div>
  );
};
