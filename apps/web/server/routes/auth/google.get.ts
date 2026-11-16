import { upsertOwner } from '@kb/pipeline'
import { ownerEmail, useDb } from '../../utils/context'

export default defineOAuthGoogleEventHandler({
  async onSuccess(event, { user }) {
    const email = String(user.email || '').toLowerCase()
    const allowed = ownerEmail()
    if (!allowed || email !== allowed) {
      return sendRedirect(event, '/login?error=owner')
    }
    const db = await useDb()
    const account = await upsertOwner(db, email, String(user.name || email))
    await setUserSession(event, {
      user: {
        id: account.user.id,
        email: account.user.email,
        name: account.user.name || email,
        role: 'owner',
        workspaceId: account.workspace.id
      }
    })
    return sendRedirect(event, '/')
  },
  onError(event) {
    return sendRedirect(event, '/login?error=oauth')
  }
})
