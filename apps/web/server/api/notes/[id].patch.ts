import { getNote, saveNote } from '@kb/pipeline'
import { requireOwner, useDb, withApi } from '../../utils/context'

export default defineEventHandler((event) => withApi(async () => {
  const user = await requireOwner(event)
  const body = await readBody(event)
  const db = await useDb()
  const documentId = getRouterParam(event, 'id') || ''

  let content = body.content
  let title = body.title
  let tags = body.tags
  if (content === undefined || title === undefined || tags === undefined) {
    const existing = await getNote(db, user.workspaceId, documentId)
    if (existing) {
      if (content === undefined) content = existing.note.content
      if (title === undefined) title = existing.note.title
      if (tags === undefined) tags = existing.note.tags
    }
  }

  const saved = await saveNote(db, {
    workspaceId: user.workspaceId,
    userId: user.id,
    documentId,
    title,
    path: body.path,
    content: content || '',
    tags,
    webSearchOverride: body.webSearchOverride
  })
  // Saving never starts a fact-check; the user runs it from the note page (「事實查核」).
  return saved
}))
