import { enqueueFactcheck, inlineJobsEnabled, processPending, saveNote } from '@kb/pipeline'
import { JOB_BUDGET_MS, requireOwner, runQueuedJobs, useDb, withApi } from '../../utils/context'

export default defineEventHandler((event) => withApi(async () => {
  const user = await requireOwner(event)
  const body = await readBody(event)
  const db = await useDb()
  const saved = await saveNote(db, {
    workspaceId: user.workspaceId,
    userId: user.id,
    documentId: getRouterParam(event, 'id'),
    title: body.title,
    path: body.path,
    content: body.content || '',
    tags: body.tags,
    webSearchOverride: body.webSearchOverride
  })
  let factcheck = null
  if (saved.changed) {
    factcheck = await enqueueFactcheck(db, user.workspaceId, saved.documentId)
    if (inlineJobsEnabled() && !factcheck.blocked) {
      await runQueuedJobs(event, () => processPending(db, user.workspaceId, 3, { budgetMs: JOB_BUDGET_MS }))
    }
  }
  return { ...saved, factcheck }
}))
