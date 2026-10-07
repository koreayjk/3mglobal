// 사용된 번역 키가 ko/en 양쪽에 모두 있는지, 자리표시자가 일치하는지 검사한다.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { en } from '../src/locales/en'
import { ko } from '../src/locales/ko'

const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [] })
const src = walk('src').filter((f) => !f.includes('locales')).map((f) => readFileSync(f, 'utf8')).join('\n')
const used = new Set<string>()
for (const m of src.matchAll(/\bt\(\s*['`]([a-zA-Z0-9_.-]+)['`]/g)) used.add(m[1])
for (const m of src.matchAll(/['`](ai\.s[1-4]|nav\.[a-z]+|rate\.[a-z]+|ai\.err\.[a-z_]+|ai\.(?:full|pdfBig|textBig))['`]/g)) used.add(m[1])
const dyn = ['ai.diff.', ['easy', 'normal', 'hard'], 'ai.kind.', ['process', 'comparison', 'sequence'], 'ai.lang.', ['original', 'ko', 'en'], 'ai.mode.', ['summary', 'cards', 'both'], 'ai.src.', ['pdf-text', 'text-file', 'manual', 'ai', 'none'],
  'editor.img.', ['type', 'size', 'empty', 'decode'], 'set.mode.', ['merge', 'replace'], 'set.motion.', ['system', 'reduce', 'full'], 'type.', ['qa', 'cloze', 'occlusion', 'image-id'], 'land.how', ['1t', '1d', '2t', '2d', '3t', '3d'], 'land.free', ['1', '2', '3', '4', '5']] as const
for (let i = 0; i < dyn.length; i += 2) for (const s of dyn[i + 1] as readonly string[]) used.add((dyn[i] as string) + s)
let bad = 0
for (const k of [...used].filter((k) => !k.includes('$'))) {
  if (!(k in ko)) { console.error('missing ko:', k); bad++ }
  if (!(k in en)) { console.error('missing en:', k); bad++ }
}
const ph = (s: string) => [...s.matchAll(/\{([a-zA-Z]+)\}/g)].map((m) => m[1]).sort().join(',')
for (const k of Object.keys(ko)) { if (!(k in en)) { console.error('en lacks', k); bad++ } else if (ph(ko[k]) !== ph(en[k])) { console.error('placeholder mismatch', k, ph(ko[k]), ph(en[k])); bad++ } }
for (const k of Object.keys(en)) if (!(k in ko)) { console.error('ko lacks', k); bad++ }
console.log(bad ? `i18n problems: ${bad}` : `i18n ok (${Object.keys(ko).length} keys)`)
process.exit(bad ? 1 : 0)
