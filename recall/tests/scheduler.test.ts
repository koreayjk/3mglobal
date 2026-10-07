import { describe, expect, it } from 'vitest'
import { applyRating, isStruggling, makeScheduler, newSched, previewDays } from '../src/scheduler'

const f = makeScheduler({ fuzz: false })
const DAY = 86_400_000

describe('scheduler (ts-fsrs)', () => {
  it('새 카드는 state 0 이고 입력을 변경하지 않는다', () => {
    const s = newSched(1_000_000)
    const copy = JSON.stringify(s)
    applyRating(s, 3, 1_000_000, f)
    expect(JSON.stringify(s)).toBe(copy)
    expect(s.state).toBe(0)
  })
  it('쉬움 > 보통 > 어려움 > 다시 순으로 다음 복습이 멀어진다', () => {
    const now = Date.UTC(2026, 0, 1)
    const s = newSched(now)
    const d = [1, 2, 3, 4].map((r) => applyRating(s, r as 1, now, f).due)
    expect(d[0]).toBeLessThanOrEqual(d[1]); expect(d[1]).toBeLessThanOrEqual(d[2]); expect(d[2]).toBeLessThan(d[3])
  })
  it('다시는 하루 이상 간격(단기 학습 단계 없음)이고 복습 상태가 쌓일수록 간격이 늘어난다', () => {
    const t0 = Date.UTC(2026, 0, 1)
    let s = applyRating(newSched(t0), 3, t0, f)
    expect(s.due - t0).toBeGreaterThanOrEqual(DAY)
    const t1 = s.due
    const s2 = applyRating(s, 3, t1, f)
    expect(s2.due - t1).toBeGreaterThan(s.due - t0)
    s = applyRating(s2, 1, s2.due, f)
    expect(s.lapses).toBe(1)
  })
  it('previewDays 는 4개 평가의 일수를 돌려준다', () => {
    const p = previewDays(newSched(0), 0, f)
    expect(Object.keys(p)).toEqual(['1', '2', '3', '4'])
  })
})
describe('isStruggling', () => {
  it('최근 5회 중 3회 이상 다시', () => {
    const mk = (r: number[]) => r.map((rating, i) => ({ rating: rating as 1, reviewedAt: i }))
    expect(isStruggling(mk([1, 3, 1, 4, 1]))).toBe(true)
    expect(isStruggling(mk([1, 1, 3, 4, 4, 4, 4]))).toBe(false)
  })
})
