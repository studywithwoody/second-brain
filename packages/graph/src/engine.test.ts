import { describe, expect, it } from 'vitest'
import {
  applyOps,
  buildPreview,
  cascadeAcceptance,
  cloneState,
  diffStates,
  emptyState,
  materialize,
  SNAPSHOT_EVERY,
  shouldSnapshot,
  statesEqual,
  summarizeOps
} from './engine'
import type { GraphEdge, GraphNode, GraphOp, GraphState } from './types'

function node(partial: Partial<GraphNode> & Pick<GraphNode, 'id' | 'labelZh'>): GraphNode {
  return {
    id: partial.id,
    labelZh: partial.labelZh,
    labelEn: partial.labelEn ?? partial.labelZh,
    aliases: partial.aliases ?? [],
    type: partial.type ?? 'concept',
    locked: partial.locked ?? false
  }
}

function edge(partial: Partial<GraphEdge> & Pick<GraphEdge, 'id' | 'sourceId' | 'targetId'>): GraphEdge {
  return {
    id: partial.id,
    sourceId: partial.sourceId,
    targetId: partial.targetId,
    relation: partial.relation ?? 'related_to',
    relationZh: partial.relationZh ?? '相關',
    relationEn: partial.relationEn ?? 'related to',
    confidence: partial.confidence ?? 0.8,
    locked: partial.locked ?? false
  }
}

function addNode(n: GraphNode, extra?: Partial<GraphOp>): GraphOp {
  return {
    opType: 'add_node',
    targetId: n.id,
    after: n,
    accepted: true,
    confidence: 0.9,
    reason: '抽取',
    source: 'ai',
    ...extra
  }
}

function addEdge(e: GraphEdge, extra?: Partial<GraphOp>): GraphOp {
  return {
    opType: 'add_edge',
    targetId: e.id,
    after: e,
    accepted: true,
    confidence: 0.88,
    reason: '共現',
    source: 'ai',
    ...extra
  }
}

describe('changeset apply', () => {
  it('adds nodes and edges and does not mutate the previous state', () => {
    const base = emptyState()
    const law = node({ id: 'n1', labelZh: '牛頓第二定律', labelEn: "Newton's second law", aliases: ['F = ma'], type: 'law' })
    const force = node({ id: 'n2', labelZh: '力', labelEn: 'force', type: 'quantity' })
    const link = edge({ id: 'e1', sourceId: 'n1', targetId: 'n2', relation: 'describes', relationZh: '描述', relationEn: 'describes' })
    const result = applyOps(base, [addEdge(link), addNode(force), addNode(law)])
    expect(result.skipped).toEqual([])
    expect(result.state.nodes.map(item => item.id).sort()).toEqual(['n1', 'n2'])
    expect(result.state.edges).toHaveLength(1)
    expect(base.nodes).toHaveLength(0)
    expect(summarizeOps(result.applied)).toContain('新增 2 個節點')
  })

  it('skips unaccepted ops and edges whose endpoint was not accepted', () => {
    const law = node({ id: 'n1', labelZh: '動量守恆', labelEn: 'Conservation of momentum', type: 'law' })
    const mass = node({ id: 'n2', labelZh: '質量', labelEn: 'mass', type: 'quantity' })
    const link = edge({ id: 'e1', sourceId: 'n1', targetId: 'n2' })
    const ops = cascadeAcceptance([
      addNode(law, { accepted: false }),
      addNode(mass),
      addEdge(link)
    ])
    expect(ops.find(op => op.opType === 'add_edge')?.accepted).toBe(false)
    const result = applyOps(emptyState(), ops)
    expect(result.state.nodes.map(item => item.id)).toEqual(['n2'])
    expect(result.state.edges).toHaveLength(0)

    const forced = applyOps(emptyState(), [
      addNode(law, { accepted: false }),
      addNode(mass),
      addEdge(link, { accepted: true })
    ])
    expect(forced.state.edges).toHaveLength(0)
    expect(forced.skipped.some(item => item.reason.includes('端點不存在'))).toBe(true)
  })

  it('refuses AI overwrites of locked nodes but allows manual edits', () => {
    const locked = node({ id: 'n1', labelZh: '牛頓第二定律', labelEn: "Newton's second law", locked: true, aliases: ['F = ma'] })
    const state: GraphState = { nodes: [locked], edges: [] }
    const ai = applyOps(state, [{
      opType: 'update_node',
      targetId: 'n1',
      before: locked,
      after: { labelZh: '錯誤名稱', labelEn: 'Wrong' },
      accepted: true,
      confidence: 0.99,
      reason: 'AI 想改名',
      source: 'ai'
    }])
    expect(ai.state.nodes[0]?.labelZh).toBe('牛頓第二定律')
    expect(ai.skipped[0]?.reason).toContain('鎖定')

    const manual = applyOps(state, [{
      opType: 'update_node',
      targetId: 'n1',
      before: locked,
      after: { labelEn: "Newton's 2nd law", locked: true },
      accepted: true,
      confidence: 1,
      reason: '擁有者手改',
      source: 'manual'
    }])
    expect(manual.state.nodes[0]?.labelEn).toBe("Newton's 2nd law")
    expect(manual.state.nodes[0]?.locked).toBe(true)
    expect(manual.state.nodes[0]?.aliases).toEqual(['F = ma'])
  })

  it('merges nodes, rewires edges, and skips locked merges from AI', () => {
    const target = node({ id: 'n1', labelZh: '牛頓第二定律', labelEn: "Newton's second law", type: 'law' })
    const alias = node({ id: 'n2', labelZh: 'F = ma', labelEn: 'F = ma', type: 'quantity' })
    const other = node({ id: 'n3', labelZh: '質量', labelEn: 'mass', type: 'quantity' })
    const link = edge({ id: 'e1', sourceId: 'n2', targetId: 'n3' })
    const state: GraphState = { nodes: [target, alias, other], edges: [link] }
    const merged = applyOps(state, [{
      opType: 'merge_nodes',
      targetId: 'n1',
      mergeFromId: 'n2',
      before: { target, merged: alias },
      after: { ...target, aliases: ['F = ma'] },
      accepted: true,
      confidence: 0.95,
      reason: '同一實體',
      source: 'ai'
    }])
    expect(merged.state.nodes.map(item => item.id).sort()).toEqual(['n1', 'n3'])
    expect(merged.state.nodes.find(item => item.id === 'n1')?.aliases).toContain('F = ma')
    expect(merged.state.edges[0]?.sourceId).toBe('n1')

    const lockedAlias = node({ ...alias, locked: true })
    const blocked = applyOps(
      { nodes: [target, lockedAlias, other], edges: [link] },
      [{
        opType: 'merge_nodes',
        targetId: 'n1',
        mergeFromId: 'n2',
        after: target,
        accepted: true,
        confidence: 0.95,
        reason: '想合併鎖定節點',
        source: 'ai'
      }]
    )
    expect(blocked.state.nodes).toHaveLength(3)
    expect(blocked.skipped[0]?.reason).toContain('鎖定')
  })
})

describe('revert creates a new forward version', () => {
  const law = node({ id: 'n1', labelZh: '牛頓第一定律', labelEn: "Newton's first law", type: 'law' })
  const force = node({ id: 'n2', labelZh: '力', labelEn: 'force', type: 'quantity' })
  const energy = node({ id: 'n3', labelZh: '動能', labelEn: 'kinetic energy', type: 'quantity' })

  function forward() {
    const state0 = emptyState()
    const state1 = applyOps(state0, [
      addNode(law),
      addNode(force),
      addEdge(edge({ id: 'e1', sourceId: 'n1', targetId: 'n2', relation: 'describes', relationZh: '描述', relationEn: 'describes' }))
    ]).state
    const state2 = applyOps(state1, [
      addNode(energy),
      addEdge(edge({ id: 'e2', sourceId: 'n1', targetId: 'n3' }))
    ]).state
    return { state0, state1, state2 }
  }

  it('restores an older version and can undo that restore', () => {
    const { state1, state2 } = forward()
    const revertOps = diffStates(state2, state1, 'revert')
    const restored = applyOps(state2, revertOps).state
    expect(statesEqual(restored, state1)).toBe(true)

    const undoRevert = diffStates(restored, state2, 'revert')
    const redone = applyOps(restored, undoRevert).state
    expect(statesEqual(redone, state2)).toBe(true)
  })

  it('replay from a periodic snapshot matches the full history', () => {
    let state = emptyState()
    const batches: GraphOp[][] = []
    for (let i = 1; i <= SNAPSHOT_EVERY + 5; i++) {
      const ops = [addNode(node({ id: `n${i}`, labelZh: `概念${i}`, labelEn: `Concept ${i}` }))]
      state = applyOps(state, ops).state
      batches.push(ops)
    }
    const snapshot = cloneState(materialize(emptyState(), batches.slice(0, SNAPSHOT_EVERY)))
    const replayed = materialize(snapshot, batches.slice(SNAPSHOT_EVERY))
    expect(statesEqual(replayed, state)).toBe(true)
    expect(shouldSnapshot(SNAPSHOT_EVERY)).toBe(true)
    expect(shouldSnapshot(SNAPSHOT_EVERY + 1)).toBe(false)
    expect(shouldSnapshot(3, 'rebuild')).toBe(true)
  })

  it('highlights added, updated, and removed elements in the preview', () => {
    const current: GraphState = {
      nodes: [law, force],
      edges: [edge({ id: 'e1', sourceId: 'n1', targetId: 'n2' })]
    }
    const preview = buildPreview(current, [
      addNode(energy),
      {
        opType: 'update_node',
        targetId: 'n2',
        before: force,
        after: { labelZh: '淨力', labelEn: 'net force' },
        accepted: true,
        confidence: 0.8,
        reason: '更精確的名稱',
        source: 'manual'
      },
      {
        opType: 'remove_edge',
        targetId: 'e1',
        before: current.edges[0],
        accepted: true,
        confidence: 0.7,
        reason: '來源已刪改',
        source: 'ai'
      }
    ])
    expect(preview.nodes.find(item => item.id === 'n3')?.highlight).toBe('add')
    expect(preview.nodes.find(item => item.id === 'n2')?.highlight).toBe('update')
    expect(preview.nodes.find(item => item.id === 'n2')?.labelZh).toBe('淨力')
    expect(preview.edges.find(item => item.id === 'e1')?.highlight).toBe('remove')
  })
})
