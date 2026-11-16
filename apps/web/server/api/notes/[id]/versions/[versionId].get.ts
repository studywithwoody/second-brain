import { getVersionContent } from '@kb/pipeline'
import { requireOwner, useDb, withApi } from '../../../../utils/context'

export default defineEventHandler((event) => withApi(async () => {
  const user = await requireOwner(event)
  const version = await getVersionContent(
    await useDb(),
    user.workspaceId,
    getRouterParam(event, 'id') || '',
    getRouterParam(event, 'versionId') || ''
  )
  if (!version) throw createError({ statusCode: 404, message: '找不到版本' })
  return version
}))
