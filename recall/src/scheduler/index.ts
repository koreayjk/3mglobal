// 복습 일정 계산 전용 모듈. 화면 코드와 분리되어 있다.
// 공식 오픈소스 구현 ts-fsrs (open-spaced-repetition/ts-fsrs, FSRS 알고리즘)를 기본 파라미터로 사용한다.
// 이 앱은 FSRS 파라미터를 사용자 데이터로 최적화하지 않는다. 일 단위 간격만 사용(enable_short_term=false).
import { createEmptyCard, fsrs, generatorParameters, type Card as FCard, type FSRS, type Grade } from 'ts-fsrs'
import type { Rating, ReviewLog, Sched } from '../types'

export function makeScheduler(opts: { fuzz?: boolean; retention?: number } = {}): FSRS {
  return fsrs(generatorParameters({ enable_fuzz: opts.fuzz ?? true, enable_short_term: false, request_retention: opts.retention ?? 0.9 }))
}
const defaultScheduler = makeScheduler()

const toF = (s: Sched): FCard => ({
  due: new Date(s.due), stability: s.stability, difficulty: s.difficulty, elapsed_days: s.elapsed_days,
  scheduled_days: s.scheduled_days, learning_steps: s.learning_steps, reps: s.reps, lapses: s.lapses,
  state: s.state, last_review: s.last_review == null ? undefined : new Date(s.last_review),
})
const fromF = (c: FCard): Sched => ({
  due: c.due.getTime(), stability: c.stability, difficulty: c.difficulty, elapsed_days: c.elapsed_days,
  scheduled_days: c.scheduled_days, learning_steps: c.learning_steps, reps: c.reps, lapses: c.lapses,
  state: c.state, last_review: c.last_review ? c.last_review.getTime() : null,
})

export function newSched(now = Date.now()): Sched { return fromF(createEmptyCard(new Date(now))) }

/** 평가를 적용한 다음 상태를 계산한다. 입력은 변경하지 않는다. */
export function applyRating(s: Sched, rating: Rating, now = Date.now(), f: FSRS = defaultScheduler): Sched {
  return fromF(f.next(toF(s), new Date(now), rating as Grade).card)
}

/** 각 평가 버튼을 눌렀을 때의 다음 복습까지 일수(표시용). */
export function previewDays(s: Sched, now = Date.now(), f: FSRS = defaultScheduler): Record<Rating, number> {
  const p = f.repeat(toF(s), new Date(now))
  const days = (g: Grade) => Math.max(0, Math.round((p[g].card.due.getTime() - now) / 86_400_000))
  return { 1: days(1), 2: days(2), 3: days(3), 4: days(4) }
}

/** 최근 기록에서 반복 실패 카드인지 판단한다. (최근 5회 중 3회 이상 '다시') */
export function isStruggling(logs: Pick<ReviewLog, 'rating' | 'reviewedAt'>[]): boolean {
  const last = logs.slice().sort((a, b) => b.reviewedAt - a.reviewedAt).slice(0, 5)
  return last.filter((l) => l.rating === 1).length >= 3
}
