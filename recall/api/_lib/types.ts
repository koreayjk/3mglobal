// 프론트엔드와 서버가 공유하는 AI 요청/응답 타입과 검증·정제 함수.
// 서버 응답도 "신뢰할 수 없는 입력"으로 취급해 클라이언트에서 한 번 더 정제한다.

export type AiTask = 'extract' | 'organize'
export type OutputMode = 'summary' | 'cards' | 'both'
export type OutLang = 'original' | 'ko' | 'en'
export type Difficulty = 'easy' | 'normal' | 'hard'

export interface PageInput {
  /** 1부터 시작하는 사진/PDF 페이지 번호 (출처 연결에 사용) */
  index: number
  label?: string
  text?: string
  image?: { mime: 'image/jpeg' | 'image/png' | 'image/webp'; data: string }
}

export interface AnalyzeRequest {
  task: AiTask
  outputMode: OutputMode
  language: OutLang
  cardCount: number
  difficulty: Difficulty
  focus: string
  pages: PageInput[]
}

export interface ExtractResult {
  pages: { index: number; text: string; unreadable: boolean }[]
}

export type AiCardType = 'qa' | 'cloze' | 'image-id'
export interface AiCard {
  type: AiCardType
  question: string
  answer: string
  hint: string
  explanation: string
  /** cloze: {{c1::정답}} 표기 텍스트 */
  text: string
  /** image-id: 이미지가 있는 페이지 번호 */
  pageIndex: number
  sources: number[]
  needsReview: boolean
}
export interface OrganizeResult {
  title: string
  topic: string
  concepts: { name: string; explanation: string; sources: number[] }[]
  terms: { term: string; definition: string; sources: number[] }[]
  processes: { name: string; kind: 'process' | 'comparison' | 'sequence'; items: string[]; sources: number[] }[]
  keyPoints: { text: string; sources: number[] }[]
  cards: AiCard[]
  warnings: string[]
}

export interface AnalyzeMeta { provider: string; mock: boolean }
export type AnalyzeResponse =
  | { ok: true; task: 'extract'; result: ExtractResult; meta: AnalyzeMeta }
  | { ok: true; task: 'organize'; result: OrganizeResult; meta: AnalyzeMeta }
  | { ok: false; error: { code: string; message: string; retryable: boolean } }

export interface HealthInfo {
  aiEnabled: boolean
  provider: string
  mock: boolean
  requiresAccessCode: boolean
  limits: { maxPages: number; maxImages: number; maxTextChars: number; maxCards: number; rateLimitPerHour: number }
}

// ───────────── 정제 유틸 ─────────────
const str = (v: unknown, max: number): string =>
  typeof v === 'string' ? v.replace(/\u0000/g, '').slice(0, max) : ''
const arr = (v: unknown, max: number): unknown[] => (Array.isArray(v) ? v.slice(0, max) : [])
const rec = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
const srcs = (v: unknown): number[] =>
  arr(v, 12).map(Number).filter((n) => Number.isInteger(n) && n > 0 && n < 1000)

export function sanitizeExtract(raw: unknown): ExtractResult {
  const o = rec(raw)
  return {
    pages: arr(o.pages, 30).map((p) => {
      const r = rec(p)
      return { index: Number(r.index) || 0, text: str(r.text, 20000), unreadable: r.unreadable === true }
    }).filter((p) => p.index > 0),
  }
}

export function sanitizeOrganize(raw: unknown, maxCards = 40): OrganizeResult {
  const o = rec(raw)
  const cards: AiCard[] = []
  for (const c of arr(o.cards, maxCards)) {
    const r = rec(c)
    const type = r.type === 'cloze' || r.type === 'image-id' ? r.type : 'qa'
    const card: AiCard = {
      type,
      question: str(r.question, 600),
      answer: str(r.answer, 800),
      hint: str(r.hint, 300),
      explanation: str(r.explanation, 800),
      text: str(r.text, 1200),
      pageIndex: Number(r.pageIndex) > 0 ? Math.floor(Number(r.pageIndex)) : 0,
      sources: srcs(r.sources),
      needsReview: r.needsReview === true,
    }
    // 카드로 쓸 수 없는 항목은 버린다 (한 카드에 하나의 질문)
    if (type === 'qa' && (!card.question.trim() || !card.answer.trim())) continue
    if (type === 'cloze' && !/\{\{c\d+::[^}]+\}\}/.test(card.text)) continue
    if (type === 'image-id' && (!card.answer.trim() || !card.pageIndex)) continue
    cards.push(card)
  }
  return {
    title: str(o.title, 200),
    topic: str(o.topic, 200),
    concepts: arr(o.concepts, 40).map((x) => {
      const r = rec(x)
      return { name: str(r.name, 200), explanation: str(r.explanation, 1000), sources: srcs(r.sources) }
    }).filter((x) => x.name),
    terms: arr(o.terms, 60).map((x) => {
      const r = rec(x)
      return { term: str(r.term, 200), definition: str(r.definition, 800), sources: srcs(r.sources) }
    }).filter((x) => x.term),
    processes: arr(o.processes, 20).map((x) => {
      const r = rec(x)
      const kind = r.kind === 'comparison' || r.kind === 'sequence' ? r.kind : 'process'
      return {
        name: str(r.name, 200), kind: kind as 'process' | 'comparison' | 'sequence',
        items: arr(r.items, 30).map((i) => str(i, 400)).filter(Boolean), sources: srcs(r.sources),
      }
    }).filter((x) => x.name),
    keyPoints: arr(o.keyPoints, 40).map((x) => {
      const r = rec(x)
      return { text: str(r.text, 500), sources: srcs(r.sources) }
    }).filter((x) => x.text),
    cards,
    warnings: arr(o.warnings, 20).map((w) => str(w, 300)).filter(Boolean),
  }
}

// ───────────── JSON 스키마 (구조화 출력용) ─────────────
const S = { type: 'string' }
const SRC = { type: 'array', items: { type: 'integer' } }
const obj = (props: Record<string, unknown>) => ({
  type: 'object', properties: props, required: Object.keys(props), additionalProperties: false,
})

export const EXTRACT_SCHEMA = obj({
  pages: { type: 'array', items: obj({ index: { type: 'integer' }, text: S, unreadable: { type: 'boolean' } }) },
})

export const ORGANIZE_SCHEMA = obj({
  title: S,
  topic: S,
  concepts: { type: 'array', items: obj({ name: S, explanation: S, sources: SRC }) },
  terms: { type: 'array', items: obj({ term: S, definition: S, sources: SRC }) },
  processes: {
    type: 'array',
    items: obj({ name: S, kind: { type: 'string', enum: ['process', 'comparison', 'sequence'] }, items: { type: 'array', items: S }, sources: SRC }),
  },
  keyPoints: { type: 'array', items: obj({ text: S, sources: SRC }) },
  cards: {
    type: 'array',
    items: obj({
      type: { type: 'string', enum: ['qa', 'cloze', 'image-id'] },
      question: S, answer: S, hint: S, explanation: S, text: S,
      pageIndex: { type: 'integer' }, sources: SRC, needsReview: { type: 'boolean' },
    }),
  },
  warnings: { type: 'array', items: S },
})
