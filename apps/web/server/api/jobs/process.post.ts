import { hasRunnableJobs, inlineJobsEnabled, processPending } from '@kb/pipeline'
import { JOB_BUDGET_MS, requireOwner, runQueuedJobs, useDb, withApi } from '../../utils/context'

/** Nudge the queue: picks up queued work and jobs whose earlier function run was cut off. */
export default defineEventHandler((event) => withApi(async () => {
  const user = await requireOwner(event)
  const db = await useDb()
  if (!inlineJobsEnabled()) return { started: false, reason: 'worker' }
  if (!(await hasRunnableJobs(db, user.workspaceId))) return { started: false }
  await runQueuedJobs(event, () => processPending(db, user.workspaceId, 3, { budgetMs: JOB_BUDGET_MS }))
  return { started: true }
}))
