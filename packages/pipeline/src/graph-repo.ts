import { and, asc, desc, eq, notInArray, sql } from 'drizzle-orm'
import {
  graphChangesets,
  graphEdges,
  graphEvidence,
  graphNodes,
  graphOps,
  graphVersions,
  type AppDb,
  type OpEvidence
} from '@kb/db'
import {
  applyOps,
  buildPreview,
  cascadeAcceptance,
  diffStates,
  emptyState,
  shouldSnapshot,
  statesEqual,
  summarizeOps,
  type GraphOp,
  type GraphState,
  type OpSource
} from '@kb/graph'
import { embedTexts } from '@kb/ai'
import { id } from './util'

function toStateNode(row: typeof graphNodes.$inferSelect): GraphState['nodes'][number] {
  return {
    id: row.id,
    labelZh: row.labelZh,
    labelEn: row.labelEn,
    aliases: row.aliases || [],
    type: row.type,
    locked: row.locked
  }
}

function toStateEdge(row: typeof graphEdges.$inferSelect): GraphState['edges'][number] {
  return {
    id: row.id,
    sourceId: row.sourceId,
    targetId: row.targetId,
    relation: row.relation,
    relationZh: row.relationZh,
    relationEn: row.relationEn,
    confidence: row.confidence,
    locked: row.locked
  }
}

export async function loadState(db: AppDb, workspaceId: string): Promise<GraphState> {
  const nodes = await db.select().from(graphNodes).where(eq(graphNodes.workspaceId, workspaceId))
  const edges = await db.select().from(graphEdges).where(eq(graphEdges.workspaceId, workspaceId))
  return { nodes: nodes.map(toStateNode), edges: edges.map(toStateEdge) }
}

export async function latestVersion(db: AppDb, workspaceId: string) {
  const [version] = await db.select().from(graphVersions).where(eq(graphVersions.workspaceId, workspaceId)).orderBy(desc(graphVersions.versionNo)).limit(1)
  return version || null
}

export async function ensureRootVersion(db: AppDb, workspaceId: string) {
  const existing = await latestVersion(db, workspaceId)
  if (existing) return existing
  const [created] = await db.insert(graphVersions).values({
    workspaceId,
    versionNo: 0,
    summary: '空白圖譜',
    snapshot: emptyState()
  }).returning()
  return created!
}

function rowToOp(row: typeof graphOps.$inferSelect): GraphOp {
  return {
    id: row.id,
    opType: row.opType,
    targetId: row.targetId || undefined,
    mergeFromId: row.mergeFromId || undefined,
    before: row.before ?? undefined,
    after: row.after ?? undefined,
    accepted: row.accepted,
    confidence: row.confidence,
    reason: row.reason,
    source: (row.source as OpSource) || 'ai'
  }
}

async function opsFor(db: AppDb, changesetId: string, onlyApplied = false) {
  const rows = await db.select().from(graphOps).where(eq(graphOps.changesetId, changesetId)).orderBy(asc(graphOps.sortOrder))
  return rows.filter(row => !onlyApplied || row.applied).map(rowToOp)
}

export async function materializeVersion(db: AppDb, workspaceId: string, versionNo: number): Promise<GraphState> {
  const versions = await db.select().from(graphVersions).where(eq(graphVersions.workspaceId, workspaceId)).orderBy(asc(graphVersions.versionNo))
  const eligible = versions.filter(version => version.versionNo <= versionNo)
  let snapshotVersion = eligible[0]
  for (const version of eligible) {
    if (version.snapshot) snapshotVersion = version
  }
  if (!snapshotVersion?.snapshot) return emptyState()
  let state = snapshotVersion.snapshot as GraphState
  for (const version of eligible) {
    if (version.versionNo <= snapshotVersion.versionNo || !version.changesetId) continue
    const ops = await opsFor(db, version.changesetId, true)
    state = applyOps(state, ops, { onlyAccepted: false }).state
  }
  return state
}

async function syncState(db: AppDb, workspaceId: string, state: GraphState) {
  const nodeIds = state.nodes.map(node => node.id)
  const edgeIds = state.edges.map(edge => edge.id)
  if (edgeIds.length) {
    await db.delete(graphEdges).where(and(eq(graphEdges.workspaceId, workspaceId), notInArray(graphEdges.id, edgeIds)))
  } else {
    await db.delete(graphEdges).where(eq(graphEdges.workspaceId, workspaceId))
  }
  if (nodeIds.length) {
    await db.delete(graphNodes).where(and(eq(graphNodes.workspaceId, workspaceId), notInArray(graphNodes.id, nodeIds)))
  } else {
    await db.delete(graphNodes).where(eq(graphNodes.workspaceId, workspaceId))
  }
  for (const node of state.nodes) {
    await db.insert(graphNodes).values({
      id: node.id,
      workspaceId,
      labelZh: node.labelZh,
      labelEn: node.labelEn,
      aliases: node.aliases,
      type: node.type,
      locked: node.locked
    }).onConflictDoUpdate({
      target: graphNodes.id,
      set: {
        labelZh: node.labelZh,
        labelEn: node.labelEn,
        aliases: node.aliases,
        type: node.type,
        locked: node.locked,
        updatedAt: new Date()
      }
    })
  }
  for (const edge of state.edges) {
    await db.insert(graphEdges).values({
      id: edge.id,
      workspaceId,
      sourceId: edge.sourceId,
      targetId: edge.targetId,
      relation: edge.relation,
      relationZh: edge.relationZh,
      relationEn: edge.relationEn,
      confidence: edge.confidence,
      locked: edge.locked
    }).onConflictDoUpdate({
      target: graphEdges.id,
      set: {
        sourceId: edge.sourceId,
        targetId: edge.targetId,
        relation: edge.relation,
        relationZh: edge.relationZh,
        relationEn: edge.relationEn,
        confidence: edge.confidence,
        locked: edge.locked
      }
    })
  }
}

async function embedTouched(db: AppDb, state: GraphState, ops: GraphOp[]) {
  const ids = new Set<string>()
  for (const op of ops) {
    if (op.opType === 'add_node' || op.opType === 'update_node' || op.opType === 'merge_nodes') {
      const nodeId = op.targetId || (op.after as { id?: string } | undefined)?.id
      if (nodeId) ids.add(nodeId)
    }
  }
  const nodes = state.nodes.filter(node => ids.has(node.id))
  if (!nodes.length) return
  const embedded = await embedTexts(nodes.map(node => [node.labelZh, node.labelEn, ...node.aliases].join(' ')))
  for (let index = 0; index < nodes.length; index++) {
    await db.execute(sql`UPDATE graph_nodes SET embedding = ${JSON.stringify(embedded.vectors[index])}::vector WHERE id = ${nodes[index]!.id}`)
  }
}

async function writeEvidence(db: AppDb, workspaceId: string, ops: Array<GraphOp & { evidence?: Array<{ documentVersionId?: string, quote: string, spanStart?: number, spanEnd?: number }> }>) {
  const rows = []
  for (const op of ops) {
    for (const item of op.evidence || []) {
      const nodeId = op.opType.includes('node') ? (op.targetId || (op.after as { id?: string } | undefined)?.id) : null
      const edgeId = op.opType.includes('edge') ? (op.targetId || (op.after as { id?: string } | undefined)?.id) : null
      if (!nodeId && !edgeId) continue
      rows.push({
        workspaceId,
        nodeId: nodeId || null,
        edgeId: edgeId || null,
        documentVersionId: item.documentVersionId || null,
        spanStart: item.spanStart ?? null,
        spanEnd: item.spanEnd ?? null,
        quote: item.quote
      })
    }
  }
  if (rows.length) await db.insert(graphEvidence).values(rows)
}

export async function createChangeset(db: AppDb, input: {
  workspaceId: string
  kind: 'incremental' | 'rebuild' | 'revert' | 'manual'
  ops: GraphOp[]
  documentId?: string | null
  runId?: string | null
  batchNo?: number | null
  batchTotal?: number | null
  rebuildGroupId?: string | null
  estimatedCostUsd?: number
  summaryHint?: string
}) {
  const base = await ensureRootVersion(db, input.workspaceId)
  const [changeset] = await db.insert(graphChangesets).values({
    workspaceId: input.workspaceId,
    kind: input.kind,
    baseVersionId: base.id,
    documentId: input.documentId || null,
    runId: input.runId || null,
    status: 'pending',
    batchNo: input.batchNo ?? null,
    batchTotal: input.batchTotal ?? null,
    rebuildGroupId: input.rebuildGroupId || null,
    estimatedCostUsd: input.estimatedCostUsd || 0,
    decisionNote: input.summaryHint || ''
  }).returning()
  if (input.ops.length) {
    await db.insert(graphOps).values(input.ops.map((op, index) => ({
      id: op.id || id(),
      changesetId: changeset!.id,
      opType: op.opType,
      targetId: op.targetId || null,
      mergeFromId: op.mergeFromId || null,
      before: op.before ?? null,
      after: op.after ?? null,
      accepted: op.accepted,
      confidence: op.confidence,
      reason: op.reason,
      source: op.source,
      evidence: (op as GraphOp & { evidence?: OpEvidence[] }).evidence || [],
      sortOrder: index
    })))
  }
  return changeset!
}

async function commitState(db: AppDb, input: {
  workspaceId: string
  changesetId: string
  kind: 'incremental' | 'rebuild' | 'revert' | 'manual'
  state: GraphState
  applied: GraphOp[]
  skipped: Array<{ op: GraphOp, reason: string }>
  userId?: string
}) {
  await syncState(db, input.workspaceId, input.state)
  await embedTouched(db, input.state, input.applied)
  const appliedIds = new Set(input.applied.map(op => op.id).filter(Boolean) as string[])
  const stored = await db.select().from(graphOps).where(eq(graphOps.changesetId, input.changesetId))
  for (const row of stored) {
    const skip = input.skipped.find(item => item.op.id === row.id)
    await db.update(graphOps).set({
      applied: appliedIds.has(row.id),
      skipReason: skip?.reason || null,
      accepted: appliedIds.has(row.id) ? true : row.accepted
    }).where(eq(graphOps.id, row.id))
  }
  const evidenceOps = stored.filter(row => appliedIds.has(row.id)).map(row => ({
    ...rowToOp(row),
    evidence: row.evidence || []
  }))
  await writeEvidence(db, input.workspaceId, evidenceOps)
  const parent = await latestVersion(db, input.workspaceId)
  const versionNo = (parent?.versionNo ?? 0) + 1
  const summary = summarizeOps(input.applied)
  const snapshot = shouldSnapshot(versionNo, input.kind) ? input.state : null
  const [version] = await db.insert(graphVersions).values({
    workspaceId: input.workspaceId,
    parentId: parent?.id || null,
    changesetId: input.changesetId,
    versionNo,
    summary,
    snapshot
  }).returning()
  const status = input.skipped.length && input.applied.length ? 'partial' : 'approved'
  await db.update(graphChangesets).set({
    status,
    resultVersionId: version!.id,
    decidedBy: input.userId || null,
    decidedAt: new Date()
  }).where(eq(graphChangesets.id, input.changesetId))
  return { version, summary, status }
}

export async function applyChangeset(db: AppDb, input: {
  workspaceId: string
  changesetId: string
  userId?: string
  opIds?: string[]
}) {
  const [changeset] = await db.select().from(graphChangesets).where(and(
    eq(graphChangesets.id, input.changesetId),
    eq(graphChangesets.workspaceId, input.workspaceId)
  )).limit(1)
  if (!changeset) throw new Error('找不到變更集')
  if (changeset.status === 'approved' || changeset.status === 'partial' || changeset.status === 'rejected') {
    throw new Error('這個變更集已經決定過了')
  }
  const stored = await db.select().from(graphOps).where(eq(graphOps.changesetId, changeset.id)).orderBy(asc(graphOps.sortOrder))
  if (input.opIds) {
    const chosen = new Set(input.opIds)
    for (const row of stored) {
      row.accepted = chosen.has(row.id)
      await db.update(graphOps).set({ accepted: row.accepted }).where(eq(graphOps.id, row.id))
    }
  }
  const cascaded = cascadeAcceptance(stored.map(rowToOp))
  for (const op of cascaded) {
    if (!op.id) continue
    await db.update(graphOps).set({ accepted: op.accepted }).where(eq(graphOps.id, op.id))
  }

  if (changeset.kind === 'rebuild') {
    const accepted = cascaded.filter(op => op.accepted)
    const status = accepted.length ? 'staged' : 'rejected'
    await db.update(graphChangesets).set({
      status,
      decidedBy: input.userId || null,
      decidedAt: new Date(),
      decisionNote: status === 'rejected' ? '這一批沒有採用任何操作' : changeset.decisionNote
    }).where(eq(graphChangesets.id, changeset.id))
    const finalized = status === 'staged' ? await finalizeRebuild(db, input.workspaceId, changeset.rebuildGroupId || '', input.userId) : null
    return { staged: true, status, finalized }
  }

  const current = await loadState(db, input.workspaceId)
  const result = applyOps(current, cascaded)
  if (!result.applied.length) {
    await db.update(graphChangesets).set({
      status: 'rejected',
      decidedBy: input.userId || null,
      decidedAt: new Date(),
      decisionNote: '沒有可套用的操作'
    }).where(eq(graphChangesets.id, changeset.id))
    return { staged: false, status: 'rejected' as const, version: null, summary: '沒有可套用的操作' }
  }
  const committed = await commitState(db, {
    workspaceId: input.workspaceId,
    changesetId: changeset.id,
    kind: changeset.kind,
    state: result.state,
    applied: result.applied,
    skipped: result.skipped,
    userId: input.userId
  })
  return { staged: false, ...committed }
}

export async function rejectChangeset(db: AppDb, workspaceId: string, changesetId: string, userId: string, note: string) {
  const [changeset] = await db.select().from(graphChangesets).where(and(
    eq(graphChangesets.id, changesetId),
    eq(graphChangesets.workspaceId, workspaceId)
  )).limit(1)
  if (!changeset) throw new Error('找不到變更集')
  if (changeset.status !== 'pending') throw new Error('這個變更集已經決定過了')
  await db.update(graphChangesets).set({
    status: 'rejected',
    decisionNote: note,
    decidedBy: userId,
    decidedAt: new Date()
  }).where(eq(graphChangesets.id, changesetId))
}

export async function snapshotCurrent(db: AppDb, workspaceId: string) {
  const version = await ensureRootVersion(db, workspaceId)
  const state = await loadState(db, workspaceId)
  await db.update(graphVersions).set({ snapshot: state }).where(eq(graphVersions.id, version.id))
  return version
}

export async function finalizeRebuild(db: AppDb, workspaceId: string, rebuildGroupId: string, userId?: string) {
  if (!rebuildGroupId) return null
  const batches = await db.select().from(graphChangesets).where(and(
    eq(graphChangesets.workspaceId, workspaceId),
    eq(graphChangesets.rebuildGroupId, rebuildGroupId)
  )).orderBy(asc(graphChangesets.batchNo), desc(graphChangesets.createdAt))
  if (!batches.length) return null
  const total = batches[0]!.batchTotal || 0
  const chosen = new Map<number, typeof batches[number]>()
  for (const batch of batches) {
    if (batch.batchNo == null || chosen.has(batch.batchNo)) continue
    if (batch.status === 'staged' || batch.status === 'approved' || batch.status === 'partial') chosen.set(batch.batchNo, batch)
  }
  if (chosen.size < total) return null
  const base = await latestVersion(db, workspaceId)
  const snapshot = (base?.snapshot as GraphState | null) || await loadState(db, workspaceId)
  const batchesInOrder = [...chosen.entries()].sort((a, b) => a[0] - b[0]).map(([, batch]) => batch)
  let state = snapshot
  const applied: GraphOp[] = []
  for (const batch of batchesInOrder) {
    const ops = (await opsFor(db, batch.id)).filter(op => op.accepted).map(op => ({ ...op, source: 'ai' as const }))
    const result = applyOps(state, ops)
    state = result.state
    applied.push(...result.applied)
  }
  const current = await loadState(db, workspaceId)
  if (statesEqual(current, state)) {
    for (const batch of batchesInOrder) {
      await db.update(graphChangesets).set({ status: 'approved', decidedAt: new Date() }).where(eq(graphChangesets.id, batch.id))
    }
    return { version: base, summary: '重建結果與目前圖譜相同' }
  }
  const replayOps = diffStates(current, state, 'ai')
  const [wrapper] = await db.insert(graphChangesets).values({
    workspaceId,
    kind: 'rebuild',
    baseVersionId: base?.id || null,
    rebuildGroupId,
    status: 'pending',
    batchNo: 0,
    batchTotal: total,
    decisionNote: '全量重建彙總'
  }).returning()
  if (replayOps.length) {
    await db.insert(graphOps).values(replayOps.map((op, index) => ({
      changesetId: wrapper!.id,
      opType: op.opType,
      targetId: op.targetId || null,
      before: op.before ?? null,
      after: op.after ?? null,
      accepted: true,
      confidence: op.confidence,
      reason: op.reason,
      source: 'ai',
      sortOrder: index
    })))
  }
  const result = applyOps(current, replayOps.map(op => ({ ...op, accepted: true })))
  const committed = await commitState(db, {
    workspaceId,
    changesetId: wrapper!.id,
    kind: 'rebuild',
    state: result.state,
    applied: result.applied,
    skipped: result.skipped,
    userId
  })
  for (const batch of batchesInOrder) {
    await db.update(graphChangesets).set({
      status: 'approved',
      resultVersionId: committed.version!.id
    }).where(eq(graphChangesets.id, batch.id))
  }
  return committed
}

export async function revertToVersion(db: AppDb, workspaceId: string, versionId: string) {
  const [target] = await db.select().from(graphVersions).where(and(
    eq(graphVersions.id, versionId),
    eq(graphVersions.workspaceId, workspaceId)
  )).limit(1)
  if (!target) throw new Error('找不到圖譜版本')
  const desired = await materializeVersion(db, workspaceId, target.versionNo)
  const current = await loadState(db, workspaceId)
  if (statesEqual(current, desired)) throw new Error('目前已經是這個版本')
  const ops = diffStates(current, desired, 'revert')
  const changeset = await createChangeset(db, {
    workspaceId,
    kind: 'revert',
    ops,
    summaryHint: `還原到版本 ${target.versionNo}`
  })
  return { changesetId: changeset.id, opCount: ops.length, summary: summarizeOps(ops) }
}

export async function updateNodeManual(db: AppDb, input: {
  workspaceId: string
  userId: string
  nodeId: string
  labelZh?: string
  labelEn?: string
  aliases?: string[]
  locked?: boolean
  type?: string
}) {
  const state = await loadState(db, input.workspaceId)
  const node = state.nodes.find(item => item.id === input.nodeId)
  if (!node) throw new Error('找不到節點')
  const after = {
    labelZh: input.labelZh ?? node.labelZh,
    labelEn: input.labelEn ?? node.labelEn,
    aliases: input.aliases ?? node.aliases,
    type: input.type ?? node.type,
    locked: input.locked ?? true
  }
  const op: GraphOp = {
    id: id(),
    opType: 'update_node',
    targetId: node.id,
    before: node,
    after,
    accepted: true,
    confidence: 1,
    reason: '擁有者手動修改，節點鎖定以免被 AI 覆蓋',
    source: 'manual'
  }
  const changeset = await createChangeset(db, {
    workspaceId: input.workspaceId,
    kind: 'manual',
    ops: [op]
  })
  return applyChangeset(db, { workspaceId: input.workspaceId, changesetId: changeset.id, userId: input.userId })
}

export async function getChangesetDetail(db: AppDb, workspaceId: string, changesetId: string) {
  const [changeset] = await db.select().from(graphChangesets).where(and(
    eq(graphChangesets.id, changesetId),
    eq(graphChangesets.workspaceId, workspaceId)
  )).limit(1)
  if (!changeset) return null
  const rows = await db.select().from(graphOps).where(eq(graphOps.changesetId, changesetId)).orderBy(asc(graphOps.sortOrder))
  const ops = rows.map(row => ({ ...rowToOp(row), evidence: row.evidence || [], applied: row.applied, skipReason: row.skipReason }))
  const current = await loadState(db, workspaceId)
  const preview = buildPreview(current, ops)
  return { changeset, ops, current, preview, summary: summarizeOps(ops.filter(op => op.accepted)) }
}

export async function listChangesets(db: AppDb, workspaceId: string) {
  return db.select().from(graphChangesets).where(eq(graphChangesets.workspaceId, workspaceId)).orderBy(desc(graphChangesets.createdAt))
}

export async function listVersions(db: AppDb, workspaceId: string) {
  return db.select().from(graphVersions).where(eq(graphVersions.workspaceId, workspaceId)).orderBy(desc(graphVersions.versionNo))
}
