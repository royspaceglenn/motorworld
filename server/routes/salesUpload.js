import { Router } from 'express';
import multer from 'multer';
import { requireAdmin } from '../middleware/rbac.js';
import { applySr1Import } from '../lib/sr1ImportService.js';
import { parseSalesRegisterPdf } from '../lib/salesRegisterImport/index.js';
import { scheduleViewerSync } from '../services/firebaseViewerSync.js';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    const name = String(file.originalname || '').toLowerCase();
    const mime = String(file.mimetype || '').toLowerCase();
    if (mime === 'application/pdf' || name.endsWith('.pdf')) {
      return cb(null, true);
    }
    return cb(new Error('Only PDF files are allowed.'));
  },
});

function parseBool(value, defaultValue) {
  if (value == null || value === '') return defaultValue;
  const v = String(value).trim().toLowerCase();
  if (v === 'true' || v === '1' || v === 'yes') return true;
  if (v === 'false' || v === '0' || v === 'no') return false;
  return defaultValue;
}

/**
 * POST /api/sales/upload-report
 * Multipart field: `file` (PDF sales register, e.g. SR-1.pdf)
 * Optional form fields:
 *   - apply (default false) — when true, insert parsed sales into POS/ledger
 *   - skipDuplicates (default true) — skip sales already imported from same PDF/key
 *   - formatId (default auto) — auto | sr1
 */
router.post('/upload-report', requireAdmin, upload.single('file'), async (req, res) => {
  try {
    const file = req.file;
    if (!file?.buffer?.length) {
      return res.status(400).json({ error: 'Upload a PDF file in the "file" field.' });
    }

    const fileName = String(file.originalname || 'register.pdf').trim() || 'register.pdf';
    const formatId = String(req.body?.formatId || 'auto').trim() || 'auto';
    const shouldApply = parseBool(req.body?.apply, false);
    const skipDuplicates = parseBool(req.body?.skipDuplicates, true);

    const parsed = await parseSalesRegisterPdf(file.buffer, fileName, formatId);

    if (parsed.lineCount === 0) {
      return res.status(400).json({
        error: 'Could not read sale lines from this PDF. Use a Motor World SR-1 sales register export.',
        fileName,
        warnings: parsed.warnings,
        parseErrors: parsed.parseErrors.slice(0, 20),
      });
    }

    const previewRecords = parsed.records.slice(0, 50);
    let importResult = null;

    if (shouldApply) {
      importResult = await applySr1Import(
        {
          sales: parsed.sales,
          sourceFileName: fileName,
          formatId: parsed.formatId,
          formatLabel: parsed.formatLabel,
          skipDuplicates,
        },
        req.user
      );
      scheduleViewerSync();
    }

    return res.json({
      fileName,
      formatId: parsed.formatId,
      formatLabel: parsed.formatLabel,
      lineCount: parsed.lineCount,
      saleCount: parsed.saleCount,
      recordCount: parsed.records.length,
      customers: parsed.customers,
      dateRange: parsed.dateRange,
      warnings: parsed.warnings,
      parseErrors: parsed.parseErrors.slice(0, 20),
      sales: parsed.sales,
      records: previewRecords,
      applied: shouldApply,
      import: importResult,
    });
  } catch (error) {
    const msg = error?.message || 'Sales report upload failed.';
    const status = /Only PDF|empty|No text|No sale lines/i.test(msg) ? 400 : 500;
    return res.status(status).json({ error: msg });
  }
});

export default router;
