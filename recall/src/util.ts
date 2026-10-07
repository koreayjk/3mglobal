export const uid = (): string =>
  (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`)

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export const DAY = 86_400_000
export const startOfDay = (t: number): number => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime() }
export const endOfDay = (t: number): number => startOfDay(t) + DAY - 1

type Child = Node | string | number | null | undefined | false
type Attrs = Record<string, unknown>

/**
 * 안전한 DOM 생성 헬퍼. 문자열 자식은 항상 텍스트 노드로 들어가므로
 * 사용자 텍스트가 HTML 로 해석되지 않는다. innerHTML 은 사용하지 않는다.
 */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs?: Attrs | null, ...children: (Child | Child[])[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue
      if (k === 'class') el.className = String(v)
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener)
      else if (k === 'dataset') Object.assign(el.dataset, v as object)
      else if (k in el && k !== 'list' && k !== 'form') (el as unknown as Record<string, unknown>)[k] = v
      else el.setAttribute(k, v === true ? '' : String(v))
    }
  }
  append(el, children)
  return el
}
export function append(el: Node, children: (Child | Child[])[]) {
  for (const c of children.flat()) {
    if (c == null || c === false) continue
    el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c)
  }
}
export function clear(el: Node) { while (el.firstChild) el.removeChild(el.firstChild) }

const SVG_NS = 'http://www.w3.org/2000/svg'
export function svg(tag: string, attrs?: Attrs, ...children: (Child | Child[])[]): SVGElement {
  const el = document.createElementNS(SVG_NS, tag)
  for (const [k, v] of Object.entries(attrs || {})) if (v != null && v !== false) el.setAttribute(k, String(v))
  append(el, children)
  return el
}

export function fmtDate(t: number, lang: string): string {
  return new Date(t).toLocaleDateString(lang === 'en' ? 'en-US' : 'ko-KR', { month: 'short', day: 'numeric' })
}
export function fmtBytes(n: number): string {
  if (n < 1024) return `${n}B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)}KB`
  return `${(n / 1024 / 1024).toFixed(1)}MB`
}

export function shuffle<T>(a: T[]): T[] {
  const r = a.slice()
  for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [r[i], r[j]] = [r[j], r[i]] }
  return r
}
export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = h('a', { href: url, download: name })
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}
