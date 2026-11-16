import { enqueueFactcheck, inlineJobsEnabled, processPending } from '@kb/pipeline'
import { JOB_BUDGET_MS, requireOwner, runQueuedJobs, useDb, withApi } from '../../../utils/context'

export default defineEventHandler((event) => withApi(async () => {
  const user = await requireOwner(event)
  const db = await useDb()
  const queued = await enqueueFactcheck(db, user.workspaceId, getRouterParam(event, 'id') || '')
  if (inlineJobsEnabled() && !queued.blocked && !queued.duplicate) {
    await runQueuedJobs(event, () => processPending(db, user.workspaceId, 3, { budgetMs: JOB_BUDGET_MS }))
  }
  return queued
}))
