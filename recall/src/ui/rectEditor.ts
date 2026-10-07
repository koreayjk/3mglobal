// 이미지 위의 사각형을 만들고 이동·크기 조절·삭제하는 편집기. 가림 영역 편집과 자르기에 함께 쓴다.
// 좌표는 항상 이미지 기준 0~1 정규화 값이므로 화면 크기·회전과 무관하다.
import { clamp, h, uid } from '../util'

export interface Rect { id: string; x: number; y: number; w: number; h: number }
export type Corner = 'nw' | 'ne' | 'sw' | 'se'
const MIN = 0.03

export function normalizeRect(r: Rect): Rect {
  const w = clamp(r.w, MIN, 1), hh = clamp(r.h, MIN, 1)
  return { id: r.id, w, h: hh, x: clamp(r.x, 0, 1 - w), y: clamp(r.y, 0, 1 - hh) }
}

/** 코너 핸들 드래그에 따른 새 사각형 (반대쪽 모서리 고정) */
export function resizeRect(r: Rect, corner: Corner, px: number, py: number): Rect {
  const right = r.x + r.w, bottom = r.y + r.h
  let x1 = r.x, y1 = r.y, x2 = right, y2 = bottom
  if (corner === 'nw' || corner === 'sw') x1 = clamp(px, 0, right - MIN); else x2 = clamp(px, r.x + MIN, 1)
  if (corner === 'nw' || corner === 'ne') y1 = clamp(py, 0, bottom - MIN); else y2 = clamp(py, r.y + MIN, 1)
  return { id: r.id, x: x1, y: y1, w: x2 - x1, h: y2 - y1 }
}

export interface RectEditorOpts {
  url: string
  rects: Rect[]
  variant: 'mask' | 'crop'
  alt: string
  maskLabel?: (index: number) => string
  onChange?: (rects: Rect[]) => void
  onSelect?: (id: string | null) => void
}

export class RectEditor {
  el: HTMLElement
  private stage: HTMLElement
  private rects: Rect[]
  private selected: string | null = null
  private els = new Map<string, HTMLElement>()
  private drag: { mode: 'move' | 'resize' | 'draw'; id: string; corner?: Corner; sx: number; sy: number; orig: Rect } | null = null

  constructor(private o: RectEditorOpts) {
    this.rects = o.rects.map((r) => ({ ...r }))
    const img = h('img', { src: o.url, alt: o.alt, draggable: false })
    this.stage = h('div', { class: 'stage editor-stage' }, img)
    this.el = h('div', { class: 'stage-wrap' }, this.stage)
    const s = this.stage
    s.addEventListener('pointerdown', (e) => this.down(e))
    s.addEventListener('pointermove', (e) => this.move(e))
    s.addEventListener('pointerup', (e) => this.up(e))
    s.addEventListener('pointercancel', (e) => this.up(e))
    if (o.variant === 'crop' && !this.rects.length) this.rects = [{ id: 'crop', x: 0.05, y: 0.05, w: 0.9, h: 0.9 }]
    if (o.variant === 'crop') this.selected = 'crop'
    this.renderAll()
  }

  getRects(): Rect[] { return this.rects.map((r) => ({ ...r })) }
  getSelected(): string | null { return this.selected }

  private pt(e: PointerEvent) {
    const b = this.stage.getBoundingClientRect()
    return { x: clamp((e.clientX - b.left) / b.width, 0, 1), y: clamp((e.clientY - b.top) / b.height, 0, 1) }
  }
  private emit() { this.o.onChange?.(this.getRects()) }

  select(id: string | null) {
    this.selected = id
    this.renderAll()
    this.o.onSelect?.(id)
  }
  setRects(rects: Rect[]) { this.rects = rects.map((r) => ({ ...r })); if (this.selected && !this.rects.some((r) => r.id === this.selected)) this.selected = null; this.renderAll() }
  addCenter(): string {
    const r = { id: uid(), x: 0.35, y: 0.4, w: 0.3, h: 0.2 }
    this.rects.push(r); this.selected = r.id; this.renderAll(); this.emit(); this.o.onSelect?.(r.id)
    return r.id
  }
  removeSelected() { if (this.selected) this.remove(this.selected) }
  remove(id: string) {
    this.rects = this.rects.filter((r) => r.id !== id)
    if (this.selected === id) this.selected = null
    this.renderAll(); this.emit(); this.o.onSelect?.(this.selected)
  }

  private down(e: PointerEvent) {
    const target = e.target as HTMLElement
    const p = this.pt(e)
    const handle = target.closest<HTMLElement>('[data-corner]')
    const maskEl = target.closest<HTMLElement>('[data-id]')
    if (handle && maskEl) {
      const r = this.rects.find((x) => x.id === maskEl.dataset.id)!
      this.drag = { mode: 'resize', id: r.id, corner: handle.dataset.corner as Corner, sx: p.x, sy: p.y, orig: { ...r } }
    } else if (maskEl) {
      const r = this.rects.find((x) => x.id === maskEl.dataset.id)!
      if (this.selected !== r.id) { this.selected = r.id; this.o.onSelect?.(r.id); this.updateSelection() }
      this.drag = { mode: 'move', id: r.id, sx: p.x, sy: p.y, orig: { ...r } }
    } else if (this.o.variant === 'mask') {
      const r: Rect = { id: uid(), x: p.x, y: p.y, w: 0, h: 0 }
      this.rects.push(r); this.selected = r.id
      this.drag = { mode: 'draw', id: r.id, sx: p.x, sy: p.y, orig: { ...r } }
      this.renderAll()
    } else return
    this.stage.setPointerCapture(e.pointerId)
    e.preventDefault()
  }

  private move(e: PointerEvent) {
    const d = this.drag
    if (!d) return
    const p = this.pt(e)
    const i = this.rects.findIndex((r) => r.id === d.id)
    if (i < 0) return
    let r = this.rects[i]
    if (d.mode === 'move') {
      r = normalizeRect({ ...d.orig, x: d.orig.x + (p.x - d.sx), y: d.orig.y + (p.y - d.sy) })
    } else if (d.mode === 'resize') {
      r = resizeRect(d.orig, d.corner!, p.x, p.y)
    } else {
      r = { id: d.id, x: Math.min(d.sx, p.x), y: Math.min(d.sy, p.y), w: Math.abs(p.x - d.sx), h: Math.abs(p.y - d.sy) }
    }
    this.rects[i] = r
    this.place(r)
  }

  private up(e: PointerEvent) {
    const d = this.drag
    if (!d) return
    this.drag = null
    try { this.stage.releasePointerCapture(e.pointerId) } catch { /* 이미 해제됨 */ }
    if (d.mode === 'draw') {
      const i = this.rects.findIndex((r) => r.id === d.id)
      const r = this.rects[i]
      if (r.w < 0.02 || r.h < 0.02) { // 너무 작으면(단순 탭) 취소
        this.rects.splice(i, 1); this.selected = null; this.renderAll(); this.o.onSelect?.(null); return
      }
      this.rects[i] = normalizeRect(r)
      this.renderAll(); this.o.onSelect?.(d.id)
    }
    this.emit()
  }

  private place(r: Rect) {
    const el = this.els.get(r.id)
    if (!el) return
    el.style.left = `${r.x * 100}%`; el.style.top = `${r.y * 100}%`
    el.style.width = `${r.w * 100}%`; el.style.height = `${r.h * 100}%`
  }

  private updateSelection() {
    for (const [id, el] of this.els) {
      const sel = id === this.selected
      el.classList.toggle('sel', sel)
      el.setAttribute('aria-pressed', String(sel))
      const hs = el.querySelectorAll('.handle')
      if (sel && !hs.length) this.addHandles(el)
      if (!sel && hs.length && this.o.variant === 'mask') hs.forEach((x) => x.remove())
    }
  }
  private addHandles(el: HTMLElement) {
    for (const c of ['nw', 'ne', 'sw', 'se'] as Corner[]) el.appendChild(h('span', { class: `handle ${c}`, 'data-corner': c }))
  }

  private renderAll() {
    for (const el of this.els.values()) el.remove()
    this.els.clear()
    this.rects.forEach((r, i) => {
      const crop = this.o.variant === 'crop'
      const el = h('div', {
        class: crop ? 'crop-box' : 'mask', 'data-id': r.id, tabindex: 0, role: 'button',
        'aria-label': crop ? this.o.alt : this.o.maskLabel?.(i) || `#${i + 1}`,
        'aria-pressed': String(r.id === this.selected),
        onKeydown: (e: KeyboardEvent) => this.key(e, r.id),
      }, crop ? null : h('span', { class: 'num' }, String(i + 1)))
      if (crop) el.style.boxShadow = '0 0 0 9999px rgba(0,0,0,.5)'
      this.els.set(r.id, el)
      this.stage.appendChild(el)
      this.place(r)
    })
    this.updateSelection()
  }

  private key(e: KeyboardEvent, id: string) {
    const i = this.rects.findIndex((r) => r.id === id)
    if (i < 0) return
    const step = e.altKey ? 0.002 : 0.01
    let r = this.rects[i]
    const dx = e.key === 'ArrowRight' ? step : e.key === 'ArrowLeft' ? -step : 0
    const dy = e.key === 'ArrowDown' ? step : e.key === 'ArrowUp' ? -step : 0
    if (dx || dy) {
      r = e.shiftKey ? normalizeRect({ ...r, w: r.w + dx, h: r.h + dy }) : normalizeRect({ ...r, x: r.x + dx, y: r.y + dy })
      this.rects[i] = r; this.place(r); this.emit(); e.preventDefault()
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && this.o.variant === 'mask') {
      e.preventDefault(); this.remove(id)
    } else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.select(id) }
  }
}
