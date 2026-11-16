import type {
  ApplyResult,
  GraphEdge,
  GraphNode,
  GraphOp,
  GraphState,
  PreviewEdge,
  PreviewNode
} from './types'

export const SNAPSHOT_EVERY = 20

export function emptyState(): GraphState {
  return { nodes: [], edges: [] }
}

export function cloneState(state: GraphState): GraphState {
  return {
    nodes: state.nodes.map(cloneNode),
    edges: state.edges.map(cloneEdge)
  }
}

function cloneNode(node: GraphNode): GraphNode {
  return { ...node, aliases: [...node.aliases] }
}

function cloneEdge(edge: GraphEdge): GraphEdge {
  return { ...edge }
}

function asNode(value: unknown): GraphNode | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Partial<GraphNode>
  if (!v.id || typeof v.labelZh !== 'string' || typeof v.labelEn !== 'string') return null
  return {
    id: v.id,
    labelZh: v.labelZh,
    labelEn: v.labelEn,
    aliases: Array.isArray(v.aliases) ? v.aliases.map(String) : [],
    type: v.type || 'concept',
    locked: Boolean(v.locked)
  }
}

function asEdge(value: unknown): GraphEdge | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Partial<GraphEdge>
  if (!v.id || !v.sourceId || !v.targetId || !v.relation) return null
  return {
    id: v.id,
    sourceId: v.sourceId,
    targetId: v.targetId,
    relation: v.relation,
    relationZh: v.relationZh || v.relation,
    relationEn: v.relationEn || v.relation,
    confidence: typeof v.confidence === 'number' ? v.confidence : 0.5,
    locked: Boolean(v.locked)
  }
}

function nodeMap(state: GraphState) {
  return new Map(state.nodes.map(node => [node.id, node]))
}

function edgeKey(edge: Pick<GraphEdge, 'sourceId' | 'targetId' | 'relation'>) {
  return `${edge.sourceId}|${edge.relation}|${edge.targetId}`
}

export function statesEqual(a: GraphState, b: GraphState): boolean {
  if (a.nodes.length !== b.nodes.length || a.edges.length !== b.edges.length) return false
  const nodes = nodeMap(b)
  for (const node of a.nodes) {
    const other = nodes.get(node.id)
    if (!other || !nodeEqual(node, other)) return false
  }
  const edges = new Map(b.edges.map(edge => [edge.id, edge]))
  for (const edge of a.edges) {
    const other = edges.get(edge.id)
    if (!other || !edgeEqual(edge, other)) return false
  }
  return true
}

function sortedAliases(aliases: string[]) {
  return [...aliases].map(alias => alias.trim()).filter(Boolean).sort()
}

function nodeEqual(a: GraphNode, b: GraphNode) {
  return a.labelZh === b.labelZh
    && a.labelEn === b.labelEn
    && a.type === b.type
    && a.locked === b.locked
    && sortedAliases(a.aliases).join('\u0000') === sortedAliases(b.aliases).join('\u0000')
}

function edgeEqual(a: GraphEdge, b: GraphEdge) {
  return a.sourceId === b.sourceId
    && a.targetId === b.targetId
    && a.relation === b.relation
    && a.relationZh === b.relationZh
    && a.relationEn === b.relationEn
    && a.locked === b.locked
    && Math.abs(a.confidence - b.confidence) < 0.0001
}

export function cascadeAcceptance(ops: GraphOp[]): GraphOp[] {
  const rejectedAdds = new Set(
    ops
      .filter(op => op.opType === 'add_node' && !op.accepted)
      .map(op => asNode(op.after)?.id)
      .filter((id): id is string => Boolean(id))
  )
  return ops.map(op => {
    if (!op.accepted) return op
    if (op.opType !== 'add_edge' && op.opType !== 'update_edge') return op
    const edge = asEdge(op.after) || asEdge(op.before)
    if (!edge) return op
    if (rejectedAdds.has(edge.sourceId) || rejectedAdds.has(edge.targetId)) {
      return { ...op, accepted: false }
    }
    return op
  })
}

export function applyOps(
  state: GraphState,
  ops: GraphOp[],
  options?: { onlyAccepted?: boolean }
): ApplyResult {
  const onlyAccepted = options?.onlyAccepted !== false
  const next = cloneState(state)
  const applied: GraphOp[] = []
  const skipped: ApplyResult['skipped'] = []
  const ordered = [...ops].sort((a, b) => opRank(a.opType) - opRank(b.opType))

  for (const op of ordered) {
    if (onlyAccepted && !op.accepted) {
      skipped.push({ op, reason: '未勾選' })
      continue
    }
    const outcome = applyOne(next, op)
    if (outcome.ok) applied.push(op)
    else skipped.push({ op, reason: outcome.reason })
  }

  return { state: next, applied, skipped }
}

function opRank(type: GraphOp['opType']) {
  switch (type) {
    case 'add_node': return 10
    case 'update_node': return 20
    case 'merge_nodes': return 30
    case 'update_edge': return 40
    case 'add_edge': return 50
    case 'remove_edge': return 60
    case 'remove_node': return 70
    default: return 100
  }
}

function applyOne(state: GraphState, op: GraphOp): { ok: true } | { ok: false, reason: string } {
  const nodes = nodeMap(state)
  if (op.opType === 'add_node') {
    const node = asNode(op.after)
    if (!node) return { ok: false, reason: '資料不完整' }
    if (nodes.has(node.id)) return { ok: false, reason: '重複的節點' }
    state.nodes.push(cloneNode(node))
    return { ok: true }
  }

  if (op.opType === 'update_node') {
    const id = op.targetId
    const current = id ? nodes.get(id) : undefined
    if (!current) return { ok: false, reason: '目標不存在' }
    if (current.locked && op.source === 'ai') return { ok: false, reason: '節點已鎖定，AI 不會覆蓋' }
    const after = (op.after || {}) as Partial<GraphNode>
    if (after.labelZh !== undefined) current.labelZh = after.labelZh
    if (after.labelEn !== undefined) current.labelEn = after.labelEn
    if (after.aliases) current.aliases = [...after.aliases]
    if (after.type !== undefined) current.type = after.type
    if (after.locked !== undefined) current.locked = after.locked
    return { ok: true }
  }

  if (op.opType === 'merge_nodes') {
    const target = op.targetId ? nodes.get(op.targetId) : undefined
    const from = op.mergeFromId ? nodes.get(op.mergeFromId) : undefined
    if (!target || !from) return { ok: false, reason: '目標不存在' }
    if ((target.locked || from.locked) && op.source === 'ai') {
      return { ok: false, reason: '節點已鎖定，AI 不會覆蓋' }
    }
    const after = asNode(op.after) || {
      ...cloneNode(target),
      aliases: unique([...target.aliases, ...from.aliases, from.labelZh, from.labelEn])
    }
    target.labelZh = after.labelZh || target.labelZh
    target.labelEn = after.labelEn || target.labelEn
    target.type = after.type || target.type
    target.aliases = unique([...target.aliases, ...after.aliases, from.labelZh, from.labelEn, ...from.aliases])
    target.locked = target.locked || from.locked || after.locked
    rewireEdges(state, from.id, target.id)
    state.nodes = state.nodes.filter(node => node.id !== from.id)
    return { ok: true }
  }

  if (op.opType === 'remove_node') {
    const id = op.targetId
    const current = id ? nodes.get(id) : undefined
    if (!current) return { ok: false, reason: '目標不存在' }
    if (current.locked && op.source === 'ai') return { ok: false, reason: '節點已鎖定，AI 不會覆蓋' }
    state.edges = state.edges.filter(edge => edge.sourceId !== id && edge.targetId !== id)
    state.nodes = state.nodes.filter(node => node.id !== id)
    return { ok: true }
  }

  if (op.opType === 'add_edge') {
    const edge = asEdge(op.after)
    if (!edge) return { ok: false, reason: '資料不完整' }
    if (!nodes.has(edge.sourceId) || !nodes.has(edge.targetId)) {
      return { ok: false, reason: '端點不存在（相依的節點未採用）' }
    }
    if (state.edges.some(item => edgeKey(item) === edgeKey(edge))) {
      return { ok: false, reason: '邊已存在' }
    }
    state.edges.push(cloneEdge(edge))
    return { ok: true }
  }

  if (op.opType === 'update_edge') {
    const id = op.targetId
    const current = state.edges.find(edge => edge.id === id)
    if (!current) return { ok: false, reason: '目標不存在' }
    if (current.locked && op.source === 'ai') return { ok: false, reason: '節點已鎖定，AI 不會覆蓋' }
    const after = (op.after || {}) as Partial<GraphEdge>
    if (after.relation !== undefined) current.relation = after.relation
    if (after.relationZh !== undefined) current.relationZh = after.relationZh
    if (after.relationEn !== undefined) current.relationEn = after.relationEn
    if (after.confidence !== undefined) current.confidence = after.confidence
    if (after.locked !== undefined) current.locked = after.locked
    if (after.sourceId && nodes.has(after.sourceId)) current.sourceId = after.sourceId
    if (after.targetId && nodes.has(after.targetId)) current.targetId = after.targetId
    return { ok: true }
  }

  if (op.opType === 'remove_edge') {
    const id = op.targetId
    const current = state.edges.find(edge => edge.id === id)
    if (!current) return { ok: false, reason: '目標不存在' }
    if (current.locked && op.source === 'ai') return { ok: false, reason: '節點已鎖定，AI 不會覆蓋' }
    state.edges = state.edges.filter(edge => edge.id !== id)
    return { ok: true }
  }

  return { ok: false, reason: '不支援的操作' }
}

function rewireEdges(state: GraphState, fromId: string, toId: string) {
  const kept: GraphEdge[] = []
  const seen = new Set<string>()
  for (const edge of state.edges) {
    const next = cloneEdge(edge)
    if (next.sourceId === fromId) next.sourceId = toId
    if (next.targetId === fromId) next.targetId = toId
    if (next.sourceId === next.targetId) continue
    const key = edgeKey(next)
    if (seen.has(key)) continue
    seen.add(key)
    kept.push(next)
  }
  state.edges = kept
}

function unique(values: string[]) {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))]
}

export function diffStates(from: GraphState, to: GraphState, source: GraphOp['source'] = 'revert'): GraphOp[] {
  const ops: GraphOp[] = []
  const fromNodes = nodeMap(from)
  const toNodes = nodeMap(to)
  for (const node of to.nodes) {
    const prev = fromNodes.get(node.id)
    if (!prev) {
      ops.push({
        opType: 'add_node',
        targetId: node.id,
        after: cloneNode(node),
        accepted: true,
        confidence: 1,
        reason: '還原時補回節點',
        source
      })
    } else if (!nodeEqual(prev, node)) {
      ops.push({
        opType: 'update_node',
        targetId: node.id,
        before: cloneNode(prev),
        after: cloneNode(node),
        accepted: true,
        confidence: 1,
        reason: '還原節點內容',
        source
      })
    }
  }
  for (const node of from.nodes) {
    if (!toNodes.has(node.id)) {
      ops.push({
        opType: 'remove_node',
        targetId: node.id,
        before: cloneNode(node),
        accepted: true,
        confidence: 1,
        reason: '還原時移除之後新增的節點',
        source
      })
    }
  }

  const fromEdges = new Map(from.edges.map(edge => [edge.id, edge]))
  const toEdges = new Map(to.edges.map(edge => [edge.id, edge]))
  for (const edge of to.edges) {
    const prev = fromEdges.get(edge.id)
    if (!prev) {
      ops.push({
        opType: 'add_edge',
        targetId: edge.id,
        after: cloneEdge(edge),
        accepted: true,
        confidence: 1,
        reason: '還原時補回關係',
        source
      })
    } else if (!edgeEqual(prev, edge)) {
      ops.push({
        opType: 'update_edge',
        targetId: edge.id,
        before: cloneEdge(prev),
        after: cloneEdge(edge),
        accepted: true,
        confidence: 1,
        reason: '還原關係內容',
        source
      })
    }
  }
  for (const edge of from.edges) {
    if (!toEdges.has(edge.id)) {
      ops.push({
        opType: 'remove_edge',
        targetId: edge.id,
        before: cloneEdge(edge),
        accepted: true,
        confidence: 1,
        reason: '還原時移除之後新增的關係',
        source
      })
    }
  }
  return ops.sort((a, b) => opRank(a.opType) - opRank(b.opType))
}

export function materialize(snapshot: GraphState, batches: GraphOp[][]): GraphState {
  return batches.reduce((state, ops) => applyOps(state, ops, { onlyAccepted: false }).state, cloneState(snapshot))
}

export function shouldSnapshot(versionNo: number, kind?: string) {
  return versionNo === 0 || versionNo % SNAPSHOT_EVERY === 0 || kind === 'rebuild'
}

export function buildPreview(current: GraphState, ops: GraphOp[]): { nodes: PreviewNode[], edges: PreviewEdge[] } {
  const cascaded = cascadeAcceptance(ops)
  const { state, applied } = applyOps(current, cascaded)
  const nodeHighlight = new Map<string, PreviewNode['highlight']>()
  const edgeHighlight = new Map<string, PreviewEdge['highlight']>()
  for (const op of applied) {
    if (op.opType === 'add_node') {
      const node = asNode(op.after)
      if (node) nodeHighlight.set(node.id, 'add')
    }
    if (op.opType === 'update_node' || op.opType === 'merge_nodes') {
      if (op.targetId) nodeHighlight.set(op.targetId, 'update')
    }
    if (op.opType === 'remove_node' && op.targetId) nodeHighlight.set(op.targetId, 'remove')
    if (op.opType === 'add_edge') {
      const edge = asEdge(op.after)
      if (edge) edgeHighlight.set(edge.id, 'add')
    }
    if (op.opType === 'update_edge' && op.targetId) edgeHighlight.set(op.targetId, 'update')
    if (op.opType === 'remove_edge' && op.targetId) edgeHighlight.set(op.targetId, 'remove')
  }

  const nodes: PreviewNode[] = state.nodes.map(node => ({
    ...cloneNode(node),
    highlight: nodeHighlight.get(node.id) || 'idle'
  }))
  for (const node of current.nodes) {
    if (!state.nodes.some(item => item.id === node.id)) {
      nodes.push({ ...cloneNode(node), highlight: 'remove' })
    }
  }

  const edges: PreviewEdge[] = state.edges.map(edge => ({
    ...cloneEdge(edge),
    highlight: edgeHighlight.get(edge.id) || 'idle'
  }))
  for (const edge of current.edges) {
    if (!state.edges.some(item => item.id === edge.id)) {
      edges.push({ ...cloneEdge(edge), highlight: 'remove' })
    }
  }
  return { nodes, edges }
}

export function summarizeOps(ops: GraphOp[]) {
  const count = (type: GraphOp['opType']) => ops.filter(op => op.opType === type).length
  const added = count('add_node')
  const updated = count('update_node') + count('merge_nodes')
  const removedNodes = count('remove_node')
  const addedEdges = count('add_edge')
  const removedEdges = count('remove_edge')
  return `新增 ${added} 個節點、修改 ${updated} 個、移除 ${removedNodes} 個節點；新增 ${addedEdges} 條關係、移除 ${removedEdges} 條`
}
