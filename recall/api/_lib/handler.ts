import { loadConfig, type Config } from './config.js'
import { checkRate } from './limits.js'
import { extractSystem, organizeSystem } from './prompt.js'
import { anthropicProvider } from './providers/anthropic.js'
import { mockProvider } from './providers/mock.js'
import { openaiProvider } from './providers/openai.js'
import { ProviderError, type Provider } from './providers/types.js'
import {
  EXTRACT_SCHEMA, ORGANIZE_SCHEMA, sanitizeExtract, sanitizeOrganize,
  type AnalyzeRequest, type AnalyzeResponse, type HealthInfo, type PageInput,
} from './types.js'

const PROVIDERS: Record<string, Provider> = { anthropic: anthropicProvider, openai: openaiProvider, mock: mockProvider }

// ───── CORS / 출처 ─────
function corsHeaders(req: Request, cfg: Config): Record<string, string> {
  const origin = req.headers.get('origin')
  const h: Record<string, string> = { 'cache-control': 'no-store', vary: 'Origin' }
  if (origin && cfg.allowedOrigins.includes(origin)) {
    h['access-control-allow-origin'] = origin
    h['access-control-allow-headers'] = 'content-type, x-access-code'
    h['access-control-allow-methods'] = 'GET, POST, OPTIONS'
    h['access-control-max-age'] = '600'
  }
  return h
}
function originAllowed(req: Request, cfg: Config): boolean {
  const origin = req.headers.get('origin')
  if (!origin) return true // 브라우저 외 호출은 Origin 이 없다. 남용 방지는 접근 코드·요청 제한이 담당한다.
  if (cfg.allowedOrigins.includes(origin)) return true
  try { return new URL(origin).host === req.headers.get('host') } catch { return false }
}
const json = (body: unknown, status: number, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...extra } })
const fail = (status: number, code: string, message: string, retryable: boolean, extra: Record<string, string> = {}) =>
  json({ ok: false, error: { code, message, retryable } } satisfies AnalyzeResponse, status, extra)

function clientIp(req: Request): string {
  const xf = req.headers.get('x-forwarded-for')
  return (xf ? xf.split(',')[0] : req.headers.get('x-real-ip') || 'unknown').trim()
}
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let d = 0
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return d === 0
}

// ───── 입력 검증 ─────
export function validateRequest(body: unknown, cfg: Config): { ok: true; req: AnalyzeRequest } | { ok: false; message: string } {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  const task = b.task === 'extract' || b.task === 'organize' ? b.task : null
  if (!task) return { ok: false, message: 'task must be "extract" or "organize".' }
  if (!Array.isArray(b.pages) || b.pages.length === 0) return { ok: false, message: 'pages is required.' }
  if (b.pages.length > cfg.maxPages) return { ok: false, message: `At most ${cfg.maxPages} pages per request.` }
  let chars = 0, images = 0
  const pages: PageInput[] = []
  const seen = new Set<number>()
  for (const raw of b.pages) {
    const p = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
    const index = Number(p.index)
    if (!Number.isInteger(index) || index < 1 || index > 999 || seen.has(index)) return { ok: false, message: 'Invalid page index.' }
    seen.add(index)
    const text = typeof p.text === 'string' ? p.text : ''
    chars += text.length
    const page: PageInput = { index, text }
    if (p.image != null) {
      const im = p.image as Record<string, unknown>
      const mime = im?.mime
      const data = im?.data
      if ((mime !== 'image/jpeg' && mime !== 'image/png' && mime !== 'image/webp') || typeof data !== 'string' || !/^[A-Za-z0-9+/=]+$/.test(data)) {
        return { ok: false, message: 'Invalid image.' }
      }
      if (data.length > cfg.maxImageB64) return { ok: false, message: 'Image is too large.' }
      if (++images > cfg.maxImages) return { ok: false, message: `At most ${cfg.maxImages} images per request.` }
      page.image = { mime, data }
    }
    if (task === 'extract' && !page.image) return { ok: false, message: 'Extraction needs an image for every page.' }
    if (task === 'organize' && !text.trim() && !page.image) return { ok: false, message: 'Empty page.' }
    pages.push(page)
  }
  if (chars > cfg.maxTextChars) return { ok: false, message: `Text is too long (max ${cfg.maxTextChars} characters).` }
  const outputMode = b.outputMode === 'summary' || b.outputMode === 'cards' ? b.outputMode : 'both'
  const language = b.language === 'ko' || b.language === 'en' ? b.language : 'original'
  const difficulty = b.difficulty === 'easy' || b.difficulty === 'hard' ? b.difficulty : 'normal'
  const cardCount = Math.max(1, Math.min(cfg.maxCards, Math.floor(Number(b.cardCount)) || 10))
  const focus = typeof b.focus === 'string' ? b.focus.slice(0, 300) : ''
  return { ok: true, req: { task, outputMode, language, difficulty, cardCount, focus, pages } }
}

// ───── 핸들러 ─────
export function handleHealth(req: Request, env?: Record<string, string | undefined>): Response {
  const cfg = loadConfig(env)
  if (!originAllowed(req, cfg)) return json({ error: 'forbidden' }, 403)
  const info: HealthInfo = {
    aiEnabled: cfg.enabled,
    provider: cfg.enabled ? cfg.provider : '',
    mock: cfg.enabled && cfg.provider === 'mock',
    requiresAccessCode: cfg.accessCode !== '',
    limits: { maxPages: cfg.maxPages, maxImages: cfg.maxImages, maxTextChars: cfg.maxTextChars, maxCards: cfg.maxCards, rateLimitPerHour: cfg.rateLimitPerHour },
  }
  return json(info, 200, corsHeaders(req, cfg))
}

export function handleOptions(req: Request, env?: Record<string, string | undefined>): Response {
  const cfg = loadConfig(env)
  return new Response(null, { status: originAllowed(req, cfg) ? 204 : 403, headers: corsHeaders(req, cfg) })
}

export async function handleAnalyze(req: Request, env?: Record<string, string | undefined>): Promise<Response> {
  const cfg = loadConfig(env)
  const cors = corsHeaders(req, cfg)
  if (!originAllowed(req, cfg)) return fail(403, 'forbidden_origin', 'This origin is not allowed.', false)
  if (!cfg.enabled) return fail(503, 'ai_disabled', 'AI analysis is not configured on this server.', false, cors)
  if (cfg.accessCode && !safeEqual(req.headers.get('x-access-code') || '', cfg.accessCode)) {
    return fail(401, 'access_code', 'A valid access code is required.', false, cors)
  }
  if (!(req.headers.get('content-type') || '').includes('application/json')) return fail(415, 'bad_request', 'JSON required.', false, cors)
  const declared = Number(req.headers.get('content-length') || 0)
  if (declared > cfg.maxBodyBytes) return fail(413, 'too_large', 'The request is too large.', false, cors)

  const raw = await req.text().catch(() => '')
  if (raw.length > cfg.maxBodyBytes) return fail(413, 'too_large', 'The request is too large.', false, cors)
  let body: unknown
  try { body = JSON.parse(raw) } catch { return fail(400, 'bad_request', 'Invalid JSON.', false, cors) }
  const v = validateRequest(body, cfg)
  if (!v.ok) return fail(400, 'bad_request', v.message, false, cors)

  const rate = checkRate(clientIp(req), cfg.rateLimitPerHour, cfg.dailyCap)
  if (!rate.ok) {
    return fail(429, rate.code, rate.code === 'daily_cap' ? 'The daily AI usage limit was reached. Try again tomorrow.' : 'Too many requests. Try again later.', true,
      { ...cors, 'retry-after': String(rate.retryAfterSec) })
  }

  const r = v.req
  const provider = PROVIDERS[cfg.provider]
  try {
    // 개인정보: 본문·추출 텍스트·이미지는 로그에 남기지 않는다.
    const out = await provider(cfg, {
      system: r.task === 'extract' ? extractSystem() : organizeSystem(r),
      pages: r.pages,
      schema: r.task === 'extract' ? EXTRACT_SCHEMA : ORGANIZE_SCHEMA,
      schemaName: r.task,
      signal: req.signal,
    })
    const meta = { provider: cfg.provider, mock: cfg.provider === 'mock' }
    const res: AnalyzeResponse = r.task === 'extract'
      ? { ok: true, task: 'extract', result: sanitizeExtract(out), meta }
      : { ok: true, task: 'organize', result: limitCards(sanitizeOrganize(out, cfg.maxCards), r.cardCount), meta }
    return json(res, 200, cors)
  } catch (e) {
    const pe = e instanceof ProviderError ? e : new ProviderError('internal', 'Unexpected server error.', 500)
    console.error('analyze failed:', pe.code) // 코드만 기록
    return fail(pe.status === 499 ? 499 : pe.status, pe.code, pe.message, pe.retryable, cors)
  }
}

function limitCards<T extends { cards: unknown[] }>(r: T, n: number): T {
  return { ...r, cards: r.cards.slice(0, n) }
}
