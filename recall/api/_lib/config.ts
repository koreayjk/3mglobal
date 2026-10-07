// 서버 환경변수 읽기. 비밀 값은 여기서만 읽고 응답/로그에 절대 내보내지 않는다.
const num = (v: string | undefined, d: number, min = 1, max = 1_000_000) => {
  const n = Number(v)
  return Number.isFinite(n) && n >= min ? Math.min(n, max) : d
}

export interface Config {
  enabled: boolean
  provider: 'anthropic' | 'openai' | 'gemini' | 'mock' | ''
  model: string
  apiKey: string
  baseUrl: string
  effort: '' | 'low' | 'medium' | 'high'
  accessCode: string
  allowedOrigins: string[]
  maxOutputTokens: number
  maxPages: number
  maxImages: number
  maxImageB64: number
  maxTextChars: number
  maxCards: number
  maxBodyBytes: number
  rateLimitPerHour: number
  dailyCap: number
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const p = (env.AI_PROVIDER || '').trim().toLowerCase()
  const provider = p === 'anthropic' || p === 'openai' || p === 'gemini' || p === 'mock' ? p : ''
  const apiKey = provider === 'anthropic' ? env.ANTHROPIC_API_KEY || '' : provider === 'openai' ? env.OPENAI_API_KEY || '' : provider === 'gemini' ? env.GEMINI_API_KEY || env.GOOGLE_API_KEY || '' : ''
  const model = (env.AI_MODEL || '').trim() || (provider === 'anthropic' ? 'claude-haiku-5-5' : provider === 'gemini' ? 'gemini-3.8-flash' : '')
  const ready = provider === 'mock' || (provider !== '' && apiKey !== '' && model !== '')
  const effort = ['low', 'medium', 'high'].includes(env.AI_EFFORT || '') ? (env.AI_EFFORT as 'low') : ''
  return {
    enabled: ready && (env.AI_ENABLED || '').toLowerCase() !== 'false',
    provider, model, apiKey,
    baseUrl: (env.AI_BASE_URL || '').trim(),
    effort,
    accessCode: env.AI_ACCESS_CODE || '',
    allowedOrigins: (env.AI_ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
    maxOutputTokens: num(env.AI_MAX_OUTPUT_TOKENS, 6000, 500, 32000),
    maxPages: num(env.AI_MAX_PAGES, 12, 1, 40),
    maxImages: num(env.AI_MAX_IMAGES, 6, 0, 20),
    maxImageB64: 900_000, // base64 문자 수 (≈ 670KB)
    maxTextChars: num(env.AI_MAX_TEXT_CHARS, 60000, 1000, 400000),
    maxCards: 30,
    maxBodyBytes: 4_000_000,
    rateLimitPerHour: num(env.AI_RATE_LIMIT_PER_HOUR, 20, 1, 10000),
    dailyCap: num(env.AI_DAILY_REQUEST_CAP, 300, 1, 1_000_000),
  }
}
