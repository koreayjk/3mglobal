import { loadAll } from '../repo'
import { t, lang } from '../i18n'
import { last7Days, planToday, summarizeToday } from '../study'
import { settings } from '../db'
import { h, fmtDate } from '../util'
import type { Ctx } from '../router'
import { barChart, deckClass, openFreeDialog, startReview } from './shared'
import { loadSamples } from '../samples'
import { toast } from '../ui/components'

export default async function view({ root }: Ctx) {
  const { decks, cards, logs, notes } = await loadAll()
  const now = Date.now()
  root.append(h('div', { class: 'page-head' }, h('div', null, h('h1', null, t('today.title')), h('p', { class: 'sub' }, new Date(now).toLocaleDateString(lang() === 'en' ? 'en-US' : 'ko-KR', { dateStyle: 'full' })))))

  if (!decks.length) {
    root.append(h('div', { class: 'card empty' }, h('h2', null, t('today.emptyTitle')), h('p', null, t('today.emptyText')),
      h('div', { class: 'row', style: 'justify-content:center' },
        h('button', { class: 'btn primary', type: 'button', onClick: async () => { await loadSamples(); toast(t('samples.loaded'), 'good'); location.hash = '/library' } }, t('samples.load')),
        h('a', { class: 'btn', href: '#/create' }, t('nav.create')))))
    return
  }

  const plan = planToday(cards, logs, { now, newPerDay: settings().newPerDay })
  const sum = summarizeToday(logs, now)
  const total = plan.queue.length
  const start = h('button', { class: 'btn primary', type: 'button', disabled: total === 0, onClick: () => startReview({ mode: 'today' }) }, t('today.start'))
  const five = h('button', { class: 'btn', type: 'button', disabled: total === 0, onClick: () => startReview({ mode: 'today', limit: '12' }) }, t('today.five'))
  const free = h('button', { class: 'btn', type: 'button', onClick: () => openFreeDialog(decks) }, t('today.free'))

  root.append(h('div', { class: 'grid cols-2' },
    h('section', { class: 'card', 'aria-labelledby': 'due-h' },
      h('h2', { id: 'due-h' }, t('today.due')),
      h('div', { class: 'stat' }, String(total)),
      h('div', { class: 'stat-label' }, total ? t('today.dueDetail', { review: plan.dueCount, fresh: plan.newCount }) : t('today.none')),
      h('div', { class: 'row', style: 'margin-top:16px' }, start, five, free),
      h('p', { class: 'field-hint', style: 'margin-top:10px' }, t('today.fiveHint'))),
    h('section', { class: 'card', 'aria-labelledby': 'done-h' },
      h('h2', { id: 'done-h' }, t('today.done')),
      h('div', { class: 'stat' }, String(sum.scheduledReviewed)),
      h('div', { class: 'stat-label' }, t('today.doneLabel')),
      sum.freeReviewed ? h('p', { class: 'small muted', style: 'margin-top:10px' }, t('today.freeDone', { n: sum.freeReviewed })) : null),
  ))

  const week = last7Days(logs, now)
  root.append(h('section', { class: 'card', style: 'margin-top:16px', 'aria-labelledby': 'wk-h' },
    h('h2', { id: 'wk-h' }, t('today.week')),
    barChart(week.map((d) => ({ label: fmtDate(d.day, lang()), value: d.count })), t('today.week')),
    h('p', { class: 'field-hint' }, t('today.weekHint'))))

  // 최근 덱: 마지막 활동(복습/수정) 순
  const lastAct = new Map<string, number>()
  for (const d of decks) lastAct.set(d.id, d.updatedAt)
  for (const l of logs) lastAct.set(l.deckId, Math.max(lastAct.get(l.deckId) || 0, l.reviewedAt))
  for (const n of notes) lastAct.set(n.deckId, Math.max(lastAct.get(n.deckId) || 0, n.updatedAt))
  const recent = decks.slice().sort((a, b) => (lastAct.get(b.id) || 0) - (lastAct.get(a.id) || 0)).slice(0, 4)
  root.append(h('section', { style: 'margin-top:24px', 'aria-labelledby': 'rd-h' },
    h('div', { class: 'row', style: 'justify-content:space-between' }, h('h2', { id: 'rd-h' }, t('today.recent')), h('a', { href: '#/library' }, t('today.allDecks'))),
    h('div', { class: 'grid cols-3' }, recent.map((d) => {
      const dc = cards.filter((c) => c.deckId === d.id)
      const due = planToday(dc, logs, { now, newPerDay: 9999 }).queue.length
      return h('a', { class: `deck-card ${deckClass(d)}`, href: `#/deck/${d.id}` }, h('h3', null, d.name),
        h('div', { class: 'meta' }, h('span', null, t('lib.cards', { n: dc.length })), h('span', null, t('lib.due', { n: due }))))
    }))))
}
