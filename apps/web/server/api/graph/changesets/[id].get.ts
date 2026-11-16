import { getChangesetDetail } from '@kb/pipeline'
import { requireOwner, useDb, withApi } from '../../../utils/context'

export default defineEventHandler((event) => withApi(async () => {
  const user = await requireOwner(event)
  const detail = await getChangesetDetail(await useDb(), user.workspaceId, getRouterParam(event, 'id') || '')
  if (!detail) throw createError({ statusCode: 404, message: '找不到變更集' })
  return detail
}))
