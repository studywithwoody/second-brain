import { searchText } from '@kb/ai'

export interface ParsedNote {
  title: string
  tags: string[]
  webSearch?: boolean
  body: string
  content: string
}

export function parseFrontmatter(markdown: string): { data: Record<string, string>, body: string } {
  if (!markdown.startsWith('---\n')) return { data: {}, body: markdown }
  const end = markdown.indexOf('\n---', 4)
  if (end < 0) return { data: {}, body: markdown }
  const raw = markdown.slice(4, end)
  const body = markdown.slice(end + 4).replace(/^\n/, '')
  const data: Record<string, string> = {}
  for (const line of raw.split('\n')) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
    if (!match) continue
    data[match[1]!] = match[2]!.trim()
  }
  return { data, body }
}

function parseTags(value: string) {
  const trimmed = value.trim()
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed.slice(1, -1).split(',').map(part => part.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean)
  }
  return trimmed.split(/[\s,]+/).filter(Boolean)
}

export function parseNote(markdown: string, fallbackTitle: string): ParsedNote {
  const { data, body } = parseFrontmatter(markdown)
  const heading = body.match(/^#\s+(.+)$/m)?.[1]?.trim()
  const inline = [...body.matchAll(/(^|\s)#([^\s#]{1,40})/g)].map(match => match[2]!).filter(tag => !/^\d+$/.test(tag))
  const tags = [...new Set([...(data.tags ? parseTags(data.tags) : []), ...inline])]
  let webSearch: boolean | undefined
  if (data.webSearch === 'true' || data.web_search === 'true') webSearch = true
  if (data.webSearch === 'false' || data.web_search === 'false') webSearch = false
  return {
    title: (data.title || heading || fallbackTitle).trim(),
    tags,
    webSearch,
    body,
    content: markdown
  }
}

export function wikilinks(markdown: string) {
  const links: Array<{ title: string, label: string }> = []
  const re = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/g
  for (const match of markdown.matchAll(re)) {
    const title = match[1]!.trim()
    if (!title) continue
    links.push({ title, label: (match[2] || title).trim() })
  }
  const seen = new Set<string>()
  return links.filter(link => {
    const key = link.title.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function chunksOf(markdown: string) {
  const parts = markdown
    .replace(/^---\n[\s\S]*?\n---\n/, '')
    .split(/\n{2,}/)
    .map(part => part.trim())
    .filter(part => part.length > 1)
  let cursor = 0
  return parts.map((text, ordinal) => {
    const spanStart = Math.max(0, markdown.indexOf(text, cursor))
    cursor = spanStart + text.length
    return { ordinal, text, spanStart, spanEnd: spanStart + text.length }
  })
}

export function noteSearchText(title: string, path: string, tags: string[], markdown: string) {
  return searchText([title, path, tags.join(' '), markdown])
}
