import { t } from '../i18n'
import type { Ctx } from '../router'
import { h } from '../util'

export default function view({ query, root }: Ctx) {
  const deck = query.get('deck')
  const q = deck ? `?deck=${deck}` : ''
  const items: [string, string, string, string][] = [
    ['qa', '❓', t('type.qa'), t('create.qaDesc')],
    ['cloze', '✂️', t('type.cloze'), t('create.clozeDesc')],
    ['occlusion', '🖼️', t('type.occlusion'), t('create.occlusionDesc')],
    ['image-id', '🔍', t('type.image-id'), t('create.imageIdDesc')],
  ]
  root.append(h('div', { class: 'page-head' }, h('div', null, h('h1', null, t('create.title')), h('p', { class: 'sub' }, t('create.sub')))),
    h('div', { class: 'grid cols-3' }, items.map(([type, ico, title, desc]) =>
      h('a', { class: 'type-card', href: `#/create/${type}${q}` }, h('span', { class: 'ico', 'aria-hidden': 'true' }, ico), h('h3', null, title), h('p', null, desc)))),
    h('h2', { style: 'margin-top:28px' }, t('create.more')),
    h('div', { class: 'grid cols-3' },
      h('a', { class: 'type-card', href: `#/create/ai${q}` }, h('span', { class: 'ico', 'aria-hidden': 'true' }, '📷'), h('h3', null, t('create.ai')), h('p', null, t('create.aiDesc'))),
      h('a', { class: 'type-card', href: `#/create/csv${q}` }, h('span', { class: 'ico', 'aria-hidden': 'true' }, '📄'), h('h3', null, t('create.csv')), h('p', null, t('create.csvDesc')))))
}
