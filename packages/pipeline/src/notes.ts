import { and, desc, eq, ilike, inArray, isNull, sql } from 'drizzle-orm'
import {
  claimReviews,
  claims,
  docChunks,
  docLinks,
  documentVersions,
  documents,
  type AppDb
} from '@kb/db'
import { embedTexts, estimateFactcheckCost, estimateGraphCost } from '@kb/ai'
import { chunksOf, noteSearchText, parseNote, wikilinks } from './markdown'
import { id, sha256 } from './util'
import { addSpend } from './budget'
import { getFactcheckState } from './factcheck-state'

export interface SaveNoteInput {
  workspaceId: string
  userId: string
  documentId?: string
  title?: string
  path?: string
  content: string
  tags?: string[]
  webSearchOverride?: boolean | null
  source?: 'edit' | 'import' | 'ai_fix'
}

export async function listNotes(db: AppDb, workspaceId: string, query?: { folder?: string, tag?: string }) {
  const rows = await db.select({
    id: documents.id,
    title: documents.title,
    path: documents.path,
    tags: documents.tags,
    updatedAt: documents.updatedAt
  }).from(documents).where(and(
    eq(documents.workspaceId, workspaceId),
    isNull(documents.deletedAt)
  )).orderBy(desc(documents.updatedAt))
  return rows.filter(row => {
    if (query?.folder && !row.path.startsWith(query.folder.replace(/\/$/, ''))) return false
    if (query?.tag && !(row.tags || []).includes(query.tag)) return false
    return true
  })
}

export async function searchNotes(db: AppDb, workspaceId: string, q: string) {
  const query = q.trim()
  if (!query) return listNotes(db, workspaceId)
  const tokens = query.split(/\s+/).map(token => token.replace(/[^\p{L}\p{N}_-]/gu, '')).filter(Boolean)
  if (!tokens.length) {
    return db.select({
      id: documents.id,
      title: documents.title,
      path: documents.path,
      tags: documents.tags,
      updatedAt: documents.updatedAt
    }).from(documents).where(and(
      eq(documents.workspaceId, workspaceId),
      isNull(documents.deletedAt),
      ilike(documents.title, `%${query}%`)
    )).limit(30)
  }
  const tsquery = tokens.join(' | ')
  const rows = await db.execute(sql`
    SELECT id, title, path, tags, updated_at AS "updatedAt",
           ts_rank(search_vector, to_tsquery('simple', ${tsquery})) AS rank
    FROM documents
    WHERE workspace_id = ${workspaceId}
      AND deleted_at IS NULL
      AND (
        search_vector @@ to_tsquery('simple', ${tsquery})
        OR title ILIKE ${'%' + query + '%'}
        OR search_text ILIKE ${'%' + query + '%'}
      )
    ORDER BY rank DESC NULLS LAST, updated_at DESC
    LIMIT 30
  `)
  const list = Array.isArray(rows) ? rows : (rows as { rows: unknown[] }).rows
  return (list as Array<Record<string, unknown>>).map(row => ({
    id: String(row.id),
    title: String(row.title),
    path: String(row.path),
    tags: (row.tags as string[]) || [],
    updatedAt: row.updatedAt as Date,
    rank: Number(row.rank || 0)
  }))
}

export async function getNote(db: AppDb, workspaceId: string, documentId: string) {
  const [note] = await db.select().from(documents).where(and(
    eq(documents.id, documentId),
    eq(documents.workspaceId, workspaceId),
    isNull(documents.deletedAt)
  )).limit(1)
  if (!note || !note.currentVersionId) return null
  const [version] = await db.select().from(documentVersions).where(eq(documentVersions.id, note.currentVersionId)).limit(1)
  const versions = await db.select({
    id: documentVersions.id,
    source: documentVersions.source,
    contentHash: documentVersions.contentHash,
    createdAt: documentVersions.createdAt
  }).from(documentVersions).where(eq(documentVersions.documentId, note.id)).orderBy(desc(documentVersions.createdAt))
  const outbound = await db.select().from(docLinks).where(eq(docLinks.fromDocumentId, note.id))
  const backlinks = await db.select({
    id: documents.id,
    title: documents.title,
    path: documents.path
  }).from(docLinks).innerJoin(documents, eq(documents.id, docLinks.fromDocumentId)).where(and(
    eq(docLinks.toDocumentId, note.id),
    isNull(documents.deletedAt)
  ))
  // Fact-checks are manual, so show the claims from the last completed check even if the note changed since.
  const factcheck = await getFactcheckState(db, workspaceId, note.id)
  const claimsVersionId = factcheck.checkedVersionId || note.currentVersionId
  const claimRows = await db.select().from(claims).where(eq(claims.documentVersionId, claimsVersionId)).orderBy(claims.spanStart)
  const reviews = claimRows.length
    ? await db.select().from(claimReviews).where(inArray(claimReviews.claimId, claimRows.map(row => row.id)))
    : []
  const content = version?.contentMd || ''
  return {
    note: {
      id: note.id,
      title: note.title,
      path: note.path,
      tags: note.tags || [],
      visibility: note.visibility,
      webSearchOverride: note.webSearchOverride,
      updatedAt: note.updatedAt,
      content
    },
    versions,
    outbound: outbound.map(link => ({
      title: link.toTitle,
      documentId: link.toDocumentId,
      resolved: link.resolved
    })),
    backlinks,
    claims: claimRows.map(claim => ({
      ...claim,
      review: reviews.find(review => review.claimId === claim.id) || null
    })),
    factcheck,
    estimates: {
      factcheckUsd: estimateFactcheckCost(content.length),
      graphUsd: estimateGraphCost(content.length)
    }
  }
}

export async function getVersionContent(db: AppDb, workspaceId: string, documentId: string, versionId: string) {
  const [note] = await db.select().from(documents).where(and(
    eq(documents.id, documentId),
    eq(documents.workspaceId, workspaceId)
  )).limit(1)
  if (!note) return null
  const [version] = await db.select().from(documentVersions).where(and(
    eq(documentVersions.id, versionId),
    eq(documentVersions.documentId, documentId)
  )).limit(1)
  return version || null
}

export async function saveNote(db: AppDb, input: SaveNoteInput) {
  const parsed = parseNote(input.content, input.title || '未命名')
  const title = (input.title || parsed.title).trim()
  const tags = [...new Set([...(input.tags || []), ...parsed.tags])]
  const path = (input.path || title).replace(/^\/+|\/+$/g, '').replace(/\.md$/i, '')
  const hash = sha256(input.content)
  const webSearchOverride = input.webSearchOverride === undefined ? (parsed.webSearch ?? null) : input.webSearchOverride

  let documentId = input.documentId
  if (!documentId) {
    const [created] = await db.insert(documents).values({
      workspaceId: input.workspaceId,
      path,
      title,
      tags,
      webSearchOverride,
      searchText: noteSearchText(title, path, tags, input.content)
    }).returning()
    documentId = created!.id
  }

  const [existing] = await db.select().from(documents).where(and(
    eq(documents.id, documentId),
    eq(documents.workspaceId, input.workspaceId)
  )).limit(1)
  if (!existing) throw new Error('找不到筆記')

  let versionId = existing.currentVersionId
  let changed = true
  if (versionId) {
    const [current] = await db.select().from(documentVersions).where(eq(documentVersions.id, versionId)).limit(1)
    if (current?.contentHash === hash && existing.title === title && existing.path === path) {
      changed = false
    }
  }
  if (changed) {
    const [version] = await db.insert(documentVersions).values({
      documentId,
      contentMd: input.content,
      contentHash: hash,
      createdBy: input.userId,
      source: input.source || 'edit'
    }).returning()
    versionId = version!.id
  }

  await db.update(documents).set({
    title,
    path,
    tags,
    webSearchOverride,
    currentVersionId: versionId,
    searchText: noteSearchText(title, path, tags, input.content),
    deletedAt: null,
    updatedAt: new Date()
  }).where(eq(documents.id, documentId))
  await db.execute(sql`
    UPDATE documents
    SET search_vector = to_tsvector('simple', ${noteSearchText(title, path, tags, input.content)})
    WHERE id = ${documentId}
  `)

  if (changed && versionId) {
    await db.delete(docChunks).where(eq(docChunks.documentId, documentId))
    const pieces = chunksOf(input.content)
    if (pieces.length) {
      const embedded = await embedTexts(pieces.map(piece => piece.text))
      // Embeddings are cheap but still count toward the monthly AI budget.
      await addSpend(db, input.workspaceId, embedded.usage.costUsd)
      await db.insert(docChunks).values(pieces.map(piece => ({
        id: id(),
        workspaceId: input.workspaceId,
        documentId,
        documentVersionId: versionId!,
        ordinal: piece.ordinal,
        text: piece.text,
        spanStart: piece.spanStart,
        spanEnd: piece.spanEnd
      })))
      for (let index = 0; index < pieces.length; index++) {
        const piece = pieces[index]!
        const vector = embedded.vectors[index]
        await db.execute(sql`
          UPDATE doc_chunks
          SET search_vector = to_tsvector('simple', ${piece.text}),
              embedding = ${JSON.stringify(vector)}::vector
          WHERE document_version_id = ${versionId} AND ordinal = ${piece.ordinal}
        `)
      }
    }
    await db.delete(docLinks).where(eq(docLinks.fromDocumentId, documentId))
    const links = wikilinks(input.content)
    if (links.length) {
      const all = await db.select({ id: documents.id, title: documents.title }).from(documents).where(and(
        eq(documents.workspaceId, input.workspaceId),
        isNull(documents.deletedAt)
      ))
      await db.insert(docLinks).values(links.map(link => {
        const target = all.find(item => item.title.toLowerCase() === link.title.toLowerCase() && item.id !== documentId)
        return {
          workspaceId: input.workspaceId,
          fromDocumentId: documentId!,
          toDocumentId: target?.id || null,
          toTitle: link.title,
          resolved: Boolean(target)
        }
      }))
    }
  }

  await db.update(docLinks).set({ toDocumentId: documentId, resolved: true }).where(and(
    eq(docLinks.workspaceId, input.workspaceId),
    sql`lower(${docLinks.toTitle}) = lower(${title})`,
    isNull(docLinks.toDocumentId)
  ))

  return { documentId, versionId: versionId!, changed, title, path }
}

export async function deleteNote(db: AppDb, workspaceId: string, documentId: string) {
  const [note] = await db.select().from(documents).where(and(
    eq(documents.id, documentId),
    eq(documents.workspaceId, workspaceId)
  )).limit(1)
  if (!note) return
  await db.update(documents).set({
    deletedAt: new Date(),
    path: `${note.path}__deleted__${note.id}`,
    updatedAt: new Date()
  }).where(eq(documents.id, documentId))
}

export async function suggestTitles(db: AppDb, workspaceId: string, q: string) {
  const rows = await listNotes(db, workspaceId)
  const query = q.trim().toLowerCase()
  return rows
    .filter(row => !query || row.title.toLowerCase().includes(query) || row.path.toLowerCase().includes(query))
    .slice(0, 8)
    .map(row => ({ id: row.id, title: row.title, path: row.path }))
}
