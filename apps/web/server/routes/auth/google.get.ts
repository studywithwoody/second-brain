import { upsertOwner } from '@kb/pipeline'
import { ownerEmail, useDb } from '../../utils/context'

function loginErrorPath(event: Parameters<typeof getQuery>[0], fallback?: { message?: string }) {
  const query = getQuery(event)
  const googleError = String(query.error || '')
  const message = String(fallback?.message || '').slice(0, 200)
  console.error('[auth/google] failed', {
    googleError: googleError || undefined,
    message: message || undefined
  })
  if (googleError === 'access_denied') return '/login?error=denied'
  return '/login?error=oauth'
}

const googleHandler = defineOAuthGoogleEventHandler({
  async onSuccess(event, { user }) {
    try {
      const email = String(user.email || '').toLowerCase()
      const allowed = ownerEmail()
      if (!allowed || email !== allowed) {
        console.error('[auth/google] owner mismatch')
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
    } catch (err) {
      const message = String((err as { message?: string })?.message || err).slice(0, 200)
      console.error('[auth/google] onSuccess failed', { message })
      return sendRedirect(event, '/login?error=oauth')
    }
  },
  onError(event, error) {
    return sendRedirect(event, loginErrorPath(event, error))
  }
})

export default defineEventHandler((event) => {
  const query = getQuery(event)
  // nuxt-auth-utils 0.6.2 treats a callback without `code` as a new login
  // start, so Google errors like access_denied would otherwise loop back to
  // the consent screen instead of showing a login error.
  if (query.error && !query.code) {
    return sendRedirect(event, loginErrorPath(event))
  }
  return googleHandler(event)
})
