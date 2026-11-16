const CJK = /[\p{Script=Han}]+/gu

export function tokenize(input: string): string[] {
  const text = input.toLowerCase()
  const tokens = new Set<string>()
  for (const word of text.match(/[a-z0-9]+(?:['’-][a-z0-9]+)*/g) || []) {
    if (word.length > 1 || /\d/.test(word)) tokens.add(word)
  }
  for (const seq of input.match(CJK) || []) {
    tokens.add(seq)
    if (seq.length === 1) continue
    for (let i = 0; i < seq.length - 1; i++) tokens.add(seq.slice(i, i + 2))
  }
  return [...tokens]
}

export function searchText(parts: string[]) {
  return tokenize(parts.join('\n')).join(' ')
}

export function hashString(value: string) {
  let h = 2166136261
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export function mockEmbedding(text: string, dim = 768): number[] {
  const vector = new Array<number>(dim).fill(0)
  for (const token of tokenize(text)) {
    const h = hashString(token)
    const i = h % dim
    const sign = (h & 2) === 0 ? 1 : -1
    vector[i] += sign * (1 + (h % 7) / 10)
  }
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1
  return vector.map(value => value / norm)
}

export function cosine(a: number[], b: number[]) {
  const n = Math.min(a.length, b.length)
  let dot = 0
  for (let i = 0; i < n; i++) dot += (a[i] || 0) * (b[i] || 0)
  return dot
}

export function normalizeName(value: string) {
  return value.toLowerCase().replace(/\s+/g, '').replace(/[＝=]/g, '=').replace(/[，。、“”"'’]/g, '')
}

export function contentHash(value: string) {
  return hashString(value).toString(16) + ':' + value.length.toString(16)
}
