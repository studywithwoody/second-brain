export type OpSource = 'ai' | 'manual' | 'revert'

export interface GraphNode {
  id: string
  labelZh: string
  labelEn: string
  aliases: string[]
  type: string
  locked: boolean
}

export interface GraphEdge {
  id: string
  sourceId: string
  targetId: string
  relation: string
  relationZh: string
  relationEn: string
  confidence: number
  locked: boolean
}

export interface GraphState {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

export type GraphOpType =
  | 'add_node'
  | 'update_node'
  | 'merge_nodes'
  | 'remove_node'
  | 'add_edge'
  | 'update_edge'
  | 'remove_edge'

export interface GraphOp {
  id?: string
  opType: GraphOpType
  targetId?: string
  mergeFromId?: string
  before?: unknown
  after?: unknown
  accepted: boolean
  confidence: number
  reason: string
  source: OpSource
}

export interface SkippedOp {
  op: GraphOp
  reason: string
}

export interface ApplyResult {
  state: GraphState
  applied: GraphOp[]
  skipped: SkippedOp[]
}

export type Highlight = 'add' | 'update' | 'remove' | 'idle'

export interface PreviewNode extends GraphNode {
  highlight: Highlight
}

export interface PreviewEdge extends GraphEdge {
  highlight: Highlight
}
