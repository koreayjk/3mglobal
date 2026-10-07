import { h } from '../util'
import { t } from '../i18n'

let toastBox: HTMLElement | null = null
export function toast(msg: string, kind: '' | 'bad' | 'good' = '') {
  if (!toastBox) { toastBox = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' }); document.body.appendChild(toastBox) }
  const el = h('div', { class: `toast ${kind}` }, msg)
  toastBox.appendChild(el)
  setTimeout(() => el.remove(), kind === 'bad' ? 6000 : 3200)
}

export interface Dlg { dlg: HTMLDialogElement; close: (v?: string) => void }
/** 접근성을 갖춘 모달 (네이티브 <dialog>: 포커스 트랩·ESC 지원) */
export function openDialog(title: string, body: Node, opts: { wide?: boolean; onClose?: (v: string) => void } = {}): Dlg {
  const titleId = `dlg-${Math.random().toString(36).slice(2, 8)}`
  const dlg = h('dialog', { class: opts.wide ? 'wide' : '', 'aria-labelledby': titleId }, h('div', { class: 'dlg-in' }, h('h2', { id: titleId }, title), body))
  document.body.appendChild(dlg)
  dlg.addEventListener('close', () => { opts.onClose?.(dlg.returnValue); dlg.remove() })
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close('cancel') })
  dlg.showModal()
  return { dlg, close: (v = 'ok') => dlg.close(v) }
}

export function confirmDialog(o: { title: string; message: string; confirm?: string; danger?: boolean }): Promise<boolean> {
  return new Promise((resolve) => {
    let result = false
    const ok = h('button', { class: `btn ${o.danger ? 'danger solid' : 'primary'}`, type: 'button' }, o.confirm || t('common.ok'))
    const cancel = h('button', { class: 'btn', type: 'button' }, t('common.cancel'))
    const body = h('div', null, h('p', null, o.message), h('div', { class: 'dlg-actions' }, cancel, ok))
    const d = openDialog(o.title, body, { onClose: () => resolve(result) })
    cancel.addEventListener('click', () => d.close('cancel'))
    ok.addEventListener('click', () => { result = true; d.close('ok') })
    cancel.focus()
  })
}

export function field(label: string, control: HTMLElement, hint?: string): HTMLElement {
  return h('label', { class: 'field' }, h('span', { class: 'lbl' }, label), control, hint ? h('div', { class: 'field-hint' }, hint) : null)
}
export const btn = (label: string, onClick: (e: Event) => void, cls = '', attrs: Record<string, unknown> = {}) =>
  h('button', { type: 'button', class: `btn ${cls}`, onClick, ...attrs }, label)

export const ICONS: Record<string, string> = {
  today: 'M8 2v3M16 2v3M3 9h18M5 4h14a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM8 14l2.5 2.5L16 12',
  library: 'M4 4h6v16H4zM12 4h4l4 16h-4zM4 8h6',
  create: 'M12 5v14M5 12h14',
  history: 'M3 12a9 9 0 1 0 3-6.7M3 4v5h5M12 7v5l3 2',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
}
export function icon(name: string): SVGElement {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor')
  s.setAttribute('stroke-width', '2'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round'); s.setAttribute('aria-hidden', 'true')
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', ICONS[name] || ''); s.appendChild(p)
  return s
}
