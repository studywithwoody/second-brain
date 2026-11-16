import { and, eq, sql } from 'drizzle-orm'
import {
  aiRuns,
  claims,
  documentVersions,
  documents,
  jobs,
  searchUsage,
  workspaces,
  type AppDb
} from '@kb/db'
import {
  embedTexts,
  estimateFactcheckCost,
  estimateGraphCost,
  extractClaims,
  extractGraph,
  judgeClaims,
  matchEntity,
  nameScore,
  resolveRuntime,
  searchWeb,
  selfCheck,
  type Usage
} from '@kb/ai'
import { normalizeName } from '@kb/ai'
import { applyOps, type GraphOp, type GraphState } from '@kb/graph'
import { gateBudget, addSpend, getWorkspace } from './budget'
import { notifyUser } from './notify'
import { createChangeset, latestVersion, loadState, snapshotCurrent } from './graph-repo'
import { graphChangesets } from '@kb/db'
import { asRows, currentMonth, id } from './util'

type OpDraft = GraphOp & { evidence?: Array<{ documentVersionId?: string, quote: string, spanStart?: number, spanEnd?: number }> }

const ACCEPT_AT = 0.75

/** LLM span offsets are unreliable; re-anchor each claim on the exact text in the note. */
export function alignClaimSpans<T extends { text: string, spanStart: number, spanEnd: number }>(markdown: string, claims: T[]): T[] {
  let cursor = 0
  return claims.map((claim) => {
    const text = claim.text.trim()
    if (!text) return claim
    if (markdown.slice(claim.spanStart, claim.spanEnd) === text) {
      cursor = claim.spanEnd
      return { ...claim, text }
    }
    let start = markdown.indexOf(text, cursor)
    if (start < 0) start = markdown.indexOf(text)
    if (start >= 0) {
      cursor = start + text.length
      return { ...claim, text, spanStart: start, spanEnd: start + text.length }
    }
    return { ...claim, text, spanStart: 0, spanEnd: 0 }
  })
}

export function inlineJobsEnabled() {
  if (process.env.PROCESS_JOBS_INLINE === 'false') return false
  if (process.env.PROCESS_JOBS_INLINE === 'true') return true
  return process.env.NODE_ENV !== 'production'
}

interface ClaimedJob {
  id: string
  workspaceId: string
  kind: 'factcheck' | 'graph_incremental' | 'graph_rebuild_batch'
  payload: Record<string, unknown>
  attempts: number
  maxAttempts: number
  estimatedCostUsd: number
}

function mapJob(row: Record<string, unknown>): ClaimedJob {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id ?? row.workspaceId),
    kind: String(row.kind) as ClaimedJob['kind'],
    payload: (row.payload || {}) as Record<string, unknown>,
    attempts: Number(row.attempts || 0),
    maxAttempts: Number(row.max_attempts ?? row.maxAttempts ?? 3),
    estimatedCostUsd: Number(row.estimated_cost_usd ?? row.estimatedCostUsd ?? 0)
  }
}

export async function recoverStaleJobs(db: AppDb) {
  await db.execute(sql`
    UPDATE jobs
    SET status = 'queued', locked_at = NULL, updated_at = now()
    WHERE status = 'running' AND locked_at < now() - interval '6 minutes'
  `)
}

export async function claimNextJob(db: AppDb, workspaceId?: string) {
  const worker = `worker-${process.pid}`
  const scope = workspaceId ? sql`AND workspace_id = ${workspaceId}` : sql``
  const result = await db.execute(sql`
    UPDATE jobs SET
      status = 'running',
      locked_at = now(),
      locked_by = ${worker},
      attempts = attempts + 1,
      updated_at = now()
    WHERE id = (
      SELECT id FROM jobs
      WHERE status = 'queued' AND run_after <= now()
      ${scope}
      ORDER BY created_at
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING *
  `)
  const row = asRows<Record<string, unknown>>(result)[0]
  return row ? mapJob(row) : null
}

async function finishJob(db: AppDb, jobId: string, status: 'succeeded' | 'failed' | 'paused_budget' | 'paused' | 'queued', extra?: { error?: string, aiRunId?: string, payload?: Record<string, unknown> }) {
  await db.update(jobs).set({
    status,
    lastError: extra?.error || null,
    lockedAt: null,
    updatedAt: new Date(),
    runAfter: status === 'queued' ? new Date(Date.now() + 1500) : new Date(),
    ...(extra?.aiRunId ? { aiRunId: extra.aiRunId } : {}),
    ...(extra?.payload ? { payload: extra.payload } : {})
  }).where(eq(jobs.id, jobId))
}

async function openRun(db: AppDb, input: { workspaceId: string, jobId: string, documentVersionId?: string, kind: 'factcheck' | 'graph' | 'rebuild' | 'embed', model: string }) {
  const runtime = resolveRuntime()
  const [run] = await db.insert(aiRuns).values({
    workspaceId: input.workspaceId,
    jobId: input.jobId,
    documentVersionId: input.documentVersionId || null,
    kind: input.kind,
    model: input.model,
    promptVersion: runtime.promptVersion,
    status: 'running'
  }).returning()
  return run!
}

function foldUsage(usages: Usage[]) {
  return usages.reduce((sum, usage) => ({
    inputTokens: sum.inputTokens + usage.inputTokens,
    outputTokens: sum.outputTokens + usage.outputTokens,
    costUsd: sum.costUsd + usage.costUsd
  }), { inputTokens: 0, outputTokens: 0, costUsd: 0 })
}

async function searchCounts(db: AppDb, workspaceId: string) {
  const month = currentMonth()
  const rows = await db.select().from(searchUsage).where(and(
    eq(searchUsage.workspaceId, workspaceId),
    eq(searchUsage.month, month)
  ))
  return {
    exa: rows.find(row => row.provider === 'exa')?.usedCount || 0,
    tavily: rows.find(row => row.provider === 'tavily')?.usedCount || 0
  }
}

async function bumpSearch(db: AppDb, workspaceId: string, provider: string) {
  const month = currentMonth()
  await db.insert(searchUsage).values({ workspaceId, month, provider, usedCount: 1 }).onConflictDoUpdate({
    target: [searchUsage.workspaceId, searchUsage.month, searchUsage.provider],
    set: { usedCount: sql`${searchUsage.usedCount} + 1` }
  })
}

async function kbHits(db: AppDb, workspaceId: string, text: string, excludeDocumentId?: string, usages?: Usage[]) {
  const embedded = await embedTexts([text])
  usages?.push(embedded.usage)
  const vector = JSON.stringify(embedded.vectors[0] || [])
  const result = await db.execute(sql`
    SELECT text, 1 - (embedding <=> ${vector}::vector) AS score
    FROM doc_chunks
    WHERE workspace_id = ${workspaceId} AND embedding IS NOT NULL
      ${excludeDocumentId ? sql`AND document_id <> ${excludeDocumentId}` : sql``}
    ORDER BY embedding <=> ${vector}::vector
    LIMIT 3
  `)
  return asRows<{ text: string, score: number }>(result)
    .filter(row => Number(row.score) > 0.15)
    .map(row => ({
      url: '',
      title: '你的筆記',
      quote: String(row.text).slice(0, 240),
      provider: 'knowledge_base' as const
    }))
}

export async function proposeOps(input: {
  extraction: { entities: Array<{ labelZh: string, labelEn: string, aliases: string[], type: string, confidence: number }>, relations: Array<{ sourceZh: string, targetZh: string, relation: string, relationZh: string, relationEn: string, confidence: number }> }
  existing: GraphState
  documentVersionId: string
}): Promise<OpDraft[]> {
  const ops: OpDraft[] = []
  const idByName = new Map<string, string>()
  const nodes = [...input.existing.nodes]
  const edges = [...input.existing.edges]
  const remember = (names: string[], nodeId: string) => {
    for (const name of names) {
      const key = normalizeName(name)
      if (key) idByName.set(key, nodeId)
    }
  }
  for (const node of nodes) remember([node.labelZh, node.labelEn, ...node.aliases], node.id)

  // Same name but a different kind of thing (e.g. the unit 牛頓 vs the person 牛頓) is not a match.
  const compatible = (node: GraphState['nodes'][number], type: string) =>
    node.type === type || node.type === 'other' || type === 'other'
  // Primary names (labelZh / labelEn) of this extraction win over aliases when resolving relation endpoints.
  const primaryByName = new Map<string, string>()
  for (const entity of input.extraction.entities) {
    const names = [entity.labelZh, entity.labelEn, ...entity.aliases]
    const primary = [entity.labelZh, entity.labelEn].map(normalizeName).filter(Boolean)
    let matched = nodes.find(node => compatible(node, entity.type) && primary.some(name => name === normalizeName(node.labelZh) || name === normalizeName(node.labelEn)))
    if (!matched) {
      const direct = names.map(name => idByName.get(normalizeName(name))).filter(Boolean)
      matched = nodes.find(node => direct.includes(node.id) && compatible(node, entity.type))
    }
    if (!matched) {
      let best: { node: GraphState['nodes'][number], score: number } | null = null
      for (const node of nodes) {
        if (!compatible(node, entity.type)) continue
        const score = nameScore(entity, node)
        if (!best || score > best.score) best = { node, score }
      }
      if (best && best.score >= 0.72) {
        const decision = best.score >= 0.98
          ? { same: true, confidence: best.score }
          : (await matchEntity(entity, best.node)).match
        if (decision.same) matched = best.node
      }
    }
    if (matched) {
      const aliases = [...new Set([...matched.aliases, ...entity.aliases])]
      const changed = matched.labelEn !== entity.labelEn || matched.type !== entity.type || aliases.join('\u0000') !== [...matched.aliases].sort().join('\u0000')
      if (changed) {
        ops.push({
          opType: 'update_node',
          targetId: matched.id,
          before: matched,
          after: {
            labelZh: matched.labelZh || entity.labelZh,
            labelEn: entity.labelEn || matched.labelEn,
            aliases,
            type: entity.type
          },
          accepted: !matched.locked && entity.confidence >= ACCEPT_AT,
          confidence: entity.confidence,
          reason: matched.locked ? '此節點已手動鎖定，AI 不會覆蓋' : '與既有節點對齊，補上名稱或別名',
          source: 'ai',
          evidence: [{ documentVersionId: input.documentVersionId, quote: entity.labelZh }]
        })
      }
      remember(names, matched.id)
      for (const name of [entity.labelZh, entity.labelEn]) if (normalizeName(name)) primaryByName.set(normalizeName(name), matched.id)
      continue
    }
    const nodeId = id()
    const created = {
      id: nodeId,
      labelZh: entity.labelZh,
      labelEn: entity.labelEn,
      aliases: entity.aliases,
      type: entity.type,
      locked: false
    }
    nodes.push(created)
    remember(names, nodeId)
    for (const name of [entity.labelZh, entity.labelEn]) if (normalizeName(name)) primaryByName.set(normalizeName(name), nodeId)
    ops.push({
      opType: 'add_node',
      targetId: nodeId,
      after: created,
      accepted: entity.confidence >= ACCEPT_AT,
      confidence: entity.confidence,
      reason: '從筆記抽出的新實體',
      source: 'ai',
      evidence: [{ documentVersionId: input.documentVersionId, quote: entity.labelZh }]
    })
  }

  for (const relation of input.extraction.relations) {
    const resolve = (name: string) => primaryByName.get(normalizeName(name)) || idByName.get(normalizeName(name))
    const sourceId = resolve(relation.sourceZh)
    const targetId = resolve(relation.targetZh)
    if (!sourceId || !targetId || sourceId === targetId) continue
    if (edges.some(edge => edge.sourceId === sourceId && edge.targetId === targetId && edge.relation === relation.relation)) continue
    const edgeId = id()
    const edge = {
      id: edgeId,
      sourceId,
      targetId,
      relation: relation.relation,
      relationZh: relation.relationZh,
      relationEn: relation.relationEn,
      confidence: relation.confidence,
      locked: false
    }
    edges.push(edge)
    ops.push({
      opType: 'add_edge',
      targetId: edgeId,
      after: edge,
      accepted: relation.confidence >= ACCEPT_AT,
      confidence: relation.confidence,
      reason: '筆記段落裡一起出現的關係',
      source: 'ai',
      evidence: [{ documentVersionId: input.documentVersionId, quote: `${relation.sourceZh}${relation.relationZh}${relation.targetZh}` }]
    })
  }
  return ops
}

async function runFactcheck(db: AppDb, job: ClaimedJob) {
  const documentId = String(job.payload.documentId || '')
  const documentVersionId = String(job.payload.documentVersionId || '')
  const [version] = await db.select().from(documentVersions).where(eq(documentVersions.id, documentVersionId)).limit(1)
  const [note] = await db.select().from(documents).where(eq(documents.id, documentId)).limit(1)
  if (!version || !note) throw new Error('找不到要查核的筆記版本')
  const estimate = job.estimatedCostUsd || estimateFactcheckCost(version.contentMd.length)
  const gate = await gateBudget(db, job.workspaceId, estimate)
  if (gate.block) {
    await finishJob(db, job.id, 'paused_budget')
    await notifyUser(db, {
      workspaceId: job.workspaceId,
      userId: gate.workspace.ownerId,
      kind: 'budget_paused',
      title: '查核任務因預算暫停',
      body: `「${note.title}」的查核已排隊，預估 $${estimate.toFixed(4)}。`
    })
    return
  }
  const runtime = resolveRuntime()
  const extracted = await extractClaims(version.contentMd, runtime)
  extracted.claims = alignClaimSpans(version.contentMd, extracted.claims)
  const usages: Usage[] = [extracted.usage]
  // One entry per extracted claim so verdict.index lines up with the evidence it was judged on.
  const evidenceBundle: Array<{ claim: string, knowledgeBase: Awaited<ReturnType<typeof kbHits>>, web: Awaited<ReturnType<typeof searchWeb>>['citations'] }> =
    extracted.claims.map(claim => ({ claim: claim.text, knowledgeBase: [], web: [] }))
  const counts = await searchCounts(db, job.workspaceId)
  const webAllowed = note.webSearchOverride ?? gate.workspace.webSearchEnabled
  const checkable = extracted.claims
    .map((claim, index) => ({ claim, index }))
    .filter(item => item.claim.checkable)
    .slice(0, 8)
  for (const { claim, index } of checkable) {
    const kb = await kbHits(db, job.workspaceId, claim.text, documentId, usages)
    let web: Awaited<ReturnType<typeof searchWeb>>['citations'] = []
    if (webAllowed) {
      const found = await searchWeb(claim.text, {
        exaApiKey: process.env.EXA_API_KEY,
        tavilyApiKey: process.env.TAVILY_API_KEY
      }, counts)
      if (found.provider === 'exa' || found.provider === 'tavily') {
        counts[found.provider] += 1
        await bumpSearch(db, job.workspaceId, found.provider)
      }
      web = found.citations
    }
    evidenceBundle[index] = { claim: claim.text, knowledgeBase: kb, web }
  }
  const judged = await judgeClaims(
    extracted.claims.map((claim, index) => ({ index, ...claim })),
    evidenceBundle.map((bundle, index) => ({ index, ...bundle })),
    runtime
  )
  usages.push(judged.usage)
  const seen = new Set<number>()
  const verdicts = judged.verdicts.filter((verdict) => {
    if (!extracted.claims[verdict.index] || seen.has(verdict.index)) return false
    seen.add(verdict.index)
    return true
  })
  for (const verdict of verdicts) {
    if (verdict.verdict === 'contradicted' && verdict.confidence >= 0.85) {
      const claim = extracted.claims[verdict.index]
      if (!claim) continue
      const check = await selfCheck(claim.text, verdict, runtime)
      usages.push(check.usage)
      if (!check.agree) {
        verdict.verdict = 'uncertain'
        verdict.confidence = Math.min(verdict.confidence, check.confidence)
        verdict.reasoning = `${verdict.reasoning} 第二次檢查沒有維持否定：${check.reasoning}`
      }
    }
  }
  const totals = foldUsage(usages)
  const run = await openRun(db, {
    workspaceId: job.workspaceId,
    jobId: job.id,
    documentVersionId,
    kind: 'factcheck',
    model: runtime.provider === 'mock' ? `mock:${runtime.verdictModel}` : runtime.verdictModel
  })
  await db.update(aiRuns).set({
    inputTokens: totals.inputTokens,
    outputTokens: totals.outputTokens,
    costUsd: totals.costUsd,
    status: 'succeeded',
    finishedAt: new Date(),
    progress: { provider: runtime.provider, claims: extracted.claims.length }
  }).where(eq(aiRuns.id, run.id))
  await db.delete(claims).where(eq(claims.documentVersionId, documentVersionId))
  if (verdicts.length) {
    await db.insert(claims).values(verdicts.map(verdict => {
      const claim = extracted.claims[verdict.index]
      const bundle = evidenceBundle[verdict.index]
      const citations = [...(bundle?.knowledgeBase || []), ...(bundle?.web || [])]
      let evidenceSource = verdict.evidenceSource
      if (evidenceSource === 'web' && !(bundle?.web || []).length) evidenceSource = (bundle?.knowledgeBase || []).length ? 'knowledge_base' : 'none'
      if (evidenceSource === 'knowledge_base' && !(bundle?.knowledgeBase || []).length && (bundle?.web || []).length) evidenceSource = 'web'
      return {
        workspaceId: job.workspaceId,
        documentId,
        documentVersionId,
        aiRunId: run.id,
        text: claim?.text || '',
        spanStart: claim?.spanStart || 0,
        spanEnd: claim?.spanEnd || 0,
        verdict: verdict.verdict,
        confidence: verdict.confidence,
        reasoning: verdict.reasoning,
        suggestedFix: verdict.suggestedFix || null,
        evidenceSource,
        citations
      }
    }))
  }
  await addSpend(db, job.workspaceId, totals.costUsd)
  const flagged = verdicts.filter(item => item.verdict === 'contradicted' || item.verdict === 'uncertain').length
  if (flagged) {
    await notifyUser(db, {
      workspaceId: job.workspaceId,
      userId: gate.workspace.ownerId,
      kind: 'factcheck_ready',
      title: `「${note.title}」有 ${flagged} 條主張待覆核`,
      body: '自動事實查核是輔助，不是權威。請對照引用與信心分數後再決定。',
      payload: { documentId }
    })
  }
  await finishJob(db, job.id, 'succeeded', { aiRunId: run.id })
}

async function runGraphIncremental(db: AppDb, job: ClaimedJob) {
  const documentId = String(job.payload.documentId || '')
  const documentVersionId = String(job.payload.documentVersionId || '')
  const [version] = await db.select().from(documentVersions).where(eq(documentVersions.id, documentVersionId)).limit(1)
  const [note] = await db.select().from(documents).where(eq(documents.id, documentId)).limit(1)
  if (!version || !note) throw new Error('找不到要建圖的筆記版本')
  const estimate = job.estimatedCostUsd || estimateGraphCost(version.contentMd.length)
  const gate = await gateBudget(db, job.workspaceId, estimate)
  if (gate.block) {
    await finishJob(db, job.id, 'paused_budget')
    return
  }
  const runtime = resolveRuntime()
  const extracted = await extractGraph(version.contentMd, runtime)
  const existing = await loadState(db, job.workspaceId)
  const ops = await proposeOps({ extraction: extracted.graph, existing, documentVersionId })
  const run = await openRun(db, {
    workspaceId: job.workspaceId,
    jobId: job.id,
    documentVersionId,
    kind: 'graph',
    model: runtime.provider === 'mock' ? `mock:${runtime.extractionModel}` : runtime.extractionModel
  })
  await db.update(aiRuns).set({
    inputTokens: extracted.usage.inputTokens,
    outputTokens: extracted.usage.outputTokens,
    costUsd: extracted.usage.costUsd,
    status: 'succeeded',
    finishedAt: new Date(),
    progress: { entities: extracted.graph.entities.length, relations: extracted.graph.relations.length }
  }).where(eq(aiRuns.id, run.id))
  const changeset = await createChangeset(db, {
    workspaceId: job.workspaceId,
    kind: 'incremental',
    ops,
    documentId,
    runId: run.id,
    estimatedCostUsd: extracted.usage.costUsd
  })
  await addSpend(db, job.workspaceId, extracted.usage.costUsd)
  await notifyUser(db, {
    workspaceId: job.workspaceId,
    userId: gate.workspace.ownerId,
    kind: 'changeset_ready',
    title: `「${note.title}」的圖譜變更待確認`,
    body: `提出 ${ops.length} 項操作。沒有你確認，圖譜不會改變。`,
    payload: { changesetId: changeset.id, documentId }
  })
  await finishJob(db, job.id, 'succeeded', { aiRunId: run.id })
}

async function virtualRebuildState(db: AppDb, workspaceId: string, rebuildGroupId: string, snapshot: GraphState) {
  const { graphChangesets, graphOps } = await import('@kb/db')
  const { asc } = await import('drizzle-orm')
  const batches = await db.select().from(graphChangesets).where(and(
    eq(graphChangesets.workspaceId, workspaceId),
    eq(graphChangesets.rebuildGroupId, rebuildGroupId)
  )).orderBy(asc(graphChangesets.batchNo))
  let state = snapshot
  for (const batch of batches) {
    const rows = await db.select().from(graphOps).where(eq(graphOps.changesetId, batch.id)).orderBy(asc(graphOps.sortOrder))
    const ops: GraphOp[] = rows.filter(row => row.accepted).map(row => ({
      opType: row.opType,
      targetId: row.targetId || undefined,
      mergeFromId: row.mergeFromId || undefined,
      before: row.before ?? undefined,
      after: row.after ?? undefined,
      accepted: true,
      confidence: row.confidence,
      reason: row.reason,
      source: 'ai'
    }))
    state = applyOps(state, ops, { onlyAccepted: false }).state
  }
  return state
}

async function runRebuildBatch(db: AppDb, job: ClaimedJob) {
  const payload = job.payload as {
    rebuildGroupId: string
    documentIds: string[]
    cursor: number
    batchSize: number
    batchTotal: number
    pause?: boolean
  }
  if (payload.pause) {
    await finishJob(db, job.id, 'paused', { payload })
    return
  }
  const ids = payload.documentIds.slice(payload.cursor, payload.cursor + payload.batchSize)
  const workspace = await getWorkspace(db, job.workspaceId)
  const base = await latestVersion(db, job.workspaceId)
  const snapshot = (base?.snapshot as GraphState | null) || await loadState(db, job.workspaceId)
  let existing = await virtualRebuildState(db, job.workspaceId, payload.rebuildGroupId, snapshot)
  const runtime = resolveRuntime()
  const usages: Usage[] = []
  const ops: OpDraft[] = []
  for (const documentId of ids) {
    const [note] = await db.select().from(documents).where(eq(documents.id, documentId)).limit(1)
    if (!note?.currentVersionId) continue
    const [version] = await db.select().from(documentVersions).where(eq(documentVersions.id, note.currentVersionId)).limit(1)
    if (!version) continue
    const gate = await gateBudget(db, job.workspaceId, estimateGraphCost(version.contentMd.length))
    if (gate.block) {
      await finishJob(db, job.id, 'paused_budget', { payload })
      return
    }
    const extracted = await extractGraph(version.contentMd, runtime)
    usages.push(extracted.usage)
    const proposed = await proposeOps({ extraction: extracted.graph, existing, documentVersionId: version.id })
    ops.push(...proposed)
    existing = applyOps(existing, proposed, { onlyAccepted: true }).state
  }
  const totals = foldUsage(usages)
  const batchNo = Math.floor(payload.cursor / payload.batchSize) + 1
  const run = await openRun(db, {
    workspaceId: job.workspaceId,
    jobId: job.id,
    kind: 'rebuild',
    model: runtime.provider === 'mock' ? `mock:${runtime.extractionModel}` : runtime.extractionModel
  })
  await db.update(aiRuns).set({
    inputTokens: totals.inputTokens,
    outputTokens: totals.outputTokens,
    costUsd: totals.costUsd,
    status: 'succeeded',
    finishedAt: new Date()
  }).where(eq(aiRuns.id, run.id))
  const changeset = await createChangeset(db, {
    workspaceId: job.workspaceId,
    kind: 'rebuild',
    ops,
    runId: run.id,
    batchNo,
    batchTotal: payload.batchTotal,
    rebuildGroupId: payload.rebuildGroupId,
    estimatedCostUsd: totals.costUsd,
    summaryHint: `重建第 ${batchNo}/${payload.batchTotal} 批`
  })
  await addSpend(db, job.workspaceId, totals.costUsd)
  await notifyUser(db, {
    workspaceId: job.workspaceId,
    userId: workspace.ownerId,
    kind: 'changeset_ready',
    title: `全量重建第 ${batchNo}/${payload.batchTotal} 批待確認`,
    body: '這一批核准後還不會改圖譜，全部批次核准才會產生一個新版本。',
    payload: { changesetId: changeset.id, rebuildGroupId: payload.rebuildGroupId }
  })
  const nextCursor = payload.cursor + payload.batchSize
  if (nextCursor < payload.documentIds.length) {
    const [fresh] = await db.select().from(jobs).where(eq(jobs.id, job.id)).limit(1)
    const pause = Boolean((fresh?.payload as { pause?: boolean } | undefined)?.pause || payload.pause)
    await db.insert(jobs).values({
      workspaceId: job.workspaceId,
      kind: 'graph_rebuild_batch',
      status: pause ? 'paused' : 'queued',
      payload: { ...payload, cursor: nextCursor, pause: false },
      estimatedCostUsd: estimateGraphCost(800) * payload.batchSize
    })
  }
  await finishJob(db, job.id, 'succeeded', { aiRunId: run.id })
}

export async function runClaimedJob(db: AppDb, job: ClaimedJob) {
  const gap = Number(process.env.AI_MIN_INTERVAL_MS || 0)
  if (gap > 0 && resolveRuntime().provider === 'gemini') {
    await new Promise(resolve => setTimeout(resolve, gap))
  }
  try {
    if (job.kind === 'factcheck') await runFactcheck(db, job)
    else if (job.kind === 'graph_incremental') await runGraphIncremental(db, job)
    else await runRebuildBatch(db, job)
  } catch (error) {
    const message = error instanceof Error ? error.message : '任務失敗'
    if (job.attempts < job.maxAttempts) await finishJob(db, job.id, 'queued', { error: message })
    else await finishJob(db, job.id, 'failed', { error: message })
    throw error
  }
}

export async function processPending(
  db: AppDb,
  workspaceId?: string,
  limit = 20,
  options?: { budgetMs?: number }
) {
  await recoverStaleJobs(db)
  const done: string[] = []
  const started = Date.now()
  for (let index = 0; index < limit; index++) {
    if (options?.budgetMs != null && Date.now() - started >= options.budgetMs) break
    const job = await claimNextJob(db, workspaceId)
    if (!job) break
    try {
      await runClaimedJob(db, job)
    } catch (error) {
      console.error('[job]', job.id, error instanceof Error ? error.message : error)
    }
    done.push(job.id)
  }
  return done
}

async function enqueue(db: AppDb, input: {
  workspaceId: string
  kind: ClaimedJob['kind']
  payload: Record<string, unknown>
  estimate: number
  ownerId: string
  title: string
}) {
  const gate = await gateBudget(db, input.workspaceId, input.estimate)
  const status = gate.block ? 'paused_budget' : 'queued'
  const [job] = await db.insert(jobs).values({
    workspaceId: input.workspaceId,
    kind: input.kind,
    status,
    payload: input.payload,
    estimatedCostUsd: input.estimate
  }).returning()
  if (status === 'paused_budget') {
    await notifyUser(db, {
      workspaceId: input.workspaceId,
      userId: input.ownerId,
      kind: 'budget_paused',
      title: '任務已排隊，等待預算',
      body: `${input.title}預估 $${input.estimate.toFixed(4)}，已達每月上限。`
    })
  }
  return { job: job!, blocked: status === 'paused_budget', estimate: input.estimate, warn: gate.warn }
}

export async function enqueueFactcheck(db: AppDb, workspaceId: string, documentId: string) {
  const [note] = await db.select().from(documents).where(and(eq(documents.id, documentId), eq(documents.workspaceId, workspaceId))).limit(1)
  if (!note?.currentVersionId) throw new Error('筆記還沒有內容')
  const [version] = await db.select().from(documentVersions).where(eq(documentVersions.id, note.currentVersionId)).limit(1)
  const existing = await db.select().from(jobs).where(and(
    eq(jobs.workspaceId, workspaceId),
    eq(jobs.kind, 'factcheck'),
    sql`${jobs.status} IN ('queued', 'running')`,
    sql`${jobs.payload}->>'documentVersionId' = ${note.currentVersionId}`
  )).limit(1)
  if (existing[0]) return { job: existing[0], blocked: false, estimate: existing[0].estimatedCostUsd, warn: false, duplicate: true }
  const workspace = await getWorkspace(db, workspaceId)
  return {
    ...await enqueue(db, {
      workspaceId,
      kind: 'factcheck',
      payload: { documentId, documentVersionId: note.currentVersionId },
      estimate: estimateFactcheckCost(version?.contentMd.length || 0),
      ownerId: workspace.ownerId,
      title: `查核「${note.title}」`
    }),
    duplicate: false
  }
}

export async function enqueueGraph(db: AppDb, workspaceId: string, documentId: string) {
  const [note] = await db.select().from(documents).where(and(eq(documents.id, documentId), eq(documents.workspaceId, workspaceId))).limit(1)
  if (!note?.currentVersionId) throw new Error('筆記還沒有內容')
  const [version] = await db.select().from(documentVersions).where(eq(documentVersions.id, note.currentVersionId)).limit(1)
  const workspace = await getWorkspace(db, workspaceId)
  return enqueue(db, {
    workspaceId,
    kind: 'graph_incremental',
    payload: { documentId, documentVersionId: note.currentVersionId },
    estimate: estimateGraphCost(version?.contentMd.length || 0),
    ownerId: workspace.ownerId,
    title: `為「${note.title}」更新圖譜`
  })
}

export async function startRebuild(db: AppDb, workspaceId: string) {
  const active = await db.select().from(jobs).where(and(
    eq(jobs.workspaceId, workspaceId),
    eq(jobs.kind, 'graph_rebuild_batch'),
    sql`${jobs.status} IN ('queued', 'running', 'paused', 'paused_budget')`
  )).limit(1)
  if (active.length) throw new Error('已經有一個全量重建在進行或暫停中')
  const notes = await db.select().from(documents).where(and(eq(documents.workspaceId, workspaceId), sql`${documents.deletedAt} IS NULL`))
  if (!notes.length) throw new Error('沒有筆記可重建')
  const versions = await db.select().from(documentVersions).where(sql`${documentVersions.documentId} IN (${sql.join(notes.map(note => sql`${note.id}`), sql`, `)})`)
  const chars = versions.reduce((sum, version) => sum + version.contentMd.length, 0)
  const estimate = estimateGraphCost(Math.ceil(chars / Math.max(1, notes.length))) * notes.length
  const gate = await gateBudget(db, workspaceId, estimate)
  if (gate.block) {
    throw new Error(`預估費用 $${estimate.toFixed(2)} 會超過本月剩餘預算 $${gate.remaining.toFixed(2)}`)
  }
  await snapshotCurrent(db, workspaceId)
  const batchSize = Math.max(1, Number(process.env.REBUILD_BATCH_SIZE || 2))
  const documentIds = notes.map(note => note.id)
  const batchTotal = Math.ceil(documentIds.length / batchSize)
  const rebuildGroupId = id()
  const [job] = await db.insert(jobs).values({
    workspaceId,
    kind: 'graph_rebuild_batch',
    status: 'queued',
    estimatedCostUsd: estimate,
    payload: { rebuildGroupId, documentIds, cursor: 0, batchSize, batchTotal }
  }).returning()
  return {
    job: job!,
    estimate,
    noteCount: notes.length,
    batchTotal,
    rebuildGroupId,
    warn: gate.warn
  }
}

export async function pauseRebuild(db: AppDb, workspaceId: string) {
  await db.update(jobs).set({ status: 'paused', updatedAt: new Date() }).where(and(
    eq(jobs.workspaceId, workspaceId),
    eq(jobs.kind, 'graph_rebuild_batch'),
    eq(jobs.status, 'queued')
  ))
  const running = await db.select().from(jobs).where(and(
    eq(jobs.workspaceId, workspaceId),
    eq(jobs.kind, 'graph_rebuild_batch'),
    eq(jobs.status, 'running')
  ))
  for (const job of running) {
    await db.update(jobs).set({
      payload: { ...(job.payload || {}), pause: true },
      updatedAt: new Date()
    }).where(eq(jobs.id, job.id))
  }
}

export async function resumeRebuild(db: AppDb, workspaceId: string) {
  await db.update(jobs).set({ status: 'queued', updatedAt: new Date() }).where(and(
    eq(jobs.workspaceId, workspaceId),
    eq(jobs.kind, 'graph_rebuild_batch'),
    sql`${jobs.status} IN ('paused', 'paused_budget')`
  ))
}

export async function rebuildOverview(db: AppDb, workspaceId: string) {
  const rows = await db.select().from(jobs).where(and(
    eq(jobs.workspaceId, workspaceId),
    eq(jobs.kind, 'graph_rebuild_batch')
  ))
  const active = rows.find(row => ['queued', 'running', 'paused', 'paused_budget'].includes(row.status))
  return { active: active || null, jobs: rows.slice(0, 12) }
}

export async function workspaceWebSearch(db: AppDb, workspaceId: string, enabled: boolean) {
  await db.update(workspaces).set({ webSearchEnabled: enabled }).where(eq(workspaces.id, workspaceId))
}

export async function workspaceLang(db: AppDb, workspaceId: string, lang: 'zh-TW' | 'en') {
  await db.update(workspaces).set({ graphDisplayLang: lang }).where(eq(workspaces.id, workspaceId))
}

/** What the UI needs to poll a note's AI work: active jobs, the latest finished ones, and a pending changeset. */
export async function documentJobStatus(db: AppDb, workspaceId: string, documentId: string) {
  const rows = await db.execute(sql`
    SELECT id, kind, status, attempts, last_error AS "lastError", created_at AS "createdAt", updated_at AS "updatedAt"
    FROM jobs
    WHERE workspace_id = ${workspaceId} AND payload->>'documentId' = ${documentId}
    ORDER BY created_at DESC
    LIMIT 10
  `)
  const list = asRows<{ id: string, kind: string, status: string, attempts: number, lastError: string | null, createdAt: string, updatedAt: string }>(rows)
  const active = list.filter(job => job.status === 'queued' || job.status === 'running')
  const [pending] = await db.select({ id: graphChangesets.id, createdAt: graphChangesets.createdAt })
    .from(graphChangesets)
    .where(and(
      eq(graphChangesets.workspaceId, workspaceId),
      eq(graphChangesets.documentId, documentId),
      eq(graphChangesets.status, 'pending')
    ))
    .orderBy(sql`${graphChangesets.createdAt} DESC`)
    .limit(1)
  return {
    active,
    latest: {
      factcheck: list.find(job => job.kind === 'factcheck') || null,
      graph: list.find(job => job.kind === 'graph_incremental') || null
    },
    pausedBudget: list.some(job => job.status === 'paused_budget'),
    pendingChangesetId: pending?.id || null
  }
}

export async function hasRunnableJobs(db: AppDb, workspaceId: string) {
  const rows = asRows<{ n: number }>(await db.execute(sql`
    SELECT count(*)::int AS n FROM jobs
    WHERE workspace_id = ${workspaceId}
      AND ((status = 'queued' AND run_after <= now())
        OR (status = 'running' AND locked_at < now() - interval '6 minutes'))
  `))
  return Number(rows[0]?.n || 0) > 0
}
