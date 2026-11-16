import { and, desc, eq, sql } from 'drizzle-orm'
import { documentVersions, documents, jobs, type AppDb } from '@kb/db'

export type FactcheckStatus = 'never' | 'outdated' | 'queued' | 'running' | 'paused_budget' | 'failed' | 'done'

export interface FactcheckJobLike {
  status: string
  documentVersionId: string
  updatedAt: Date | string
  lastError?: string | null
}

export interface FactcheckStateInput {
  currentVersionId: string | null
  /** Newest first. */
  jobs: FactcheckJobLike[]
  /** Versions of the note, any order. */
  versions: Array<{ id: string, source: string, createdAt: Date | string }>
}

export interface FactcheckState {
  status: FactcheckStatus
  checkedVersionId: string | null
  checkedAt: string | null
  lastError: string | null
}

const time = (value: Date | string) => new Date(value).getTime()

/**
 * Fact-checks only run when the user asks. This works out what the note page should say:
 * never checked, outdated (edited since the last check), queued/running, paused by budget, failed, or done.
 * Versions created only by accepting AI fixes do not make a check outdated.
 */
export function computeFactcheckState(input: FactcheckStateInput): FactcheckState {
  const lastDone = input.jobs.find(job => job.status === 'succeeded')
  const checkedVersionId = lastDone?.documentVersionId || null
  const checkedAt = lastDone ? new Date(lastDone.updatedAt).toISOString() : null
  const base = { checkedVersionId, checkedAt, lastError: null as string | null }
  const current = input.currentVersionId
  const forCurrent = input.jobs.filter(job => job.documentVersionId === current)
  const active = forCurrent.find(job => job.status === 'running') || forCurrent.find(job => job.status === 'queued')
  if (active) return { ...base, status: active.status as FactcheckStatus }
  const latestForCurrent = forCurrent[0]
  if (latestForCurrent?.status === 'paused_budget') return { ...base, status: 'paused_budget' }
  if (!lastDone) {
    const failed = input.jobs.find(job => job.status === 'failed')
    if (failed && failed.documentVersionId === current) return { ...base, status: 'failed', lastError: failed.lastError || null }
    return { ...base, status: 'never' }
  }
  if (checkedVersionId === current) return { ...base, status: 'done' }
  const checked = input.versions.find(version => version.id === checkedVersionId)
  if (checked) {
    const newer = input.versions.filter(version => version.id !== checked.id && time(version.createdAt) > time(checked.createdAt))
    if (newer.length && newer.every(version => version.source === 'ai_fix')) return { ...base, status: 'done' }
  }
  if (latestForCurrent?.status === 'failed') return { ...base, status: 'failed', lastError: latestForCurrent.lastError || null }
  return { ...base, status: 'outdated' }
}

export async function getFactcheckState(db: AppDb, workspaceId: string, documentId: string): Promise<FactcheckState> {
  const [note] = await db.select({ currentVersionId: documents.currentVersionId }).from(documents).where(and(
    eq(documents.id, documentId),
    eq(documents.workspaceId, workspaceId)
  )).limit(1)
  const rows = await db.select({
    status: jobs.status,
    payload: jobs.payload,
    updatedAt: jobs.updatedAt,
    lastError: jobs.lastError
  }).from(jobs).where(and(
    eq(jobs.workspaceId, workspaceId),
    eq(jobs.kind, 'factcheck'),
    sql`${jobs.payload}->>'documentId' = ${documentId}`
  )).orderBy(desc(jobs.createdAt)).limit(30)
  const versions = await db.select({
    id: documentVersions.id,
    source: documentVersions.source,
    createdAt: documentVersions.createdAt
  }).from(documentVersions).where(eq(documentVersions.documentId, documentId))
  return computeFactcheckState({
    currentVersionId: note?.currentVersionId || null,
    jobs: rows.map(row => ({
      status: row.status,
      documentVersionId: String((row.payload as Record<string, unknown> | null)?.documentVersionId || ''),
      updatedAt: row.updatedAt,
      lastError: row.lastError
    })),
    versions
  })
}
