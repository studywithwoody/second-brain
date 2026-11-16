import { mockCitation } from './mock'

export interface WebCitation {
  url: string
  title: string
  quote: string
  provider: 'exa' | 'tavily' | 'mock'
}

export interface SearchKeys {
  exaApiKey?: string
  tavilyApiKey?: string
}

function clip(value: string, max = 280) {
  const text = value.replace(/\s+/g, ' ').trim()
  return text.length > max ? `${text.slice(0, max)}…` : text
}

async function searchExa(query: string, apiKey: string): Promise<WebCitation[]> {
  const response = await fetch('https://api.exa.ai/search', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey
    },
    body: JSON.stringify({
      query,
      numResults: 3,
      contents: { text: { maxCharacters: 400 } }
    })
  })
  if (!response.ok) throw new Error(`Exa ${response.status}`)
  const data = await response.json() as { results?: Array<{ url?: string, title?: string, text?: string, highlights?: string[] }> }
  return (data.results || []).map(item => ({
    url: item.url || '',
    title: item.title || item.url || 'Exa 結果',
    quote: clip(item.highlights?.[0] || item.text || ''),
    provider: 'exa' as const
  })).filter(item => item.quote)
}

async function searchTavily(query: string, apiKey: string): Promise<WebCitation[]> {
  const response = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      max_results: 3,
      include_answer: false,
      search_depth: 'basic'
    })
  })
  if (!response.ok) throw new Error(`Tavily ${response.status}`)
  const data = await response.json() as { results?: Array<{ url?: string, title?: string, content?: string }> }
  return (data.results || []).map(item => ({
    url: item.url || '',
    title: item.title || 'Tavily 結果',
    quote: clip(item.content || ''),
    provider: 'tavily' as const
  })).filter(item => item.quote)
}

export async function searchWeb(query: string, keys: SearchKeys, usage?: { exa: number, tavily: number, exaLimit?: number, tavilyLimit?: number }) {
  const exaLimit = usage?.exaLimit ?? 2500
  const tavilyLimit = usage?.tavilyLimit ?? 1000
  const exaNearCap = (usage?.exa ?? 0) / exaLimit >= 0.9
  const tavilyNearCap = (usage?.tavily ?? 0) / tavilyLimit >= 0.9
  if (keys.exaApiKey && !exaNearCap) {
    try {
      const citations = await searchExa(query, keys.exaApiKey)
      if (citations.length) return { citations, provider: 'exa' as const }
    } catch {
      // fall through to Tavily
    }
  }
  if (keys.tavilyApiKey && !tavilyNearCap) {
    try {
      const citations = await searchTavily(query, keys.tavilyApiKey)
      if (citations.length) return { citations, provider: 'tavily' as const }
    } catch {
      // fall through to mock
    }
  }
  if (!keys.exaApiKey && !keys.tavilyApiKey) {
    return { citations: [mockCitation(query)], provider: 'mock' as const }
  }
  return { citations: [] as WebCitation[], provider: 'none' as const }
}
