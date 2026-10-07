import { loadAll } from '../repo'
import { t, lang } from '../i18n'
import { hardCardIds, last7Days, ratingCounts } from '../study'
import { fmtDate, h, DAY, startOfDay } from '../util'
import type { Ctx } from '../router'
import { barChart, noteTitle, RATING_KEYS } from './shared'
import type { Rating } from '../types'

export default async function view({ root }: Ctx) {
  const { decks, notes, cards, logs } = await loadAll()
  const now = Date.now()
  root.append(h('div', { class: 'page-head' }, h('div', null, h('h1', null, t('hist.title')), h('p', { class: 'sub' }, t('hist.sub')))))
  if (!logs.length) { root.append(h('div', { class: 'card empty' }, t('hist.empty'))); return }

  const sched = logs.filter((l) => l.scheduled).length
  const days = new Set(logs.map((l) => startOfDay(l.reviewedAt))).size
  const hints = logs.filter((l) => l.hintUsed).length
  const rc = ratingCounts(logs)
  root.append(h('div', { class: 'grid cols-3' },
    stat(String(logs.length), t('hist.total')), stat(String(days), t('hist.days')), stat(String(sched), t('hist.scheduled')), stat(String(logs.length - sched), t('hist.free')), stat(String(hints), t('hist.hints'))))

  // 14일
  const start = startOfDay(now) - 13 * DAY
  const d14 = Array.from({ length: 14 }, (_, i) => ({ label: fmtDate(start + i * DAY, lang()), value: 0 }))
  for (const l of logs) { const i = Math.floor((startOfDay(l.reviewedAt) - start) / DAY); if (i >= 0 && i < 14) d14[i].value++ }
  void last7Days
  root.append(h('section', { class: 'card', style: 'margin-top:16px' }, h('h2', null, t('hist.last14')), barChart(d14, t('hist.last14')), h('p', { class: 'field-hint' }, t('today.weekHint'))))

  root.append(h('section', { class: 'card', style: 'margin-top:16px' }, h('h2', null, t('hist.dist')),
    h('table', { class: 'tbl' }, h('tbody', null, ([1, 2, 3, 4] as Rating[]).map((r) => h('tr', null, h('th', null, t(RATING_KEYS[r])), h('td', null, String(rc[r])), h('td', { class: 'muted' }, `${Math.round((rc[r] / logs.length) * 100)}%`))))),
    h('p', { class: 'field-hint' }, t('hist.distNote'))))

  // 다음 7일 예정
  const up = Array.from({ length: 7 }, (_, i) => ({ label: fmtDate(startOfDay(now) + i * DAY, lang()), value: 0 }))
  for (const c of cards) { if (c.suspended || c.sched.state === 0) continue; const i = Math.max(0, Math.floor((c.dueAt - startOfDay(now)) / DAY)); if (i < 7) up[i].value++ }
  root.append(h('section', { class: 'card', style: 'margin-top:16px' }, h('h2', null, t('hist.upcoming')), barChart(up, t('hist.upcoming')), h('p', { class: 'field-hint' }, t('hist.upcomingNote'))))

  // 어려운 카드
  const hard = [...hardCardIds(logs)].map((id) => cards.find((c) => c.id === id)).filter(Boolean).slice(0, 8)
  if (hard.length) {
    root.append(h('section', { class: 'card', style: 'margin-top:16px' }, h('h2', null, t('hist.hard')), h('p', { class: 'small muted' }, t('hist.hardTip')),
      h('ul', { class: 'list' }, hard.map((c) => { const n = notes.find((x) => x.id === c!.noteId); return n ? h('li', null, h('div', { class: 'grow clip' }, noteTitle(n)), h('a', { class: 'btn sm', href: `#/note/${n.id}` }, t('common.edit'))) : null }))))
  }

  const recent = logs.slice().sort((a, b) => b.reviewedAt - a.reviewedAt).slice(0, 30)
  root.append(h('section', { class: 'card', style: 'margin-top:16px' }, h('h2', null, t('hist.recent')),
    h('div', { style: 'overflow-x:auto' }, h('table', { class: 'tbl' },
      h('thead', null, h('tr', null, [t('hist.when'), t('hist.card'), t('hist.rating'), t('hist.mode'), t('hist.next')].map((x) => h('th', null, x)))),
      h('tbody', null, recent.map((l) => {
        const n = notes.find((x) => x.id === l.noteId)
        return h('tr', null,
          h('td', null, new Date(l.reviewedAt).toLocaleString(lang() === 'en' ? 'en-US' : 'ko-KR', { dateStyle: 'short', timeStyle: 'short' })),
          h('td', null, n ? noteTitle(n).slice(0, 50) : '—', decks.length > 1 ? h('div', { class: 'small muted' }, decks.find((d) => d.id === l.deckId)?.name || '') : null),
          h('td', null, t(RATING_KEYS[l.rating]), l.hintUsed ? ` (${t('hist.hint')})` : ''),
          h('td', null, l.scheduled ? t('review.modeToday') : t('review.modeFree')),
          h('td', null, l.dueAfter ? fmtDate(l.dueAfter, lang()) : '—'))
      }))))))
}
const stat = (v: string, label: string) => h('div', { class: 'card' }, h('div', { class: 'stat' }, v), h('div', { class: 'stat-label' }, label))
