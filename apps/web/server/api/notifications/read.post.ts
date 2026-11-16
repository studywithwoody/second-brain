import { and, eq, isNull } from 'drizzle-orm'
import { notifications } from '@kb/db'
import { requireOwner, useDb, withApi } from '../../utils/context'

export default defineEventHandler((event) => withApi(async () => {
  const user = await requireOwner(event)
  await (await useDb()).update(notifications).set({ readAt: new Date() }).where(and(
    eq(notifications.userId, user.id),
    eq(notifications.workspaceId, user.workspaceId),
    isNull(notifications.readAt)
  ))
  return { ok: true }
}))
