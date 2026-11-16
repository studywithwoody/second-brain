import { listChangesets } from '@kb/pipeline'
import { requireOwner, useDb, withApi } from '../../utils/context'

export default defineEventHandler((event) => withApi(async () => {
  const user = await requireOwner(event)
  return { changesets: await listChangesets(await useDb(), user.workspaceId) }
}))
