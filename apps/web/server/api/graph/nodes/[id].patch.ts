import { updateNodeManual } from '@kb/pipeline'
import { requireOwner, useDb, withApi } from '../../../utils/context'

export default defineEventHandler((event) => withApi(async () => {
  const user = await requireOwner(event)
  const body = await readBody(event)
  return updateNodeManual(await useDb(), {
    workspaceId: user.workspaceId,
    userId: user.id,
    nodeId: getRouterParam(event, 'id') || '',
    labelZh: body.labelZh,
    labelEn: body.labelEn,
    aliases: body.aliases,
    locked: body.locked,
    type: body.type
  })
}))
