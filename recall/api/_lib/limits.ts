// 데이터베이스 없는 "최선 노력" 사용량 제한.
// 서버리스 인스턴스 메모리에만 저장되므로 인스턴스가 여러 개이거나 재시작되면 카운터가 초기화된다.
// 확정적인 지출 상한은 AI 제공자 콘솔(월 예산/한도)에서 설정해야 한다. README 참고.
const perIp = new Map<string, number[]>()
let day = ''
let dayCount = 0

export function checkRate(ip: string, perHour: number, dailyCap: number, now = Date.now()):
  { ok: true } | { ok: false; code: 'rate_limited' | 'daily_cap'; retryAfterSec: number } {
  const today = new Date(now).toISOString().slice(0, 10)
  if (today !== day) { day = today; dayCount = 0 }
  if (dayCount >= dailyCap) return { ok: false, code: 'daily_cap', retryAfterSec: 3600 }
  const hourAgo = now - 3_600_000
  const hits = (perIp.get(ip) || []).filter((t) => t > hourAgo)
  if (hits.length >= perHour) {
    return { ok: false, code: 'rate_limited', retryAfterSec: Math.max(1, Math.ceil((hits[0] + 3_600_000 - now) / 1000)) }
  }
  hits.push(now)
  perIp.set(ip, hits)
  dayCount++
  if (perIp.size > 5000) { // 메모리 보호
    for (const [k, v] of perIp) if (!v.some((t) => t > hourAgo)) perIp.delete(k)
  }
  return { ok: true }
}

export function _resetLimits() { perIp.clear(); day = ''; dayCount = 0 }
