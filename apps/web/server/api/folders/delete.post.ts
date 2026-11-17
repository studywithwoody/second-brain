import { and, eq, isNull, like, or, sql } from 'drizzle-orm'
import { documents, documentVersions } from '@kb/db'
import { noteSearchText } from '@kb/pipeline'
import { requireOwner, useDb, withApi } from '../../utils/context'

export default defineEventHandler((event) => withApi(async () => {
  const user = await requireOwner(event)
  const body = await readBody<{ folder: string, action?: 'root' | 'trash' }>(event)
  const folder = (body?.folder || '').trim().replace(/^\/+|\/+$/g, '')
  const action = body?.action || 'root'

  if (!folder) {
    throw createError({ statusCode: 400, message: '請指定要刪除的資料夾' })
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
      eq(documents.path, folder),
      like(documents.path, `${folder}/%`)
    )
  ))

  let count = 0
  if (action === 'trash') {
    for (const doc of docs) {
      await db.update(documents).set({
        deletedAt: new Date(),
        updatedAt: new Date()
      }).where(eq(documents.id, doc.id))
      count++
    }
  } else {
    // Move to root: keep only the leaf file name
    for (const doc of docs) {
      const parts = doc.path.split('/')
      const fileName = parts.pop() || doc.title || '未命名'
      let newPath = fileName
      let candidate = newPath
      let suffix = 1

      // Ensure new path doesn't collide with existing active documents
      while (true) {
        const [conflict] = await db.select({ id: documents.id })
          .from(documents)
          .where(and(
            eq(documents.workspaceId, user.workspaceId),
            eq(documents.path, candidate),
            isNull(documents.deletedAt)
          ))
          .limit(1)

        if (!conflict || conflict.id === doc.id) {
          newPath = candidate
          break
        }
        candidate = `${fileName}_${suffix++}`
      }

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
  }

  return { ok: true, count }
}))
