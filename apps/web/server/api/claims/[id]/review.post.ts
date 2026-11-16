import { enqueueFactcheck, inlineJobsEnabled, processPending, reviewClaim } from '@kb/pipeline'
import { JOB_BUDGET_MS, requireOwner, runQueuedJobs, useDb, withApi } from '../../../utils/context'

export default defineEventHandler((event) => withApi(async () => {
  const user = await requireOwner(event)
  const body = await readBody(event)
  const db = await useDb()
  const result = await reviewClaim(db, {
    workspaceId: user.workspaceId,
    userId: user.id,
    claimId: getRouterParam(event, 'id') || '',
    decision: body.decision,
    note: body.note
  })
  if (result.versionId && inlineJobsEnabled()) {
    const { claims } = await import('@kb/db')
    const { eq } = await import('drizzle-orm')
    const [claim] = await db.select().from(claims).where(eq(claims.id, getRouterParam(event, 'id') || '')).limit(1)
    if (claim) {
      const queued = await enqueueFactcheck(db, user.workspaceId, claim.documentId)
      if (!queued.blocked) {
        await runQueuedJobs(event, () => processPending(db, user.workspaceId, 3, { budgetMs: JOB_BUDGET_MS }))
      }
    }
  }
  return result
}))
