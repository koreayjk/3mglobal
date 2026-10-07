// public/icon*.svg 로부터 PNG 아이콘을 만든다. (한 번 실행해 결과를 커밋)
const { chromium } = await import(process.env.PW || 'playwright')
import { readFileSync, writeFileSync } from 'node:fs'
const b = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium/chrome-linux/chrome' })
const p = await b.newPage()
for (const [svg, size, out] of [['icon.svg', 192, 'icon-192.png'], ['icon.svg', 512, 'icon-512.png'], ['icon-maskable.svg', 512, 'icon-maskable-512.png'], ['icon.svg', 180, 'apple-touch-icon.png']]) {
  await p.setViewportSize({ width: size, height: size })
  await p.setContent(`<body style="margin:0"><img src="data:image/svg+xml;base64,${readFileSync(`public/${svg}`).toString('base64')}" width="${size}" height="${size}"></body>`)
  writeFileSync(`public/${out}`, await p.screenshot({ type: 'png', omitBackground: true }))
}
await b.close()
