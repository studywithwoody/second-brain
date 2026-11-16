import { listNotes } from '@kb/pipeline'
import { requireOwner, useDb, withApi } from '../../utils/context'

export default defineEventHandler((event) => withApi(async () => {
  const user = await requireOwner(event)
  const query = getQuery(event)
  const notes = await listNotes(await useDb(), user.workspaceId, {
    folder: typeof query.folder === 'string' ? query.folder : undefined,
    tag: typeof query.tag === 'string' ? query.tag : undefined
  })
  return { notes }
}))
