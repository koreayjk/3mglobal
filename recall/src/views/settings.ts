import { buildBackup, importBackup, validateBackup, type BackupCheck, type ImportMode } from '../backup'
import { clearAll, loadSettings, persistStorage, saveSettings, settings } from '../db'
import { t, lang } from '../i18n'
import { fetchHealth } from '../ai/client'
import { loadSamples } from '../samples'
import { refresh, type Ctx } from '../router'
import { confirmDialog, field, toast } from '../ui/components'
import { downloadBlob, fmtBytes, h } from '../util'
import type { Lang } from '../types'

const prefsChanged = () => window.dispatchEvent(new Event('recall:prefs'))

export default async function view({ root }: Ctx) {
  const s = settings()
  root.append(h('div', { class: 'page-head' }, h('div', null, h('h1', null, t('set.title')))))

  // 표시
  const langSeg = h('div', { class: 'seg', role: 'group', 'aria-label': t('set.language') }, (['ko', 'en'] as Lang[]).map((l) =>
    h('button', { type: 'button', 'aria-pressed': String(s.lang === l), onClick: async () => { await saveSettings({ lang: l }); prefsChanged() } }, l === 'ko' ? '한국어' : 'English')))
  const motion = h('select', { onChange: async (e: Event) => { await saveSettings({ motion: (e.target as HTMLSelectElement).value as 'system' }); prefsChanged() } },
    ['system', 'reduce', 'full'].map((m) => h('option', { value: m }, t(`set.motion.${m}`))))
  motion.value = s.motion
  const perDay = h('input', { type: 'number', min: 0, max: 500, value: s.newPerDay, onChange: async (e: Event) => { const v = Math.max(0, Math.min(500, Math.floor(Number((e.target as HTMLInputElement).value) || 0))); (e.target as HTMLInputElement).value = String(v); await saveSettings({ newPerDay: v }); toast(t('set.saved')) } })
  root.append(h('section', { class: 'card stack' }, h('h2', null, t('set.display')), field(t('set.language'), langSeg), field(t('set.motion'), motion, t('set.motionHelp')), field(t('set.newPerDay'), perDay, t('set.newPerDayHelp'))))

  // 데이터
  const storageInfo = h('p', { class: 'small muted' })
  const refreshStorage = async () => {
    try {
      const est = await navigator.storage?.estimate?.(); const persisted = await navigator.storage?.persisted?.()
      storageInfo.textContent = `${t('set.storageUsed', { size: fmtBytes(est?.usage || 0) })} · ${persisted ? t('set.persisted') : t('set.notPersisted')}`
    } catch { storageInfo.textContent = '' }
  }
  void refreshStorage()
  const importBox = h('div', { class: 'stack' })
  const fileIn = h('input', { type: 'file', accept: '.json,application/json', 'aria-label': t('set.importFile') })
  let busy = false
  fileIn.addEventListener('change', async () => {
    const f = fileIn.files?.[0]; fileIn.value = ''
    importBox.replaceChildren()
    if (!f) return
    let check: BackupCheck
    try { check = validateBackup(JSON.parse(await f.text())) } catch { check = { ok: false, errors: [t('set.notJson')] } }
    if (!check.ok) { importBox.append(h('div', { class: 'notice bad' }, h('strong', null, t('set.importInvalid')), h('ul', null, check.errors.map((e) => h('li', null, e))))); return }
    const c = check.counts!
    let mode: ImportMode = 'merge'
    const radios = (['merge', 'replace'] as ImportMode[]).map((m) => h('label', { class: 'check' }, h('input', { type: 'radio', name: 'imode', value: m, checked: m === 'merge', onChange: () => { mode = m } }), t(`set.mode.${m}`)))
    const go = h('button', { class: 'btn primary', type: 'button' }, t('set.importRun'))
    go.addEventListener('click', async () => {
      if (busy) return
      if (mode === 'replace' && !(await confirmDialog({ title: t('set.replaceTitle'), message: t('set.replaceMsg'), confirm: t('set.replaceDo'), danger: true }))) return
      busy = true; go.setAttribute('disabled', '')
      try { await importBackup(check.data!, mode); await loadSettings(); toast(t('set.imported'), 'good'); importBox.replaceChildren(); prefsChanged() }
      catch (e) { console.error(e); toast(t('set.importFail'), 'bad') } finally { busy = false; go.removeAttribute('disabled') }
    })
    importBox.append(h('div', { class: 'notice good' }, t('set.importOk', { decks: c.decks, notes: c.notes, cards: c.cards, logs: c.logs, images: c.images })), h('div', { class: 'stack' }, ...radios), go)
  })
  root.append(h('section', { class: 'card stack', style: 'margin-top:16px' }, h('h2', null, t('set.data')),
    h('div', { class: 'notice warn' }, t('set.localWarn')), storageInfo,
    h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', onClick: async () => { await persistStorage(); await refreshStorage() } }, t('set.persist'))),
    h('h3', null, t('set.backup')), h('p', { class: 'small muted' }, t('set.backupHelp')),
    h('div', { class: 'row' }, h('button', { class: 'btn primary', type: 'button', onClick: async (e: Event) => {
      const b = e.currentTarget as HTMLButtonElement; b.disabled = true
      try { const bk = await buildBackup(); downloadBlob(new Blob([JSON.stringify(bk)], { type: 'application/json' }), `recall-backup-${new Date().toISOString().slice(0, 10)}.json`); toast(t('set.exported'), 'good') }
      catch (err) { console.error(err); toast(t('set.exportFail'), 'bad') } finally { b.disabled = false }
    } }, t('set.export')), h('a', { class: 'btn', href: '#/create/csv' }, t('create.csv'))),
    h('h3', null, t('set.restore')), field(t('set.importFile'), fileIn), importBox,
    h('h3', null, t('set.samples')),
    h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', onClick: async () => {
      if (settings().samplesLoaded && !(await confirmDialog({ title: t('set.samples'), message: t('set.samplesAgain') }))) return
      try { await loadSamples(); toast(t('samples.loaded'), 'good'); refresh() } catch (e) { console.error(e); toast(t('set.importFail'), 'bad') }
    } }, t('samples.load'))),
    h('h3', null, t('set.danger')),
    h('div', { class: 'row' }, h('button', { class: 'btn danger', type: 'button', onClick: async () => {
      if (!(await confirmDialog({ title: t('set.wipeTitle'), message: t('set.wipeMsg'), confirm: t('set.wipeDo'), danger: true }))) return
      await clearAll(); await loadSettings(); await saveSettings({ lang: lang() }); toast(t('common.deleted')); location.hash = '/today'; prefsChanged()
    } }, t('set.wipe')))))

  // AI
  const aiBox = h('section', { class: 'card stack', style: 'margin-top:16px' }, h('h2', null, t('set.ai')), h('p', { class: 'muted' }, t('set.aiChecking')))
  root.append(aiBox)
  void fetchHealth().then((hl) => {
    aiBox.replaceChildren(h('h2', null, t('set.ai')))
    if (!hl || !hl.aiEnabled) aiBox.append(h('div', { class: 'notice' }, hl ? t('set.aiOff') : t('set.aiUnreach')))
    else {
      aiBox.append(h('div', { class: 'notice good' }, t('set.aiOn', { provider: hl.provider })), ...(hl.mock ? [h('div', { class: 'mock-banner' }, t('ai.mockBanner'))] : []),
        h('p', { class: 'small muted' }, t('ai.limits', { n: hl.limits.rateLimitPerHour, pages: hl.limits.maxPages })))
      if (hl.requiresAccessCode) {
        const code = h('input', { type: 'password', autocomplete: 'off', value: settings().aiAccessCode })
        aiBox.append(field(t('set.accessCode'), code, t('set.accessCodeHelp')), h('button', { class: 'btn', type: 'button', onClick: async () => { await saveSettings({ aiAccessCode: code.value.trim() }); toast(t('set.saved')) } }, t('common.save')))
      }
    }
    aiBox.append(h('p', { class: 'small muted' }, t('set.aiPrivacy')))
  })

  root.append(h('section', { class: 'card', style: 'margin-top:16px' }, h('h2', null, t('set.about')), h('p', null, t('set.aboutText')), h('p', { class: 'small muted' }, t('set.aboutFuture'))))
}
