import { saveNote } from '@kb/pipeline'
import { requireOwner, useDb, withApi } from '../../utils/context'

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
  // Saving never starts a fact-check; the user runs it from the note page (「事實查核」).
  return saved
}))
