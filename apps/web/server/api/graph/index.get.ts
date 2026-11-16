import { eq } from 'drizzle-orm'
import { graphEdges, graphNodes, workspaces } from '@kb/db'
import { displayLabel } from '@kb/pipeline'
import { requireOwner, useDb, withApi } from '../../utils/context'

export default defineEventHandler((event) => withApi(async () => {
  const user = await requireOwner(event)
  const db = await useDb()
  const [workspace] = await db.select().from(workspaces).where(eq(workspaces.id, user.workspaceId)).limit(1)
  const requested = String(getQuery(event).lang || workspace?.graphDisplayLang || 'zh-TW')
  const lang = requested === 'en' ? 'en' : 'zh-TW'
  const nodes = await db.select().from(graphNodes).where(eq(graphNodes.workspaceId, user.workspaceId))
  const edges = await db.select().from(graphEdges).where(eq(graphEdges.workspaceId, user.workspaceId))
  return {
    lang,
    nodes: nodes.map(node => ({
      id: node.id,
      label: displayLabel(node, lang),
      labelZh: node.labelZh,
      labelEn: node.labelEn,
      aliases: node.aliases || [],
      type: node.type,
      locked: node.locked
    })),
    edges: edges.map(edge => ({
      id: edge.id,
      source: edge.sourceId,
      target: edge.targetId,
      relation: edge.relation,
      label: lang === 'en' ? (edge.relationEn || edge.relation) : (edge.relationZh || edge.relation),
      confidence: edge.confidence,
      locked: edge.locked
    }))
  }
}))
