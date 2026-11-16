import { and, eq, sql } from 'drizzle-orm'
import { budgetPeriods, jobs, workspaces, type AppDb } from '@kb/db'
import { budgetDecision } from '@kb/ai'
import { currentMonth } from './util'
import { notifyUser } from './notify'

export async function getWorkspace(db: AppDb, workspaceId: string) {
  const [workspace] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1)
  if (!workspace) throw new Error('找不到工作區')
  return workspace
}

export async function ensureBudgetPeriod(db: AppDb, workspaceId: string) {
  const workspace = await getWorkspace(db, workspaceId)
  const month = currentMonth()
  const [existing] = await db.select().from(budgetPeriods).where(and(
    eq(budgetPeriods.workspaceId, workspaceId),
    eq(budgetPeriods.month, month)
  )).limit(1)
  if (existing) return { workspace, period: existing, rolled: false }
  const [created] = await db.insert(budgetPeriods).values({
    workspaceId,
    month,
    capUsd: workspace.monthlyBudgetUsd,
    spentUsd: 0
  }).onConflictDoNothing().returning()
  const period = created || (await db.select().from(budgetPeriods).where(and(
    eq(budgetPeriods.workspaceId, workspaceId),
    eq(budgetPeriods.month, month)
  )).limit(1))[0]!
  const resumed = await db.update(jobs).set({
    status: 'queued',
    updatedAt: new Date()
  }).where(and(
    eq(jobs.workspaceId, workspaceId),
    eq(jobs.status, 'paused_budget')
  )).returning({ id: jobs.id })
  if (resumed.length) {
    await notifyUser(db, {
      workspaceId,
      userId: workspace.ownerId,
      kind: 'budget_resumed',
      title: '本月 AI 預算已重置',
      body: `排隊中的 ${resumed.length} 個任務已恢復。`
    })
  }
  return { workspace, period, rolled: resumed.length > 0 }
}

export async function gateBudget(db: AppDb, workspaceId: string, estimate: number) {
  const { workspace, period } = await ensureBudgetPeriod(db, workspaceId)
  const decision = budgetDecision(period.spentUsd, period.capUsd, estimate)
  return { workspace, period, ...decision }
}

export async function addSpend(db: AppDb, workspaceId: string, amount: number) {
  if (!(amount > 0)) return gateBudget(db, workspaceId, 0)
  const { period, workspace } = await ensureBudgetPeriod(db, workspaceId)
  await db.update(budgetPeriods).set({
    spentUsd: sql`${budgetPeriods.spentUsd} + ${amount}`
  }).where(eq(budgetPeriods.id, period.id))
  const [updated] = await db.select().from(budgetPeriods).where(eq(budgetPeriods.id, period.id)).limit(1)
  const spent = updated?.spentUsd ?? period.spentUsd + amount
  const decision = budgetDecision(spent, updated?.capUsd ?? period.capUsd, 0)
  if (decision.warn && !updated?.warnedAt && !decision.block) {
    await db.update(budgetPeriods).set({ warnedAt: new Date() }).where(eq(budgetPeriods.id, period.id))
    await notifyUser(db, {
      workspaceId,
      userId: workspace.ownerId,
      kind: 'budget_warning',
      title: '本月 AI 預算已用到 80%',
      body: `已使用約 $${spent.toFixed(4)}，上限 $${(updated?.capUsd ?? period.capUsd).toFixed(2)}。新的大型任務送出前會先顯示預估費用。`
    })
  }
  if (decision.block && !updated?.pausedAt) {
    await db.update(budgetPeriods).set({ pausedAt: new Date() }).where(eq(budgetPeriods.id, period.id))
    const paused = await db.update(jobs).set({
      status: 'paused_budget',
      updatedAt: new Date()
    }).where(and(eq(jobs.workspaceId, workspaceId), eq(jobs.status, 'queued'))).returning({ id: jobs.id })
    await notifyUser(db, {
      workspaceId,
      userId: workspace.ownerId,
      kind: 'budget_paused',
      title: '已達每月 AI 預算上限',
      body: `AI 任務已暫停。排隊 ${paused.length} 個，下個月或調高上限後會繼續。`
    })
  }
  return { workspace, period: updated || period, ...decision }
}

export async function setBudgetCap(db: AppDb, workspaceId: string, capUsd: number) {
  if (!(capUsd > 0) || capUsd > 1000) throw new Error('每月上限需介於 0 與 1000 美元之間')
  await db.update(workspaces).set({ monthlyBudgetUsd: capUsd }).where(eq(workspaces.id, workspaceId))
  const { period } = await ensureBudgetPeriod(db, workspaceId)
  await db.update(budgetPeriods).set({ capUsd }).where(eq(budgetPeriods.id, period.id))
  const decision = budgetDecision(period.spentUsd, capUsd, 0)
  if (!decision.block) {
    await db.update(jobs).set({ status: 'queued', updatedAt: new Date() }).where(and(
      eq(jobs.workspaceId, workspaceId),
      eq(jobs.status, 'paused_budget')
    ))
    await db.update(budgetPeriods).set({ pausedAt: null }).where(eq(budgetPeriods.id, period.id))
  }
  return decision
}
