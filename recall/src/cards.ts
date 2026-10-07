import { newSched } from './scheduler'
import type { Card, CardKind, Note } from './types'

export const clozeRe = () => /\{\{c(\d+)::([\s\S]*?)\}\}/g

export function clozeNumbers(text: string): number[] {
  const set = new Set<number>()
  for (const m of text.matchAll(clozeRe())) set.add(Number(m[1]))
  return [...set].sort((a, b) => a - b)
}

/** 노트에서 만들어져야 하는 복습 카드의 (kind,key) 목록 */
export function desiredCards(note: Note): { kind: CardKind; key: string }[] {
  switch (note.type) {
    case 'qa':
      return note.reverse ? [{ kind: 'qa', key: '' }, { kind: 'qa-rev', key: '' }] : [{ kind: 'qa', key: '' }]
    case 'cloze':
      return clozeNumbers(note.text).map((n) => ({ kind: 'cloze' as const, key: String(n) }))
    case 'occlusion':
      return note.masks.map((m) => ({ kind: 'mask' as const, key: m.id }))
    case 'image-id':
      return [{ kind: 'image-id', key: '' }]
  }
}
export const cardId = (noteId: string, kind: CardKind, key: string) => `${noteId}:${kind}:${key}`

/**
 * 노트와 기존 카드를 맞춘다. 이미 있는 카드는 일정과 이력을 그대로 유지하고,
 * 새로 필요한 카드만 만들며, 더 이상 필요 없는 카드(삭제된 마스크/빈칸)만 제거 대상으로 돌려준다.
 */
export function reconcileCards(note: Note, existing: Card[], now = Date.now()): { upsert: Card[]; removeIds: string[] } {
  const want = desiredCards(note)
  const byId = new Map(existing.map((c) => [c.id, c]))
  const wantIds = new Set<string>()
  const upsert: Card[] = []
  for (const w of want) {
    const id = cardId(note.id, w.kind, w.key)
    wantIds.add(id)
    const cur = byId.get(id)
    if (cur) {
      if (cur.deckId !== note.deckId) upsert.push({ ...cur, deckId: note.deckId, updatedAt: now })
    } else {
      const sched = newSched(now)
      upsert.push({ id, noteId: note.id, deckId: note.deckId, kind: w.kind, key: w.key, dueAt: sched.due, sched, suspended: false, revision: 0, createdAt: now, updatedAt: now })
    }
  }
  return { upsert, removeIds: existing.filter((c) => !wantIds.has(c.id)).map((c) => c.id) }
}

export const emptyNote = (over: Partial<Note> & Pick<Note, 'id' | 'deckId' | 'type'>): Note => ({
  createdAt: Date.now(), updatedAt: Date.now(),
  question: '', answer: '', hint: '', explanation: '', source: '', reverse: false,
  text: '', imageId: '', masks: [], occlusionMode: 'one', origin: 'manual',
  ...over,
})
