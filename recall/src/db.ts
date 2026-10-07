import { DEFAULT_SETTINGS, type Card, type Deck, type Material, type Note, type ReviewLog, type Settings, type StoredImage } from './types'

const DB_NAME = 'recall'
const DB_VERSION = 1

export interface Stores {
  decks: Deck
  notes: Note
  cards: Card
  logs: ReviewLog
  images: StoredImage
  materials: Material
  kv: { key: string; value: unknown }
}
export type StoreName = keyof Stores
export const ALL_STORES: StoreName[] = ['decks', 'notes', 'cards', 'logs', 'images', 'materials', 'kv']

let dbPromise: Promise<IDBDatabase> | null = null

export function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis)) return reject(new Error('IndexedDB unavailable'))
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      db.createObjectStore('decks', { keyPath: 'id' })
      const notes = db.createObjectStore('notes', { keyPath: 'id' })
      notes.createIndex('deckId', 'deckId')
      const cards = db.createObjectStore('cards', { keyPath: 'id' })
      cards.createIndex('deckId', 'deckId')
      cards.createIndex('noteId', 'noteId')
      cards.createIndex('dueAt', 'dueAt')
      const logs = db.createObjectStore('logs', { keyPath: 'id' })
      logs.createIndex('cardId', 'cardId')
      logs.createIndex('reviewedAt', 'reviewedAt')
      db.createObjectStore('images', { keyPath: 'id' })
      db.createObjectStore('materials', { keyPath: 'id' })
      db.createObjectStore('kv', { keyPath: 'key' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => { dbPromise = null; reject(req.error) }
  })
  return dbPromise
}

const wrap = <T>(r: IDBRequest<T>) => new Promise<T>((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) })

/** 여러 저장소를 하나의 트랜잭션으로 읽고 쓴다. 모두 성공하거나 모두 취소된다. */
export async function tx<R>(stores: StoreName[], mode: IDBTransactionMode, fn: (t: IDBTransaction) => Promise<R> | R): Promise<R> {
  const db = await openDb()
  return new Promise<R>((resolve, reject) => {
    const t = db.transaction(stores, mode)
    let result: R
    t.oncomplete = () => resolve(result)
    t.onerror = () => reject(t.error)
    t.onabort = () => reject(t.error || new Error('Transaction aborted'))
    Promise.resolve(fn(t)).then((r) => { result = r }, (e) => { try { t.abort() } catch { /* 이미 종료 */ } reject(e) })
  })
}
export const store = <K extends StoreName>(t: IDBTransaction, name: K) => t.objectStore(name)

export async function getAll<K extends StoreName>(name: K): Promise<Stores[K][]> {
  return tx([name], 'readonly', (t) => wrap(store(t, name).getAll() as IDBRequest<Stores[K][]>))
}
export async function get<K extends StoreName>(name: K, id: string): Promise<Stores[K] | undefined> {
  return tx([name], 'readonly', (t) => wrap(store(t, name).get(id) as IDBRequest<Stores[K] | undefined>))
}
export async function getAllByIndex<K extends StoreName>(name: K, index: string, value: IDBValidKey): Promise<Stores[K][]> {
  return tx([name], 'readonly', (t) => wrap(store(t, name).index(index).getAll(value) as IDBRequest<Stores[K][]>))
}
export async function put<K extends StoreName>(name: K, value: Stores[K]): Promise<void> {
  await tx([name], 'readwrite', (t) => { store(t, name).put(value) })
}
export async function putMany<K extends StoreName>(name: K, values: Stores[K][]): Promise<void> {
  await tx([name], 'readwrite', (t) => { const s = store(t, name); for (const v of values) s.put(v) })
}
export async function del(name: StoreName, id: string): Promise<void> {
  await tx([name], 'readwrite', (t) => { store(t, name).delete(id) })
}
export async function clearAll(): Promise<void> {
  await tx(ALL_STORES, 'readwrite', (t) => { for (const n of ALL_STORES) store(t, n).clear() })
}

// ───── 설정 ─────
let settingsCache: Settings | null = null
export async function loadSettings(): Promise<Settings> {
  const row = await get('kv', 'settings')
  settingsCache = { ...DEFAULT_SETTINGS, ...((row?.value as Partial<Settings>) || {}) }
  return settingsCache
}
export const settings = (): Settings => settingsCache || DEFAULT_SETTINGS
export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  settingsCache = { ...settings(), ...patch }
  await put('kv', { key: 'settings', value: settingsCache })
  return settingsCache
}

export async function persistStorage(): Promise<boolean> {
  try { return (await navigator.storage?.persist?.()) ?? false } catch { return false }
}
