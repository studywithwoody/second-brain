import { and, eq, isNull, like, or, sql } from 'drizzle-orm'
import { documents, documentVersions } from '@kb/db'
import { noteSearchText } from '@kb/pipeline'
import { requireOwner, useDb, withApi } from '../../utils/context'

export default defineEventHandler((event) => withApi(async () => {
  const user = await requireOwner(event)
  const body = await readBody<{ from: string, to: string }>(event)
  const from = (body?.from || '').trim().replace(/^\/+|\/+$/g, '')
  const to = (body?.to || '').trim().replace(/^\/+|\/+$/g, '')

  if (!from || !to) {
    throw createError({ statusCode: 400, message: '來源與目標資料夾路徑不可為空' })
  }
  if (from === to) {
    return { ok: true, count: 0 }
  }

  const db = await useDb()
  const docs = await db.select({
    id: documents.id,
    path: documents.path,
    title: documents.title,
    tags: documents.tags,
    currentVersionId: documents.currentVersionId
  }).from(documents).where(and(
    eq(documents.workspaceId, user.workspaceId),
    isNull(documents.deletedAt),
    or(
      eq(documents.path, from),
      like(documents.path, `${from}/%`)
    )
  ))

  let count = 0
  for (const doc of docs) {
    let newPath = doc.path
    if (doc.path === from) {
      newPath = to
    } else if (doc.path.startsWith(`${from}/`)) {
      newPath = `${to}/${doc.path.slice(from.length + 1)}`
    }
    if (newPath === doc.path) continue

    let content = ''
    if (doc.currentVersionId) {
      const [ver] = await db.select({ contentMd: documentVersions.contentMd })
        .from(documentVersions)
        .where(eq(documentVersions.id, doc.currentVersionId))
        .limit(1)
      content = ver?.contentMd || ''
    }

    const sText = noteSearchText(doc.title, newPath, doc.tags || [], content)
    await db.update(documents).set({
      path: newPath,
      searchText: sText,
      updatedAt: new Date()
    }).where(eq(documents.id, doc.id))

    await db.execute(sql`
      UPDATE documents
      SET search_vector = to_tsvector('simple', ${sText})
      WHERE id = ${doc.id}
    `)
    count++
  }

  return { ok: true, count }
}))
