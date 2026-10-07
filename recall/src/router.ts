export interface Ctx {
  root: HTMLElement
  params: Record<string, string>
  query: URLSearchParams
}
export type View = (ctx: Ctx) => Promise<void | (() => void)> | void | (() => void)
interface Route { re: RegExp; keys: string[]; view: () => Promise<{ default: View }>; shell: boolean; nav?: string }
const routes: Route[] = []

export function route(pattern: string, view: Route['view'], o: { shell?: boolean; nav?: string } = {}) {
  const keys: string[] = []
  const re = new RegExp('^' + pattern.replace(/:([a-zA-Z]+)/g, (_, k) => { keys.push(k); return '([^/]+)' }) + '/?$')
  routes.push({ re, keys, view, shell: o.shell ?? true, nav: o.nav })
}

export function parseHash(): { path: string; query: URLSearchParams } {
  const raw = location.hash.replace(/^#/, '') || '/'
  const [path, qs] = raw.split('?')
  return { path: path || '/', query: new URLSearchParams(qs || '') }
}
export function match(path: string) {
  for (const r of routes) {
    const m = r.re.exec(path)
    if (m) return { route: r, params: Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) }
  }
  return null
}
export const go = (path: string) => { location.hash = path }
export const href = (path: string) => `#${path}`
/** 현재 화면을 다시 그린다 (데이터 변경 후 사용) */
export const refresh = () => window.dispatchEvent(new HashChangeEvent('hashchange'))
