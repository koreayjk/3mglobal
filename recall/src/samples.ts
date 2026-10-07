// 예제 자료. 외부 이미지 저작권에 의존하지 않도록 직접 그린 SVG 를 PNG 로 변환해 사용한다.
import { emptyNote } from './cards'
import { loadSettings, saveSettings } from './db'
import { saveImage } from './images'
import { addNotes, createDeck } from './repo'
import type { Mask, Note } from './types'
import { uid } from './util'

const FONT = `font-family="'Pretendard','Noto Sans KR','Apple SD Gothic Neo','Malgun Gothic',sans-serif"`

function bioSvg(): string {
  const names = ['탄수화물', '지질', '단백질', '핵산']
  const mono = ['단당류', '지방산 + 글리세롤', '아미노산', '뉴클레오타이드']
  const fills = ['#ffe9cf', '#fff3c4', '#dff5e6', '#dcecff']
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 500" width="800" height="500"><rect width="800" height="500" fill="#fffdf8"/>`
  for (let i = 0; i < 4; i++) {
    const cx = 100 + 200 * i
    s += `<text x="${cx}" y="66" text-anchor="middle" font-size="30" font-weight="700" fill="#1f2a44" ${FONT}>${names[i]}</text>`
    s += `<rect x="${cx - 90}" y="100" width="180" height="300" rx="22" fill="${fills[i]}"/>`
    s += `<text x="${cx}" y="448" text-anchor="middle" font-size="${i === 1 ? 19 : 22}" fill="#33405e" ${FONT}>${mono[i]}</text>`
  }
  // 탄수화물: 육각 고리 3개
  const hex = (x: number, y: number, r: number) => [0, 1, 2, 3, 4, 5].map((k) => `${(x + r * Math.cos(Math.PI / 6 + (k * Math.PI) / 3)).toFixed(1)},${(y + r * Math.sin(Math.PI / 6 + (k * Math.PI) / 3)).toFixed(1)}`).join(' ')
  for (const [x, y] of [[80, 180], [120, 250], [80, 320]]) s += `<polygon points="${hex(x, y, 34)}" fill="#fff" stroke="#c2570c" stroke-width="4" stroke-linejoin="round"/>`
  // 지질: 글리세롤 + 지방산 꼬리 3개
  s += `<line x1="290" y1="170" x2="290" y2="330" stroke="#8a6d00" stroke-width="6"/>`
  for (const y of [170, 250, 330]) {
    s += `<circle cx="290" cy="${y}" r="12" fill="#e0a800"/><path d="M302 ${y} q15 -16 30 0 t30 0 t30 0" fill="none" stroke="#b58900" stroke-width="5" stroke-linecap="round"/>`
  }
  // 단백질: 아미노산 구슬 사슬
  const cols = ['#2f9e5f', '#52b788', '#2f9e5f', '#74c69d', '#2f9e5f', '#52b788', '#2f9e5f']
  let d = 'M520 160'
  const pts: [number, number][] = [[530, 170], [575, 200], [530, 235], [580, 265], [530, 300], [575, 335], [535, 370]]
  pts.forEach(([x, y]) => { d += ` L${x} ${y}` })
  s += `<path d="${d}" fill="none" stroke="#1b6a3a" stroke-width="5" stroke-linejoin="round"/>`
  pts.forEach(([x, y], i) => { s += `<circle cx="${x}" cy="${y}" r="17" fill="${cols[i]}" stroke="#1b6a3a" stroke-width="3"/>` })
  // 핵산: 이중 나선
  let a = 'M700 150', b2 = 'M700 150'
  for (let y = 150; y <= 370; y += 10) { const dx = Math.sin(((y - 150) / 220) * Math.PI * 3) * 40; a += ` L${700 + dx} ${y}`; b2 += ` L${700 - dx} ${y}` }
  s += `<path d="${a}" fill="none" stroke="#1c4f9c" stroke-width="5"/><path d="${b2}" fill="none" stroke="#4d8fe0" stroke-width="5"/>`
  for (let y = 165; y <= 370; y += 28) { const dx = Math.sin(((y - 150) / 220) * Math.PI * 3) * 40; s += `<line x1="${700 + dx}" y1="${y}" x2="${700 - dx}" y2="${y}" stroke="#7aa7e6" stroke-width="3"/>` }
  return s + '</svg>'
}
// 마스크 좌표(픽셀 → 0~1 정규화)
const nm = (x: number, y: number, w: number, h: number, W: number, H: number) => ({ x: x / W, y: y / H, w: w / W, h: h / H })
const BIO_NAME_MASKS = [0, 1, 2, 3].map((i) => nm(100 + 200 * i - 85, 28, 170, 56, 800, 500))
const BIO_MONO_MASKS = [0, 1, 2, 3].map((i) => nm(100 + 200 * i - 90, 418, 180, 42, 800, 500))

function stackQueueSvg(): string {
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 500" width="800" height="500"><rect width="800" height="500" fill="#f8fbff"/>`
  const T = (x: number, y: number, txt: string, size = 26, anchor = 'middle', w = 700, fill = '#1f2a44') => `<text x="${x}" y="${y}" text-anchor="${anchor}" font-size="${size}" font-weight="${w}" fill="${fill}" ${FONT}>${txt}</text>`
  s += T(200, 56, 'Stack', 34, 'middle', 800) + T(200, 98, 'LIFO', 28, 'middle', 700, '#2447c8')
  s += T(600, 56, 'Queue', 34, 'middle', 800) + T(600, 98, 'FIFO', 28, 'middle', 700, '#2447c8')
  s += `<line x1="400" y1="30" x2="400" y2="470" stroke="#d5deef" stroke-width="3" stroke-dasharray="8 8"/>`
  ;[['1', 330], ['2', 270], ['3', 210]].forEach(([n, y]) => { s += `<rect x="130" y="${y}" width="140" height="60" rx="8" fill="#dcecff" stroke="#2447c8" stroke-width="3"/>` + T(200, Number(y) + 40, String(n), 28) })
  s += T(300, 247, 'top', 24, 'start', 700, '#b42318') + `<path d="M292 240 H274" stroke="#b42318" stroke-width="3" marker-end="url(#a)"/>`
  s += T(90, 180, 'push', 24, 'middle', 600, '#11704f') + T(310, 180, 'pop', 24, 'middle', 600, '#9a4a05')
  s += `<path d="M90 190 V230" stroke="#11704f" stroke-width="4"/><path d="M310 230 V190" stroke="#9a4a05" stroke-width="4"/>`
  ;[['1', 450], ['2', 530], ['3', 610]].forEach(([n, x]) => { s += `<rect x="${x}" y="250" width="80" height="60" rx="8" fill="#ffe9cf" stroke="#c2570c" stroke-width="3"/>` + T(Number(x) + 40, 290, String(n), 28) })
  s += T(490, 352, 'front', 24, 'middle', 700, '#b42318') + T(650, 352, 'back', 24, 'middle', 700, '#b42318')
  s += T(420, 232, 'pop', 24, 'middle', 600, '#9a4a05') + T(735, 232, 'push', 24, 'middle', 600, '#11704f')
  s += `<path d="M450 245 H410" stroke="#9a4a05" stroke-width="4"/><path d="M770 280 H695" stroke="#11704f" stroke-width="4"/>`
  return s + '</svg>'
}
const SQ_MASKS = [
  { ...nm(138, 66, 124, 44, 800, 500), answer: 'LIFO', hint: 'Last In, First Out' },
  { ...nm(538, 66, 124, 44, 800, 500), answer: 'FIFO', hint: 'First In, First Out' },
  { ...nm(292, 218, 66, 38, 800, 500), answer: 'top', hint: 'stack 에서 맨 위(가장 나중에 넣은) 원소를 가리킴' },
  { ...nm(448, 328, 84, 38, 800, 500), answer: 'front', hint: 'queue 에서 가장 먼저 넣은 원소 쪽' },
  { ...nm(618, 328, 64, 38, 800, 500), answer: 'back', hint: 'queue 에서 가장 나중에 넣은 원소 쪽' },
]

function dnaSvg(): string {
  let a = 'M300 40', b = 'M300 40', rungs = ''
  for (let y = 40; y <= 560; y += 8) { const dx = Math.sin(((y - 40) / 520) * Math.PI * 4) * 110; a += ` L${300 + dx} ${y}`; b += ` L${300 - dx} ${y}` }
  for (let y = 60; y <= 560; y += 26) { const dx = Math.sin(((y - 40) / 520) * Math.PI * 4) * 110; rungs += `<line x1="${300 + dx}" y1="${y}" x2="${300 - dx}" y2="${y}" stroke="#7aa7e6" stroke-width="6" stroke-linecap="round"/>` }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600" width="600" height="600"><rect width="600" height="600" fill="#f4f8ff"/>${rungs}<path d="${a}" fill="none" stroke="#1c4f9c" stroke-width="12" stroke-linecap="round"/><path d="${b}" fill="none" stroke="#e0661f" stroke-width="12" stroke-linecap="round"/></svg>`
}

async function rasterize(svg: string, scale = 2): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    const w = img.naturalWidth * scale, h = img.naturalHeight * scale
    const c = document.createElement('canvas'); c.width = w; c.height = h
    c.getContext('2d')!.drawImage(img, 0, 0, w, h)
    return await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('png'))), 'image/png'))
  } finally { URL.revokeObjectURL(url) }
}

const mk = (masks: { x: number; y: number; w: number; h: number; answer: string; hint?: string }[]): Mask[] => masks.map((m) => ({ id: uid(), x: m.x, y: m.y, w: m.w, h: m.h, answer: m.answer, hint: m.hint || '' }))

export async function loadSamples(): Promise<void> {
  await loadSettings()
  const [bioPng, sqPng, dnaPng] = await Promise.all([rasterize(bioSvg()), rasterize(stackQueueSvg()), rasterize(dnaSvg())])
  const [bio, sq, dna] = await Promise.all([saveImage(bioPng, 'bio.png'), saveImage(sqPng, 'stack-queue.png'), saveImage(dnaPng, 'dna.png')])
  const base = Date.now()
  let n = 0
  const note = (deckId: string, p: Partial<Note> & Pick<Note, 'type'>): Note => emptyNote({ id: uid(), deckId, origin: 'sample', createdAt: base + n, updatedAt: base + n++, ...p })

  const dBio = await createDeck('생물학 · 4대 고분자', '탄수화물·지질·단백질·핵산', 2)
  const dCpp = await createDeck('C++ stack과 queue', '컨테이너 어댑터 기본', 3)
  const dUs = await createDeck('미국사 핵심 개념', '건국기부터 20세기 중반까지', 4)
  const dEn = await createDeck('영어 단어', '자주 나오는 단어', 1)

  await addNotes([
    note(dBio.id, { type: 'occlusion', imageId: bio.id, question: '4대 고분자의 이름을 맞혀 보세요', masks: mk(BIO_NAME_MASKS.map((m, i) => ({ ...m, answer: ['탄수화물', '지질', '단백질', '핵산'][i], hint: ['단당류가 연결됨', '물에 잘 녹지 않음', '아미노산이 연결됨', 'DNA와 RNA'][i] }))), explanation: '그림은 개념 이해를 돕는 단순화된 예제입니다.', source: '예제 자료' }),
    note(dBio.id, { type: 'occlusion', imageId: bio.id, question: '각 분자의 단위체(구성 단위)는?', occlusionMode: 'all', masks: mk(BIO_MONO_MASKS.map((m, i) => ({ ...m, answer: ['단당류', '지방산 + 글리세롤', '아미노산', '뉴클레오타이드'][i] }))), explanation: '지질은 반복 단위로 이루어진 엄밀한 중합체가 아니므로 교재에 따라 표현이 다를 수 있습니다.' }),
    note(dBio.id, { type: 'image-id', imageId: dna.id, question: '이 구조는 무엇인가요?', answer: 'DNA 이중 나선(핵산)', hint: '두 가닥이 꼬여 있음', explanation: '이 그림은 단순화한 모식도입니다.' }),
    note(dBio.id, { type: 'qa', question: '단백질의 단위체는 무엇이고, 어떤 결합으로 연결되나요?', answer: '아미노산이 펩타이드 결합으로 연결됩니다.', hint: '아미노기와 카복실기 사이의 결합' }),
    note(dBio.id, { type: 'qa', question: '핵산의 단위체인 뉴클레오타이드는 어떤 세 부분으로 이루어지나요?', answer: '5탄당(당), 인산기, 질소 염기', hint: '당 + 인산 + ?' }),
    note(dBio.id, { type: 'cloze', text: '단위체들이 {{c1::탈수 축합}} 반응으로 결합해 고분자가 되고, {{c2::가수분해}}로 다시 분해된다.', hint: '물이 빠짐 / 물이 더해짐' }),

    note(dCpp.id, { type: 'occlusion', imageId: sq.id, question: 'stack과 queue 그림의 빈 곳을 채워 보세요', masks: mk(SQ_MASKS), explanation: 'std::stack, std::queue 는 컨테이너 어댑터입니다.' }),
    note(dCpp.id, { type: 'qa', question: 'std::stack<int> s; s.push(1); s.push(2); s.push(3); s.pop(); 다음에 s.top() 의 값은?', answer: '2', explanation: 'LIFO 이므로 마지막에 넣은 3 이 제거되고 그 아래의 2 가 top 이 됩니다.' }),
    note(dCpp.id, { type: 'qa', question: 'std::queue<int> q; q.push(7); q.push(8); q.push(9); q.pop(); 다음에 q.front() 의 값은?', answer: '8', explanation: 'FIFO 이므로 가장 먼저 넣은 7 이 제거됩니다.' }),
    note(dCpp.id, { type: 'qa', question: 'std::stack::pop() 은 제거한 값을 반환하나요?', answer: '아니요. 반환형이 void 이며 값만 제거합니다. 값을 읽으려면 pop() 전에 top() 을 호출합니다.', hint: 'top() 과 pop() 의 역할 분리' }),
    note(dCpp.id, { type: 'cloze', text: 'stack 은 {{c1::LIFO}}, queue 는 {{c2::FIFO}} 구조이다.' }),
    note(dCpp.id, { type: 'cloze', text: 'std::queue<int> q;\nq.push(3); q.push(5);\nq.{{c1::pop}}();   // 3 제거\nint x = q.{{c2::front}}();   // x == 5', hint: '코드의 빈칸을 채우세요' }),

    note(dUs.id, { type: 'qa', question: '1776년 대륙회의가 채택한 문서는 무엇인가요?', answer: '독립선언서 (미국 독립선언서)', explanation: '토머스 제퍼슨이 주된 초안 작성자였습니다.' }),
    note(dUs.id, { type: 'qa', question: '미국 연방헌법은 어디에서 언제 작성되었나요?', answer: '1787년 필라델피아 제헌회의에서 작성되었습니다.', explanation: '이후 각 주의 비준을 거쳐 1789년 새 정부가 출범했습니다.' }),
    note(dUs.id, { type: 'qa', question: '권리장전(Bill of Rights)이란 무엇인가요?', answer: '연방헌법의 수정조항 제1조~제10조로, 1791년에 비준되었습니다.', hint: '수정조항 10개' }),
    note(dUs.id, { type: 'qa', question: '1803년 루이지애나 매입은 누구에게서, 어느 대통령 때 이루어졌나요?', answer: '프랑스로부터, 토머스 제퍼슨 대통령 때.' }),
    note(dUs.id, { type: 'cloze', text: '{{c1::수정헌법 제13조}}는 1865년 미국에서 노예제를 폐지했다.' }),
    note(dUs.id, { type: 'qa', question: '1954년 Brown v. Board of Education 판결의 핵심 내용은?', answer: '공립학교에서의 인종 분리가 헌법(평등보호 조항)에 위배된다고 판결했습니다.', explanation: '원문 표현을 확인하고 자신의 말로 다시 정리해 보세요.' }),

    note(dEn.id, { type: 'qa', question: 'meticulous', answer: '꼼꼼한, 세심한', hint: '세부 사항에 매우 신경 씀', explanation: 'She is meticulous about keeping records.', reverse: true }),
    note(dEn.id, { type: 'qa', question: 'ephemeral', answer: '순식간의, 덧없는', hint: '오래 가지 않음', explanation: 'Fame can be ephemeral.' }),
    note(dEn.id, { type: 'qa', question: 'ubiquitous', answer: '어디에나 있는', hint: 'u로 시작, 흔함', explanation: 'Smartphones are ubiquitous today.', reverse: true }),
    note(dEn.id, { type: 'qa', question: 'pragmatic', answer: '실용적인, 현실적인', explanation: 'We need a pragmatic solution.' }),
    note(dEn.id, { type: 'cloze', text: 'She was {{c1::reluctant}} to admit her mistake.', hint: '마지못해 하는', explanation: 'reluctant: 꺼리는, 마음 내키지 않는' }),
  ])
  await saveSettings({ samplesLoaded: true })
}
