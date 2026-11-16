import { revertToVersion } from '@kb/pipeline'
import { requireOwner, useDb, withApi } from '../../../../utils/context'

export default defineEventHandler((event) => withApi(async () => {
  const user = await requireOwner(event)
  return revertToVersion(await useDb(), user.workspaceId, getRouterParam(event, 'id') || '')
}))
