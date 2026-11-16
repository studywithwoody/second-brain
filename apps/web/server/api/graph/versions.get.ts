import { listVersions } from '@kb/pipeline'
import { requireOwner, useDb, withApi } from '../../utils/context'

export default defineEventHandler((event) => withApi(async () => {
  const user = await requireOwner(event)
  return { versions: await listVersions(await useDb(), user.workspaceId) }
}))
