import { get, put } from './db'
import type { StoredImage } from './types'
import { uid } from './util'

export const IMAGE_MAX_BYTES = 10 * 1024 * 1024
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
const STORE_MAX_EDGE = 2000

/** 파일 내용의 매직 바이트로 실제 형식을 확인한다 (확장자/MIME 신뢰 안 함) */
export async function sniffImage(blob: Blob): Promise<string | null> {
  const b = new Uint8Array(await blob.slice(0, 12).arrayBuffer())
  const eq = (o: number, s: string) => [...s].every((ch, i) => b[o + i] === ch.charCodeAt(0))
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b[0] === 0x89 && eq(1, 'PNG')) return 'image/png'
  if (eq(0, 'GIF8')) return 'image/gif'
  if (eq(0, 'RIFF') && eq(8, 'WEBP')) return 'image/webp'
  return null
}

export type ImageError = 'type' | 'size' | 'empty' | 'decode'
export async function validateImage(file: Blob): Promise<ImageError | null> {
  if (file.size === 0) return 'empty'
  if (file.size > IMAGE_MAX_BYTES) return 'size'
  if (!(await sniffImage(file))) return 'type'
  return null
}

export async function decode(blob: Blob): Promise<ImageBitmap> {
  try { return await createImageBitmap(blob, { imageOrientation: 'from-image' }) } catch { throw new Error('decode') }
}

export interface Transform { rotate?: 0 | 90 | 180 | 270; crop?: { x: number; y: number; w: number; h: number }; maxEdge?: number; quality?: number; mime?: 'image/jpeg' | 'image/webp' }

/** 회전·자르기·축소를 적용해 새 Blob 을 만든다. 이미지는 EXIF 방향을 반영해 디코딩한다. */
export async function transformImage(src: Blob, t: Transform = {}): Promise<Blob> {
  const bmp = await decode(src)
  try {
    const c = t.crop ?? { x: 0, y: 0, w: 1, h: 1 }
    const sx = Math.round(c.x * bmp.width), sy = Math.round(c.y * bmp.height)
    const sw = Math.max(1, Math.round(c.w * bmp.width)), sh = Math.max(1, Math.round(c.h * bmp.height))
    // 회전은 자르기 이후에 적용 (자르기 좌표는 회전 전 이미지 기준)
    const rot = t.rotate ?? 0
    const swap = rot === 90 || rot === 270
    const scale = Math.min(1, (t.maxEdge ?? STORE_MAX_EDGE) / Math.max(sw, sh))
    const dw = Math.max(1, Math.round(sw * scale)), dh = Math.max(1, Math.round(sh * scale))
    const canvas = document.createElement('canvas')
    canvas.width = swap ? dh : dw
    canvas.height = swap ? dw : dh
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.translate(canvas.width / 2, canvas.height / 2)
    ctx.rotate((rot * Math.PI) / 180)
    ctx.drawImage(bmp, sx, sy, sw, sh, -dw / 2, -dh / 2, dw, dh)
    const mime = t.mime ?? 'image/jpeg'
    const out = await new Promise<Blob | null>((res) => canvas.toBlob(res, mime, t.quality ?? 0.85))
    if (!out) throw new Error('encode')
    return out
  } finally { bmp.close() }
}

/** 저장용: 긴 변 2000px 이하로 줄이고 JPEG 로 다시 인코딩 (GIF 는 첫 프레임) */
export const normalizeForStorage = (b: Blob) => transformImage(b, { maxEdge: STORE_MAX_EDGE, quality: 0.86 })

/** AI 전송용: 긴 변 1280px, JPEG 0.78 → base64 */
export async function toAiImage(b: Blob): Promise<{ mime: 'image/jpeg'; data: string }> {
  const out = await transformImage(b, { maxEdge: 1280, quality: 0.78 })
  return { mime: 'image/jpeg', data: await blobToBase64(out) }
}

export function blobToBase64(b: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader()
    r.onload = () => res(String(r.result).split(',')[1] || '')
    r.onerror = () => rej(r.error)
    r.readAsDataURL(b)
  })
}
export function base64ToBlob(data: string, mime: string): Blob {
  const bin = atob(data)
  const arr = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
  return new Blob([arr], { type: mime })
}

export async function saveImage(blob: Blob, name: string): Promise<StoredImage> {
  const img: StoredImage = { id: uid(), blob, mime: blob.type || 'image/jpeg', name: name.slice(0, 120), size: blob.size, createdAt: Date.now() }
  await put('images', img)
  return img
}

// 화면 표시용 object URL 캐시
const urlCache = new Map<string, string>()
export async function imageUrl(id: string): Promise<string> {
  const hit = urlCache.get(id)
  if (hit) return hit
  const rec = await get('images', id)
  if (!rec) return ''
  const url = URL.createObjectURL(rec.blob)
  urlCache.set(id, url)
  return url
}
export function dropImageUrl(id: string) {
  const u = urlCache.get(id)
  if (u) { URL.revokeObjectURL(u); urlCache.delete(id) }
}
