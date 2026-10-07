// 학습 큐/통계 계산 (순수 함수). 저장소·화면과 분리.
import { DAY, endOfDay, shuffle, startOfDay } from './util'
import type { Card, ReviewLog } from './types'

export interface QueueOpts { now: number; newPerDay: number; deckId?: string }

/** 오늘 이미 처음 학습한(새 카드였던) 카드 수 */
export function newIntroducedToday(logs: ReviewLog[], now: number): number {
  const s = startOfDay(now)
  const ids = new Set<string>()
  for (const l of logs) if (l.reviewedAt >= s && l.scheduled && l.stateBefore === 0) ids.add(l.cardId)
  return ids.size
}

/** 같은 노트의 카드가 연달아 나오지 않도록 가볍게 흩뜨린다 (순서 안정성 유지) */
export function spreadSiblings(cards: Card[]): Card[] {
  const rest = cards.slice()
  const out: Card[] = []
  while (rest.length) {
    const last = out[out.length - 1]
    let i = last ? rest.findIndex((c) => c.noteId !== last.noteId) : 0
    if (i < 0) i = 0
    out.push(rest.splice(i, 1)[0])
  }
  return out
}

export interface TodayPlan { queue: Card[]; dueCount: number; newCount: number }

/**
 * 오늘 복습 큐: 오늘 안에 예정된 복습 카드 + (하루 새 카드 한도 안의) 새 카드.
 * 학습하지 않은 카드는 어떤 경우에도 완료 처리되지 않는다 (큐는 읽기 전용 계산).
 */
export function planToday(cards: Card[], logs: ReviewLog[], o: QueueOpts): TodayPlan {
  const pool = cards.filter((c) => !c.suspended && (!o.deckId || c.deckId === o.deckId))
  const eod = endOfDay(o.now)
  const due = pool.filter((c) => c.sched.state !== 0 && c.dueAt <= eod).sort((a, b) => a.dueAt - b.dueAt)
  const left = Math.max(0, o.newPerDay - newIntroducedToday(logs, o.now))
  const fresh = shuffle(pool.filter((c) => c.sched.state === 0)).slice(0, left)
  return { queue: spreadSiblings([...due, ...fresh]), dueCount: due.length, newCount: fresh.length }
}

/** 최근 5회 중 '다시/어려움'이 2회 이상이거나 최근 평가가 '다시'인 카드를 어려운 카드로 본다 */
export function hardCardIds(logs: ReviewLog[]): Set<string> {
  const by = new Map<string, ReviewLog[]>()
  for (const l of logs) (by.get(l.cardId) ?? by.set(l.cardId, []).get(l.cardId)!).push(l)
  const out = new Set<string>()
  for (const [id, ls] of by) {
    const last = ls.sort((a, b) => b.reviewedAt - a.reviewedAt)
    const recent = last.slice(0, 5)
    if (last[0].rating === 1 || recent.filter((l) => l.rating <= 2).length >= 2) out.add(id)
  }
  return out
}

export function planFree(cards: Card[], logs: ReviewLog[], o: { deckId?: string; hardOnly: boolean; limit: number }): Card[] {
  let pool = cards.filter((c) => !c.suspended && (!o.deckId || c.deckId === o.deckId))
  if (o.hardOnly) { const hard = hardCardIds(logs); pool = pool.filter((c) => hard.has(c.id)) }
  return spreadSiblings(shuffle(pool).slice(0, o.limit))
}

export function summarizeToday(logs: ReviewLog[], now: number) {
  const s = startOfDay(now)
  const today = logs.filter((l) => l.reviewedAt >= s)
  return { scheduledReviewed: today.filter((l) => l.scheduled).length, freeReviewed: today.filter((l) => !l.scheduled).length, total: today.length }
}

/** 최근 7일(오늘 포함) 일별 복습 횟수. 기록에 있는 값만 센다. */
export function last7Days(logs: ReviewLog[], now: number): { day: number; count: number }[] {
  const start = startOfDay(now) - 6 * DAY
  const out = Array.from({ length: 7 }, (_, i) => ({ day: start + i * DAY, count: 0 }))
  for (const l of logs) {
    const i = Math.floor((startOfDay(l.reviewedAt) - start) / DAY)
    if (i >= 0 && i < 7) out[i].count++
  }
  return out
}

export function ratingCounts(logs: ReviewLog[]): Record<1 | 2 | 3 | 4, number> {
  const c = { 1: 0, 2: 0, 3: 0, 4: 0 }
  for (const l of logs) c[l.rating]++
  return c
}

/** 연속 학습일 (오늘 또는 어제까지 이어진 날 수) */
export function streakDays(logs: ReviewLog[], now: number): number {
  const days = new Set(logs.map((l) => startOfDay(l.reviewedAt)))
  let d = startOfDay(now)
  if (!days.has(d)) d -= DAY
  let n = 0
  while (days.has(d)) { n++; d -= DAY }
  return n
}
