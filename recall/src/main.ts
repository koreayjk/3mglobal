import './styles.css'
import { registerSW } from 'virtual:pwa-register'
import { loadSettings, settings } from './db'
import { applyLang, t } from './i18n'
import { match, parseHash, route, type View } from './router'
import { btn, icon } from './ui/components'
import { clear, h } from './util'

function applyMotion() {
  document.documentElement.dataset.motion = settings().motion === 'system' ? '' : settings().motion
}
export function applyPrefs() { applyLang(settings().lang); applyMotion() }

route('/', () => import('./views/landing'), { shell: false })
route('/today', () => import('./views/today'), { nav: 'today' })
route('/library', () => import('./views/library'), { nav: 'library' })
route('/deck/:id', () => import('./views/deck'), { nav: 'library' })
route('/create', () => import('./views/create'), { nav: 'create' })
route('/create/ai', () => import('./views/aiImport'), { nav: 'create' })
route('/create/csv', () => import('./views/importCsv'), { nav: 'create' })
route('/create/:type', () => import('./views/editor'), { nav: 'create' })
route('/note/:id', () => import('./views/editor'), { nav: 'library' })
route('/review', () => import('./views/review'), { nav: 'today' })
route('/history', () => import('./views/history'), { nav: 'history' })
route('/settings', () => import('./views/settings'), { nav: 'history' })

const NAV = [
  { id: 'today', path: '/today', key: 'nav.today' },
  { id: 'library', path: '/library', key: 'nav.library' },
  { id: 'create', path: '/create', key: 'nav.create' },
  { id: 'history', path: '/history', key: 'nav.history' },
]

let cleanup: (() => void) | null = null
let seq = 0

async function render() {
  const my = ++seq
  cleanup?.(); cleanup = null
  const { path, query } = parseHash()
  const app = document.getElementById('app')!
  clear(app)
  const m = match(path)
  if (!m) { location.hash = '/'; return }
  document.title = 'Recall'
  let root: HTMLElement
  if (m.route.shell) {
    root = h('main', { id: 'main', tabindex: -1 })
    const nav = (cls: string, withIcon: boolean) => h('nav', { class: cls, 'aria-label': t('nav.label') },
      NAV.map((n) => h('a', { href: `#${n.path}`, 'aria-current': m.route.nav === n.id ? 'page' : null }, withIcon ? icon(n.id) : null, t(n.key))))
    app.append(
      h('a', { class: 'skip', href: '#main', onClick: (e: Event) => { e.preventDefault(); root.focus() } }, t('common.skip')),
      h('div', { class: 'shell' },
        h('header', { class: 'topbar' }, h('div', { class: 'topbar-in' },
          h('a', { class: 'brand', href: '#/' }, h('span', { class: 'brand-dot', 'aria-hidden': 'true' }, 'R'), 'Recall'),
          nav('nav', false), h('span', { class: 'spacer' }),
          h('a', { class: 'btn ghost icon-btn', href: '#/settings', 'aria-label': t('nav.settings'), title: t('nav.settings') }, icon('settings')))),
        root),
      nav('tabbar', true),
    )
  } else { root = h('main', { id: 'main', class: 'landing', tabindex: -1 }); app.append(root) }
  try {
    const mod = await m.route.view()
    if (my !== seq) return
    const c = await (mod.default as View)({ root, params: m.params, query })
    if (my !== seq) { if (typeof c === 'function') c(); return }
    if (typeof c === 'function') cleanup = c
    if (m.route.shell) { window.scrollTo(0, 0) }
  } catch (e) {
    console.error(e)
    clear(root)
    root.append(h('div', { class: 'card' }, h('h2', null, t('common.error')), h('p', { class: 'muted' }, String((e as Error).message || e)),
      btn(t('common.reload'), () => location.reload(), 'primary')))
  }
}

async function boot() {
  try { await loadSettings() } catch { /* DB 열기 실패는 각 화면에서 안내 */ }
  applyPrefs()
  window.addEventListener('hashchange', render)
  window.addEventListener('recall:prefs', () => { applyPrefs(); render() })
  await render()
  registerSW({ immediate: true })
}
void boot()
