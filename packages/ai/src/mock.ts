import type { ClaimVerdict, ExtractedClaim, GraphExtraction } from './schemas'
import { cosine, mockEmbedding, normalizeName } from './text'
import { estimateTokens } from './pricing'

const FALSE_CLAIMS: Array<{ re: RegExp, fix: string, confidence: number, reasoning: string }> = [
  {
    re: /F\s*=\s*mv\b/i,
    fix: '牛頓第二定律是 F = ma（淨力等於質量乘以加速度），不是 F = mv。',
    confidence: 0.94,
    reasoning: '第二定律把淨力、質量與加速度連起來，關係式是 F = ma。F = mv 把加速度誤寫成速度。'
  },
  {
    re: /地球是平的/,
    fix: '地球是近似球體（兩極略扁的橢球）。',
    confidence: 0.99,
    reasoning: '大地測量與衛星觀測都不支持平坦地球。'
  },
  {
    re: /水的沸點是\s*90/,
    fix: '在一大氣壓下，水的沸點約為 100°C。',
    confidence: 0.96,
    reasoning: '標準大氣壓下純水的沸點約為 100°C，90°C 偏低。'
  },
  {
    re: /光速約為\s*30\s*公尺/,
    fix: '真空中的光速約為 3×10^8 公尺／秒。',
    confidence: 0.97,
    reasoning: '真空光速約為每秒 2.998×10^8 公尺，不是 30 公尺。'
  }
]

const TRUE_CLAIMS: RegExp[] = [
  /不受外力/,
  /等速直線運動/,
  /動量/,
  /動能/,
  /位能/,
  /質量乘/,
  /F\s*=\s*ma\b/i,
  /電荷量乘積/,
  /距離平方成反比/,
  /保守力/
]

export interface KnownEntity {
  labelZh: string
  labelEn: string
  aliases: string[]
  type: 'concept' | 'law' | 'quantity' | 'person' | 'other'
}

export const LEXICON: KnownEntity[] = [
  { labelZh: '牛頓', labelEn: 'Isaac Newton', aliases: ['Newton'], type: 'person' },
  { labelZh: '牛頓第一定律', labelEn: "Newton's first law", aliases: ['慣性定律'], type: 'law' },
  { labelZh: '牛頓第二定律', labelEn: "Newton's second law", aliases: ['F = ma', 'F=ma'], type: 'law' },
  { labelZh: '牛頓第三定律', labelEn: "Newton's third law", aliases: ['作用力與反作用力'], type: 'law' },
  { labelZh: '牛頓運動定律', labelEn: "Newton's laws of motion", aliases: ['運動定律'], type: 'law' },
  { labelZh: '動量守恆', labelEn: 'Conservation of momentum', aliases: ['动量守恒'], type: 'law' },
  { labelZh: '力學能守恆', labelEn: 'Conservation of mechanical energy', aliases: ['機械能守恆'], type: 'law' },
  { labelZh: '庫侖定律', labelEn: "Coulomb's law", aliases: ['庫倫定律'], type: 'law' },
  { labelZh: '力', labelEn: 'force', aliases: ['淨力'], type: 'quantity' },
  { labelZh: '質量', labelEn: 'mass', aliases: [], type: 'quantity' },
  { labelZh: '加速度', labelEn: 'acceleration', aliases: [], type: 'quantity' },
  { labelZh: '動量', labelEn: 'momentum', aliases: [], type: 'quantity' },
  { labelZh: '動能', labelEn: 'kinetic energy', aliases: [], type: 'quantity' },
  { labelZh: '位能', labelEn: 'potential energy', aliases: ['勢能'], type: 'quantity' },
  { labelZh: '電荷', labelEn: 'electric charge', aliases: [], type: 'quantity' }
]

function negates(text: string, pattern: RegExp) {
  const flagged = text.match(pattern)
  if (!flagged || flagged.index == null) return false
  return /不是|並非|而非|不是說/.test(text.slice(Math.max(0, flagged.index - 4), flagged.index))
}

function splitSentences(text: string) {
  return text
    .split(/\n+|(?<=[。！？!?])\s*/)
    .map(part => part.trim())
    .filter(part => part.length >= 8)
    .filter(part => !/^#{1,6}\s/.test(part))
    .filter(part => !/^---/.test(part))
    .filter(part => !/^(title|tags)\s*:/.test(part))
}

export function extractClaimsMock(markdown: string): ExtractedClaim[] {
  const claims: ExtractedClaim[] = []
  let cursor = 0
  for (const sentence of splitSentences(markdown)) {
    const start = markdown.indexOf(sentence, cursor)
    if (start < 0) continue
    cursor = start + sentence.length
    const opinion = /我覺得|也許|或許|可能|應該吧/.test(sentence)
    claims.push({
      text: sentence,
      spanStart: start,
      spanEnd: start + sentence.length,
      checkable: !opinion
    })
  }
  return claims.slice(0, 12)
}

export function judgeClaimsMock(claims: ExtractedClaim[]): ClaimVerdict[] {
  return claims.map((claim, index) => {
    if (!claim.checkable) {
      return {
        index,
        verdict: 'not_checkable' as const,
        confidence: 0.7,
        reasoning: '這句偏意見或無法單獨查證，先不判定對錯。',
        evidenceSource: 'none' as const
      }
    }
    const wrong = FALSE_CLAIMS.find(item => item.re.test(claim.text) && !negates(claim.text, item.re))
    if (wrong) {
      return {
        index,
        verdict: 'contradicted' as const,
        confidence: wrong.confidence,
        reasoning: wrong.reasoning,
        suggestedFix: wrong.fix,
        evidenceSource: 'web' as const
      }
    }
    if (TRUE_CLAIMS.some(re => re.test(claim.text))) {
      return {
        index,
        verdict: 'supported' as const,
        confidence: 0.86,
        reasoning: '這句與筆記中的物理關係以及常見教材表述一致。',
        evidenceSource: 'knowledge_base' as const
      }
    }
    return {
      index,
      verdict: 'uncertain' as const,
      confidence: 0.42,
      reasoning: '現有筆記與檢索摘錄不足以確認或否定這句。',
      evidenceSource: 'none' as const
    }
  })
}

export function selfCheckMock(claim: string, confidence: number) {
  const known = FALSE_CLAIMS.some(item => item.re.test(claim))
  if (known && confidence >= 0.85) {
    return { agree: true, confidence, reasoning: '第二次檢查仍認為原句與標準表述衝突。' }
  }
  return { agree: false, confidence: 0.45, reasoning: '第二次檢查無法維持高信心的否定，降為不確定。' }
}

export function extractGraphMock(markdown: string): GraphExtraction {
  const found: KnownEntity[] = []
  const ordered = [...LEXICON].sort((a, b) => b.labelZh.length - a.labelZh.length)
  for (const entity of ordered) {
    const names = [entity.labelZh, ...entity.aliases]
    const hit = names.some(name => markdown.includes(name))
    if (!hit) continue
    found.push(entity)
  }
  const entities = found.map(entity => ({
    labelZh: entity.labelZh,
    labelEn: entity.labelEn,
    aliases: entity.aliases,
    type: entity.type,
    confidence: 0.9
  }))
  const relations: GraphExtraction['relations'] = []
  const paragraphs = markdown.split(/\n{2,}/)
  for (const paragraph of paragraphs) {
    const present = found.filter(entity =>
      [entity.labelZh, ...entity.aliases].some(name => paragraph.includes(name))
    )
    for (let i = 0; i < present.length; i++) {
      for (let j = i + 1; j < present.length; j++) {
        const a = present[i]!
        const b = present[j]!
        if (a.type === 'person' || b.type === 'person') {
          relations.push(rel(a, b, 'proposed', '提出', 'proposed', 0.8))
        } else if (a.type === 'law' && b.type === 'quantity' || b.type === 'law' && a.type === 'quantity') {
          const law = a.type === 'law' ? a : b
          const quantity = a.type === 'quantity' ? a : b
          relations.push(rel(law, quantity, 'describes', '描述', 'describes', 0.84))
        } else if (/守恆/.test(a.labelZh) && /能|動量/.test(b.labelZh) || /守恆/.test(b.labelZh) && /能|動量/.test(a.labelZh)) {
          relations.push(rel(a, b, 'includes', '包含', 'includes', 0.78))
        } else {
          relations.push(rel(a, b, 'related_to', '相關', 'related to', 0.7))
        }
      }
    }
  }
  const uniq = new Map<string, GraphExtraction['relations'][number]>()
  for (const relation of relations) {
    const key = `${relation.sourceZh}|${relation.relation}|${relation.targetZh}`
    if (!uniq.has(key)) uniq.set(key, relation)
  }
  return { entities, relations: [...uniq.values()] }
}

function rel(
  source: KnownEntity,
  target: KnownEntity,
  relation: string,
  relationZh: string,
  relationEn: string,
  confidence: number
): GraphExtraction['relations'][number] {
  return {
    sourceZh: source.labelZh,
    targetZh: target.labelZh,
    relation,
    relationZh,
    relationEn,
    confidence
  }
}

export interface MatchCandidate {
  labelZh: string
  labelEn: string
  aliases: string[]
}

export function namesOf(item: MatchCandidate) {
  return [item.labelZh, item.labelEn, ...item.aliases].filter(Boolean)
}

export function nameScore(a: MatchCandidate, b: MatchCandidate) {
  const left = namesOf(a).map(normalizeName)
  const right = new Set(namesOf(b).map(normalizeName))
  if (left.some(name => name && right.has(name))) return 0.99
  return cosine(
    mockEmbedding(namesOf(a).join(' ')),
    mockEmbedding(namesOf(b).join(' '))
  )
}

export function matchEntityMock(candidate: MatchCandidate, existing: MatchCandidate) {
  const score = nameScore(candidate, existing)
  const same = score >= 0.9
  return {
    same,
    confidence: Math.max(0, Math.min(0.99, score)),
    reason: same ? '名稱、別名或公式一致，視為同一實體。' : '名稱差異夠大，先當成不同節點。'
  }
}

export function mockCitation(query: string) {
  if (/F\s*=\s*mv|第二定律|牛頓/i.test(query)) {
    return {
      url: 'https://example.edu/physics/newton',
      title: '示範教材：牛頓運動定律',
      quote: '第二定律：物體的淨力等於質量乘以加速度，F = ma。',
      provider: 'mock' as const
    }
  }
  if (/動量/.test(query)) {
    return {
      url: 'https://example.edu/physics/momentum',
      title: '示範教材：動量守恆',
      quote: '不受外力的系統，總動量保持不變。',
      provider: 'mock' as const
    }
  }
  if (/庫侖|電荷/.test(query)) {
    return {
      url: 'https://example.edu/physics/coulomb',
      title: '示範教材：庫侖定律',
      quote: '靜電力大小與兩電荷乘積成正比，與距離平方成反比。',
      provider: 'mock' as const
    }
  }
  return {
    url: 'https://example.edu/physics/overview',
    title: '示範教材摘錄',
    quote: '此為離線示範搜尋結果，設定 EXA_API_KEY 或 TAVILY_API_KEY 後會改查真實網頁。',
    provider: 'mock' as const
  }
}

export function mockUsage(model: string, input: string, outputChars: number) {
  return {
    model,
    inputTokens: estimateTokens(input),
    outputTokens: Math.max(16, Math.ceil(outputChars / 2))
  }
}
