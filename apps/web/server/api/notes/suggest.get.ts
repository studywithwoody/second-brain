import { suggestTitles } from '@kb/pipeline'
import { requireOwner, useDb, withApi } from '../../utils/context'

export default defineEventHandler((event) => withApi(async () => {
  const user = await requireOwner(event)
  const q = String(getQuery(event).q || '')
  return { notes: await suggestTitles(await useDb(), user.workspaceId, q) }
}))
