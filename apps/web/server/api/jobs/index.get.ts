import { documentJobStatus } from '@kb/pipeline'
import { requireOwner, useDb, withApi } from '../../utils/context'

export default defineEventHandler((event) => withApi(async () => {
  const user = await requireOwner(event)
  const documentId = String(getQuery(event).documentId || '')
  if (!documentId) throw createError({ statusCode: 400, message: '缺少 documentId' })
  return documentJobStatus(await useDb(), user.workspaceId, documentId)
}))
