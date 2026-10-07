import { pageText } from '../prompt.js'
import { ProviderError, type Provider } from './types.js'

// OpenAI Chat Completions + JSON 스키마 응답 형식. AI_BASE_URL 로 호환 서버도 지정 가능.
export const openaiProvider: Provider = async (cfg, call) => {
  const base = (cfg.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '')
  const parts: unknown[] = []
  for (const p of call.pages) {
    parts.push({ type: 'text', text: pageText(p) })
    if (p.image) parts.push({ type: 'image_url', image_url: { url: `data:${p.image.mime};base64,${p.image.data}` } })
  }
  parts.push({ type: 'text', text: 'Return the result now in the required JSON format.' })
  let res: Response
  try {
    res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
      signal: call.signal ? AbortSignal.any([call.signal, AbortSignal.timeout(55_000)]) : AbortSignal.timeout(55_000),
      body: JSON.stringify({
        model: cfg.model,
        max_completion_tokens: cfg.maxOutputTokens,
        messages: [{ role: 'system', content: call.system }, { role: 'user', content: parts }],
        response_format: { type: 'json_schema', json_schema: { name: call.schemaName, schema: call.schema, strict: false } },
      }),
    })
  } catch {
    if (call.signal?.aborted) throw new ProviderError('aborted', 'Request cancelled.', 499, false)
    throw new ProviderError('provider_unreachable', 'Could not reach the AI provider.', 504)
  }
  if (res.status === 429) throw new ProviderError('provider_busy', 'The AI provider is busy. Try again shortly.', 503)
  if (res.status === 401 || res.status === 403) throw new ProviderError('provider_auth', 'AI provider credentials are not valid.', 502, false)
  if (res.status >= 400 && res.status < 500) throw new ProviderError('provider_rejected', 'The AI provider rejected the request.', 502, false)
  if (!res.ok) throw new ProviderError('provider_error', 'The AI provider returned an error.', 502)
  const data = (await res.json().catch(() => null)) as { choices?: { finish_reason?: string; message?: { content?: string; refusal?: string } }[] } | null
  const choice = data?.choices?.[0]
  if (choice?.message?.refusal) throw new ProviderError('refused', 'The AI provider declined to process this material.', 422, false)
  if (choice?.finish_reason === 'length') throw new ProviderError('output_too_long', 'The result was too long. Try fewer pages or fewer cards.', 422, false)
  try { return JSON.parse(choice?.message?.content || '') } catch { throw new ProviderError('bad_output', 'The AI returned an unreadable result.') }
}
