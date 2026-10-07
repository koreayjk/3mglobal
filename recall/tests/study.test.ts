import { describe, expect, it } from 'vitest'
import { reconcileCards, clozeNumbers, emptyNote } from '../src/cards'
import { newSched } from '../src/scheduler'
import { planFree, planToday, last7Days } from '../src/study'
import type { Card, ReviewLog } from '../src/types'
import { DAY, startOfDay } from '../src/util'
import { normalizeRect, resizeRect } from '../src/ui/rectEditor'

const NOW = new Date(2026, 5, 10, 12, 0, 0).getTime()
const card = (id: string, o: Partial<Card> & { state?: number; due?: number } = {}): Card => {
  const sched = { ...newSched(NOW), state: o.state ?? 0, due: o.due ?? NOW }
  return { id, noteId: o.noteId ?? id, deckId: o.deckId ?? 'd', kind: 'qa', key: '', dueAt: sched.due, sched, suspended: false, revision: 0, createdAt: 0, updatedAt: 0 }
}
const log = (cardId: string, o: Partial<ReviewLog> = {}): ReviewLog => ({ id: Math.random().toString(), cardId, noteId: cardId, deckId: 'd', reviewedAt: NOW, rating: 3, hintUsed: false, mode: 'today', scheduled: true, durationMs: 1, stateBefore: 0, dueBefore: NOW, dueAfter: NOW + DAY, sessionId: 's', ...o })

describe('planToday', () => {
  it('오늘 안에 예정된 복습 카드와 한도 내 새 카드만 포함하고 미래 카드는 제외한다', () => {
    const cards = [card('due', { state: 2, due: NOW - DAY }), card('later', { state: 2, due: NOW + 3 * DAY }), card('n1'), card('n2'), card('n3')]
    const p = planToday(cards, [], { now: NOW, newPerDay: 2 })
    expect(p.dueCount).toBe(1); expect(p.newCount).toBe(2)
    expect(p.queue.map((c) => c.id)).not.toContain('later')
  })
  it('오늘 이미 시작한 새 카드는 한도에서 빠진다', () => {
    const cards = [card('n1'), card('n2'), card('n3')]
    const p = planToday(cards, [log('x', { stateBefore: 0 })], { now: NOW, newPerDay: 2 })
    expect(p.newCount).toBe(1)
  })
  it('보류 카드는 제외하고 큐 계산은 카드를 변경하지 않는다', () => {
    const c = card('a', { state: 2, due: NOW - 1 }); c.suspended = true
    const before = JSON.stringify(c)
    expect(planToday([c], [], { now: NOW, newPerDay: 5 }).queue).toHaveLength(0)
    expect(JSON.stringify(c)).toBe(before)
  })
})
describe('planFree', () => {
  it('어려운 카드만 고를 수 있다', () => {
    const cards = [card('a', { state: 2 }), card('b', { state: 2 })]
    const q = planFree(cards, [log('a', { rating: 1 }), log('b', { rating: 4 })], { hardOnly: true, limit: 10 })
    expect(q.map((c) => c.id)).toEqual(['a'])
  })
})
describe('last7Days', () => {
  it('일별 횟수를 센다', () => {
    const r = last7Days([log('a'), log('a'), log('a', { reviewedAt: NOW - 2 * DAY })], NOW)
    expect(r[6].count).toBe(2); expect(r[4].count).toBe(1); expect(r[0].day).toBe(startOfDay(NOW) - 6 * DAY)
  })
})
describe('reconcileCards', () => {
  it('빈칸 번호마다 카드가 만들어지고, 빈칸을 지우면 해당 카드만 제거되며 기존 일정은 유지된다', () => {
    const n = emptyNote({ id: 'n', deckId: 'd', type: 'cloze', text: '{{c1::a}} b {{c2::c}}' })
    const first = reconcileCards(n, [], NOW)
    expect(first.upsert.map((c) => c.key)).toEqual(['1', '2'])
    const existing = first.upsert.map((c, i) => ({ ...c, revision: i + 5 }))
    const n2 = { ...n, text: '{{c1::a}} b c' }
    const second = reconcileCards(n2, existing, NOW)
    expect(second.upsert).toHaveLength(0)
    expect(second.removeIds).toEqual(['n:cloze:2'])
  })
  it('마스크 하나당 카드 하나', () => {
    const m = (id: string) => ({ id, x: 0.1, y: 0.1, w: 0.2, h: 0.2, answer: 'a', hint: '' })
    const n = emptyNote({ id: 'o', deckId: 'd', type: 'occlusion', imageId: 'i', masks: [m('m1'), m('m2'), m('m3')] })
    expect(reconcileCards(n, [], NOW).upsert.map((c) => c.id)).toEqual(['o:mask:m1', 'o:mask:m2', 'o:mask:m3'])
  })
  it('역방향 카드는 요청할 때만', () => {
    const q = emptyNote({ id: 'q', deckId: 'd', type: 'qa', question: 'a', answer: 'b' })
    expect(reconcileCards(q, [], NOW).upsert).toHaveLength(1)
    expect(reconcileCards({ ...q, reverse: true }, [], NOW).upsert).toHaveLength(2)
  })
  it('clozeNumbers', () => { expect(clozeNumbers('{{c2::x}} {{c1::y}} {{c2::z}}')).toEqual([1, 2]) })
})
describe('rect geometry (정규화 좌표)', () => {
  it('항상 0~1 범위 안으로 정규화한다', () => {
    const r = normalizeRect({ id: 'a', x: 0.95, y: -0.2, w: 0.3, h: 2 })
    expect(r.x + r.w).toBeLessThanOrEqual(1); expect(r.y).toBeGreaterThanOrEqual(0); expect(r.h).toBeLessThanOrEqual(1)
  })
  it('코너 리사이즈는 반대 모서리를 고정한다', () => {
    const r = resizeRect({ id: 'a', x: 0.2, y: 0.2, w: 0.4, h: 0.4 }, 'se', 0.9, 0.8)
    expect(r.x).toBeCloseTo(0.2); expect(r.y).toBeCloseTo(0.2); expect(r.w).toBeCloseTo(0.7); expect(r.h).toBeCloseTo(0.6)
    const r2 = resizeRect({ id: 'a', x: 0.2, y: 0.2, w: 0.4, h: 0.4 }, 'nw', 0.7, 0.7)
    expect(r2.w).toBeGreaterThan(0)
  })
})
