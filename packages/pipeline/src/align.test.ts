import { describe, expect, it } from 'vitest'
import { alignClaimSpans } from './jobs'

describe('alignClaimSpans', () => {
  const md = '# 牛頓\n\n力的單位是牛頓。\n\n牛頓在 1905 年發表了《原理》。\n'
  it('re-anchors LLM offsets on the exact text', () => {
    const [claim] = alignClaimSpans(md, [{ text: '牛頓在 1905 年發表了《原理》。', spanStart: 22, spanEnd: 61 }])
    expect(md.slice(claim!.spanStart, claim!.spanEnd)).toBe(claim!.text)
  })
  it('keeps correct offsets and walks forward for repeated text', () => {
    const start = md.indexOf('力的單位是牛頓。')
    const claims = alignClaimSpans(md, [
      { text: '力的單位是牛頓。', spanStart: start, spanEnd: start + 8 },
      { text: '牛頓在 1905 年發表了《原理》。', spanStart: 0, spanEnd: 3 }
    ])
    expect(claims[0]!.spanStart).toBe(start)
    expect(md.slice(claims[1]!.spanStart, claims[1]!.spanEnd)).toBe(claims[1]!.text)
  })
  it('zeroes spans when the text is not verbatim', () => {
    const [claim] = alignClaimSpans(md, [{ text: '完全不存在的句子', spanStart: 5, spanEnd: 9 }])
    expect([claim!.spanStart, claim!.spanEnd]).toEqual([0, 0])
  })
})
