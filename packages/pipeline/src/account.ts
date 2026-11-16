import { eq } from 'drizzle-orm'
import { users, workspaceMembers, workspaces, type AppDb } from '@kb/db'
import { ensureBudgetPeriod } from './budget'
import { ensureRootVersion } from './graph-repo'

export async function upsertOwner(db: AppDb, email: string, name: string) {
  const normalized = email.trim().toLowerCase()
  if (!normalized) throw new Error('缺少擁有者信箱')
  const [found] = await db.select().from(users).where(eq(users.email, normalized)).limit(1)
  const user = found || (await db.insert(users).values({ email: normalized, name: name || normalized }).returning())[0]!
  if (found && name && found.name !== name) {
    await db.update(users).set({ name }).where(eq(users.id, found.id))
  }
  const [owned] = await db.select().from(workspaces).where(eq(workspaces.ownerId, user.id)).limit(1)
  if (owned) {
    await ensureRootVersion(db, owned.id)
    return { user, workspace: owned }
  }
  const cap = Number(process.env.MONTHLY_BUDGET_USD || 10)
  const [workspace] = await db.insert(workspaces).values({
    ownerId: user.id,
    name: '我的知識庫',
    graphDisplayLang: 'zh-TW',
    webSearchEnabled: false,
    monthlyBudgetUsd: Number.isFinite(cap) && cap > 0 ? cap : 10
  }).returning()
  await db.insert(workspaceMembers).values({
    workspaceId: workspace!.id,
    userId: user.id,
    role: 'owner'
  })
  await ensureRootVersion(db, workspace!.id)
  await ensureBudgetPeriod(db, workspace!.id)
  return { user, workspace: workspace! }
}
