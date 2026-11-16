import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { documents, notifications, workspaces } from '@kb/db'
import { resolveRuntime } from '@kb/ai'
import { ensureBudgetPeriod, rebuildOverview } from '@kb/pipeline'
import { requireOwner, useDb, withApi } from '../utils/context'

export default defineEventHandler((event) => withApi(async () => {
  const user = await requireOwner(event)
  const db = await useDb()
  const budget = await ensureBudgetPeriod(db, user.workspaceId)
  const [workspace] = await db.select().from(workspaces).where(eq(workspaces.id, user.workspaceId)).limit(1)
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(documents).where(and(
    eq(documents.workspaceId, user.workspaceId),
    isNull(documents.deletedAt)
  ))
  let llm = { provider: 'mock' as 'mock' | 'gemini', extractionModel: '', verdictModel: '' }
  try {
    const runtime = resolveRuntime()
    llm = { provider: runtime.provider, extractionModel: runtime.extractionModel, verdictModel: runtime.verdictModel }
  } catch (error) {
    llm = { provider: 'gemini', extractionModel: '', verdictModel: error instanceof Error ? error.message : '設定不完整' }
  }
  const inbox = await db.select().from(notifications).where(and(
    eq(notifications.userId, user.id),
    eq(notifications.workspaceId, user.workspaceId)
  )).orderBy(desc(notifications.createdAt)).limit(12)
  return {
    workspace,
    noteCount: Number(count || 0),
    budget: budget.period,
    ratio: budget.period.capUsd ? budget.period.spentUsd / budget.period.capUsd : 0,
    llm,
    rebuild: await rebuildOverview(db, user.workspaceId),
    notifications: inbox
  }
}))
