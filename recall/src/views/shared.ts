import { t } from '../i18n'
import { go } from '../router'
import type { Card, Deck, Note, Rating } from '../types'
import { clozeRe } from '../cards'
import { field, openDialog } from '../ui/components'
import { h, svg } from '../util'

export const deckClass = (d: Pick<Deck, 'color'>) => `dk${((d.color % 6) + 6) % 6}`

export function deckSelect(decks: Deck[], value?: string, allowAll = false): HTMLSelectElement {
  const s = h('select', null,
    allowAll ? h('option', { value: '' }, t('free.allDecks')) : null,
    decks.map((d) => h('option', { value: d.id }, d.name)))
  if (value !== undefined) s.value = value
  return s
}

export function noteTitle(n: Note): string {
  switch (n.type) {
    case 'qa': return n.question
    case 'cloze': return n.text.replace(clozeRe(), (_m, _n, a) => `[${a}]`)
    case 'occlusion': return n.question || t('type.occlusion')
    case 'image-id': return n.question || n.answer
  }
}
export const typeLabel = (type: Note['type']) => t(`type.${type}`)

export function dueLabel(c: Card, now = Date.now()): string {
  if (c.sched.state === 0) return t('card.new')
  const days = Math.round((c.dueAt - now) / 86_400_000)
  if (c.dueAt <= now) return t('card.dueNow')
  return days <= 0 ? t('card.today') : t('card.inDays', { n: days })
}

export const RATING_KEYS: Record<Rating, string> = { 1: 'rate.again', 2: 'rate.hard', 3: 'rate.good', 4: 'rate.easy' }

export function startReview(q: Record<string, string>) { go(`/review?${new URLSearchParams(q).toString()}`) }

/** 자유 연습 시작 다이얼로그 */
export function openFreeDialog(decks: Deck[], presetDeck = '') {
  const deck = deckSelect(decks, presetDeck, true)
  const hard = h('input', { type: 'checkbox' })
  const limit = h('input', { type: 'number', min: 5, max: 200, value: 20 })
  const sched = h('input', { type: 'checkbox' })
  const body = h('div', { class: 'stack' },
    h('p', { class: 'notice warn' }, t('free.explain')),
    field(t('free.deck'), deck),
    h('label', { class: 'check' }, hard, t('free.hardOnly')),
    field(t('free.limit'), limit),
    h('label', { class: 'check' }, sched, t('free.updateSchedule')),
    h('div', { class: 'field-hint' }, t('free.updateHint')),
  )
  const start = h('button', { class: 'btn primary', type: 'button' }, t('free.start'))
  const cancel = h('button', { class: 'btn', type: 'button' }, t('common.cancel'))
  body.appendChild(h('div', { class: 'dlg-actions' }, cancel, start))
  const d = openDialog(t('free.title'), body)
  cancel.addEventListener('click', () => d.close('cancel'))
  start.addEventListener('click', () => {
    d.close('ok')
    startReview({ mode: 'free', ...(deck.value ? { deck: deck.value } : {}), ...(hard.checked ? { hard: '1' } : {}), limit: String(Math.max(1, Math.min(200, Number(limit.value) || 20))), sched: sched.checked ? '1' : '0' })
  })
}

export function barChart(data: { label: string; value: number }[], ariaLabel: string): HTMLElement {
  const max = Math.max(1, ...data.map((d) => d.value))
  return h('div', { class: 'bars', role: 'img', 'aria-label': `${ariaLabel}: ${data.map((d) => `${d.label} ${d.value}`).join(', ')}` },
    data.map((d) => h('div', { class: 'bar', 'aria-hidden': 'true' }, h('b', null, String(d.value)),
      (() => { const i = h('i', { class: d.value ? '' : 'zero' }); i.style.height = `${Math.max(3, (d.value / max) * 80)}px`; return i })(),
      h('span', null, d.label))))
}
export { svg }
