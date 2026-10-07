// 도메인 단위 저장 작업. 노트와 카드는 항상 같은 트랜잭션에서 함께 갱신한다.
import { reconcileCards } from './cards'
import { get, getAll, getAllByIndex, put, store, tx } from './db'
import type { Card, Deck, Note, ReviewLog, StudyMode, Rating } from './types'
import { applyRating } from './scheduler'
import { uid } from './util'

export async function saveNote(note: Note): Promise<Note> {
  const n = { ...note, updatedAt: Date.now() }
  await tx(['notes', 'cards'], 'readwrite', async (t) => {
    const cardsStore = store(t, 'cards')
    const existing = await new Promise<Card[]>((res, rej) => {
      const r = cardsStore.index('noteId').getAll(n.id); r.onsuccess = () => res(r.result as Card[]); r.onerror = () => rej(r.error)
    })
    const { upsert, removeIds } = reconcileCards(n, existing)
    store(t, 'notes').put(n)
    for (const c of upsert) cardsStore.put(c)
    for (const id of removeIds) {
      cardsStore.delete(id)
    }
  })
  return n
}

export async function saveNotes(notes: Note[]): Promise<void> {
  for (const n of notes) await saveNote(n)
}

export async function deleteNote(noteId: string): Promise<void> {
  await tx(['notes', 'cards', 'logs', 'images'], 'readwrite', async (t) => {
    const note = await new Promise<Note | undefined>((res) => { const r = store(t, 'notes').get(noteId); r.onsuccess = () => res(r.result as Note | undefined) })
    store(t, 'notes').delete(noteId)
    const cards = await new Promise<Card[]>((res) => { const r = store(t, 'cards').index('noteId').getAll(noteId); r.onsuccess = () => res(r.result as Card[]) })
    for (const c of cards) store(t, 'cards').delete(c.id)
    const logs = await new Promise<ReviewLog[]>((res) => { const r = store(t, 'logs').getAll(); r.onsuccess = () => res(r.result as ReviewLog[]) })
    for (const l of logs) if (l.noteId === noteId) store(t, 'logs').delete(l.id)
    // 다른 노트가 쓰지 않는 이미지는 함께 정리
    if (note?.imageId) {
      const others = await new Promise<Note[]>((res) => { const r = store(t, 'notes').getAll(); r.onsuccess = () => res(r.result as Note[]) })
      const mats = await new Promise<{ pages: { imageId: string }[] }[]>((res) => { const r = store(t, 'materials').getAll(); r.onsuccess = () => res(r.result as never) })
      const used = others.some((o) => o.imageId === note.imageId) || mats.some((m) => m.pages.some((p) => p.imageId === note.imageId))
      if (!used) store(t, 'images').delete(note.imageId)
    }
  })
}

export async function deleteDeck(deckId: string): Promise<void> {
  const notes = await getAllByIndex('notes', 'deckId', deckId)
  for (const n of notes) await deleteNote(n.id)
  await tx(['decks', 'materials'], 'readwrite', async (t) => {
    store(t, 'decks').delete(deckId)
    const mats = await new Promise<{ id: string; deckId: string }[]>((res) => { const r = store(t, 'materials').getAll(); r.onsuccess = () => res(r.result as never) })
    for (const m of mats) if (m.deckId === deckId) store(t, 'materials').delete(m.id)
  })
}

export async function createDeck(name: string, description = '', color?: number): Promise<Deck> {
  const decks = await getAll('decks')
  const d: Deck = { id: uid(), name: name.trim().slice(0, 80) || 'Deck', description: description.slice(0, 300), color: color ?? decks.length % 6, createdAt: Date.now(), updatedAt: Date.now() }
  await put('decks', d)
  return d
}

export interface RateArgs {
  card: Card
  rating: Rating
  hintUsed: boolean
  mode: StudyMode
  /** false 이면 기록만 남기고 카드 일정은 바꾸지 않는다 (자유 연습 기본값) */
  updateSchedule: boolean
  sessionId: string
  /** 같은 화면 표시에 대해 평가가 두 번 저장되지 않도록 하는 고유 키 */
  attemptKey: string
  durationMs: number
  now?: number
}
export type RateResult = { status: 'saved'; card: Card; log: ReviewLog } | { status: 'duplicate' } | { status: 'missing' }

/**
 * 평가 저장: 카드 갱신 + 로그 추가를 한 트랜잭션에서 수행한다.
 * - 로그 id 는 (sessionId, attemptKey) 로 결정되어 같은 평가가 두 번 들어가면 거부된다.
 * - 카드 revision 이 화면에 표시된 시점과 다르면(이미 다른 곳에서 평가됨) 저장하지 않는다.
 */
export async function rateCard(a: RateArgs): Promise<RateResult> {
  const now = a.now ?? Date.now()
  const logId = `${a.sessionId}:${a.attemptKey}`
  return tx(['cards', 'logs'], 'readwrite', async (t) => {
    const logs = store(t, 'logs')
    const existingLog = await new Promise<unknown>((res) => { const r = logs.get(logId); r.onsuccess = () => res(r.result) })
    if (existingLog) return { status: 'duplicate' } as RateResult
    const cur = await new Promise<Card | undefined>((res) => { const r = store(t, 'cards').get(a.card.id); r.onsuccess = () => res(r.result as Card | undefined) })
    if (!cur) return { status: 'missing' } as RateResult
    if (a.updateSchedule && cur.revision !== a.card.revision) return { status: 'duplicate' } as RateResult
    let next = cur
    let dueAfter: number | null = null
    if (a.updateSchedule) {
      const sched = applyRating(cur.sched, a.rating, now)
      next = { ...cur, sched, dueAt: sched.due, revision: cur.revision + 1, updatedAt: now }
      store(t, 'cards').put(next)
      dueAfter = sched.due
    }
    const log: ReviewLog = {
      id: logId, cardId: cur.id, noteId: cur.noteId, deckId: cur.deckId, reviewedAt: now, rating: a.rating,
      hintUsed: a.hintUsed, mode: a.mode, scheduled: a.updateSchedule, durationMs: Math.max(0, Math.round(a.durationMs)),
      stateBefore: cur.sched.state, dueBefore: cur.dueAt, dueAfter, sessionId: a.sessionId,
    }
    logs.put(log)
    return { status: 'saved', card: next, log } as RateResult
  })
}

export async function loadAll() {
  const [decks, notes, cards, logs] = await Promise.all([getAll('decks'), getAll('notes'), getAll('cards'), getAll('logs')])
  return { decks, notes, cards, logs }
}

/** 모든 노트에 대해 카드를 다시 맞춘다 (복원/병합 이후 정합성 보정) */
export async function reconcileAll(): Promise<void> {
  const [notes, cards] = await Promise.all([getAll('notes'), getAll('cards')])
  const byNote = new Map<string, Card[]>()
  for (const c of cards) (byNote.get(c.noteId) ?? byNote.set(c.noteId, []).get(c.noteId)!).push(c)
  const noteIds = new Set(notes.map((n) => n.id))
  await tx(['cards'], 'readwrite', (t) => {
    const cs = store(t, 'cards')
    for (const n of notes) {
      const { upsert, removeIds } = reconcileCards(n, byNote.get(n.id) || [])
      for (const c of upsert) cs.put(c)
      for (const id of removeIds) cs.delete(id)
    }
    for (const c of cards) if (!noteIds.has(c.noteId)) cs.delete(c.id)
  })
}

export { get }

/** 새 노트 여러 개를 한 트랜잭션으로 추가 (CSV 가져오기 등). 노트와 파생 카드가 함께 저장된다. */
export async function addNotes(notes: Note[]): Promise<void> {
  const now = Date.now()
  await tx(['notes', 'cards'], 'readwrite', (t) => {
    const ns = store(t, 'notes'), cs = store(t, 'cards')
    for (const n of notes) {
      ns.put(n)
      for (const c of reconcileCards(n, [], now).upsert) cs.put(c)
    }
  })
}
