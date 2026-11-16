import { and, eq } from 'drizzle-orm'
import { claimReviews, claims, documentVersions, documents, type AppDb } from '@kb/db'
import { saveNote } from './notes'

export async function reviewClaim(db: AppDb, input: {
  workspaceId: string
  userId: string
  claimId: string
  decision: 'accept_fix' | 'keep_noted' | 'mark_false_positive'
  note?: string
}) {
  const [claim] = await db.select().from(claims).where(and(
    eq(claims.id, input.claimId),
    eq(claims.workspaceId, input.workspaceId)
  )).limit(1)
  if (!claim) throw new Error('找不到主張')
  const [existing] = await db.select().from(claimReviews).where(eq(claimReviews.claimId, claim.id)).limit(1)
  if (existing) throw new Error('這條主張已經覆核過')
  let versionId: string | null = null
  if (input.decision === 'accept_fix') {
    if (!claim.suggestedFix) throw new Error('這條主張沒有建議修正')
    const [version] = await db.select().from(documentVersions).where(eq(documentVersions.id, claim.documentVersionId)).limit(1)
    if (!version) throw new Error('找不到原文')
    const current = version.contentMd.slice(claim.spanStart, claim.spanEnd)
    if (current !== claim.text) throw new Error('原文已變更，請直接在編輯器修改')
    const content = version.contentMd.slice(0, claim.spanStart) + claim.suggestedFix + version.contentMd.slice(claim.spanEnd)
    const [note] = await db.select().from(documents).where(eq(documents.id, claim.documentId)).limit(1)
    const saved = await saveNote(db, {
      workspaceId: input.workspaceId,
      userId: input.userId,
      documentId: claim.documentId,
      title: note?.title,
      path: note?.path,
      tags: note?.tags || [],
      webSearchOverride: note?.webSearchOverride ?? undefined,
      content,
      source: 'ai_fix'
    })
    versionId = saved.versionId
  }
  const [review] = await db.insert(claimReviews).values({
    claimId: claim.id,
    decision: input.decision,
    note: input.note || '',
    reviewedBy: input.userId
  }).returning()
  return { review, versionId }
}
