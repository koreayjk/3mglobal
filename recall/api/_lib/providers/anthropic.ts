import Anthropic from '@anthropic-ai/sdk'
import { pageText } from '../prompt.js'
import { ProviderError, type Provider } from './types.js'

// 구조화 출력(output_config.format)을 사용한다. 최신 모델은 forced tool_choice 를 지원하지 않는다.
export const anthropicProvider: Provider = async (cfg, call) => {
  const client = new Anthropic({ apiKey: cfg.apiKey, baseURL: cfg.baseUrl || undefined, maxRetries: 1, timeout: 55_000 })
  const content: Anthropic.ContentBlockParam[] = []
  for (const p of call.pages) {
    content.push({ type: 'text', text: pageText(p) })
    if (p.image) content.push({ type: 'image', source: { type: 'base64', media_type: p.image.mime, data: p.image.data } })
  }
  content.push({ type: 'text', text: 'Return the result now in the required JSON format.' })
  try {
    const res = await client.messages.create(
      {
        model: cfg.model,
        max_tokens: cfg.maxOutputTokens,
        system: call.system,
        messages: [{ role: 'user', content }],
        output_config: { ...(cfg.effort ? { effort: cfg.effort } : {}), format: { type: 'json_schema', schema: call.schema } },
      },
      { signal: call.signal },
    )
    if (res.stop_reason === 'refusal') throw new ProviderError('refused', 'The AI provider declined to process this material.', 422, false)
    if (res.stop_reason === 'max_tokens') throw new ProviderError('output_too_long', 'The result was too long. Try fewer pages or fewer cards.', 422, false)
    const text = res.content.map((b) => (b.type === 'text' ? b.text : '')).join('')
    try { return JSON.parse(text) } catch { throw new ProviderError('bad_output', 'The AI returned an unreadable result.') }
  } catch (e) {
    if (e instanceof ProviderError) throw e
    if (e instanceof Anthropic.RateLimitError) throw new ProviderError('provider_busy', 'The AI provider is busy. Try again shortly.', 503)
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) throw new ProviderError('provider_auth', 'AI provider credentials are not valid.', 502, false)
    if (e instanceof Anthropic.BadRequestError) throw new ProviderError('provider_rejected', 'The AI provider rejected the request.', 502, false)
    if (e instanceof Anthropic.APIError) throw new ProviderError('provider_error', 'The AI provider returned an error.', 502)
    if (call.signal?.aborted) throw new ProviderError('aborted', 'Request cancelled.', 499, false)
    throw new ProviderError('provider_unreachable', 'Could not reach the AI provider.', 504)
  }
}
