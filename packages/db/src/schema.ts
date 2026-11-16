import {
  boolean,
  customType,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector
} from 'drizzle-orm/pg-core'

export const tsvector = customType<{ data: string }>({
  dataType() {
    return 'tsvector'
  }
})

export const memberRole = pgEnum('member_role', ['owner', 'student'])
export const visibility = pgEnum('doc_visibility', ['private', 'shared'])
export const versionSource = pgEnum('version_source', ['edit', 'import', 'ai_fix'])
export const jobStatus = pgEnum('job_status', ['queued', 'running', 'succeeded', 'failed', 'paused_budget', 'paused', 'cancelled'])
export const jobKind = pgEnum('job_kind', ['factcheck', 'graph_incremental', 'graph_rebuild_batch'])
export const aiRunKind = pgEnum('ai_run_kind', ['factcheck', 'graph', 'rebuild', 'embed'])
export const aiRunStatus = pgEnum('ai_run_status', ['running', 'succeeded', 'failed', 'paused_budget'])
export const claimVerdict = pgEnum('claim_verdict', ['supported', 'contradicted', 'uncertain', 'not_checkable'])
export const evidenceSource = pgEnum('evidence_source', ['knowledge_base', 'web', 'none'])
export const reviewDecision = pgEnum('review_decision', ['accept_fix', 'keep_noted', 'mark_false_positive'])
export const changesetKind = pgEnum('changeset_kind', ['incremental', 'rebuild', 'revert', 'manual'])
export const changesetStatus = pgEnum('changeset_status', ['pending', 'staged', 'approved', 'partial', 'rejected'])
export const graphOpType = pgEnum('graph_op_type', ['add_node', 'update_node', 'merge_nodes', 'remove_node', 'add_edge', 'update_edge', 'remove_edge'])
export const commentTarget = pgEnum('comment_target', ['document', 'claim', 'node', 'edge'])
export const suggestionStatus = pgEnum('suggestion_status', ['pending', 'accepted', 'rejected'])
export const notificationKind = pgEnum('notification_kind', [
  'suggestion',
  'budget_warning',
  'budget_paused',
  'budget_resumed',
  'factcheck_ready',
  'changeset_ready'
])

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  name: text('name').notNull().default(''),
  ...timestamps
})

export const workspaces = pgTable('workspaces', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: uuid('owner_id').notNull().references(() => users.id),
  name: text('name').notNull().default('我的知識庫'),
  graphDisplayLang: text('graph_display_lang').notNull().default('zh-TW'),
  webSearchEnabled: boolean('web_search_enabled').notNull().default(false),
  monthlyBudgetUsd: doublePrecision('monthly_budget_usd').notNull().default(10),
  ...timestamps
})

export const workspaceMembers = pgTable('workspace_members', {
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: memberRole('role').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, table => [
  primaryKey({ columns: [table.workspaceId, table.userId] })
])

export const documents = pgTable('documents', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  path: text('path').notNull(),
  title: text('title').notNull(),
  tags: jsonb('tags').$type<string[]>().notNull().default([]),
  currentVersionId: uuid('current_version_id'),
  visibility: visibility('visibility').notNull().default('private'),
  webSearchOverride: boolean('web_search_override'),
  searchText: text('search_text').notNull().default(''),
  searchVector: tsvector('search_vector'),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, table => [
  uniqueIndex('documents_workspace_path').on(table.workspaceId, table.path),
  index('documents_workspace_idx').on(table.workspaceId)
])

export const documentVersions = pgTable('document_versions', {
  id: uuid('id').primaryKey().defaultRandom(),
  documentId: uuid('document_id').notNull().references(() => documents.id, { onDelete: 'cascade' }),
  contentMd: text('content_md').notNull(),
  contentHash: text('content_hash').notNull(),
  createdBy: uuid('created_by').references(() => users.id),
  source: versionSource('source').notNull().default('edit'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, table => [
  index('document_versions_doc_idx').on(table.documentId)
])

export const docLinks = pgTable('doc_links', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  fromDocumentId: uuid('from_document_id').notNull().references(() => documents.id, { onDelete: 'cascade' }),
  toDocumentId: uuid('to_document_id').references(() => documents.id, { onDelete: 'set null' }),
  toTitle: text('to_title').notNull(),
  resolved: boolean('resolved').notNull().default(false)
}, table => [
  index('doc_links_from_idx').on(table.fromDocumentId),
  index('doc_links_to_idx').on(table.toDocumentId)
])

export const docChunks = pgTable('doc_chunks', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  documentId: uuid('document_id').notNull().references(() => documents.id, { onDelete: 'cascade' }),
  documentVersionId: uuid('document_version_id').notNull().references(() => documentVersions.id, { onDelete: 'cascade' }),
  ordinal: integer('ordinal').notNull(),
  text: text('text').notNull(),
  spanStart: integer('span_start').notNull().default(0),
  spanEnd: integer('span_end').notNull().default(0),
  searchVector: tsvector('search_vector'),
  embedding: vector('embedding', { dimensions: 768 })
}, table => [
  index('doc_chunks_version_idx').on(table.documentVersionId)
])

export const jobs = pgTable('jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  kind: jobKind('kind').notNull(),
  status: jobStatus('status').notNull().default('queued'),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
  progress: jsonb('progress').$type<Record<string, unknown>>().notNull().default({}),
  estimatedCostUsd: doublePrecision('estimated_cost_usd').notNull().default(0),
  attempts: integer('attempts').notNull().default(0),
  maxAttempts: integer('max_attempts').notNull().default(3),
  runAfter: timestamp('run_after', { withTimezone: true }).notNull().defaultNow(),
  lockedAt: timestamp('locked_at', { withTimezone: true }),
  lockedBy: text('locked_by'),
  lastError: text('last_error'),
  aiRunId: uuid('ai_run_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, table => [
  index('jobs_status_idx').on(table.status, table.runAfter)
])

export const aiRuns = pgTable('ai_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  jobId: uuid('job_id').references(() => jobs.id, { onDelete: 'set null' }),
  documentVersionId: uuid('document_version_id').references(() => documentVersions.id, { onDelete: 'set null' }),
  kind: aiRunKind('kind').notNull(),
  model: text('model').notNull(),
  promptVersion: text('prompt_version').notNull(),
  inputTokens: integer('input_tokens').notNull().default(0),
  outputTokens: integer('output_tokens').notNull().default(0),
  costUsd: doublePrecision('cost_usd').notNull().default(0),
  status: aiRunStatus('status').notNull().default('running'),
  progress: jsonb('progress').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true })
}, table => [
  index('ai_runs_workspace_idx').on(table.workspaceId, table.createdAt)
])

export const claims = pgTable('claims', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  documentId: uuid('document_id').notNull().references(() => documents.id, { onDelete: 'cascade' }),
  documentVersionId: uuid('document_version_id').notNull().references(() => documentVersions.id, { onDelete: 'cascade' }),
  aiRunId: uuid('ai_run_id').references(() => aiRuns.id, { onDelete: 'set null' }),
  text: text('text').notNull(),
  spanStart: integer('span_start').notNull(),
  spanEnd: integer('span_end').notNull(),
  verdict: claimVerdict('verdict').notNull(),
  confidence: doublePrecision('confidence').notNull(),
  reasoning: text('reasoning').notNull().default(''),
  suggestedFix: text('suggested_fix'),
  evidenceSource: evidenceSource('evidence_source').notNull().default('none'),
  citations: jsonb('citations').$type<Citation[]>().notNull().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, table => [
  index('claims_version_idx').on(table.documentVersionId),
  index('claims_document_idx').on(table.documentId)
])

export const claimReviews = pgTable('claim_reviews', {
  id: uuid('id').primaryKey().defaultRandom(),
  claimId: uuid('claim_id').notNull().references(() => claims.id, { onDelete: 'cascade' }),
  decision: reviewDecision('decision').notNull(),
  note: text('note').notNull().default(''),
  reviewedBy: uuid('reviewed_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
})

export const graphNodes = pgTable('graph_nodes', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  labelZh: text('label_zh').notNull(),
  labelEn: text('label_en').notNull().default(''),
  aliases: jsonb('aliases').$type<string[]>().notNull().default([]),
  type: text('type').notNull().default('concept'),
  locked: boolean('locked').notNull().default(false),
  embedding: vector('embedding', { dimensions: 768 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, table => [
  index('graph_nodes_workspace_idx').on(table.workspaceId)
])

export const graphEdges = pgTable('graph_edges', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  sourceId: uuid('source_id').notNull().references(() => graphNodes.id, { onDelete: 'cascade' }),
  targetId: uuid('target_id').notNull().references(() => graphNodes.id, { onDelete: 'cascade' }),
  relation: text('relation').notNull(),
  relationZh: text('relation_zh').notNull().default(''),
  relationEn: text('relation_en').notNull().default(''),
  confidence: doublePrecision('confidence').notNull().default(0.5),
  locked: boolean('locked').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, table => [
  index('graph_edges_workspace_idx').on(table.workspaceId),
  uniqueIndex('graph_edges_unique').on(table.workspaceId, table.sourceId, table.targetId, table.relation)
])

export const graphEvidence = pgTable('graph_evidence', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  nodeId: uuid('node_id').references(() => graphNodes.id, { onDelete: 'cascade' }),
  edgeId: uuid('edge_id').references(() => graphEdges.id, { onDelete: 'cascade' }),
  documentVersionId: uuid('document_version_id').references(() => documentVersions.id, { onDelete: 'set null' }),
  spanStart: integer('span_start'),
  spanEnd: integer('span_end'),
  quote: text('quote').notNull().default('')
})

export const graphVersions = pgTable('graph_versions', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  parentId: uuid('parent_id'),
  changesetId: uuid('changeset_id'),
  versionNo: integer('version_no').notNull(),
  summary: text('summary').notNull().default(''),
  snapshot: jsonb('snapshot').$type<GraphSnapshot | null>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, table => [
  uniqueIndex('graph_versions_workspace_no').on(table.workspaceId, table.versionNo)
])

export const graphChangesets = pgTable('graph_changesets', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  runId: uuid('run_id').references(() => aiRuns.id, { onDelete: 'set null' }),
  documentId: uuid('document_id').references(() => documents.id, { onDelete: 'set null' }),
  kind: changesetKind('kind').notNull(),
  baseVersionId: uuid('base_version_id').references(() => graphVersions.id),
  resultVersionId: uuid('result_version_id'),
  status: changesetStatus('status').notNull().default('pending'),
  batchNo: integer('batch_no'),
  batchTotal: integer('batch_total'),
  rebuildGroupId: uuid('rebuild_group_id'),
  decisionNote: text('decision_note').notNull().default(''),
  decidedBy: uuid('decided_by').references(() => users.id),
  estimatedCostUsd: doublePrecision('estimated_cost_usd').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  decidedAt: timestamp('decided_at', { withTimezone: true })
}, table => [
  index('graph_changesets_workspace_idx').on(table.workspaceId, table.status),
  index('graph_changesets_rebuild_idx').on(table.rebuildGroupId)
])

export const graphOps = pgTable('graph_ops', {
  id: uuid('id').primaryKey().defaultRandom(),
  changesetId: uuid('changeset_id').notNull().references(() => graphChangesets.id, { onDelete: 'cascade' }),
  opType: graphOpType('op_type').notNull(),
  targetId: text('target_id'),
  mergeFromId: text('merge_from_id'),
  before: jsonb('before'),
  after: jsonb('after'),
  accepted: boolean('accepted').notNull().default(false),
  applied: boolean('applied').notNull().default(false),
  confidence: doublePrecision('confidence').notNull().default(0),
  reason: text('reason').notNull().default(''),
  source: text('source').notNull().default('ai'),
  skipReason: text('skip_reason'),
  evidence: jsonb('evidence').$type<OpEvidence[]>().notNull().default([]),
  sortOrder: integer('sort_order').notNull().default(0)
}, table => [
  index('graph_ops_changeset_idx').on(table.changesetId, table.sortOrder)
])

export const budgetPeriods = pgTable('budget_periods', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  month: text('month').notNull(),
  capUsd: doublePrecision('cap_usd').notNull(),
  spentUsd: doublePrecision('spent_usd').notNull().default(0),
  warnedAt: timestamp('warned_at', { withTimezone: true }),
  pausedAt: timestamp('paused_at', { withTimezone: true })
}, table => [
  uniqueIndex('budget_periods_workspace_month').on(table.workspaceId, table.month)
])

export const notifications = pgTable('notifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  kind: notificationKind('kind').notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
  readAt: timestamp('read_at', { withTimezone: true }),
  emailedAt: timestamp('emailed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, table => [
  index('notifications_user_idx').on(table.userId, table.createdAt)
])

export const comments = pgTable('comments', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  authorId: uuid('author_id').notNull().references(() => users.id),
  targetType: commentTarget('target_type').notNull(),
  targetId: uuid('target_id').notNull(),
  body: text('body').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
})

export const suggestions = pgTable('suggestions', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  authorId: uuid('author_id').notNull().references(() => users.id),
  targetType: commentTarget('target_type').notNull(),
  targetId: uuid('target_id').notNull(),
  proposedChange: jsonb('proposed_change').$type<Record<string, unknown>>().notNull().default({}),
  rationale: text('rationale').notNull().default(''),
  status: suggestionStatus('status').notNull().default('pending'),
  ownerNote: text('owner_note').notNull().default(''),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
})

export const searchUsage = pgTable('search_usage', {
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  month: text('month').notNull(),
  provider: text('provider').notNull(),
  usedCount: integer('used_count').notNull().default(0)
}, table => [
  primaryKey({ columns: [table.workspaceId, table.month, table.provider] })
])

export interface Citation {
  url: string
  title: string
  quote: string
  provider?: 'knowledge_base' | 'exa' | 'tavily' | 'mock'
}

export interface OpEvidence {
  documentVersionId?: string
  quote: string
  spanStart?: number
  spanEnd?: number
}

export interface GraphSnapshot {
  nodes: Array<{
    id: string
    labelZh: string
    labelEn: string
    aliases: string[]
    type: string
    locked: boolean
  }>
  edges: Array<{
    id: string
    sourceId: string
    targetId: string
    relation: string
    relationZh: string
    relationEn: string
    confidence: number
    locked: boolean
  }>
}
