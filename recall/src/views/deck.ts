import { getAllByIndex, get, put } from '../db'
import { deleteDeck, deleteNote } from '../repo'
import { t } from '../i18n'
import { imageUrl } from '../images'
import { go, refresh } from '../router'
import type { Ctx } from '../router'
import { confirmDialog, field, openDialog, toast } from '../ui/components'
import { h } from '../util'
import { getAll } from '../db'
import { deckClass, dueLabel, noteTitle, openFreeDialog, startReview, typeLabel } from './shared'
import { planToday } from '../study'

export default async function view({ root, params }: Ctx) {
  const deck = await get('decks', params.id)
  if (!deck) { root.append(h('div', { class: 'card empty' }, t('deck.missing'), h('p', null, h('a', { href: '#/library' }, t('nav.library'))))); return }
  const [notes, cards, logs, allDecks] = await Promise.all([getAllByIndex('notes', 'deckId', deck.id), getAllByIndex('cards', 'deckId', deck.id), getAll('logs'), getAll('decks')])
  const dl = logs.filter((l) => l.deckId === deck.id)
  const due = planToday(cards, dl, { now: Date.now(), newPerDay: 9999 }).queue.length

  root.append(h('div', { class: 'page-head' },
    h('div', null, h('span', { class: `badge ${deckClass(deck)}` }, t('lib.deck')), h('h1', null, deck.name), deck.description ? h('p', { class: 'sub' }, deck.description) : null), h('span', { class: 'spacer' }),
    h('div', { class: 'row' },
      h('button', { class: 'btn primary', type: 'button', disabled: !due, onClick: () => startReview({ mode: 'today', deck: deck.id }) }, t('deck.studyToday', { n: due })),
      h('button', { class: 'btn', type: 'button', onClick: () => openFreeDialog(allDecks, deck.id) }, t('today.free')),
      h('a', { class: 'btn', href: `#/create?deck=${deck.id}` }, t('deck.add')))))

  const q = h('input', { type: 'search', placeholder: t('deck.search'), 'aria-label': t('deck.search') })
  const list = h('ul', { class: 'list' })
  const sorted = notes.slice().sort((a, b) => b.updatedAt - a.updatedAt)
  const render = () => {
    const needle = q.value.trim().toLowerCase()
    list.replaceChildren(...sorted.filter((n) => !needle || `${n.question} ${n.answer} ${n.text} ${n.explanation}`.toLowerCase().includes(needle)).map((n) => {
      const nc = cards.filter((c) => c.noteId === n.id)
      const next = nc.slice().sort((a, b) => a.dueAt - b.dueAt)[0]
      const thumb = n.imageId ? h('img', { class: 'thumb', alt: '' }) : null
      if (thumb) void imageUrl(n.imageId).then((u) => { thumb.src = u })
      return h('li', null, thumb,
        h('div', { class: 'grow' }, h('div', { class: 'clip' }, h('strong', null, noteTitle(n) || '—')),
          h('div', { class: 'small muted' }, h('span', { class: 'badge accent' }, typeLabel(n.type)), ' ', t('deck.cardsN', { n: nc.length }), next ? ` · ${dueLabel(next)}` : '', n.origin === 'ai' ? ` · ${t('deck.byAi')}` : '')),
        h('a', { class: 'btn sm', href: `#/note/${n.id}` }, t('common.edit')),
        h('button', { class: 'btn sm danger', type: 'button', 'aria-label': `${t('common.delete')}: ${noteTitle(n)}`, onClick: async () => {
          if (!(await confirmDialog({ title: t('deck.delNote'), message: t('deck.delNoteMsg'), confirm: t('common.delete'), danger: true }))) return
          await deleteNote(n.id); toast(t('common.deleted')); refresh()
        } }, t('common.delete')))
    }))
    if (!list.childElementCount) list.append(h('li', { class: 'muted' }, notes.length ? t('deck.noMatch') : t('deck.empty')))
  }
  q.addEventListener('input', render); render()
  root.append(h('div', { class: 'card' }, h('div', { class: 'row', style: 'margin-bottom:8px' }, h('h2', { style: 'margin:0' }, t('deck.items', { n: notes.length })), h('span', { class: 'spacer' }), q), list))

  root.append(h('div', { class: 'row', style: 'margin-top:20px' },
    h('button', { class: 'btn', type: 'button', onClick: () => editDeck() }, t('deck.rename')),
    h('button', { class: 'btn danger', type: 'button', onClick: async () => {
      if (!(await confirmDialog({ title: t('deck.del'), message: t('deck.delMsg', { n: notes.length }), confirm: t('common.delete'), danger: true }))) return
      await deleteDeck(deck.id); toast(t('common.deleted')); go('/library')
    } }, t('deck.del'))))

  function editDeck() {
    const name = h('input', { type: 'text', maxLength: 80, value: deck!.name })
    const desc = h('input', { type: 'text', maxLength: 300, value: deck!.description })
    const form = h('form', { class: 'stack' }, field(t('lib.deckName'), name), field(t('lib.deckDesc'), desc),
      h('div', { class: 'dlg-actions' }, h('button', { class: 'btn', type: 'button', onClick: () => d.close('cancel') }, t('common.cancel')), h('button', { class: 'btn primary', type: 'submit' }, t('common.save'))))
    const d = openDialog(t('deck.rename'), form)
    form.addEventListener('submit', async (e) => { e.preventDefault(); if (!name.value.trim()) return; await put('decks', { ...deck!, name: name.value.trim(), description: desc.value, updatedAt: Date.now() }); d.close(); refresh() })
  }
}
