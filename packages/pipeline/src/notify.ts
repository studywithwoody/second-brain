import { notifications, users, type AppDb } from '@kb/db'
import { eq } from 'drizzle-orm'

export async function notifyUser(db: AppDb, input: {
  workspaceId: string
  userId: string
  kind: 'suggestion' | 'budget_warning' | 'budget_paused' | 'budget_resumed' | 'factcheck_ready' | 'changeset_ready'
  title: string
  body: string
  payload?: Record<string, unknown>
}) {
  const [row] = await db.insert(notifications).values({
    userId: input.userId,
    workspaceId: input.workspaceId,
    kind: input.kind,
    payload: { title: input.title, body: input.body, ...(input.payload || {}) }
  }).returning()
  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.NOTIFY_EMAIL_FROM
  if (!apiKey || !from || !row) return row
  const [user] = await db.select().from(users).where(eq(users.id, input.userId)).limit(1)
  if (!user?.email) return row
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        from,
        to: user.email,
        subject: input.title,
        text: input.body
      })
    })
    if (response.ok) {
      await db.update(notifications).set({ emailedAt: new Date() }).where(eq(notifications.id, row.id))
    }
  } catch (error) {
    console.warn('[notify] email failed', error instanceof Error ? error.message : error)
  }
  return row
}
