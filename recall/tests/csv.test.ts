import { describe, expect, it } from 'vitest'
import { mapCsv, parseCsv } from '../src/csv'

describe('parseCsv', () => {
  it('쉼표·따옴표·줄바꿈·이스케이프된 따옴표를 처리한다', () => {
    const rows = parseCsv('question,answer\r\n"a, b","line1\nline2"\r\n"say ""hi""",x\r\n')
    expect(rows).toEqual([['question', 'answer'], ['a, b', 'line1\nline2'], ['say "hi"', 'x']])
  })
  it('BOM 과 마지막 줄바꿈 없음, 빈 줄을 처리한다', () => {
    expect(parseCsv('﻿q,a\n\n1,2')).toEqual([['q', 'a'], ['1', '2']])
  })
  it('탭 구분자를 감지한다', () => { expect(parseCsv('q\ta\n1\t2')).toEqual([['q', 'a'], ['1', '2']]) })
  it('빈 칸을 유지한다', () => { expect(parseCsv('a,,c')).toEqual([['a', '', 'c']]) })
})
describe('mapCsv', () => {
  it('한국어/영어 머리글을 인식하고 필수 값 없는 줄은 건너뛴다', () => {
    const r = mapCsv(parseCsv('질문,답,힌트\nQ1,A1,h\nQ2,,x\n,A3,'))
    expect(r.hasHeader).toBe(true)
    expect(r.cards).toEqual([{ question: 'Q1', answer: 'A1', hint: 'h', explanation: '', source: '' }])
    expect(r.skipped).toBe(2)
  })
  it('머리글이 없으면 위치로 매핑한다', () => {
    const r = mapCsv(parseCsv('apple,사과\nbook,책,힌트'))
    expect(r.hasHeader).toBe(false)
    expect(r.cards.length).toBe(2)
    expect(r.cards[1].hint).toBe('힌트')
  })
})
