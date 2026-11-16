import { inlineJobsEnabled, pauseRebuild, processPending, resumeRebuild, startRebuild } from '@kb/pipeline'
import { requireOwner, useDb, withApi } from '../../utils/context'

export default defineEventHandler((event) => withApi(async () => {
  const user = await requireOwner(event)
  const body = await readBody(event).catch(() => ({}))
  const db = await useDb()
  if (body.action === 'pause') {
    await pauseRebuild(db, user.workspaceId)
    return { ok: true }
  }
  if (body.action === 'resume') {
    await resumeRebuild(db, user.workspaceId)
    if (inlineJobsEnabled()) await processPending(db, user.workspaceId, 2)
    return { ok: true }
  }
  const started = await startRebuild(db, user.workspaceId)
  if (inlineJobsEnabled()) await processPending(db, user.workspaceId, 2)
  return started
}))
