import { enqueueFactcheck, inlineJobsEnabled, processPending, saveNote } from '@kb/pipeline'
import { requireOwner, useDb, withApi } from '../../utils/context'

export default defineEventHandler((event) => withApi(async () => {
  const user = await requireOwner(event)
  const body = await readBody(event)
  const db = await useDb()
  const saved = await saveNote(db, {
    workspaceId: user.workspaceId,
    userId: user.id,
    title: body.title,
    path: body.path,
    content: body.content || '',
    tags: body.tags,
    webSearchOverride: body.webSearchOverride
  })
  let factcheck = null
  if (saved.changed) {
    factcheck = await enqueueFactcheck(db, user.workspaceId, saved.documentId)
    if (inlineJobsEnabled() && !factcheck.blocked) await processPending(db, user.workspaceId, 3)
  }
  return { ...saved, factcheck }
}))
