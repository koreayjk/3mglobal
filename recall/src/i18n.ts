import { en } from './locales/en'
import { ko } from './locales/ko'
import type { Lang } from './types'

const dict: Record<Lang, Record<string, string>> = { ko, en }
let current: Lang = 'ko'

export function applyLang(l: Lang) { current = l; document.documentElement.lang = l }
export const lang = (): Lang => current

/** {name} 형태의 자리표시자를 치환한다. 값은 텍스트로만 쓰이므로 HTML 로 해석되지 않는다. */
export function t(key: string, params?: Record<string, string | number>): string {
  let s = dict[current][key] ?? dict.ko[key] ?? key
  if (params) for (const [k, v] of Object.entries(params)) s = s.split(`{${k}}`).join(String(v))
  return s
}
export const has = (key: string) => key in dict[current]
export { dict }
