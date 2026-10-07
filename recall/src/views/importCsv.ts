import { CSV_MAX_BYTES, CSV_MAX_ROWS, mapCsv, parseCsv } from '../csv'
import { emptyNote } from '../cards'
import { getAll } from '../db'
import { t } from '../i18n'
import { addNotes, createDeck } from '../repo'
import { go, type Ctx } from '../router'
import { toast, field } from '../ui/components'
import { fmtBytes, h, uid } from '../util'
import type { CsvCard } from '../csv'

export default async function view({ root, query }: Ctx) {
  const decks = await getAll('decks')
  let cards: CsvCard[] = []
  let skipped = 0
  const NEW = '__new__'
  const deckSel = h('select', null, decks.map((d) => h('option', { value: d.id }, d.name)), h('option', { value: NEW }, t('editor.newDeck')))
  deckSel.value = query.get('deck') && decks.some((d) => d.id === query.get('deck')) ? query.get('deck')! : decks[0]?.id ?? NEW
  const newName = h('input', { type: 'text', maxLength: 80, placeholder: t('lib.deckName') })
  const reverse = h('input', { type: 'checkbox' })
  const area = h('textarea', { rows: 8, placeholder: 'question,answer,hint,explanation,source\n"What is 2+2?","4",,,' })
  const file = h('input', { type: 'file', accept: '.csv,.tsv,.txt,text/csv,text/plain' })
  const preview = h('div'); const info = h('div', { class: 'small muted' })
  const go_ = h('button', { class: 'btn primary', type: 'button', disabled: true }, t('csv.import'))

  const parse = () => {
    if (area.value.length > CSV_MAX_BYTES) { cards = []; info.textContent = t('csv.tooBig', { size: fmtBytes(CSV_MAX_BYTES) }); go_.setAttribute('disabled', ''); return }
    const rows = parseCsv(area.value)
    const m = mapCsv(rows)
    skipped = m.skipped
    cards = m.cards.slice(0, CSV_MAX_ROWS)
    const over = m.cards.length - cards.length
    info.textContent = cards.length ? t('csv.found', { n: cards.length, skipped, header: m.hasHeader ? t('csv.yes') : t('csv.no') }) + (over > 0 ? ' ' + t('csv.capped', { n: CSV_MAX_ROWS }) : '') : (area.value.trim() ? t('csv.none') : '')
    preview.replaceChildren(cards.length ? h('div', { style: 'overflow-x:auto' }, h('table', { class: 'tbl' },
      h('thead', null, h('tr', null, [t('editor.question'), t('editor.answer'), t('editor.hint')].map((x) => h('th', null, x)))),
      h('tbody', null, cards.slice(0, 8).map((c) => h('tr', null, h('td', null, c.question), h('td', null, c.answer), h('td', null, c.hint)))))) : '')
    if (cards.length) go_.removeAttribute('disabled'); else go_.setAttribute('disabled', '')
  }
  area.addEventListener('input', parse)
  file.addEventListener('change', async () => {
    const f = file.files?.[0]; if (!f) return
    if (f.size > CSV_MAX_BYTES) { toast(t('csv.tooBig', { size: fmtBytes(CSV_MAX_BYTES) }), 'bad'); file.value = ''; return }
    area.value = await f.text(); parse()
  })
  let busy = false
  go_.addEventListener('click', async () => {
    if (busy || !cards.length) return
    busy = true; go_.setAttribute('disabled', '')
    try {
      let deckId = deckSel.value
      if (deckId === NEW) { if (!newName.value.trim()) { toast(t('editor.needDeckName'), 'bad'); newName.focus(); return } deckId = (await createDeck(newName.value)).id }
      const now = Date.now()
      await addNotes(cards.map((c, i) => emptyNote({ id: uid(), deckId, type: 'qa', question: c.question.slice(0, 2000), answer: c.answer.slice(0, 4000), hint: c.hint.slice(0, 300), explanation: c.explanation.slice(0, 2000), source: c.source.slice(0, 300), reverse: reverse.checked, origin: 'csv', createdAt: now + i, updatedAt: now + i })))
      toast(t('csv.done', { n: cards.length }), 'good'); go(`/deck/${deckId}`)
    } catch (e) { console.error(e); toast(t('editor.saveFail'), 'bad') } finally { busy = false; if (cards.length) go_.removeAttribute('disabled') }
  })
  root.append(h('div', { class: 'page-head' }, h('div', null, h('h1', null, t('csv.title')), h('p', { class: 'sub' }, t('csv.sub')))),
    h('div', { class: 'card stack' }, h('p', { class: 'notice' }, t('csv.format')),
      field(t('csv.file'), file), field(t('csv.paste'), area), info, preview,
      field(t('editor.deck'), deckSel), newName, h('label', { class: 'check' }, reverse, t('editor.reverse')), go_))
}
