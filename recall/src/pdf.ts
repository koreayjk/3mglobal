// PDF 처리는 브라우저 안에서만 수행한다 (pdf.js). 필요할 때만 동적으로 불러온다.
import type { PDFDocumentProxy } from 'pdfjs-dist'

export const PDF_MAX_BYTES = 20 * 1024 * 1024
export const PDF_MAX_PAGES = 20

let libPromise: Promise<typeof import('pdfjs-dist/legacy/build/pdf.mjs')> | null = null
async function lib() {
  if (!libPromise) {
    libPromise = (async () => {
      const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
      const worker = (await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')).default
      pdfjs.GlobalWorkerOptions.workerSrc = worker
      return pdfjs
    })()
  }
  return libPromise
}

export async function openPdf(file: Blob): Promise<PDFDocumentProxy> {
  const pdfjs = await lib()
  const data = new Uint8Array(await file.arrayBuffer())
  return pdfjs.getDocument({ data }).promise
}

export async function pageText(doc: PDFDocumentProxy, n: number): Promise<string> {
  const page = await doc.getPage(n)
  const tc = await page.getTextContent()
  let out = ''
  for (const it of tc.items) {
    if ('str' in it) { out += it.str; out += it.hasEOL ? '\n' : '' }
  }
  page.cleanup()
  return out.replace(/[ \t]+\n/g, '\n').trim()
}

export async function renderPage(doc: PDFDocumentProxy, n: number, maxEdge = 1600): Promise<Blob> {
  const page = await doc.getPage(n)
  const base = page.getViewport({ scale: 1 })
  const scale = Math.min(3, maxEdge / Math.max(base.width, base.height))
  const viewport = page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height)
  await page.render({ canvas, viewport }).promise
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.85))
  page.cleanup()
  if (!blob) throw new Error('render')
  return blob
}
