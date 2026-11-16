import { deleteNote } from '@kb/pipeline'
import { requireOwner, useDb, withApi } from '../../utils/context'

export default defineEventHandler((event) => withApi(async () => {
  const user = await requireOwner(event)
  await deleteNote(await useDb(), user.workspaceId, getRouterParam(event, 'id') || '')
  return { ok: true }
}))
