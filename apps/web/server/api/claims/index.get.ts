import { and, desc, eq, inArray } from 'drizzle-orm'
import { claimReviews, claims, documents } from '@kb/db'
import { requireOwner, useDb, withApi } from '../../utils/context'

export default defineEventHandler((event) => withApi(async () => {
  const user = await requireOwner(event)
  const db = await useDb()
  const rows = await db.select({
    id: claims.id,
    text: claims.text,
    verdict: claims.verdict,
    confidence: claims.confidence,
    reasoning: claims.reasoning,
    suggestedFix: claims.suggestedFix,
    citations: claims.citations,
    documentId: claims.documentId,
    title: documents.title,
    createdAt: claims.createdAt
  }).from(claims).innerJoin(documents, eq(documents.id, claims.documentId)).where(and(
    eq(claims.workspaceId, user.workspaceId),
    inArray(claims.verdict, ['contradicted', 'uncertain'])
  )).orderBy(desc(claims.createdAt)).limit(80)
  const reviews = rows.length
    ? await db.select().from(claimReviews).where(inArray(claimReviews.claimId, rows.map(row => row.id)))
    : []
  return {
    claims: rows.map(row => ({ ...row, review: reviews.find(review => review.claimId === row.id) || null }))
  }
}))
