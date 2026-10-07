// RFC 4180 방식 CSV 파서: 쉼표(또는 탭/세미콜론), 큰따옴표, 따옴표 안 쉼표·줄바꿈, "" 이스케이프, BOM, CRLF 처리.
export const CSV_MAX_BYTES = 2 * 1024 * 1024
export const CSV_MAX_ROWS = 5000

export function detectDelimiter(text: string): string {
  const first = text.split(/\r?\n/, 1)[0] || ''
  let best = ',', bestN = -1
  for (const d of [',', '\t', ';']) {
    // 따옴표 밖 구분자만 센다
    let n = 0, q = false
    for (const ch of first) { if (ch === '"') q = !q; else if (ch === d && !q) n++ }
    if (n > bestN) { best = d; bestN = n }
  }
  return best
}

export function parseCsv(input: string, delimiter?: string): string[][] {
  const text = input.replace(/^﻿/, '')
  const d = delimiter || detectDelimiter(text)
  const rows: string[][] = []
  let row: string[] = [], field = '', inQ = false, i = 0
  const endRow = () => { row.push(field); field = ''; if (row.length > 1 || row[0] !== '') rows.push(row); row = [] }
  while (i < text.length) {
    const ch = text[i]
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue }
        inQ = false; i++; continue
      }
      field += ch; i++; continue
    }
    if (ch === '"' && field === '') { inQ = true; i++; continue }
    if (ch === d) { row.push(field); field = ''; i++; continue }
    if (ch === '\r') { if (text[i + 1] === '\n') i++; endRow(); i++; continue }
    if (ch === '\n') { endRow(); i++; continue }
    field += ch; i++
  }
  if (field !== '' || row.length) endRow()
  return rows
}

export interface CsvCard { question: string; answer: string; hint: string; explanation: string; source: string }

const ALIASES: Record<keyof CsvCard, string[]> = {
  question: ['question', 'q', 'front', '질문', '문제', '앞면', '단어'],
  answer: ['answer', 'a', 'back', '답', '정답', '답변', '뒷면', '뜻'],
  hint: ['hint', '힌트'],
  explanation: ['explanation', 'note', 'notes', '설명', '추가 설명', '메모'],
  source: ['source', '출처'],
}

export function mapCsv(rows: string[][]): { cards: CsvCard[]; hasHeader: boolean; skipped: number } {
  if (!rows.length) return { cards: [], hasHeader: false, skipped: 0 }
  const norm = (s: string) => s.trim().toLowerCase()
  const first = rows[0].map(norm)
  const colOf = (k: keyof CsvCard) => first.findIndex((c) => ALIASES[k].includes(c))
  const qi = colOf('question'), ai = colOf('answer')
  const hasHeader = qi >= 0 && ai >= 0
  const idx = hasHeader
    ? { question: qi, answer: ai, hint: colOf('hint'), explanation: colOf('explanation'), source: colOf('source') }
    : { question: 0, answer: 1, hint: 2, explanation: 3, source: 4 }
  const cards: CsvCard[] = []
  let skipped = 0
  for (const r of hasHeader ? rows.slice(1) : rows) {
    const g = (i: number) => (i >= 0 && i < r.length ? r[i].trim() : '')
    const c = { question: g(idx.question), answer: g(idx.answer), hint: g(idx.hint), explanation: g(idx.explanation), source: g(idx.source) }
    if (!c.question || !c.answer) { skipped++; continue }
    cards.push(c)
  }
  return { cards, hasHeader, skipped }
}
