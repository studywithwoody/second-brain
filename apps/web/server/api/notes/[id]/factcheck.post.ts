import { enqueueFactcheck, inlineJobsEnabled, processPending } from '@kb/pipeline'
import { requireOwner, useDb, withApi } from '../../../utils/context'

export default defineEventHandler((event) => withApi(async () => {
  const user = await requireOwner(event)
  const db = await useDb()
  const queued = await enqueueFactcheck(db, user.workspaceId, getRouterParam(event, 'id') || '')
  if (inlineJobsEnabled() && !queued.blocked && !queued.duplicate) await processPending(db, user.workspaceId, 3)
  return queued
}))
