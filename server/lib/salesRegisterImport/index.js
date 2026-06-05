import { extractTextFromPdfBuffer } from './extractPdfText.js';
import { parseSr1Text } from './parseSr1.js';
import { salesToFlatRecords } from './toFlatRecords.js';
import { computeMigrationPlan } from './migrationPlan.js';

export { extractTextFromPdfBuffer, parseSr1Text, salesToFlatRecords, computeMigrationPlan };

/**
 * Full pipeline: PDF buffer → parsed sales + flat ledger records.
 */
export async function parseSalesRegisterPdf(buffer, fileName = 'register.pdf', formatId = 'auto') {
  const text = await extractTextFromPdfBuffer(buffer);
  const parsed = parseSr1Text(text, fileName);
  const records = salesToFlatRecords(parsed);

  return {
    ...parsed,
    formatId: formatId || 'auto',
    formatLabel: 'Sales register (SR-1)',
    records,
    migrationPlan: computeMigrationPlan(parsed),
  };
}
