import { getNote } from '@kb/pipeline'
import { requireOwner, useDb, withApi } from '../../utils/context'

export default defineEventHandler((event) => withApi(async () => {
  const user = await requireOwner(event)
  const note = await getNote(await useDb(), user.workspaceId, getRouterParam(event, 'id') || '')
  if (!note) throw createError({ statusCode: 404, message: '找不到筆記' })
  return note
}))
