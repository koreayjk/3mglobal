import { clozeNumbers, clozeRe, desiredCards, emptyNote } from '../cards'
import { get, getAll } from '../db'
import { t } from '../i18n'
import { IMAGE_MAX_BYTES, imageUrl, normalizeForStorage, saveImage, validateImage } from '../images'
import { createDeck, deleteNote, saveNote } from '../repo'
import { go, refresh, type Ctx } from '../router'
import type { Mask, Note, NoteType } from '../types'
import { confirmDialog, field, toast } from '../ui/components'
import { RectEditor } from '../ui/rectEditor'
import { fmtBytes, h, uid } from '../util'

const TYPES: NoteType[] = ['qa', 'cloze', 'occlusion', 'image-id']

export default async function view({ root, params, query }: Ctx) {
  const editing = params.id ? await get('notes', params.id) : undefined
  if (params.id && !editing) { root.append(h('div', { class: 'card empty' }, t('deck.missing'))); return }
  const type = (editing?.type ?? params.type) as NoteType
  if (!TYPES.includes(type)) { go('/create'); return }
  const decks = await getAll('decks')
  const original = editing
  const note: Note = editing ? structuredClone(editing) : emptyNote({ id: uid(), deckId: query.get('deck') || decks[0]?.id || '', type })
  if (!editing && type === 'image-id') note.question = ''

  let pendingBlob: Blob | null = null
  let pendingUrl = ''
  let editor: RectEditor | null = null

  // ── 덱 선택 ──
  const NEW = '__new__'
  const deckSel = h('select', { 'aria-label': t('editor.deck') }, decks.map((d) => h('option', { value: d.id }, d.name)), h('option', { value: NEW }, t('editor.newDeck')))
  deckSel.value = note.deckId && decks.some((d) => d.id === note.deckId) ? note.deckId : decks.length ? decks[0].id : NEW
  const newDeckName = h('input', { type: 'text', maxLength: 80, placeholder: t('lib.deckName'), 'aria-label': t('lib.deckName') })
  const newDeckBox = h('div', { style: deckSel.value === NEW ? '' : 'display:none' }, newDeckName)
  deckSel.addEventListener('change', () => { newDeckBox.style.display = deckSel.value === NEW ? '' : 'none' })

  // ── 공통 필드 ──
  const hint = h('input', { type: 'text', maxLength: 300, value: note.hint })
  const expl = h('textarea', { maxLength: 2000, rows: 3 }); expl.value = note.explanation
  const source = h('input', { type: 'text', maxLength: 300, value: note.source })
  const fields: HTMLElement[] = []

  let collect: () => string | null = () => null // 오류 메시지를 반환하면 저장 중단

  if (type === 'qa') {
    const q = h('textarea', { rows: 3, maxLength: 2000, required: true }); q.value = note.question
    const a = h('textarea', { rows: 3, maxLength: 4000, required: true }); a.value = note.answer
    const rev = h('input', { type: 'checkbox', checked: note.reverse })
    fields.push(field(t('editor.question'), q), field(t('editor.answer'), a), field(t('editor.hint'), hint, t('editor.hintHelp')),
      h('label', { class: 'check' }, rev, t('editor.reverse')), h('div', { class: 'field-hint', style: 'margin-top:-8px' }, t('editor.reverseHelp')),
      field(t('editor.explanation'), expl, t('editor.explanationHelp')), field(t('editor.source'), source))
    collect = () => {
      if (!q.value.trim() || !a.value.trim()) return t('editor.needQA')
      Object.assign(note, { question: q.value.trim(), answer: a.value.trim(), reverse: rev.checked })
      return null
    }
  }

  if (type === 'cloze') {
    const ta = h('textarea', { rows: 5, maxLength: 4000, required: true, class: 'cloze-src' }); ta.value = note.text
    const same = h('input', { type: 'checkbox' })
    const preview = h('ol', { class: 'small' })
    const refreshPreview = () => {
      const nums = clozeNumbers(ta.value)
      preview.replaceChildren(...(nums.length ? nums.map((n) => h('li', null, ta.value.replace(clozeRe(), (_m, k, ans) => (Number(k) === n ? '[…]' : ans)))) : [h('li', { class: 'muted' }, t('editor.noBlank'))]))
    }
    const make = () => {
      const s = ta.selectionStart, e = ta.selectionEnd, v = ta.value
      if (s === e) return toast(t('editor.selectFirst'), 'bad')
      const sel = v.slice(s, e)
      if (/\{\{|\}\}/.test(sel) || insideCloze(v, s) || insideCloze(v, e)) return toast(t('editor.noNest'), 'bad')
      const nums = clozeNumbers(v)
      const n = nums.length ? (same.checked ? nums[nums.length - 1] : Math.max(...nums) + 1) : 1
      ta.value = `${v.slice(0, s)}{{c${n}::${sel}}}${v.slice(e)}`
      ta.focus(); refreshPreview()
    }
    const unmake = () => {
      const pos = ta.selectionStart; const v = ta.value
      for (const m of v.matchAll(clozeRe())) {
        const st = m.index!, en = st + m[0].length
        if (pos >= st && pos <= en) { ta.value = v.slice(0, st) + m[2] + v.slice(en); ta.focus(); refreshPreview(); return }
      }
      toast(t('editor.noBlankHere'), 'bad')
    }
    ta.addEventListener('input', refreshPreview)
    fields.push(field(t('editor.clozeText'), ta, t('editor.clozeHelp')),
      h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', onClick: make }, t('editor.makeBlank')), h('button', { class: 'btn', type: 'button', onClick: unmake }, t('editor.removeBlank')),
        h('label', { class: 'check' }, same, t('editor.sameBlank'))),
      h('div', { class: 'card flat' }, h('h3', null, t('editor.clozePreview')), preview),
      field(t('editor.hint'), hint, t('editor.hintHelp')), field(t('editor.explanation'), expl), field(t('editor.source'), source))
    refreshPreview()
    collect = () => {
      if (!clozeNumbers(ta.value).length) return t('editor.needBlank')
      note.text = ta.value; return null
    }
  }

  if (type === 'occlusion' || type === 'image-id') {
    const stageBox = h('div', { class: 'stage-wrap' })
    const fileIn = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif', class: 'sr-only', id: 'img-file' })
    const pickBtn = h('label', { class: 'btn', for: 'img-file', tabindex: 0, role: 'button', onKeydown: (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileIn.click() } } }, t('editor.chooseImage'))
    const imgNote = h('div', { class: 'field-hint' }, t('editor.imageLimit', { size: fmtBytes(IMAGE_MAX_BYTES) }))
    const maskList = h('div', { class: 'stack' })
    const addMask = h('button', { class: 'btn', type: 'button', onClick: () => { editor?.addCenter() } }, t('editor.addMask'))
    const delMask = h('button', { class: 'btn danger', type: 'button', onClick: () => { editor?.removeSelected() } }, t('editor.delMask'))
    const maskTools = h('div', { class: 'row' }, addMask, delMask)
    const tip = h('p', { class: 'notice' }, t('editor.maskTip'))

    const answer = h('input', { type: 'text', maxLength: 300, value: note.answer })
    const prompt = h('input', { type: 'text', maxLength: 300, value: note.question, placeholder: t('editor.promptDefault') })
    const mode = h('select', null, h('option', { value: 'one' }, t('editor.modeOne')), h('option', { value: 'all' }, t('editor.modeAll')))
    mode.value = note.occlusionMode
    const title = h('input', { type: 'text', maxLength: 300, value: note.question, placeholder: t('editor.titlePh') })

    const currentUrl = async () => pendingUrl || (note.imageId ? await imageUrl(note.imageId) : '')

    const cardEls = new Map<string, HTMLElement>()
    // 선택 강조만 갱신한다. 목록을 다시 그리면 입력 중인 칸의 포커스가 사라지므로 구조가 바뀔 때만 다시 그린다.
    const highlight = () => { const sel = editor?.getSelected(); for (const [id, el] of cardEls) el.style.borderColor = id === sel ? '#b45309' : '' }
    const drawMaskList = () => {
      cardEls.clear()
      maskList.replaceChildren(...note.masks.map((m, i) => h('div', { class: 'card flat' },
        h('div', { class: 'row' }, h('span', { class: 'badge accent' }, t('editor.maskN', { n: i + 1 })), h('span', { class: 'spacer' }),
          h('button', { class: 'btn sm danger', type: 'button', onClick: () => editor?.remove(m.id) }, t('common.delete'))),
        h('div', { class: 'grid', style: 'margin-top:8px' },
          field(t('editor.maskAnswer'), h('input', { type: 'text', maxLength: 300, value: m.answer, onInput: (e: Event) => { m.answer = (e.target as HTMLInputElement).value }, onFocus: () => editor?.select(m.id) })),
          field(t('editor.hint'), h('input', { type: 'text', maxLength: 300, value: m.hint, onInput: (e: Event) => { m.hint = (e.target as HTMLInputElement).value } }))))))
      if (!note.masks.length) maskList.append(h('p', { class: 'muted' }, t('editor.noMask')))
      maskList.querySelectorAll<HTMLElement>('.card.flat').forEach((el, i) => cardEls.set(note.masks[i].id, el))
      highlight()
    }

    const mountEditor = async () => {
      stageBox.replaceChildren()
      const url = await currentUrl()
      if (!url) { stageBox.append(h('p', { class: 'muted' }, t('editor.noImage'))); return }
      if (type === 'occlusion') {
        editor = new RectEditor({
          url, variant: 'mask', alt: t('editor.imageAlt'), maskLabel: (i) => t('editor.maskN', { n: i + 1 }),
          rects: note.masks.map((m) => ({ id: m.id, x: m.x, y: m.y, w: m.w, h: m.h })),
          onChange: (rects) => {
            const old = new Map(note.masks.map((m) => [m.id, m]))
            note.masks = rects.map((r) => ({ id: r.id, x: r.x, y: r.y, w: r.w, h: r.h, answer: old.get(r.id)?.answer ?? '', hint: old.get(r.id)?.hint ?? '' } as Mask))
            if (note.masks.length !== old.size || note.masks.some((m) => !old.has(m.id))) drawMaskList()
          },
          onSelect: () => highlight(),
        })
        stageBox.append(editor.el)
      } else {
        stageBox.append(h('div', { class: 'stage' }, h('img', { src: url, alt: t('editor.imageAlt') })))
      }
      drawMaskList()
    }

    fileIn.addEventListener('change', async () => {
      const f = fileIn.files?.[0]; fileIn.value = ''
      if (!f) return
      const err = await validateImage(f)
      if (err) return toast(t(`editor.img.${err}`, { size: fmtBytes(IMAGE_MAX_BYTES) }), 'bad')
      try {
        const norm = await normalizeForStorage(f)
        if (pendingUrl) URL.revokeObjectURL(pendingUrl)
        pendingBlob = norm; pendingUrl = URL.createObjectURL(norm)
        if (type === 'occlusion' && note.masks.length && original?.imageId) toast(t('editor.imageReplaced'))
        await mountEditor()
      } catch { toast(t('editor.img.decode'), 'bad') }
    })

    if (type === 'occlusion') {
      fields.push(field(t('editor.titleLabel'), title), h('div', null, pickBtn, fileIn, imgNote), tip, maskTools, stageBox, h('h3', null, t('editor.masks')), maskList,
        field(t('editor.modeLabel'), mode, t('editor.modeHelp')), field(t('editor.explanation'), expl), field(t('editor.source'), source))
      collect = () => {
        if (!pendingBlob && !note.imageId) return t('editor.needImage')
        if (!note.masks.length) return t('editor.needMask')
        if (note.masks.some((m) => !m.answer.trim())) return t('editor.needMaskAnswer')
        note.question = title.value.trim(); note.occlusionMode = mode.value as 'one' | 'all'
        note.masks = note.masks.map((m) => ({ ...m, answer: m.answer.trim(), hint: m.hint.trim() }))
        return null
      }
    } else {
      fields.push(h('div', null, pickBtn, fileIn, imgNote), stageBox, field(t('editor.idPrompt'), prompt, t('editor.idPromptHelp')), field(t('editor.idAnswer'), answer),
        field(t('editor.hint'), hint, t('editor.hintHelp')), field(t('editor.explanation'), expl), field(t('editor.source'), source))
      collect = () => {
        if (!pendingBlob && !note.imageId) return t('editor.needImage')
        if (!answer.value.trim()) return t('editor.needIdAnswer')
        note.answer = answer.value.trim(); note.question = prompt.value.trim()
        return null
      }
    }
    await mountEditor()
  }

  // ── 저장 ──
  let saving = false
  const save = async (again: boolean) => {
    if (saving) return
    const err = collect()
    if (err) { toast(err, 'bad'); return }
    note.hint = hint.value.trim(); note.explanation = expl.value.trim(); note.source = source.value.trim()
    // 기존 카드가 사라지면 확인
    if (original) {
      const keep = new Set(desiredCards(note).map((c) => `${c.kind}:${c.key}`))
      const lost = desiredCards(original).filter((c) => !keep.has(`${c.kind}:${c.key}`)).length
      if (lost && !(await confirmDialog({ title: t('editor.lostTitle'), message: t('editor.lostMsg', { n: lost }), confirm: t('common.save'), danger: true }))) return
    }
    saving = true
    try {
      if (deckSel.value === NEW) {
        if (!newDeckName.value.trim()) { toast(t('editor.needDeckName'), 'bad'); newDeckName.focus(); return }
        note.deckId = (await createDeck(newDeckName.value)).id
      } else note.deckId = deckSel.value
      if (pendingBlob) { note.imageId = (await saveImage(pendingBlob, 'image.jpg')).id }
      await saveNote(note)
      toast(t('editor.saved'), 'good')
      if (again && !original) { const target = `/create/${type}?deck=${note.deckId}`; if (location.hash === `#${target}`) refresh(); else go(target); return }
      go(`/deck/${note.deckId}`)
    } catch (e) {
      console.error(e); toast(t('editor.saveFail'), 'bad')
    } finally { saving = false }
  }

  root.append(h('div', { class: 'page-head' }, h('div', null, h('h1', null, original ? t('editor.editTitle', { type: t(`type.${type}`) }) : t('editor.newTitle', { type: t(`type.${type}`) })))),
    h('form', { class: 'card stack', onSubmit: (e: Event) => { e.preventDefault(); void save(false) }, onKeydown: (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); void save(false) } } },
      field(t('editor.deck'), deckSel), newDeckBox, ...fields,
      h('div', { class: 'row' },
        h('button', { class: 'btn primary', type: 'submit' }, t('common.save')),
        !original && type !== 'occlusion' && type !== 'image-id' ? h('button', { class: 'btn', type: 'button', onClick: () => void save(true) }, t('editor.saveAgain')) : null,
        h('a', { class: 'btn ghost', href: original ? `#/deck/${original.deckId}` : '#/create' }, t('common.cancel')),
        h('span', { class: 'spacer' }),
        original ? h('button', { class: 'btn danger', type: 'button', onClick: async () => {
          if (!(await confirmDialog({ title: t('deck.delNote'), message: t('deck.delNoteMsg'), confirm: t('common.delete'), danger: true }))) return
          await deleteNote(original.id); toast(t('common.deleted')); go(`/deck/${original.deckId}`)
        } }, t('common.delete')) : null)))
  return () => { if (pendingUrl) URL.revokeObjectURL(pendingUrl) }
}

function insideCloze(v: string, pos: number): boolean {
  for (const m of v.matchAll(clozeRe())) { const st = m.index!; if (pos > st && pos < st + m[0].length) return true }
  return false
}
