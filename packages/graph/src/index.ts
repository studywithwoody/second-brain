export * from './types'
export * from './engine'

export function displayLabel(node: { labelZh: string, labelEn: string }, lang: string) {
  if (lang === 'en') return node.labelEn || node.labelZh || '未命名'
  return node.labelZh || node.labelEn || '未命名'
}
