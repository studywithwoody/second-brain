import { reviewClaim } from '@kb/pipeline'
import { requireOwner, useDb, withApi } from '../../../utils/context'

// Accepting a fix only edits that sentence and marks the claim resolved; it does not re-run the note's fact-check.
export default defineEventHandler((event) => withApi(async () => {
  const user = await requireOwner(event)
  const body = await readBody(event)
  const db = await useDb()
  return reviewClaim(db, {
    workspaceId: user.workspaceId,
    userId: user.id,
    claimId: getRouterParam(event, 'id') || '',
    decision: body.decision,
    note: body.note
  })
}))
