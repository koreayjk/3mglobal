import { t } from '../i18n'
import { h } from '../util'
import { openDialog } from './components'

export function cameraSupported(): boolean {
  return !!navigator.mediaDevices?.getUserMedia && window.isSecureContext
}

/** 카메라 미리보기 모달. 촬영하면 Blob 을, 취소하면 null 을 돌려준다. 접근 실패 시 reject → 호출자가 파일 선택으로 대체. */
export async function captureFromCamera(): Promise<Blob | null> {
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 } }, audio: false })
  return new Promise((resolve) => {
    const video = h('video', { class: 'cam', autoplay: true, playsInline: true, muted: true, 'aria-label': t('ai.camera') })
    video.srcObject = stream
    let blob: Blob | null = null
    const stop = () => stream.getTracks().forEach((tr) => tr.stop())
    const shoot = h('button', { class: 'btn primary', type: 'button' }, t('ai.shoot'))
    const cancel = h('button', { class: 'btn', type: 'button' }, t('common.cancel'))
    const body = h('div', null, video, h('div', { class: 'dlg-actions' }, cancel, shoot))
    const d = openDialog(t('ai.camera'), body, { onClose: () => { stop(); resolve(blob) } })
    cancel.addEventListener('click', () => d.close('cancel'))
    shoot.addEventListener('click', () => {
      const c = document.createElement('canvas')
      c.width = video.videoWidth || 1280; c.height = video.videoHeight || 960
      c.getContext('2d')!.drawImage(video, 0, 0, c.width, c.height)
      c.toBlob((b) => { blob = b; d.close('ok') }, 'image/jpeg', 0.9)
    })
  })
}
