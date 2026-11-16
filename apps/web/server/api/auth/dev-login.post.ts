import { upsertOwner } from '@kb/pipeline'
import { devBypassAllowed, ownerEmail, useDb } from '../../utils/context'

export default defineEventHandler(async (event) => {
  if (!devBypassAllowed()) {
    throw createError({ statusCode: 404, message: '開發登入只在非正式環境且 DEV_AUTH_BYPASS=true 時開放' })
  }
  const email = ownerEmail() || 'owner@localhost'
  const db = await useDb()
  const { user, workspace } = await upsertOwner(db, email, '擁有者')
  await setUserSession(event, {
    user: {
      id: user.id,
      email: user.email,
      name: user.name || '擁有者',
      role: 'owner',
      workspaceId: workspace.id
    }
  })
  return { ok: true }
})
