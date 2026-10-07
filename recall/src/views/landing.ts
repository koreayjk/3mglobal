import { getAll, settings } from '../db'
import { t } from '../i18n'
import { loadSamples } from '../samples'
import type { Ctx } from '../router'
import { go } from '../router'
import { toast } from '../ui/components'
import { clear, h, svg } from '../util'

// 원리 설명용 예시 모델 (실측 데이터나 개인 기억률이 아님): R = exp(-t/S), 복습 시 R=1 로 돌아가고 S 가 커진다고 가정
const S0 = 2, GROWTH = 2.4, REVIEW_DAYS = [1, 3, 7, 14, 24]
// 그래프는 실제 표시 폭(px)에 맞춰 그린다. 고정 도면을 축소하면 글자도 같이 작아지기 때문이다.
let W = 640, H = 300
const L = 52, R = 16, T = 18, B = 46, MAXD = 30

function curvePath(reviews: number[], withReviews: boolean): string {
  const pts: string[] = []
  let s = S0, startD = 0
  const marks = withReviews ? reviews : []
  for (let d = 0; d <= MAXD + 1e-9; d += 0.25) {
    // 현재 구간 갱신
    const k = marks.filter((r) => r <= d).length
    if (k > 0) { startD = marks[k - 1]; s = S0 * GROWTH ** k }
    const v = Math.exp(-(d - startD) / s)
    const x = L + (d / MAXD) * (W - L - R), y = T + (1 - v) * (H - T - B)
    pts.push(`${pts.length ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`)
    // 복습 시점의 수직 복귀를 표현
    if (marks.includes(d)) { const y0 = T; pts.push(`L${x.toFixed(1)} ${y0}`) }
  }
  return pts.join(' ')
}

export default async function view({ root }: Ctx) {
  const decks = await getAll('decks').catch(() => [])
  void settings
  root.append(
    h('div', { class: 'hero' }, h('div', { class: 'hero-in' },
      h('div', null,
        h('a', { class: 'brand', href: '#/', style: 'color:#fff;margin-bottom:24px' }, h('span', { class: 'brand-dot', style: 'background:#fff;color:#2447c8', 'aria-hidden': 'true' }, 'R'), 'Recall'),
        h('h1', null, t('land.h1a'), h('br'), t('land.h1b')),
        h('p', { class: 'lead' }, t('land.lead')),
        h('div', { class: 'row' },
          h('a', { class: 'btn light', href: '#/today' }, t('land.start')),
          h('button', { class: 'btn outline-light', type: 'button', onClick: async (e: Event) => {
            const b = e.currentTarget as HTMLButtonElement; b.disabled = true
            try { if (!decks.length) await loadSamples(); go('/review?mode=free&limit=8&sched=0') } catch (err) { console.error(err); toast(t('common.error'), 'bad'); b.disabled = false }
          } }, t('land.try')),
          decks.length ? h('a', { class: 'btn outline-light', href: '#/today' }, t('land.open')) : null),
        h('p', { style: 'margin-top:16px;opacity:.85;font-size:.9rem' }, t('land.tryNote'))),
      h('div', { class: 'hero-art', 'aria-hidden': 'true' },
        h('div', { class: 'mini-card' }, h('small', null, t('land.miniWord')), h('div', { style: 'font-size:1.4rem;font-weight:700' }, 'meticulous'), h('div', { class: 'muted' }, '꼼꼼한, 세심한')),
        h('div', { class: 'mini-card' }, h('small', null, t('land.miniImage')), miniMask()),
        h('div', { class: 'mini-card' }, h('small', null, t('land.miniCode')), h('div', { style: 'font-family:var(--mono);font-size:.95rem' }, 'q.push(3); q.push(5);'), h('div', { style: 'font-family:var(--mono)' }, h('span', { class: 'blank' }, '[…]'), '();  // 3 제거'))))),

    h('section', { class: 'land-sec', 'aria-labelledby': 'use-h' }, h('h2', { id: 'use-h' }, t('land.useTitle')), h('p', { class: 'muted' }, t('land.useSub')),
      h('div', { class: 'grid cols-3' }, [
        ['dk1', t('land.use.word'), 'abundant', '풍부한, 넘치는'],
        ['dk2', t('land.use.bio'), t('land.use.bioQ'), t('land.use.bioA')],
        ['dk4', t('land.use.history'), t('land.use.historyQ'), t('land.use.historyA')],
        ['dk3', t('land.use.formula'), t('land.use.formulaQ'), t('land.use.formulaA')],
        ['dk0', t('land.use.code'), t('land.use.codeQ'), t('land.use.codeA')],
        ['dk5', t('land.use.your'), t('land.use.yourQ'), t('land.use.yourA')],
      ].map(([cls, tag, q, a]) => h('div', { class: `use-card ${cls}` }, h('span', { class: 'tag' }, tag), h('div', { class: 'q' }, q), h('div', { class: 'a' }, a))))),

    h('section', { class: 'land-sec', 'aria-labelledby': 'how-h' }, h('h2', { id: 'how-h' }, t('land.howTitle')),
      h('div', { class: 'grid cols-3' }, [1, 2, 3].map((n) => h('div', { class: 'card' }, h('span', { class: 'badge accent' }, `STEP ${n}`), h('h3', { style: 'margin-top:8px' }, t(`land.how${n}t`)), h('p', { class: 'muted', style: 'margin:0' }, t(`land.how${n}d`)))))),

    curveSection(),

    h('section', { class: 'land-sec', 'aria-labelledby': 'free-h' }, h('h2', { id: 'free-h' }, t('land.freeTitle')),
      h('div', { class: 'card' }, h('ul', { style: 'margin:0;padding-left:1.2em' }, [1, 2, 3, 4, 5].map((n) => h('li', null, t(`land.free${n}`)))),
        h('div', { class: 'row', style: 'margin-top:16px' }, h('a', { class: 'btn primary', href: '#/today' }, t('land.start'))))),
    h('div', { class: 'land-foot' }, h('p', null, t('land.foot')), h('p', null, h('a', { href: '#/settings' }, t('nav.settings')))),
  )
}

function miniMask(): HTMLElement {
  const box = h('div', { class: 'stage', style: 'display:block;max-width:240px' })
  box.append(svg('svg', { viewBox: '0 0 240 110', width: '100%', role: 'img', 'aria-label': '' },
    svg('rect', { width: 240, height: 110, fill: '#dff5e6' }),
    svg('circle', { cx: 60, cy: 55, r: 26, fill: '#fff', stroke: '#1b6a3a', 'stroke-width': 4 }),
    svg('circle', { cx: 120, cy: 55, r: 26, fill: '#52b788', stroke: '#1b6a3a', 'stroke-width': 4 }),
    svg('circle', { cx: 180, cy: 55, r: 26, fill: '#fff', stroke: '#1b6a3a', 'stroke-width': 4 }),
    svg('rect', { x: 94, y: 40, width: 52, height: 30, rx: 4, fill: '#2447c8', stroke: '#fff', 'stroke-width': 2 }),
    svg('text', { x: 120, y: 62, 'text-anchor': 'middle', fill: '#fff', 'font-size': 20, 'font-weight': 800 }, '?')))
  return box
}

function curveSection(): HTMLElement {
  let n = 0
  const svgEl = svg('svg', { role: 'img', 'aria-labelledby': 'curve-title curve-desc' })
  const live = h('p', { class: 'small', 'aria-live': 'polite', style: 'min-height:2.8em' })
  const btn = h('button', { class: 'btn primary', type: 'button' }, '')
  const reset = h('button', { class: 'btn', type: 'button' }, t('land.curve.reset'))
  const draw = () => {
    clear(svgEl)
    svgEl.setAttribute('viewBox', `0 0 ${W} ${H}`)
    const rv = REVIEW_DAYS.slice(0, n)
    svgEl.append(svg('title', { id: 'curve-title' }, t('land.curve.title')), svg('desc', { id: 'curve-desc' }, t('land.curve.desc')))
    for (let i = 0; i <= 4; i++) svgEl.append(svg('line', { class: 'grid-l', x1: L, x2: W - R, y1: T + (i * (H - T - B)) / 4, y2: T + (i * (H - T - B)) / 4 }))
    svgEl.append(svg('line', { class: 'axis', x1: L, x2: L, y1: T, y2: H - B }), svg('line', { class: 'axis', x1: L, x2: W - R, y1: H - B, y2: H - B }))
    for (const d of [0, 7, 14, 21, 28]) {
      const x = L + (d / MAXD) * (W - L - R)
      svgEl.append(svg('line', { class: 'axis', x1: x, x2: x, y1: H - B, y2: H - B + 5 }), svg('text', { x, y: H - B + 20, 'text-anchor': 'middle' }, String(d)))
    }
    svgEl.append(svg('text', { x: (L + W - R) / 2, y: H - 6, 'text-anchor': 'middle' }, t('land.curve.x')),
      svg('text', { x: L - 8, y: T + 10, 'text-anchor': 'end' }, t('land.curve.high')), svg('text', { x: L - 8, y: H - B, 'text-anchor': 'end' }, t('land.curve.low')))
    svgEl.append(svg('path', { class: 'curve-base', d: curvePath([], false) }))
    if (n > 0) {
      svgEl.append(svg('path', { class: 'curve-rev', d: curvePath(rv, true) }))
      for (const d of rv) { const x = L + (d / MAXD) * (W - L - R); svgEl.append(svg('circle', { class: 'mark', cx: x, cy: T, r: 6 }), svg('text', { x, y: T + 22, 'text-anchor': 'middle' }, String(d))) }
    }
    btn.textContent = n >= REVIEW_DAYS.length ? t('land.curve.max') : t('land.curve.add', { day: REVIEW_DAYS[n] })
    ;(btn as HTMLButtonElement).disabled = n >= REVIEW_DAYS.length
    live.textContent = n === 0 ? t('land.curve.live0') : t('land.curve.liveN', { n })
  }
  const fit = (w: number) => { W = Math.max(260, Math.round(w)); H = Math.max(220, Math.min(320, Math.round(W * 0.55))); draw() }
  new ResizeObserver((es) => { const w = es[0].contentRect.width; if (w > 0 && Math.abs(w - W) >= 4) fit(w) }).observe(svgEl as unknown as Element)
  btn.addEventListener('click', () => { if (n < REVIEW_DAYS.length) { n++; draw() } })
  reset.addEventListener('click', () => { n = 0; draw() })
  draw()
  return h('section', { class: 'land-sec', 'aria-labelledby': 'curve-h' }, h('h2', { id: 'curve-h' }, t('land.curveTitle')), h('p', { class: 'muted' }, t('land.curveSub')),
    h('div', { class: 'curve-box' }, svgEl,
      h('div', { class: 'legend' }, h('span', null, h('i', { style: 'border-color:#b42318;border-top-style:dashed' }), t('land.curve.legendBase')), h('span', null, h('i', { style: 'border-color:#2447c8' }), t('land.curve.legendRev'))),
      h('div', { class: 'row' }, btn, reset), live,
      h('p', { class: 'disclaimer' }, t('land.curve.disclaimer'))))
}
