import type { OrganizeResult } from '../api/_lib/types'

export const SCHEMA_VERSION = 1

export type NoteType = 'qa' | 'cloze' | 'occlusion' | 'image-id'
export type CardKind = 'qa' | 'qa-rev' | 'cloze' | 'mask' | 'image-id'
export type Rating = 1 | 2 | 3 | 4 // 다시 / 어려움 / 보통 / 쉬움
export type Lang = 'ko' | 'en'
export type StudyMode = 'today' | 'free'

export interface Deck {
  id: string
  name: string
  description: string
  /** 0~5: 덱 색상 팔레트 인덱스 */
  color: number
  createdAt: number
  updatedAt: number
}

export interface Mask {
  id: string
  /** 이미지 기준 0~1 정규화 좌표 */
  x: number
  y: number
  w: number
  h: number
  answer: string
  hint: string
}

/** 원자료 (복습 카드와 분리) */
export interface Note {
  id: string
  deckId: string
  type: NoteType
  createdAt: number
  updatedAt: number
  // 질문·답변
  question: string
  answer: string
  hint: string
  explanation: string
  source: string
  reverse: boolean
  // 빈칸: {{c1::정답}} 표기
  text: string
  // 이미지 (가리기·식별)
  imageId: string
  masks: Mask[]
  occlusionMode: 'one' | 'all'
  origin: 'manual' | 'ai' | 'csv' | 'sample'
}

/** FSRS 상태(ts-fsrs Card 를 직렬화 가능한 형태로 저장) */
export interface Sched {
  due: number
  stability: number
  difficulty: number
  elapsed_days: number
  scheduled_days: number
  learning_steps: number
  reps: number
  lapses: number
  state: number // 0 New, 1 Learning, 2 Review, 3 Relearning
  last_review: number | null
}

/** 복습 카드: 노트 하나에서 파생, 일정은 카드별로 독립 */
export interface Card {
  id: string // `${noteId}:${kind}:${key}`
  noteId: string
  deckId: string
  kind: CardKind
  key: string
  dueAt: number
  sched: Sched
  suspended: boolean
  /** 평가가 저장될 때마다 +1. 중복 저장 방지(낙관적 동시성)에 사용 */
  revision: number
  createdAt: number
  updatedAt: number
}

export interface ReviewLog {
  id: string
  cardId: string
  noteId: string
  deckId: string
  reviewedAt: number
  rating: Rating
  hintUsed: boolean
  mode: StudyMode
  /** 이 평가가 복습 일정을 갱신했는지 */
  scheduled: boolean
  durationMs: number
  stateBefore: number
  dueBefore: number
  dueAfter: number | null
  sessionId: string
}

export interface StoredImage {
  id: string
  blob: Blob
  mime: string
  name: string
  size: number
  createdAt: number
}

export interface Material {
  id: string
  deckId: string
  title: string
  topic: string
  createdAt: number
  summary: Omit<OrganizeResult, 'cards' | 'warnings'>
  pages: { index: number; text: string; imageId: string }[]
  aiGenerated: boolean
  mock: boolean
}

export interface Settings {
  lang: Lang
  newPerDay: number
  motion: 'system' | 'reduce' | 'full'
  /** 서버에 접근 코드가 설정된 경우에만 사용. 이 기기에만 저장되고 백업에는 포함되지 않음 */
  aiAccessCode: string
  samplesLoaded: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  lang: 'ko',
  newPerDay: 20,
  motion: 'system',
  aiAccessCode: '',
  samplesLoaded: false,
}
