import { Readable } from 'node:stream'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// 배포(vercel.json)와 같은 CSP 를 preview 서버에도 적용해 CSP 위반을 미리 확인한다.
const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; worker-src 'self' blob:; manifest-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'"

// `npm run dev` 에서 /api/* 서버리스 함수를 같은 프로세스로 실행한다. (서버 환경변수는 브라우저로 노출되지 않음)
function devApi(): Plugin {
  return {
    name: 'recall-dev-api',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url || '/', 'http://localhost')
        const m = /^\/api\/(analyze|health)$/.exec(url.pathname)
        if (!m) return next()
        try {
          const mod = (await server.ssrLoadModule(`/api/${m[1]}.ts`)) as Record<string, (r: Request) => Promise<Response>>
          const method = (req.method || 'GET').toUpperCase()
          const fn = mod[method]
          if (!fn) { res.statusCode = 405; return res.end() }
          const headers = new Headers()
          for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v)
          const hasBody = method !== 'GET' && method !== 'HEAD'
          const request = new Request(url, {
            method, headers,
            body: hasBody ? (Readable.toWeb(req) as unknown as ReadableStream) : undefined,
            ...(hasBody ? { duplex: 'half' } : {}),
          } as RequestInit)
          const response = await fn(request)
          res.statusCode = response.status
          response.headers.forEach((v, k) => res.setHeader(k, v))
          res.end(Buffer.from(await response.arrayBuffer()))
        } catch (e) {
          console.error('dev api error', (e as Error).message)
          res.statusCode = 500
          res.end('dev api error')
        }
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  // VITE_ 가 없는 변수(API 키 등)는 Node 프로세스에만 올리고 클라이언트 번들에는 넣지 않는다.
  const env = loadEnv(mode, process.cwd(), '')
  for (const [k, v] of Object.entries(env)) if (!k.startsWith('VITE_') && process.env[k] === undefined) process.env[k] = v
  const base = env.VITE_BASE || '/'
  return {
    base,
    plugins: [
      devApi(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['icon.svg'],
        workbox: {
          globPatterns: ['**/*.{js,css,html,svg,png,woff2,mjs}'],
          maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
          navigateFallback: `${base}index.html`,
          navigateFallbackDenylist: [/^\/api\//],
          cleanupOutdatedCaches: true,
        },
        manifest: {
          name: 'Recall',
          short_name: 'Recall',
          description: '단어부터 그림, 공식까지. 직접 만든 문제를 간격을 두고 복습합니다.',
          lang: 'ko',
          start_url: base,
          scope: base,
          display: 'standalone',
          background_color: '#f6f8fc',
          theme_color: '#2447c8',
          icons: [
            { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
            { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
      }),
    ],
    build: { target: 'es2022', sourcemap: false },
    preview: { headers: { 'Content-Security-Policy': CSP } },
    test: { include: ['tests/**/*.test.ts'], environment: 'node' },
  }
})
