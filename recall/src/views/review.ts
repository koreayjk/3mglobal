import { clozeRe } from '../cards'
import { getAll, get, settings } from '../db'
import { t } from '../i18n'
import { imageUrl } from '../images'
import { refresh, type Ctx } from '../router'
import { previewDays, isStruggling } from '../scheduler'
import { planFree, planToday } from '../study'
import type { Card, Mask, Note, Rating, ReviewLog } from '../types'
import { confirmDialog, toast } from '../ui/components'
import { rateCard } from '../repo'
import { h, uid } from '../util'
import { RATING_KEYS } from './shared'

interface Item { card: Card; again: boolean }

export default async function view({ root, query }: Ctx) {
  const mode = query.get('mode') === 'free' ? 'free' : 'today'
  const deckId = query.get('deck') || undefined
  const limit = Number(query.get('limit')) || 0
  const updateSchedule = mode === 'today' || query.get('sched') === '1'
  const [cards, logs, notesArr] = await Promise.all([getAll('cards'), getAll('logs'), getAll('notes')])
  const notes = new Map(notesArr.map((n) => [n.id, n]))
  const now = Date.now()

  let queue: Card[]
  if (mode === 'today') {
    queue = planToday(cards, logs, { now, newPerDay: settings().newPerDay, deckId }).queue
    if (limit) queue = queue.slice(0, limit)
  } else {
    queue = planFree(cards, logs, { deckId, hardOnly: query.get('hard') === '1', limit: limit || 20 })
  }
  const sessionId = uid()
  const modePill = h('span', { class: `mode-pill ${mode}` }, mode === 'today' ? t('review.modeToday') : (updateSchedule ? t('review.modeFreeSched') : t('review.modeFree')))

  if (!queue.length) {
    root.append(h('div', { class: 'review' }, h('div', { class: 'card empty' }, modePill, h('h2', { style: 'margin-top:12px' }, t('review.nothing')), h('p', null, mode === 'today' ? t('review.nothingToday') : t('review.nothingFree')),
      h('a', { class: 'btn primary', href: '#/today' }, t('review.back')))))
    return
  }

  const items: Item[] = queue.map((card) => ({ card, again: false }))
  const total = items.length
  let idx = 0, doneFirst = 0, revealed = false, hintUsed = false, submitting = false, shownAt = Date.now(), attempt = 0, ended = false
  const tally: Record<Rating, number> = { 1: 0, 2: 0, 3: 0, 4: 0 }
  let hintCount = 0

  const progressBar = h('i'); const progressText = h('span', { class: 'small muted', 'aria-live': 'polite' })
  const live = h('div', { class: 'sr-only', 'aria-live': 'polite' })
  const stageEl = h('div')
  const endBtn = h('button', { class: 'btn sm', type: 'button', onClick: () => void endSession(true) }, t('review.end'))
  root.append(h('div', { class: 'review' },
    h('div', { class: 'review-top' }, modePill, h('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': total, 'aria-valuenow': 0, 'aria-label': t('review.progress') }, progressBar), progressText, endBtn),
    mode === 'free' && !updateSchedule ? h('p', { class: 'notice warn small' }, t('review.freeNote')) : null,
    stageEl, live))

  const onKey = (e: KeyboardEvent) => {
    if (ended) return
    const tag = (e.target as HTMLElement).tagName
    if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT') { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !revealed) { e.preventDefault(); reveal() } return }
    if (document.querySelector('dialog[open]')) return
    if (!revealed && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); reveal() }
    else if (revealed && ['1', '2', '3', '4'].includes(e.key)) { e.preventDefault(); void rate(Number(e.key) as Rating) }
  }
  document.addEventListener('keydown', onKey)

  function updateProgress() {
    const pct = Math.round((doneFirst / total) * 100)
    progressBar.style.width = `${pct}%`
    root.querySelector('.progress')?.setAttribute('aria-valuenow', String(doneFirst))
    const remainAgain = items.slice(idx).filter((i) => i.again).length
    progressText.textContent = t('review.progressText', { done: doneFirst, total }) + (remainAgain ? ` · ${t('review.againLeft', { n: remainAgain })}` : '')
  }

  async function show() {
    if (idx >= items.length) return void endSession(false)
    revealed = false; hintUsed = false; shownAt = Date.now(); attempt++
    updateProgress()
    const { card } = items[idx]
    const note = notes.get(card.noteId) ?? (await get('notes', card.noteId))
    if (!note) { idx++; return void show() } // 노트가 사라진 카드는 건너뜀 (완료 처리하지 않음)
    const hist = logs.filter((l) => l.cardId === card.id)
    const face = await buildFace(card, note, hist)
    stageEl.replaceChildren(face.el)
    face.focus()
  }

  async function buildFace(card: Card, note: Note, hist: ReviewLog[]) {
    const wrap = h('div', { class: 'q-card' })
    const answerBox = h('div', { class: 'a-box', hidden: true })
    const mine = h('textarea', { rows: 2, 'aria-label': t('review.yourAnswer'), placeholder: t('review.yourAnswerPh') })
    const hintBox = h('div', { class: 'notice small', hidden: true, style: 'margin-top:12px' })
    const hintText = noteHint(card, note)
    const hintBtn = hintText ? h('button', { class: 'btn sm', type: 'button', onClick: () => { hintUsed = true; hintBox.hidden = false; hintBtn!.setAttribute('disabled', ''); live.textContent = t('review.hintShown') } }, t('review.showHint')) : null
    if (hintText) hintBox.append(h('strong', null, t('editor.hint') + ': '), hintText)
    const showBtn = h('button', { class: 'btn primary', type: 'button', onClick: () => reveal() }, t('review.show'))
    const actions = h('div', { class: 'row', style: 'margin-top:16px' }, showBtn, hintBtn)
    const ratingRow = h('div', { class: 'rate', hidden: true })
    const days = previewDays(card.sched)
    for (const r of [1, 2, 3, 4] as Rating[]) {
      ratingRow.append(h('button', { type: 'button', class: `r${r}`, 'data-rate': r, onClick: () => void rate(r) }, t(RATING_KEYS[r]), h('small', null, updateSchedule ? fmtDays(days[r]) : `[${r}]`)))
    }

    let focusEl: HTMLElement = showBtn
    let revealExtra: () => void = () => {}

    if (note.type === 'qa') {
      const rev = card.kind === 'qa-rev'
      const qText = rev ? note.answer : note.question, aText = rev ? note.question : note.answer
      wrap.append(h('div', { class: 'q-label' }, rev ? t('review.reverse') : t('review.question')), h('div', { class: 'q-text' }, qText), hintBox, h('div', { style: 'margin-top:14px' }, mine))
      const long = aText.length > 60 || aText.includes('\n')
      answerBox.append(h('div', { class: 'q-label' }, long ? t('review.model') : t('review.answer')), h('div', { class: 'a-text' }, aText))
      if (long) answerBox.append(h('p', { class: 'small muted', style: 'margin:8px 0 0' }, t('review.selfCompare')))
      focusEl = showBtn
      revealExtra = () => { if (mine.value.trim()) answerBox.after(h('div', { class: 'mine-box', id: 'mine' }, h('div', { class: 'q-label' }, t('review.yourAnswer')), mine.value)) }
    } else if (note.type === 'cloze') {
      const n = Number(card.key)
      const build = (show: boolean) => {
        const frag = document.createDocumentFragment(); let last = 0
        for (const m of note.text.matchAll(clozeRe())) {
          frag.append(note.text.slice(last, m.index!))
          const isT = Number(m[1]) === n
          frag.append(isT ? h('span', { class: `blank${show ? ' shown' : ''}` }, show ? m[2] : '[…]') : m[2])
          last = m.index! + m[0].length
        }
        frag.append(note.text.slice(last))
        return frag
      }
      const body = h('div', { class: 'q-text' }, build(false))
      wrap.append(h('div', { class: 'q-label' }, t('review.cloze')), body, hintBox, h('div', { style: 'margin-top:14px' }, mine))
      const target = [...note.text.matchAll(clozeRe())].filter((m) => Number(m[1]) === n).map((m) => m[2]).join(' / ')
      answerBox.append(h('div', { class: 'q-label' }, t('review.answer')), h('div', { class: 'a-text' }, target))
      focusEl = showBtn
      revealExtra = () => { body.replaceChildren(build(true)); if (mine.value.trim()) answerBox.after(h('div', { class: 'mine-box' }, h('div', { class: 'q-label' }, t('review.yourAnswer')), mine.value)) }
    } else {
      const url = await imageUrl(note.imageId)
      const stage = h('div', { class: 'stage' }, h('img', { src: url, alt: t('review.imageAlt') }))
      const wrapImg = h('div', { class: 'stage-wrap' }, stage)
      if (note.type === 'occlusion') {
        const target = note.masks.find((m) => m.id === card.key)
        const draw = (show: boolean) => {
          stage.querySelectorAll('.mask').forEach((x) => x.remove())
          for (const m of note.masks) {
            const isT = m.id === card.key
            if (!isT && note.occlusionMode === 'one') continue
            if (isT && show) { stage.append(maskEl(m, 'mask revealed', '')); continue }
            stage.append(maskEl(m, isT ? 'mask target' : 'mask', isT ? '?' : ''))
          }
        }
        draw(false)
        wrap.append(h('div', { class: 'q-label' }, t('review.occlusion')), h('div', { class: 'q-text', style: 'font-size:1.05rem' }, note.question || t('review.occlusionQ')), wrapImg, hintBox, h('div', { style: 'margin-top:14px' }, mine))
        answerBox.append(h('div', { class: 'q-label' }, t('review.answer')), h('div', { class: 'a-text' }, target?.answer || ''))
        focusEl = showBtn
        revealExtra = () => { draw(true); if (mine.value.trim()) answerBox.after(h('div', { class: 'mine-box' }, h('div', { class: 'q-label' }, t('review.yourAnswer')), mine.value)) }
      } else {
        wrap.append(h('div', { class: 'q-label' }, t('type.image-id')), h('div', { class: 'q-text', style: 'font-size:1.05rem' }, note.question || t('editor.promptDefault')), wrapImg, hintBox, h('div', { style: 'margin-top:14px' }, mine))
        answerBox.append(h('div', { class: 'q-label' }, t('review.answer')), h('div', { class: 'a-text' }, note.answer))
        focusEl = showBtn
        revealExtra = () => { if (mine.value.trim()) answerBox.after(h('div', { class: 'mine-box' }, h('div', { class: 'q-label' }, t('review.yourAnswer')), mine.value)) }
      }
    }
    if (note.explanation || note.source) {
      answerBox.append(h('div', { style: 'margin-top:10px', class: 'small' }, note.explanation ? h('div', { style: 'white-space:pre-wrap' }, h('strong', null, t('review.explanation') + ': '), note.explanation) : null,
        note.source ? h('div', { class: 'muted' }, t('review.source') + ': ' + note.source) : null))
    }
    wrap.append(answerBox, actions, ratingRow)
    if (isStruggling(hist)) {
      wrap.append(h('div', { class: 'notice warn small', style: 'margin-top:16px' }, t('review.struggling'), ' ', h('a', { href: `#/note/${note.id}` }, t('review.editCard'))))
    }
    revealFn = () => {
      answerBox.hidden = false; ratingRow.hidden = false; actions.hidden = true; mine.readOnly = true
      revealExtra()
      live.textContent = t('review.revealed')
      ratingRow.querySelector<HTMLElement>('.r3')?.focus()
    }
    return { el: wrap, focus: () => focusEl.focus({ preventScroll: true }) }
  }
  let revealFn: () => void = () => {}

  function maskEl(m: Mask, cls: string, text: string): HTMLElement {
    const el = h('div', { class: cls, 'aria-hidden': 'true' }, text)
    el.style.left = `${m.x * 100}%`; el.style.top = `${m.y * 100}%`; el.style.width = `${m.w * 100}%`; el.style.height = `${m.h * 100}%`
    return el
  }

  function reveal() { if (revealed || ended) return; revealed = true; revealFn() }

  async function rate(r: Rating) {
    if (!revealed || submitting || ended) return // 중복 클릭·키 반복 방지
    submitting = true
    stageEl.querySelectorAll<HTMLButtonElement>('.rate button').forEach((b) => { b.disabled = true })
    const it = items[idx]
    try {
      const res = await rateCard({
        card: it.card, rating: r, hintUsed, mode,
        // 같은 세션에서 '다시'로 재출제된 카드는 이미 일정이 갱신되었으므로 재확인은 기록만 남긴다
        updateSchedule: updateSchedule && !it.again,
        sessionId, attemptKey: `${it.card.id}#${attempt}`, durationMs: Date.now() - shownAt,
      })
      if (res.status === 'duplicate') toast(t('review.duplicate'))
      if (res.status === 'saved') {
        tally[r]++; if (hintUsed) hintCount++
        logs.push(res.log)
        if (res.status === 'saved' && !it.again) doneFirst++
        if (r === 1) items.push({ card: res.card, again: true }) // 같은 세션 뒤쪽에서 재출제
      }
      idx++
      await show()
    } catch (e) {
      console.error(e); toast(t('review.saveFail'), 'bad')
      stageEl.querySelectorAll<HTMLButtonElement>('.rate button').forEach((b) => { b.disabled = false })
    } finally { submitting = false }
  }

  async function endSession(manual: boolean) {
    if (ended) return
    if (manual && doneFirst > 0 && !(await confirmDialog({ title: t('review.endTitle'), message: t('review.endMsg'), confirm: t('review.end') }))) return
    ended = true
    document.removeEventListener('keydown', onKey)
    const count = tally[1] + tally[2] + tally[3] + tally[4]
    const allCards = await getAll('cards')
    const tomorrow = allCards.filter((c) => !c.suspended && c.sched.state !== 0 && c.dueAt <= Date.now() + 86_400_000 + 1).length
    root.replaceChildren(h('div', { class: 'review' }, h('div', { class: 'card stack' },
      modePill, h('h1', null, t('review.doneTitle')),
      count ? h('p', null, t('review.doneCount', { n: count })) : h('p', { class: 'muted' }, t('review.doneNone')),
      count ? h('table', { class: 'tbl' }, h('tbody', null, ([1, 2, 3, 4] as Rating[]).map((r) => h('tr', null, h('th', null, t(RATING_KEYS[r])), h('td', null, String(tally[r])))), h('tr', null, h('th', null, t('review.hintsUsed')), h('td', null, String(hintCount))))) : null,
      h('p', { class: 'small muted' }, t('review.selfNote')),
      updateSchedule && count ? h('p', null, t('review.tomorrow', { n: tomorrow })) : null,
      !updateSchedule && count ? h('p', { class: 'notice small' }, t('review.freeNoChange')) : null,
      h('div', { class: 'row' }, h('a', { class: 'btn primary', href: '#/today' }, t('review.back')), h('a', { class: 'btn', href: '#/history' }, t('nav.history')),
        h('button', { class: 'btn', type: 'button', onClick: () => refresh() }, t('review.again')))))
    )
    window.scrollTo(0, 0)
  }

  await show()
  return () => { document.removeEventListener('keydown', onKey) }
}

const fmtDays = (d: number) => (d <= 0 ? t('review.lt1d') : t('review.days', { n: d }))
function noteHint(card: Card, note: Note): string {
  if (card.kind === 'mask') return note.masks.find((m) => m.id === card.key)?.hint || note.hint
  return note.hint
}
