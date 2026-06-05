import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

function formatPdfError(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  if (typeof e === 'string' && e.trim()) return e.trim();
  return 'Could not read the PDF file.';
}

/** Extract plain text from a PDF file in the browser (for SR-1 import). */
export async function extractTextFromPdfFile(file: File): Promise<string> {
  if (!file || file.size === 0) {
    throw new Error('The selected file is empty.');
  }
  if (!/\.pdf$/i.test(file.name) && file.type && file.type !== 'application/pdf') {
    throw new Error('Please choose a PDF sales register file.');
  }

  let pdfjs;
  try {
    pdfjs = await import('pdfjs-dist');
    pdfjs.GlobalWorkerOptions.workerSrc = pdfjsWorker;
  } catch (e) {
    throw new Error(`PDF reader failed to load: ${formatPdfError(e)}`);
  }

  const data = new Uint8Array(await file.arrayBuffer());
  let doc;
  try {
    doc = await pdfjs.getDocument({ data }).promise;
  } catch (e) {
    throw new Error(`Could not open PDF: ${formatPdfError(e)}`);
  }
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const parts: string[] = [];
    let lastY: number | null = null;

    for (const item of content.items) {
      if (!('str' in item)) continue;
      const str = String(item.str || '');
      if (!str) continue;

      const y = Array.isArray(item.transform) ? Number(item.transform[5]) : null;
      if (parts.length > 0) {
        if (item.hasEOL) {
          parts.push('\n');
        } else if (lastY != null && y != null && Math.abs(y - lastY) > 4) {
          parts.push('\n');
        } else {
          parts.push(' ');
        }
      }
      parts.push(str);
      if (y != null) lastY = y;
      if (item.hasEOL) lastY = null;
    }

    pages.push(parts.join(''));
  }
  return pages.join('\n');
}
