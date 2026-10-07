import { getAll } from '../db'
import { createDeck, loadAll } from '../repo'
import { t, lang } from '../i18n'
import { planToday } from '../study'
import { field, openDialog, toast } from '../ui/components'
import { fmtDate, h } from '../util'
import type { Ctx } from '../router'
import { deckClass } from './shared'
import { loadSamples } from '../samples'
import type { Material } from '../types'
import { imageUrl } from '../images'

export function openNewDeckDialog(onDone: (id: string) => void) {
  const name = h('input', { type: 'text', maxLength: 80, required: true })
  const desc = h('input', { type: 'text', maxLength: 300 })
  let color = 0
  const swatches = h('div', { class: 'row', role: 'radiogroup', 'aria-label': t('lib.color') }, [0, 1, 2, 3, 4, 5].map((i) => {
    const b = h('button', { type: 'button', role: 'radio', 'aria-checked': String(i === 0), 'aria-label': `${t('lib.color')} ${i + 1}`, class: `btn icon-btn dk${i}`, onClick: () => {
      color = i; swatches.querySelectorAll('button').forEach((x, j) => x.setAttribute('aria-checked', String(j === i)))
    } }, '●')
    return b
  }))
  const form = h('form', { class: 'stack' }, field(t('lib.deckName'), name), field(t('lib.deckDesc'), desc), swatches,
    h('div', { class: 'dlg-actions' }, h('button', { class: 'btn', type: 'button', onClick: () => d.close('cancel') }, t('common.cancel')), h('button', { class: 'btn primary', type: 'submit' }, t('common.save'))))
  const d = openDialog(t('lib.newDeck'), form)
  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    if (!name.value.trim()) { name.focus(); return }
    const deck = await createDeck(name.value, desc.value, color)
    d.close('ok'); onDone(deck.id)
  })
  name.focus()
}

export default async function view({ root }: Ctx) {
  const { decks, notes, cards, logs } = await loadAll()
  const now = Date.now()
  root.append(h('div', { class: 'page-head' },
    h('div', null, h('h1', null, t('lib.title')), h('p', { class: 'sub' }, t('lib.sub'))), h('span', { class: 'spacer' }),
    h('button', { class: 'btn primary', type: 'button', onClick: () => openNewDeckDialog((id) => { location.hash = `/deck/${id}` }) }, t('lib.newDeck'))))
  if (!decks.length) {
    root.append(h('div', { class: 'card empty' }, h('p', null, t('lib.empty')),
      h('button', { class: 'btn primary', type: 'button', onClick: async () => { await loadSamples(); toast(t('samples.loaded'), 'good'); location.hash = '/today' } }, t('samples.load'))))
  } else {
    root.append(h('div', { class: 'grid cols-3' }, decks.map((d) => {
      const dc = cards.filter((c) => c.deckId === d.id)
      const due = planToday(dc, logs, { now, newPerDay: 9999 }).queue.length
      return h('a', { class: `deck-card ${deckClass(d)}`, href: `#/deck/${d.id}` }, h('h3', null, d.name),
        d.description ? h('p', { class: 'small', style: 'margin:0' }, d.description) : null,
        h('div', { class: 'meta' }, h('span', null, t('lib.notes', { n: notes.filter((n) => n.deckId === d.id).length })), h('span', null, t('lib.cards', { n: dc.length })), h('span', null, t('lib.due', { n: due }))))
    })))
  }

  const mats = (await getAll('materials')).sort((a, b) => b.createdAt - a.createdAt)
  if (mats.length) {
    root.append(h('section', { style: 'margin-top:32px' }, h('h2', null, t('lib.materials')), h('p', { class: 'muted small' }, t('lib.materialsHint')),
      h('div', { class: 'card' }, h('ul', { class: 'list' }, mats.map((m) => h('li', null,
        h('div', { class: 'grow' }, h('strong', null, m.title || t('ai.untitled')), h('div', { class: 'small muted' }, `${decks.find((d) => d.id === m.deckId)?.name || ''} · ${fmtDate(m.createdAt, lang())}${m.mock ? ' · ' + t('ai.mockShort') : ''}`)),
        h('button', { class: 'btn sm', type: 'button', onClick: () => openMaterial(m) }, t('lib.open'))))))))
  }
}

function openMaterial(m: Material) {
  const body = h('div', { class: 'stack' })
  if (m.topic) body.append(h('p', { class: 'muted' }, m.topic))
  const sec = (title: string, items: Node[]) => { if (items.length) body.append(h('h3', null, title), h('ul', null, items)) }
  sec(t('ai.concepts'), m.summary.concepts.map((c) => h('li', null, h('strong', null, c.name), ' — ', c.explanation)))
  sec(t('ai.terms'), m.summary.terms.map((c) => h('li', null, h('strong', null, c.term), ' — ', c.definition)))
  sec(t('ai.processes'), m.summary.processes.map((p) => h('li', null, h('strong', null, p.name), h('ol', null, p.items.map((i) => h('li', null, i))))))
  sec(t('ai.keyPoints'), m.summary.keyPoints.map((k) => h('li', null, k.text)))
  const pages = h('div', null)
  body.append(h('h3', null, t('ai.sourceText')), pages)
  for (const p of m.pages) {
    const img = h('img', { class: 'thumb', alt: '', style: 'display:none' })
    if (p.imageId) void imageUrl(p.imageId).then((u) => { if (u) { img.src = u; img.style.display = '' } })
    pages.append(h('div', { class: 'src-page' }, h('strong', null, `#${p.index}`), ' ', img, h('pre', null, p.text)))
  }
  body.append(h('div', { class: 'dlg-actions' }, h('button', { class: 'btn', type: 'button', onClick: () => d.close() }, t('common.close'))))
  const d = openDialog(m.title || t('ai.untitled'), body, { wide: true })
}
