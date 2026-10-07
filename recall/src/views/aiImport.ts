import type { AiCard, AnalyzeRequest, Difficulty, HealthInfo, OrganizeResult, OutLang, OutputMode, PageInput } from '../../api/_lib/types'
import { analyze, fetchHealth } from '../ai/client'
import { emptyNote } from '../cards'
import { getAll, settings } from '../db'
import { t } from '../i18n'
import { IMAGE_MAX_BYTES, imageUrl, normalizeForStorage, saveImage, sniffImage, toAiImage, transformImage, validateImage } from '../images'
import { openPdf, PDF_MAX_BYTES, PDF_MAX_PAGES, pageText, renderPage } from '../pdf'
import { addNotes, createDeck } from '../repo'
import { go, type Ctx } from '../router'
import { put } from '../db'
import type { Material, Note } from '../types'
import { cameraSupported, captureFromCamera } from '../ui/camera'
import { confirmDialog, field, openDialog, toast } from '../ui/components'
import { RectEditor } from '../ui/rectEditor'
import { clear, fmtBytes, h, uid } from '../util'

const TEXT_MAX_BYTES = 200 * 1024
const CHUNK = 4000

interface PageItem {
  id: string; label: string; blob?: Blob; thumb?: string; text: string
  source: 'pdf-text' | 'text-file' | 'manual' | 'ai' | 'none'
}
interface Job { id: string; name: string; status: 'processing' | 'done' | 'error' | 'cancelled'; error?: string; cancelled: boolean; run: () => Promise<void> }
interface EditCard { c: AiCard; on: boolean }

export default async function view({ root, query }: Ctx) {
  const [health, decks] = await Promise.all([fetchHealth(), getAll('decks')])
  const aiOn = !!health?.aiEnabled
  const maxPages = health?.limits.maxPages ?? 12
  const maxImages = health?.limits.maxImages ?? 6
  const maxChars = health?.limits.maxTextChars ?? 60000

  let step = 1
  const pages: PageItem[] = []
  const jobs: Job[] = []
  let busy = false
  let ctl: AbortController | null = null
  let sendError: { code: string; message: string; retryable: boolean; detail?: string } | null = null
  let result: OrganizeResult | null = null
  let isMock = false
  let editCards: EditCard[] = []
  const opts = { mode: 'both' as OutputMode, language: 'original' as OutLang, count: 10, difficulty: 'normal' as Difficulty, focus: '', includeImages: false }

  const body = h('div')
  root.append(h('div', { class: 'page-head' }, h('div', null, h('h1', null, t('ai.title')), h('p', { class: 'sub' }, t('ai.sub')))), body)
  const thumbUrls: string[] = []
  const mkThumb = (b: Blob) => { const u = URL.createObjectURL(b); thumbUrls.push(u); return u }

  // ───────────── 공통 ─────────────
  const stepsBar = () => h('ol', { class: 'steps', 'aria-label': t('ai.steps') }, ['ai.s1', 'ai.s2', 'ai.s3', 'ai.s4'].map((k, i) =>
    h('li', { class: step === i + 1 ? 'on' : step > i + 1 ? 'done' : '', 'aria-current': step === i + 1 ? 'step' : null }, h('b', null, String(i + 1)), t(k))))
  const errText = (code: string, fallback: string) => { const k = `ai.err.${code}`; const v = t(k); return v === k ? fallback || t('ai.err.generic') : v }
  const mockBanner = () => (isMock ? h('div', { class: 'mock-banner', role: 'note' }, t('ai.mockBanner')) : null)

  function draw() {
    clear(body)
    body.append(stepsBar())
    if (!aiOn) body.append(h('div', { class: 'notice warn', style: 'margin-bottom:16px' }, health ? t('ai.offNotice') : t('ai.unreachNotice'), ' ', h('a', { href: '#/create' }, t('ai.manual'))))
    ;[null, step1, step2, step3, step4][step]!()
  }

  // ───────────── 1. 자료 추가 ─────────────
  function addItem(p: Omit<PageItem, 'id'>) { pages.push({ id: uid(), ...p }) }
  const room = () => Math.max(0, maxPages - pages.length)

  async function ingest(file: File | Blob, name: string, job: Job) {
    const fail = (key: string, p?: Record<string, string | number>) => { throw new Error(t(key, p)) }
    if (file instanceof Blob && (await sniffImage(file))) {
      const err = await validateImage(file)
      if (err) fail(`editor.img.${err}`, { size: fmtBytes(IMAGE_MAX_BYTES) })
      if (!room()) fail('ai.full', { n: maxPages })
      const blob = await normalizeForStorage(file)
      if (job.cancelled) return
      addItem({ label: name, blob, thumb: mkThumb(blob), text: '', source: 'none' })
      return
    }
    const head = new Uint8Array(await file.slice(0, 5).arrayBuffer())
    const isPdf = String.fromCharCode(...head) === '%PDF-'
    if (isPdf) {
      if (file.size > PDF_MAX_BYTES) fail('ai.pdfBig', { size: fmtBytes(PDF_MAX_BYTES) })
      const doc = await openPdf(file)
      let from = 1, to = Math.min(doc.numPages, PDF_MAX_PAGES)
      if (doc.numPages > PDF_MAX_PAGES) {
        const r = await askRange(name, doc.numPages)
        if (!r) { job.cancelled = true; return }
        ;[from, to] = r
      }
      to = Math.min(to, from + room() - 1)
      if (to < from) fail('ai.full', { n: maxPages })
      for (let n = from; n <= to; n++) {
        if (job.cancelled) return
        const text = await pageText(doc, n)
        const blob = await renderPage(doc, n)
        addItem({ label: `${name} p.${n}`, blob, thumb: mkThumb(blob), text, source: text.trim().length >= 20 ? 'pdf-text' : 'none' })
        draw()
      }
      return
    }
    const looksText = /\.(txt|md|markdown|csv)$/i.test(name) || (file as File).type?.startsWith('text/')
    if (!looksText) fail('editor.img.type')
    if (file.size > TEXT_MAX_BYTES) fail('ai.textBig', { size: fmtBytes(TEXT_MAX_BYTES) })
    const text = (await file.text()).replace(/\u0000/g, '')
    if (!text.trim()) fail('editor.img.empty')
    const chunks = chunkText(text)
    if (chunks.length > room()) fail('ai.full', { n: maxPages })
    chunks.forEach((c, i) => addItem({ label: chunks.length > 1 ? `${name} (${i + 1}/${chunks.length})` : name, text: c, source: 'text-file' }))
  }

  function startJob(file: File | Blob, name: string) {
    const job: Job = { id: uid(), name, status: 'processing', cancelled: false, run: async () => {} }
    job.run = async () => {
      job.status = 'processing'; job.error = undefined; job.cancelled = false; draw()
      try { await ingest(file, name, job); job.status = job.cancelled ? 'cancelled' : 'done' }
      catch (e) { job.status = 'error'; job.error = (e as Error).message || t('common.error') }
      draw()
    }
    jobs.push(job); void job.run()
  }

  function step1() {
    const imgIn = h('input', { type: 'file', accept: 'image/*', multiple: true, class: 'sr-only', 'aria-label': t('ai.pickPhotos') })
    const camIn = h('input', { type: 'file', accept: 'image/*', capture: 'environment', class: 'sr-only', 'aria-label': t('ai.camera') })
    const fileIn = h('input', { type: 'file', accept: 'application/pdf,.pdf,text/plain,.txt,.md,text/markdown', multiple: true, class: 'sr-only', 'aria-label': t('ai.pickFiles') })
    const take = (inp: HTMLInputElement) => inp.addEventListener('change', () => { const fs = [...(inp.files || [])]; inp.value = ''; fs.forEach((f) => startJob(f, f.name)) })
    ;[imgIn, camIn, fileIn].forEach(take)
    const shoot = async () => {
      if (!cameraSupported()) return camIn.click()
      try { const b = await captureFromCamera(); if (b) startJob(b, `${t('ai.photo')} ${pages.length + 1}`) }
      catch { toast(t('ai.cameraFail'), 'bad'); camIn.click() } // 접근 불가 → 파일 선택으로 대체
    }
    body.append(
      h('div', { class: 'card stack' },
        h('div', { class: 'notice' }, t('ai.limitsInfo', { img: fmtBytes(IMAGE_MAX_BYTES), pdf: fmtBytes(PDF_MAX_BYTES), pdfPages: PDF_MAX_PAGES, txt: fmtBytes(TEXT_MAX_BYTES), max: maxPages })),
        h('div', { class: 'row' },
          h('button', { class: 'btn primary', type: 'button', onClick: () => void shoot() }, `📷 ${t('ai.camera')}`),
          h('button', { class: 'btn', type: 'button', onClick: () => imgIn.click() }, `🖼️ ${t('ai.pickPhotos')}`),
          h('button', { class: 'btn', type: 'button', onClick: () => fileIn.click() }, `📄 ${t('ai.pickFiles')}`), imgIn, camIn, fileIn),
        jobs.some((j) => j.status !== 'done') ? h('div', { class: 'stack' }, jobs.filter((j) => j.status !== 'done').map(jobRow)) : null,
        h('div', { class: 'row' }, h('strong', null, t('ai.pagesN', { n: pages.length, max: maxPages })), h('span', { class: 'muted small' }, t('ai.orderHint'))),
        pages.length ? h('div', { class: 'stack' }, pages.map(pageRow)) : h('p', { class: 'muted' }, t('ai.noPages')),
        h('div', { class: 'row' }, h('button', { class: 'btn primary', type: 'button', disabled: !pages.length || jobs.some((j) => j.status === 'processing'), onClick: () => { step = 2; draw() } }, t('ai.next')), h('a', { class: 'btn ghost', href: '#/create' }, t('common.cancel')))))
  }

  function jobRow(j: Job) {
    return h('div', { class: `page-item${j.status === 'error' ? ' err' : ''}`, style: 'grid-template-columns:1fr auto' },
      h('div', null, h('strong', { class: 'clip', style: 'display:block' }, j.name),
        j.status === 'processing' ? h('span', { class: 'small muted' }, h('span', { class: 'spin', 'aria-hidden': 'true' }), ' ', t('ai.processing')) : j.status === 'cancelled' ? h('span', { class: 'small muted' }, t('ai.cancelled')) : h('span', { class: 'small', role: 'alert' }, j.error)),
      h('div', { class: 'row' },
        j.status === 'processing' ? h('button', { class: 'btn sm', type: 'button', onClick: () => { j.cancelled = true } }, t('ai.cancelUpload')) : null,
        j.status === 'error' || j.status === 'cancelled' ? h('button', { class: 'btn sm', type: 'button', onClick: () => void j.run() }, t('ai.retry')) : null,
        j.status !== 'processing' ? h('button', { class: 'btn sm ghost', type: 'button', onClick: () => { jobs.splice(jobs.indexOf(j), 1); draw() } }, t('common.close')) : null))
  }

  function pageRow(p: PageItem, i: number) {
    const move = (d: number) => { const j = i + d; if (j < 0 || j >= pages.length) return; [pages[i], pages[j]] = [pages[j], pages[i]]; draw() }
    const img = p.thumb ? h('img', { class: 'thumb', src: p.thumb, alt: t('ai.thumbAlt', { n: i + 1 }) }) : h('div', { class: 'thumb', 'aria-hidden': 'true', style: 'display:grid;place-items:center;font-size:1.6rem' }, '📝')
    return h('div', { class: 'page-item' }, img,
      h('div', null, h('strong', null, `#${i + 1}`), ' ', h('span', { class: 'clip', style: 'display:inline-block;max-width:100%;vertical-align:bottom' }, p.label), h('div', { class: 'small muted' }, p.text ? t('ai.chars', { n: p.text.length }) : t('ai.noText'))),
      h('div', { class: 'row', style: 'justify-content:end' },
        h('button', { class: 'btn sm icon-btn', type: 'button', disabled: i === 0, 'aria-label': t('ai.up'), onClick: () => move(-1) }, '↑'),
        h('button', { class: 'btn sm icon-btn', type: 'button', disabled: i === pages.length - 1, 'aria-label': t('ai.down'), onClick: () => move(1) }, '↓'),
        p.blob ? h('button', { class: 'btn sm', type: 'button', onClick: () => void rotate(p) }, t('ai.rotate')) : null,
        p.blob ? h('button', { class: 'btn sm', type: 'button', onClick: () => cropDialog(p) }, t('ai.crop')) : null,
        h('button', { class: 'btn sm danger', type: 'button', onClick: () => { pages.splice(i, 1); draw() } }, t('common.delete'))))
  }

  async function rotate(p: PageItem) {
    if (!p.blob) return
    try { const nb = await transformImage(p.blob, { rotate: 90, quality: 0.9, maxEdge: 2000 }); p.blob = nb; p.thumb = mkThumb(nb); draw() } catch { toast(t('editor.img.decode'), 'bad') }
  }
  function cropDialog(p: PageItem) {
    if (!p.blob || !p.thumb) return
    const ed = new RectEditor({ url: p.thumb, rects: [], variant: 'crop', alt: t('ai.cropAlt') })
    const apply = h('button', { class: 'btn primary', type: 'button' }, t('ai.cropApply'))
    const cancel = h('button', { class: 'btn', type: 'button' }, t('common.cancel'))
    const d = openDialog(t('ai.crop'), h('div', null, h('p', { class: 'small muted' }, t('ai.cropHelp')), ed.el, h('div', { class: 'dlg-actions' }, cancel, apply)), { wide: true })
    cancel.addEventListener('click', () => d.close('cancel'))
    apply.addEventListener('click', async () => {
      const r = ed.getRects()[0]; if (!r || !p.blob) return d.close('cancel')
      try { const nb = await transformImage(p.blob, { crop: { x: r.x, y: r.y, w: r.w, h: r.h }, quality: 0.9, maxEdge: 2000 }); p.blob = nb; p.thumb = mkThumb(nb); d.close('ok'); draw() } catch { toast(t('editor.img.decode'), 'bad') }
    })
  }

  // ───────────── 2. 추출 확인 ─────────────
  const picked = new Set<string>()
  function step2() {
    const needOcr = pages.filter((p) => p.blob && !p.text.trim())
    if (!picked.size) needOcr.forEach((p) => picked.add(p.id))
    const flagged = pages.reduce((n, p) => n + (p.text.match(/\[확인 필요|\[needs check/gi)?.length || 0), 0)
    const ocrBtn = h('button', { class: 'btn', type: 'button', disabled: !aiOn || busy || !picked.size, onClick: () => void runExtract() }, busy ? t('ai.sending') : t('ai.extractAi', { n: picked.size }))
    body.append(h('div', { class: 'card stack' },
      h('p', null, t('ai.confirmText')),
      needOcr.length ? h('div', { class: 'notice warn' }, t('ai.ocrNeeded', { n: needOcr.length })) : null,
      flagged ? h('div', { class: 'notice warn' }, t('ai.flagged', { n: flagged })) : null,
      mockBanner(),
      h('div', { class: 'row' }, ocrBtn, aiOn ? h('span', { class: 'small muted' }, t('ai.extractNote')) : h('span', { class: 'small muted' }, t('ai.extractManual'))),
      sendError ? errBox() : null,
      ...pages.map((p, i) => {
        const ta = h('textarea', { rows: 6, 'aria-label': t('ai.textOf', { n: i + 1 }) }); ta.value = p.text
        ta.addEventListener('input', () => { p.text = ta.value; if (p.source === 'none' || p.source === 'ai') p.source = ta.value.trim() ? (p.source === 'ai' ? 'ai' : 'manual') : 'none' })
        return h('div', { class: 'page-item', style: 'grid-template-columns:1fr', id: `p-${i + 1}` },
          h('div', { class: 'row' }, h('strong', null, `#${i + 1}`), h('span', { class: 'clip' }, p.label), h('span', { class: 'badge accent' }, t(`ai.src.${p.source}`)), h('span', { class: 'spacer' }),
            p.blob ? h('label', { class: 'check', style: 'min-height:36px' }, h('input', { type: 'checkbox', checked: picked.has(p.id), onChange: (e: Event) => { (e.target as HTMLInputElement).checked ? picked.add(p.id) : picked.delete(p.id); draw() } }), t('ai.pickExtract')) : null),
          h('div', { class: 'split', style: 'grid-template-columns:140px 1fr' }, p.thumb ? h('button', { type: 'button', class: 'btn ghost', style: 'padding:0;height:auto;display:block', 'aria-label': t('ai.enlarge'), onClick: () => enlarge(p) }, h('img', { src: p.thumb, alt: '', style: 'width:100%;border-radius:8px' })) : h('div'), ta))
      }),
      h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', onClick: () => { step = 1; draw() } }, t('ai.back')), h('button', { class: 'btn primary', type: 'button', disabled: busy, onClick: () => { step = 3; sendError = null; draw() } }, t('ai.next')))))
  }
  function enlarge(p: PageItem) { if (!p.thumb) return; const d = openDialog(p.label, h('div', null, h('img', { src: p.thumb, alt: p.label, style: 'max-width:100%' }), h('div', { class: 'dlg-actions' }, h('button', { class: 'btn', type: 'button', onClick: () => d.close() }, t('common.close')))), { wide: true }) }

  function errBox() {
    const e = sendError!
    return h('div', { class: 'notice bad', role: 'alert' }, h('strong', null, errText(e.code, e.message)), h('div', { class: 'small' }, e.retryable ? t('ai.retryHint') : t('ai.noRetryHint')), e.detail ? h('div', { class: 'small', style: 'margin-top:6px;overflow-wrap:anywhere' }, `${t('ai.detail')}: ${e.detail}`) : null)
  }

  async function runExtract() {
    if (busy) return
    const sel = pages.filter((p) => picked.has(p.id) && p.blob)
    if (!sel.length) return
    const ok = await confirmDialog({ title: t('ai.consentTitle'), message: t('ai.consentExtract', { n: sel.length, provider: health?.provider || '' }), confirm: t('ai.send') })
    if (!ok) return
    busy = true; sendError = null; ctl = new AbortController(); draw()
    try {
      for (let i = 0; i < sel.length; i += maxImages) {
        const chunk = sel.slice(i, i + maxImages)
        const req: AnalyzeRequest = { task: 'extract', outputMode: 'both', language: 'original', cardCount: 1, difficulty: 'normal', focus: '',
          pages: await Promise.all(chunk.map(async (p): Promise<PageInput> => ({ index: pages.indexOf(p) + 1, image: await toAiImage(p.blob!) }))) }
        const res = await analyze(req, { signal: ctl.signal, accessCode: settings().aiAccessCode })
        if (!res.ok) { sendError = res.error; break }
        if (res.task === 'extract') {
          isMock = isMock || res.meta.mock
          for (const r of res.result.pages) { const p = pages[r.index - 1]; if (p && chunk.includes(p)) { p.text = r.text; p.source = 'ai'; picked.delete(p.id) } }
        }
      }
    } finally { busy = false; ctl = null; draw() }
  }

  // ───────────── 3. 옵션·전송 ─────────────
  function step3() {
    const imgPages = pages.filter((p) => p.blob)
    const emptyPages = pages.filter((p) => !p.text.trim())
    const included = (): PageItem[] => pages.filter((p) => p.text.trim() || (opts.includeImages && p.blob))
    const mode = h('div', { class: 'seg', role: 'group', 'aria-label': t('ai.outMode') }, (['summary', 'cards', 'both'] as OutputMode[]).map((m) =>
      h('button', { type: 'button', 'aria-pressed': String(opts.mode === m), onClick: () => { opts.mode = m; draw() } }, t(`ai.mode.${m}`))))
    const lang = h('select', { onChange: (e: Event) => { opts.language = (e.target as HTMLSelectElement).value as OutLang } }, (['original', 'ko', 'en'] as OutLang[]).map((l) => h('option', { value: l }, t(`ai.lang.${l}`))))
    lang.value = opts.language
    const count = h('input', { type: 'number', min: 1, max: health?.limits.maxCards ?? 30, value: opts.count, onChange: (e: Event) => { opts.count = Math.max(1, Math.min(health?.limits.maxCards ?? 30, Math.floor(Number((e.target as HTMLInputElement).value) || 10))); (e.target as HTMLInputElement).value = String(opts.count) } })
    const diff = h('select', { onChange: (e: Event) => { opts.difficulty = (e.target as HTMLSelectElement).value as Difficulty } }, (['easy', 'normal', 'hard'] as Difficulty[]).map((d) => h('option', { value: d }, t(`ai.diff.${d}`))))
    diff.value = opts.difficulty
    const focus = h('input', { type: 'text', maxLength: 300, value: opts.focus, placeholder: t('ai.focusPh'), onInput: (e: Event) => { opts.focus = (e.target as HTMLInputElement).value } })
    const inc = h('input', { type: 'checkbox', checked: opts.includeImages, disabled: !imgPages.length, onChange: (e: Event) => { opts.includeImages = (e.target as HTMLInputElement).checked; draw() } })
    const inPages = included()
    const chars = inPages.reduce((n, p) => n + p.text.length, 0)
    const imgs = opts.includeImages ? inPages.filter((p) => p.blob).length : 0
    const problems: string[] = []
    if (!inPages.length) problems.push(t('ai.p.none'))
    if (inPages.length > maxPages) problems.push(t('ai.p.pages', { n: maxPages }))
    if (imgs > maxImages) problems.push(t('ai.p.images', { n: maxImages }))
    if (chars > maxChars) problems.push(t('ai.p.chars', { n: maxChars }))
    const send = h('button', { class: 'btn primary', type: 'button', disabled: busy || !aiOn || problems.length > 0, onClick: () => void runOrganize(inPages) }, busy ? t('ai.sending') : t('ai.analyze'))
    body.append(h('div', { class: 'card stack' },
      field(t('ai.outMode'), mode), h('div', { class: 'grid cols-2' }, field(t('ai.outLang'), lang), field(t('ai.count'), count, opts.mode === 'summary' ? t('ai.countOff') : undefined), field(t('ai.difficulty'), diff)),
      field(t('ai.focus'), focus), h('label', { class: 'check' }, inc, t('ai.includeImages')), h('div', { class: 'field-hint', style: 'margin-top:-8px' }, t('ai.includeImagesHelp')),
      !opts.includeImages && emptyPages.length ? h('div', { class: 'notice warn' }, t('ai.emptySkipped', { n: emptyPages.length })) : null,
      h('div', { class: 'notice' }, h('strong', null, t('ai.privacyTitle')), h('ul', { style: 'margin:6px 0 0;padding-left:1.2em' },
        h('li', null, t('ai.privacy1', { provider: health?.provider || '—' })), h('li', null, t('ai.privacy2', { pages: inPages.length, chars, imgs })), h('li', null, t('ai.privacy3')), health?.provider === 'gemini' ? h('li', null, t('ai.privacyGemini')) : null,
        h('li', null, t('ai.privacy4', { n: health?.limits.rateLimitPerHour ?? 0 })))),
      problems.length ? h('div', { class: 'notice bad', role: 'alert' }, h('ul', { style: 'margin:0;padding-left:1.2em' }, problems.map((p) => h('li', null, p)))) : null,
      sendError ? errBox() : null,
      h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', disabled: busy, onClick: () => { step = 2; draw() } }, t('ai.back')), send,
        busy ? h('button', { class: 'btn danger', type: 'button', onClick: () => ctl?.abort() }, t('common.cancel')) : null,
        sendError?.retryable && !busy ? h('span', { class: 'small muted' }, t('ai.retryHint')) : null)))
  }

  async function runOrganize(inPages: PageItem[]) {
    if (busy) return // 중복 클릭 방지
    busy = true; sendError = null; ctl = new AbortController(); draw()
    try {
      const reqPages: PageInput[] = []
      for (const p of inPages) {
        const idx = pages.indexOf(p) + 1
        reqPages.push({ index: idx, text: p.text, ...(opts.includeImages && p.blob ? { image: await toAiImage(p.blob) } : {}) })
      }
      const req: AnalyzeRequest = { task: 'organize', outputMode: opts.mode, language: opts.language, cardCount: opts.count, difficulty: opts.difficulty, focus: opts.focus.trim(), pages: reqPages }
      const res = await analyze(req, { signal: ctl.signal, accessCode: settings().aiAccessCode })
      if (!res.ok) { sendError = res.error; return }
      if (res.task === 'organize') {
        result = res.result; isMock = isMock || res.meta.mock
        editCards = res.result.cards.map((c) => ({ c, on: !c.needsReview })) // 확인 필요 카드는 기본 선택 해제
        step = 4
      }
    } catch (e) { console.error(e); sendError = { code: 'network', message: '', retryable: true } }
    finally { busy = false; ctl = null; draw() }
  }

  // ───────────── 4. 결과 확인·저장 ─────────────
  function chips(src: number[]) {
    return src.length ? h('span', { class: 'row', style: 'gap:6px' }, src.map((n) => h('button', { type: 'button', class: 'src-chip', title: pages[n - 1]?.label || '', 'aria-label': t('ai.goSource', { n }), onClick: () => flash(n) }, `#${n}`))) : h('span', { class: 'small muted' }, t('ai.noSource'))
  }
  function flash(n: number) {
    const el = document.getElementById(`src-${n}`); if (!el) return
    el.scrollIntoView({ behavior: settings().motion === 'reduce' ? 'auto' : 'smooth', block: 'center' }); el.classList.add('flash'); el.focus({ preventScroll: true }); setTimeout(() => el.classList.remove('flash'), 1600)
  }
  const delBtn = (onClick: () => void) => h('button', { class: 'btn sm danger', type: 'button', onClick }, t('common.delete'))
  const inp = (v: string, on: (s: string) => void, label: string, long = false) => {
    const el = long ? h('textarea', { rows: 2, 'aria-label': label }) : h('input', { type: 'text', 'aria-label': label })
    el.value = v; el.addEventListener('input', () => on(el.value)); return el
  }
  function listSection<T>(title: string, arr: T[], render: (item: T, remove: () => void) => HTMLElement) {
    if (!arr.length) return null
    const box = h('div', { class: 'stack' })
    const sec = h('section', null, h('h3', null, title), box)
    for (const item of arr.slice()) {
      const row = h('div', { class: 'ai-card' })
      const remove = () => { arr.splice(arr.indexOf(item), 1); row.remove(); if (!arr.length) sec.remove() }
      row.append(render(item, remove)); box.append(row)
    }
    return sec
  }

  function step4() {
    const r = result!
    const saveDeck = h('select', null, decks.map((d) => h('option', { value: d.id }, d.name)), h('option', { value: '__new__' }, t('editor.newDeck')))
    saveDeck.value = query.get('deck') && decks.some((d) => d.id === query.get('deck')) ? query.get('deck')! : decks[0]?.id ?? '__new__'
    const newName = h('input', { type: 'text', maxLength: 80, value: r.title.slice(0, 80), placeholder: t('lib.deckName'), 'aria-label': t('lib.deckName') })
    const newBox = h('div', { style: saveDeck.value === '__new__' ? '' : 'display:none' }, newName)
    saveDeck.addEventListener('change', () => { newBox.style.display = saveDeck.value === '__new__' ? '' : 'none' })
    const summaryOnly = opts.mode === 'summary'
    const hasSummary = opts.mode !== 'cards'
    const keepMat = h('input', { type: 'checkbox', checked: summaryOnly, disabled: summaryOnly })
    const keepImgs = h('input', { type: 'checkbox' })
    const countEl = h('span', null)
    const updateCount = () => { const n = editCards.filter((e) => e.on).length; countEl.textContent = t('ai.saveN', { n }); saveBtn.disabled = saving || (!n && !(keepMat as HTMLInputElement).checked) }
    let saving = false
    const saveBtn = h('button', { class: 'btn primary', type: 'button' }, countEl)
    keepMat.addEventListener('change', updateCount)

    const left = h('div', { style: 'position:sticky;top:76px;align-self:start;max-height:calc(100vh - 96px);overflow:auto' }, h('h3', null, t('ai.sourceText')),
      ...pages.map((p, i) => h('div', { class: 'src-page', id: `src-${i + 1}`, tabindex: -1 }, h('div', { class: 'row' }, h('strong', null, `#${i + 1}`), h('span', { class: 'small muted clip' }, p.label)),
        p.thumb ? h('button', { type: 'button', class: 'btn ghost', style: 'padding:0;height:auto', 'aria-label': t('ai.enlarge'), onClick: () => enlarge(p) }, h('img', { src: p.thumb, alt: '', style: 'max-width:100%;max-height:140px;border-radius:8px' })) : null,
        h('pre', null, p.text || t('ai.noText')))))

    const right = h('div', { class: 'stack' },
      mockBanner(),
      r.warnings.length ? h('div', { class: 'notice warn' }, h('strong', null, t('ai.warnings')), h('ul', { style: 'margin:4px 0 0;padding-left:1.2em' }, r.warnings.map((w) => h('li', null, w)))) : null,
      h('div', { class: 'notice' }, t('ai.reviewNotice')),
      hasSummary ? h('section', { class: 'stack' }, h('h2', null, t('ai.summary')),
        field(t('ai.titleLabel'), inp(r.title, (s) => { r.title = s }, t('ai.titleLabel'))), field(t('ai.topic'), inp(r.topic, (s) => { r.topic = s }, t('ai.topic'))),
        listSection(t('ai.concepts'), r.concepts, (c, rm) => h('div', { class: 'stack' }, inp(c.name, (s) => { c.name = s }, t('ai.name')), inp(c.explanation, (s) => { c.explanation = s }, t('ai.explanation'), true), h('div', { class: 'row' }, chips(c.sources), h('span', { class: 'spacer' }), delBtn(rm)))),
        listSection(t('ai.terms'), r.terms, (c, rm) => h('div', { class: 'stack' }, inp(c.term, (s) => { c.term = s }, t('ai.term')), inp(c.definition, (s) => { c.definition = s }, t('ai.definition'), true), h('div', { class: 'row' }, chips(c.sources), h('span', { class: 'spacer' }), delBtn(rm)))),
        listSection(t('ai.processes'), r.processes, (c, rm) => h('div', { class: 'stack' }, h('div', { class: 'row' }, h('span', { class: 'badge accent' }, t(`ai.kind.${c.kind}`)), inp(c.name, (s) => { c.name = s }, t('ai.name'))),
          (() => { const ta = h('textarea', { rows: Math.min(8, c.items.length + 1), 'aria-label': t('ai.items') }); ta.value = c.items.join('\n'); ta.addEventListener('input', () => { c.items = ta.value.split('\n').map((x) => x.trim()).filter(Boolean) }); return ta })(),
          h('div', { class: 'row' }, chips(c.sources), h('span', { class: 'spacer' }), delBtn(rm)))),
        listSection(t('ai.keyPoints'), r.keyPoints, (c, rm) => h('div', { class: 'stack' }, inp(c.text, (s) => { c.text = s }, t('ai.keyPoints'), true), h('div', { class: 'row' }, chips(c.sources), h('span', { class: 'spacer' }), delBtn(rm))))) : null,
      opts.mode !== 'summary' ? h('section', { class: 'stack' }, h('h2', null, t('ai.cards', { n: editCards.length })),
        editCards.length ? h('div', { class: 'row' }, h('button', { class: 'btn sm', type: 'button', onClick: () => { editCards.forEach((e) => { e.on = true }); draw() } }, t('ai.selectAll')), h('button', { class: 'btn sm', type: 'button', onClick: () => { editCards.forEach((e) => { e.on = false }); draw() } }, t('ai.selectNone'))) : h('p', { class: 'muted' }, t('ai.noCards')),
        ...editCards.map((e) => cardEditor(e, updateCount, () => { editCards.splice(editCards.indexOf(e), 1); draw() }))) : null,
      h('section', { class: 'card stack' }, h('h2', null, t('ai.saveTitle')), field(t('editor.deck'), saveDeck), newBox,
        hasSummary ? h('label', { class: 'check' }, keepMat, t('ai.keepMaterial')) : null,
        hasSummary ? h('label', { class: 'check' }, keepImgs, t('ai.keepImages')) : null,
        h('div', { class: 'field-hint' }, t('ai.saveHint')),
        h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', onClick: () => { step = 3; draw() } }, t('ai.back')), saveBtn)))
    body.append(h('div', { class: 'split', style: 'grid-template-columns:minmax(0,.8fr) minmax(0,1.2fr)' }, left, right))
    updateCount()

    saveBtn.addEventListener('click', async () => {
      if (saving) return
      const chosen = editCards.filter((e) => e.on).map((e) => e.c)
      const bad = chosen.find((c) => (c.type === 'qa' && (!c.question.trim() || !c.answer.trim())) || (c.type === 'cloze' && !/\{\{c\d+::[^}]+\}\}/.test(c.text)) || (c.type === 'image-id' && !c.answer.trim()))
      if (bad) return toast(t('ai.badCard'), 'bad')
      saving = true; saveBtn.disabled = true
      try {
        let deckId = saveDeck.value
        if (deckId === '__new__') { if (!newName.value.trim()) { toast(t('editor.needDeckName'), 'bad'); newName.focus(); return } deckId = (await createDeck(newName.value)).id }
        const imgIds = new Map<number, string>()
        const imgFor = async (n: number) => { const p = pages[n - 1]; if (!p?.blob) return ''; if (!imgIds.has(n)) imgIds.set(n, (await saveImage(p.blob, `page-${n}.jpg`)).id); return imgIds.get(n)! }
        const now = Date.now()
        const notes: Note[] = []
        let i = 0
        for (const c of chosen) {
          const src = [r.title, ...c.sources.map((n) => pages[n - 1]?.label).filter(Boolean)].filter(Boolean).join(' · ')
          const base = { id: uid(), deckId, origin: 'ai' as const, createdAt: now + i, updatedAt: now + i++, hint: c.hint.trim(), explanation: c.explanation.trim(), source: src.slice(0, 300) }
          if (c.type === 'qa') notes.push(emptyNote({ ...base, type: 'qa', question: c.question.trim(), answer: c.answer.trim() }))
          else if (c.type === 'cloze') notes.push(emptyNote({ ...base, type: 'cloze', text: c.text.trim() }))
          else { const imageId = await imgFor(c.pageIndex); if (imageId) notes.push(emptyNote({ ...base, type: 'image-id', imageId, answer: c.answer.trim(), question: c.question.trim() })) }
        }
        if (notes.length) await addNotes(notes)
        if (hasSummary && (keepMat as HTMLInputElement).checked) {
          const m: Material = {
            id: uid(), deckId, title: r.title.trim(), topic: r.topic.trim(), createdAt: now, aiGenerated: true, mock: isMock,
            summary: { title: r.title, topic: r.topic, concepts: r.concepts, terms: r.terms, processes: r.processes, keyPoints: r.keyPoints },
            pages: await Promise.all(pages.map(async (p, k) => ({ index: k + 1, text: p.text, imageId: (keepImgs as HTMLInputElement).checked ? await imgFor(k + 1) : imgIds.get(k + 1) || '' }))),
          }
          await put('materials', m)
        }
        toast(t('ai.saved', { n: notes.length }), 'good')
        go(`/deck/${deckId}`)
      } catch (e) { console.error(e); toast(t('editor.saveFail'), 'bad'); saving = false; updateCount() }
    })
  }

  function cardEditor(e: EditCard, onToggle: () => void, remove: () => void): HTMLElement {
    const c = e.c
    const box = h('div', { class: `ai-card${e.on ? '' : ' off'}${c.needsReview ? ' review' : ''}` })
    const cb = h('input', { type: 'checkbox', checked: e.on, 'aria-label': t('ai.useCard') })
    cb.addEventListener('change', () => { e.on = cb.checked; box.classList.toggle('off', !e.on); onToggle() })
    const noImg = c.type === 'image-id' && !pages[c.pageIndex - 1]?.blob
    if (noImg) { cb.disabled = true; e.on = false }
    const f = (label: string, v: string, set: (s: string) => void, long = false) => field(label, inp(v, set, label, long))
    box.append(h('div', { class: 'row' }, h('label', { class: 'check' }, cb, h('span', { class: 'badge accent' }, t(`type.${c.type === 'image-id' ? 'image-id' : c.type}`))),
      c.needsReview ? h('span', { class: 'badge warn' }, t('ai.needsReview')) : null, noImg ? h('span', { class: 'badge bad' }, t('ai.noImage')) : null, h('span', { class: 'spacer' }), chips(c.sources), delBtn(remove)))
    if (c.type === 'qa') box.append(f(t('editor.question'), c.question, (s) => { c.question = s }, true), f(t('editor.answer'), c.answer, (s) => { c.answer = s }, true))
    if (c.type === 'cloze') box.append(f(t('editor.clozeText'), c.text, (s) => { c.text = s }, true), h('div', { class: 'field-hint' }, t('ai.clozeHelp')))
    if (c.type === 'image-id') {
      const p = pages[c.pageIndex - 1]
      if (p?.thumb) box.append(h('img', { src: p.thumb, alt: t('ai.thumbAlt', { n: c.pageIndex }), style: 'max-width:220px;border-radius:8px;margin-top:8px' }))
      box.append(f(t('editor.idAnswer'), c.answer, (s) => { c.answer = s }))
    }
    box.append(f(t('editor.hint'), c.hint, (s) => { c.hint = s }), f(t('editor.explanation'), c.explanation, (s) => { c.explanation = s }, true))
    return box
  }

  draw()
  void imageUrl; void (null as unknown as HealthInfo)
  return () => { ctl?.abort(); thumbUrls.forEach((u) => URL.revokeObjectURL(u)) }
}

function chunkText(text: string): string[] {
  const paras = text.split(/\n{2,}/)
  const out: string[] = []
  let cur = ''
  for (const p of paras) {
    if (cur && cur.length + p.length + 2 > CHUNK) { out.push(cur); cur = '' }
    if (p.length > CHUNK) { for (let i = 0; i < p.length; i += CHUNK) out.push(p.slice(i, i + CHUNK)); continue }
    cur = cur ? `${cur}\n\n${p}` : p
  }
  if (cur) out.push(cur)
  return out
}

function askRange(name: string, total: number): Promise<[number, number] | null> {
  return new Promise((resolve) => {
    let r: [number, number] | null = null
    const from = h('input', { type: 'number', min: 1, max: total, value: 1 })
    const to = h('input', { type: 'number', min: 1, max: total, value: Math.min(total, PDF_MAX_PAGES) })
    const ok = h('button', { class: 'btn primary', type: 'button' }, t('common.ok')); const cancel = h('button', { class: 'btn', type: 'button' }, t('common.cancel'))
    const d = openDialog(t('ai.pdfRange'), h('div', { class: 'stack' }, h('p', null, t('ai.pdfRangeMsg', { name, total, max: PDF_MAX_PAGES })), h('div', { class: 'grid cols-2' }, field(t('ai.from'), from), field(t('ai.to'), to)), h('div', { class: 'dlg-actions' }, cancel, ok)), { onClose: () => resolve(r) })
    cancel.addEventListener('click', () => d.close('cancel'))
    ok.addEventListener('click', () => {
      const a = Math.max(1, Math.min(total, Math.floor(Number(from.value) || 1))); let b = Math.max(a, Math.min(total, Math.floor(Number(to.value) || a)))
      b = Math.min(b, a + PDF_MAX_PAGES - 1); r = [a, b]; d.close('ok')
    })
  })
}
