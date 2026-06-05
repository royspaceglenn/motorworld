import { PDFParse } from 'pdf-parse';

/**
 * Extract plain text from a PDF buffer (Node.js).
 * Uses pdf-parse v2 (pdfjs-dist) — preserves tab-separated SR-1 columns.
 */
export async function extractTextFromPdfBuffer(buffer) {
  if (!buffer || buffer.length === 0) {
    throw new Error('The uploaded file is empty.');
  }

  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    const text = String(result?.text || '').trim();
    if (!text) {
      throw new Error('No text could be extracted from this PDF.');
    }
    return text;
  } finally {
    await parser.destroy();
  }
}
