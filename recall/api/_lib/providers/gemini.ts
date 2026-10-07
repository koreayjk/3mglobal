import { pageText } from '../prompt.js'
import { ProviderError, type Provider } from './types.js'

// Google Gemini API (generateContent). 문서상 "legacy 이지만 계속 완전히 지원"되는 방식이다.
// 인증은 x-goog-api-key 헤더. 키는 URL 이 아니라 헤더로 보낸다.
const DEFAULT_BASE = 'https://generativelanguage.googleapis.com/v1beta'
const BLOCKED = new Set(['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'IMAGE_SAFETY', 'SPII', 'RECITATION', 'OTHER'])

export const geminiProvider: Provider = async (cfg, call) => {
  const base = (cfg.baseUrl || DEFAULT_BASE).replace(/\/+$/, '')
  const model = cfg.model.replace(/^models\//, '')
  const parts: unknown[] = []
  for (const p of call.pages) {
    parts.push({ text: pageText(p) })
    if (p.image) parts.push({ inlineData: { mimeType: p.image.mime, data: p.image.data } })
  }
  const send = async (withSchema: boolean) => {
    const tail = withSchema ? 'Return the result now in the required JSON format.'
      : `Return ONLY a JSON object matching this JSON Schema (no prose):\n${JSON.stringify(call.schema)}`
    try {
      return await fetch(`${base}/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': cfg.apiKey },
        signal: call.signal ? AbortSignal.any([call.signal, AbortSignal.timeout(55_000)]) : AbortSignal.timeout(55_000),
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: call.system }] },
          contents: [{ role: 'user', parts: [...parts, { text: tail }] }],
          generationConfig: {
            maxOutputTokens: cfg.maxOutputTokens,
            responseMimeType: 'application/json',
            ...(withSchema ? { responseJsonSchema: call.schema } : {}),
          },
        }),
      })
    } catch {
      if (call.signal?.aborted) throw new ProviderError('aborted', 'Request cancelled.', 499, false)
      throw new ProviderError('provider_unreachable', 'Could not reach the AI provider.', 504)
    }
  }

  let res = await send(true)
  // 스키마 형식을 받아들이지 않는 모델/버전이면 스키마를 프롬프트로 옮겨 한 번만 다시 시도한다.
  if (res.status === 400) {
    const msg = JSON.stringify(await res.clone().json().catch(() => ({}))).toLowerCase()
    if (!msg.includes('api key') && !msg.includes('api_key')) res = await send(false)
  }
  if (res.status === 429) throw new ProviderError('provider_busy', 'The AI provider is busy or the free-tier quota is used up. Try again later.', 503)
  if (res.status === 401 || res.status === 403) throw new ProviderError('provider_auth', 'AI provider credentials are not valid.', 502, false)
  if (res.status === 400) {
    const msg = JSON.stringify(await res.json().catch(() => ({}))).toLowerCase()
    if (msg.includes('api key') || msg.includes('api_key')) throw new ProviderError('provider_auth', 'AI provider credentials are not valid.', 502, false)
    throw new ProviderError('provider_rejected', 'The AI provider rejected the request.', 502, false)
  }
  if (res.status === 404) throw new ProviderError('provider_rejected', 'The AI model was not found. Check AI_MODEL.', 502, false)
  if (!res.ok) throw new ProviderError('provider_error', 'The AI provider returned an error.', 502)

  const data = (await res.json().catch(() => null)) as {
    candidates?: { finishReason?: string; content?: { parts?: { text?: string; thought?: boolean }[] } }[]
    promptFeedback?: { blockReason?: string }
  } | null
  const cand = data?.candidates?.[0]
  if (!cand || data?.promptFeedback?.blockReason) throw new ProviderError('refused', 'The AI provider declined to process this material.', 422, false)
  if (cand.finishReason === 'MAX_TOKENS') throw new ProviderError('output_too_long', 'The result was too long. Try fewer pages or fewer cards.', 422, false)
  if (cand.finishReason && BLOCKED.has(cand.finishReason)) throw new ProviderError('refused', 'The AI provider declined to process this material.', 422, false)
  const text = (cand.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? '').join('')
  try { return JSON.parse(text) } catch { throw new ProviderError('bad_output', 'The AI returned an unreadable result.') }
}
