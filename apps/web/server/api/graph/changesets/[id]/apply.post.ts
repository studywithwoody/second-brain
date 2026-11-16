import { applyChangeset } from '@kb/pipeline'
import { requireOwner, useDb, withApi } from '../../../../utils/context'

export default defineEventHandler((event) => withApi(async () => {
  const user = await requireOwner(event)
  const body = await readBody(event)
  return applyChangeset(await useDb(), {
    workspaceId: user.workspaceId,
    changesetId: getRouterParam(event, 'id') || '',
    userId: user.id,
    opIds: Array.isArray(body.opIds) ? body.opIds : undefined
  })
}))
