// 빌드 결과(dist)에 비밀 키·제공자 주소가 들어가지 않았는지 검사한다.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p] })
const patterns = [/sk-ant-[A-Za-z0-9_-]{8,}/, /sk-proj-[A-Za-z0-9_-]{8,}/, /sk-[A-Za-z0-9]{32,}/, /ANTHROPIC_API_KEY/, /OPENAI_API_KEY/, /AI_ACCESS_CODE/, /api\.anthropic\.com/, /api\.openai\.com/]
let bad = 0
for (const f of walk('dist').filter((f) => /\.(js|mjs|html|css|json|webmanifest|map)$/.test(f))) {
  const s = readFileSync(f, 'utf8')
  for (const re of patterns) if (re.test(s)) { console.error(`secret-like pattern ${re} in ${f}`); bad++ }
}
console.log(bad ? `FAILED: ${bad} finding(s)` : 'dist is clean: no API keys or provider endpoints in the bundle')
process.exit(bad ? 1 : 0)
