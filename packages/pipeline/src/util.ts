import { createHash, randomUUID } from 'node:crypto'

export function id() {
  return randomUUID()
}

export function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

export function currentMonth(date = new Date()) {
  return date.toISOString().slice(0, 7)
}

export function asRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[]
  if (result && typeof result === 'object' && Array.isArray((result as { rows?: T[] }).rows)) {
    return (result as { rows: T[] }).rows
  }
  return []
}
