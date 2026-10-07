import { sanitizeExtract, sanitizeOrganize, type AnalyzeRequest, type AnalyzeResponse, type HealthInfo } from '../../api/_lib/types'

// 비밀 값이 아닌 서버 "주소"만 환경변수로 받는다. API 키는 프론트엔드에 존재하지 않는다.
const BASE = ((import.meta.env.VITE_AI_API_BASE as string | undefined) || '').replace(/\/+$/, '')

export async function fetchHealth(): Promise<HealthInfo | null> {
  try {
    const r = await fetch(`${BASE}/api/health`, { cache: 'no-store' })
    if (!r.ok) return null
    const j = (await r.json()) as HealthInfo
    if (typeof j?.aiEnabled !== 'boolean') return null
    return j
  } catch { return null }
}

export async function analyze(req: AnalyzeRequest, o: { signal?: AbortSignal; accessCode?: string } = {}): Promise<AnalyzeResponse> {
  let res: Response
  try {
    res = await fetch(`${BASE}/api/analyze`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(o.accessCode ? { 'x-access-code': o.accessCode } : {}) },
      body: JSON.stringify(req),
      signal: o.signal,
    })
  } catch (e) {
    if ((e as Error).name === 'AbortError') return { ok: false, error: { code: 'aborted', message: 'cancelled', retryable: true } }
    return { ok: false, error: { code: 'network', message: 'network error', retryable: true } }
  }
  let body: unknown
  try { body = await res.json() } catch { return { ok: false, error: { code: 'bad_response', message: 'Unreadable response', retryable: true } } }
  const b = body as AnalyzeResponse
  if (!res.ok || !b || (b as { ok?: boolean }).ok !== true) {
    const e = (b as { error?: { code?: string; message?: string; retryable?: boolean } })?.error
    return { ok: false, error: { code: e?.code || `http_${res.status}`, message: e?.message || 'Request failed', retryable: e?.retryable ?? res.status >= 500 } }
  }
  // 서버 응답도 신뢰하지 않고 다시 정제한다
  if (b.ok && b.task === 'extract') return { ...b, result: sanitizeExtract(b.result) }
  if (b.ok && b.task === 'organize') return { ...b, result: sanitizeOrganize(b.result) }
  return { ok: false, error: { code: 'bad_response', message: 'Unexpected response', retryable: true } }
}
