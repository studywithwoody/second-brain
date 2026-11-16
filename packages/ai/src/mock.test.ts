import { describe, expect, it } from 'vitest'
import { budgetDecision } from './pricing'
import { extractClaimsMock, extractGraphMock, judgeClaimsMock, matchEntityMock } from './mock'

const note = `# 牛頓運動定律

牛頓第一定律：若物體不受外力，將保持靜止或等速直線運動。

牛頓第二定律是 F = mv。

正確關係是 F = ma。`

describe('mock fact-check', () => {
  it('flags F = mv and supports the inertia sentence', () => {
    const claims = extractClaimsMock(note)
    const verdicts = judgeClaimsMock(claims)
    const wrong = verdicts.find(item => claims[item.index]?.text.includes('F = mv'))
    const inertia = verdicts.find(item => claims[item.index]?.text.includes('等速直線運動'))
    expect(wrong?.verdict).toBe('contradicted')
    expect(wrong?.suggestedFix).toContain('F = ma')
    expect(inertia?.verdict).toBe('supported')
    const corrected = extractClaimsMock('牛頓第二定律是 F = ma（淨力等於質量乘以加速度），不是 F = mv。')
    const again = judgeClaimsMock(corrected).find(item => corrected[item.index]?.text.includes('不是 F = mv'))
    expect(again?.verdict).not.toBe('contradicted')
  })
})

describe('mock graph extraction', () => {
  it('stores both Chinese and English names', () => {
    const graph = extractGraphMock('[[牛頓第二定律]] 描述 [[力]] 與 [[質量]]，別名 F = ma。')
    const law = graph.entities.find(item => item.labelZh === '牛頓第二定律')
    expect(law?.labelEn).toBe("Newton's second law")
    expect(law?.aliases).toContain('F = ma')
    expect(graph.relations.some(item => item.relation === 'describes')).toBe(true)
    const matched = matchEntityMock(
      { labelZh: 'F = ma', labelEn: 'F = ma', aliases: [] },
      { labelZh: '牛頓第二定律', labelEn: "Newton's second law", aliases: ['F = ma'] }
    )
    expect(matched.same).toBe(true)
  })
})

describe('budget gate', () => {
  it('warns at 80 percent and blocks at the cap', () => {
    expect(budgetDecision(7.9, 10, 0.1).warn).toBe(false)
    expect(budgetDecision(8, 10, 0.1).warn).toBe(true)
    expect(budgetDecision(8, 10, 0.1).block).toBe(false)
    expect(budgetDecision(9.95, 10, 0.1).block).toBe(true)
    expect(budgetDecision(10, 10, 0).block).toBe(true)
  })
})
