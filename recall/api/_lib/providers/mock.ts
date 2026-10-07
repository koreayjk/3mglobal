import type { Provider } from './types.js'

// 개발용 가짜 제공자. 실제 AI 가 아니며 입력과 무관한 고정 예제를 돌려준다.
// UI 는 meta.mock 이 true 일 때 이를 명확히 표시한다.
export const mockProvider: Provider = async (_cfg, call) => {
  if (call.schemaName === 'extract') {
    return { pages: call.pages.map((p) => ({ index: p.index, text: p.text || `[개발용 예제 추출 결과] ${p.index}번 페이지의 글자를 읽은 것처럼 보이는 가짜 텍스트입니다. [확인 필요: 흐린 글자]`, unreadable: false })) }
  }
  const first = call.pages[0]?.index ?? 1
  return {
    title: '[개발용 예제] 광합성 기초',
    topic: '생물학',
    concepts: [{ name: '광합성', explanation: '(예제) 빛 에너지를 화학 에너지로 바꾸는 과정.', sources: [first] }],
    terms: [{ term: '엽록체', definition: '(예제) 광합성이 일어나는 세포 소기관.', sources: [first] }],
    processes: [{ name: '광합성 순서(예제)', kind: 'process', items: ['빛 흡수', '물 분해', '포도당 합성'], sources: [first] }],
    keyPoints: [{ text: '(예제) 이 결과는 실제 AI 분석이 아닙니다.', sources: [first] }],
    cards: [
      { type: 'qa', question: '(예제) 광합성이 일어나는 소기관은?', answer: '엽록체', hint: '초록색', explanation: '', text: '', pageIndex: 0, sources: [first], needsReview: false },
      { type: 'cloze', question: '', answer: '', hint: '', explanation: '', text: '광합성은 {{c1::엽록체}}에서 일어난다.', pageIndex: 0, sources: [first], needsReview: false },
      { type: 'qa', question: '(예제) 확인이 필요한 카드', answer: '[확인 필요]', hint: '', explanation: '', text: '', pageIndex: 0, sources: [first], needsReview: true },
    ],
    warnings: ['개발용 예제 결과입니다. 실제 AI 가 아니며 입력 내용과 무관합니다.'],
  }
}
