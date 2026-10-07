import { ALL_STORES, getAll, loadSettings, saveSettings, settings, store, tx } from './db'
import { base64ToBlob, blobToBase64 } from './images'
import { reconcileAll } from './repo'
import { SCHEMA_VERSION, type Card, type Deck, type Material, type Note, type ReviewLog, type Settings } from './types'

export interface BackupImage { id: string; mime: string; name: string; size: number; createdAt: number; data: string }
export interface BackupData {
  decks: Deck[]; notes: Note[]; cards: Card[]; logs: ReviewLog[]; materials: Material[]; images: BackupImage[]
  settings: Partial<Settings>
}
export interface BackupFile { app: 'recall'; schemaVersion: number; exportedAt: string; data: BackupData }

export async function buildBackup(): Promise<BackupFile> {
  const [decks, notes, cards, logs, materials, imgs] = await Promise.all([
    getAll('decks'), getAll('notes'), getAll('cards'), getAll('logs'), getAll('materials'), getAll('images'),
  ])
  const images: BackupImage[] = []
  for (const i of imgs) images.push({ id: i.id, mime: i.mime, name: i.name, size: i.size, createdAt: i.createdAt, data: await blobToBase64(i.blob) })
  const { aiAccessCode: _omit, ...pub } = settings() // 접근 코드는 백업에 넣지 않는다
  void _omit
  return { app: 'recall', schemaVersion: SCHEMA_VERSION, exportedAt: new Date().toISOString(), data: { decks, notes, cards, logs, materials, images, settings: pub } }
}

// ───── 검증 ─────
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const isStr = (v: unknown) => typeof v === 'string'
const isNum = (v: unknown) => typeof v === 'number' && Number.isFinite(v)

export interface BackupCheck { ok: boolean; errors: string[]; data?: BackupData; counts?: Record<string, number>; schemaVersion?: number }

export function validateBackup(raw: unknown): BackupCheck {
  const errors: string[] = []
  const err = (m: string) => { if (errors.length < 12) errors.push(m) }
  if (!isObj(raw) || raw.app !== 'recall') return { ok: false, errors: ['Not a Recall backup file.'] }
  const sv = raw.schemaVersion
  if (!isNum(sv)) return { ok: false, errors: ['schemaVersion is missing.'] }
  if ((sv as number) > SCHEMA_VERSION) return { ok: false, errors: [`Backup schemaVersion ${sv} is newer than this app supports (${SCHEMA_VERSION}). Update the app.`], schemaVersion: sv as number }
  if (!isObj(raw.data)) return { ok: false, errors: ['data is missing.'] }
  const d = raw.data
  const list = (k: string): unknown[] => { const v = d[k]; if (!Array.isArray(v)) { err(`${k} must be an array.`); return [] } return v }
  const decks = list('decks'), notes = list('notes'), cards = list('cards'), logs = list('logs'), materials = list('materials'), images = list('images')
  decks.forEach((x, i) => { if (!isObj(x) || !isStr(x.id) || !isStr(x.name) || !isNum(x.createdAt)) err(`decks[${i}] is invalid.`) })
  notes.forEach((x, i) => {
    if (!isObj(x) || !isStr(x.id) || !isStr(x.deckId) || !['qa', 'cloze', 'occlusion', 'image-id'].includes(x.type as string)) return err(`notes[${i}] is invalid.`)
    if (!Array.isArray(x.masks)) return err(`notes[${i}].masks must be an array.`)
    for (const m of x.masks as unknown[]) {
      if (!isObj(m) || !isStr(m.id) || ![m.x, m.y, m.w, m.h].every(isNum) || (m.x as number) < 0 || (m.y as number) < 0 || (m.w as number) <= 0 || (m.h as number) <= 0 || (m.x as number) + (m.w as number) > 1.0001 || (m.y as number) + (m.h as number) > 1.0001) return err(`notes[${i}] has an invalid mask.`)
    }
  })
  cards.forEach((x, i) => {
    if (!isObj(x) || !isStr(x.id) || !isStr(x.noteId) || !isStr(x.deckId) || !isNum(x.dueAt) || !isObj(x.sched)) return err(`cards[${i}] is invalid.`)
    const s = x.sched as Record<string, unknown>
    if (![s.due, s.stability, s.difficulty, s.reps, s.lapses, s.state].every(isNum)) err(`cards[${i}].sched is invalid.`)
  })
  logs.forEach((x, i) => { if (!isObj(x) || !isStr(x.id) || !isStr(x.cardId) || !isNum(x.reviewedAt) || ![1, 2, 3, 4].includes(x.rating as number)) err(`logs[${i}] is invalid.`) })
  materials.forEach((x, i) => { if (!isObj(x) || !isStr(x.id) || !Array.isArray(x.pages)) err(`materials[${i}] is invalid.`) })
  images.forEach((x, i) => { if (!isObj(x) || !isStr(x.id) || !isStr(x.mime) || !isStr(x.data) || !/^image\/(jpeg|png|webp|gif)$/.test(x.mime as string)) err(`images[${i}] is invalid.`) })
  if (errors.length) return { ok: false, errors, schemaVersion: sv as number }
  // 참조 무결성: 노트→덱, 카드→노트, 이미지 참조
  const deckIds = new Set((decks as Deck[]).map((x) => x.id))
  const noteIds = new Set((notes as Note[]).map((x) => x.id))
  const imageIds = new Set((images as BackupImage[]).map((x) => x.id))
  ;(notes as Note[]).forEach((n, i) => {
    if (!deckIds.has(n.deckId)) err(`notes[${i}] refers to a missing deck.`)
    if ((n.type === 'occlusion' || n.type === 'image-id') && !imageIds.has(n.imageId)) err(`notes[${i}] refers to a missing image.`)
  })
  ;(cards as Card[]).forEach((c, i) => { if (!noteIds.has(c.noteId)) err(`cards[${i}] refers to a missing note.`) })
  if (errors.length) return { ok: false, errors, schemaVersion: sv as number }
  const counts = { decks: decks.length, notes: notes.length, cards: cards.length, logs: logs.length, images: images.length, materials: materials.length }
  return { ok: true, errors: [], schemaVersion: sv as number, counts, data: { decks, notes, cards, logs, materials, images, settings: isObj(d.settings) ? d.settings : {} } as BackupData }
}

// ───── 가져오기 ─────
export type ImportMode = 'merge' | 'replace'

export async function importBackup(data: BackupData, mode: ImportMode): Promise<void> {
  // 이미지 Blob 은 트랜잭션 밖에서 미리 만든다
  const images = data.images.map((i) => ({ id: i.id, blob: base64ToBlob(i.data, i.mime), mime: i.mime, name: i.name || 'image', size: i.size, createdAt: i.createdAt }))
  const keepCode = settings().aiAccessCode
  await tx(ALL_STORES, 'readwrite', async (t) => {
    const read = <T>(name: 'decks' | 'notes' | 'cards' | 'logs' | 'materials' | 'images') =>
      new Promise<T[]>((res) => { const r = store(t, name).getAll(); r.onsuccess = () => res(r.result as T[]) })
    if (mode === 'replace') {
      for (const n of ALL_STORES) store(t, n).clear()
      for (const x of data.decks) store(t, 'decks').put(x)
      for (const x of data.notes) store(t, 'notes').put(x)
      for (const x of data.cards) store(t, 'cards').put(x)
      for (const x of data.logs) store(t, 'logs').put(x)
      for (const x of data.materials) store(t, 'materials').put(x)
      for (const x of images) store(t, 'images').put(x)
      return
    }
    // 병합: 같은 id 는 더 최근에 수정/복습한 쪽을 유지, 로그는 합집합
    const [decks, notes, cards, mats, imgs] = await Promise.all([read<Deck>('decks'), read<Note>('notes'), read<Card>('cards'), read<Material>('materials'), read<{ id: string }>('images')])
    const newer = <T extends { id: string }>(cur: T[], inc: T[], ts: (x: T) => number, name: 'decks' | 'notes' | 'cards' | 'materials') => {
      const m = new Map(cur.map((x) => [x.id, x]))
      for (const x of inc) { const c = m.get(x.id); if (!c || ts(x) > ts(c)) store(t, name).put(x) }
    }
    newer(decks, data.decks, (x) => x.updatedAt, 'decks')
    newer(notes, data.notes, (x) => x.updatedAt, 'notes')
    newer(cards, data.cards, (x) => x.sched.last_review ?? x.updatedAt, 'cards')
    newer(mats, data.materials, (x) => x.createdAt, 'materials')
    const have = new Set(imgs.map((x) => x.id))
    for (const x of images) if (!have.has(x.id)) store(t, 'images').put(x)
    for (const x of data.logs) store(t, 'logs').put(x) // id 가 같으면 동일 기록
  })
  await reconcileAll() // 병합으로 어긋난 카드 정합성 보정 (일정은 유지)
  await loadSettings()
  if (mode === 'replace') {
    const s = data.settings
    await saveSettings({ ...(s.lang ? { lang: s.lang } : {}), ...(s.newPerDay ? { newPerDay: s.newPerDay } : {}), ...(s.motion ? { motion: s.motion } : {}), aiAccessCode: keepCode, samplesLoaded: !!s.samplesLoaded })
  }
}
