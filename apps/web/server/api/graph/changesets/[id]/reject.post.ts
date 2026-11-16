import { rejectChangeset } from '@kb/pipeline'
import { requireOwner, useDb, withApi } from '../../../../utils/context'

export default defineEventHandler((event) => withApi(async () => {
  const user = await requireOwner(event)
  const body = await readBody(event)
  await rejectChangeset(await useDb(), user.workspaceId, getRouterParam(event, 'id') || '', user.id, String(body.note || ''))
  return { ok: true }
}))
