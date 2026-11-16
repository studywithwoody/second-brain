import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { embedMany, generateObject } from 'ai'
import {
  claimPrompt,
  graphPrompt,
  matchPrompt,
  PROMPT_VERSION,
  selfCheckPrompt,
  verdictPrompt
} from './prompts'
import {
  entityMatchSchema,
  extractedClaimsSchema,
  graphExtractionSchema,
  selfCheckSchema,
  verdictSchema,
  type ClaimVerdict,
  type EntityMatch,
  type ExtractedClaim,
  type GraphExtraction
} from './schemas'
import {
  extractClaimsMock,
  extractGraphMock,
  judgeClaimsMock,
  matchEntityMock,
  mockUsage,
  selfCheckMock,
  type MatchCandidate
} from './mock'
import { mockEmbedding } from './text'
import { tokenCost } from './pricing'

export interface Usage {
  model: string
  inputTokens: number
  outputTokens: number
  costUsd: number
}

export interface AiRuntime {
  provider: 'mock' | 'gemini'
  extractionModel: string
  verdictModel: string
  embeddingModel: string
  promptVersion: string
}

export function resolveRuntime(env: NodeJS.ProcessEnv = process.env): AiRuntime {
  const extractionModel = env.EXTRACTION_MODEL || 'gemini-3.5-flash-lite'
  const verdictModel = env.VERDICT_MODEL || 'gemini-3.8-flash'
  const embeddingModel = env.EMBEDDING_MODEL || 'gemini-embedding-001'
  const requested = (env.LLM_PROVIDER || '').toLowerCase()
  const hasKey = Boolean(env.GEMINI_API_KEY)
  const provider = requested === 'mock' || (!requested && !hasKey)
    ? 'mock'
    : 'gemini'
  if (provider === 'gemini' && !hasKey) {
    throw new Error('LLM_PROVIDER=gemini 但未設定 GEMINI_API_KEY')
  }
  return { provider, extractionModel, verdictModel, embeddingModel, promptVersion: PROMPT_VERSION }
}

function withCost(usage: { model: string, inputTokens: number, outputTokens: number }): Usage {
  return { ...usage, costUsd: tokenCost(usage.model, usage.inputTokens, usage.outputTokens) }
}

function google(model: string) {
  const client = createGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY || '' })
  return client(model)
}

function usageFrom(model: string, usage: { inputTokens?: number, outputTokens?: number, promptTokens?: number, completionTokens?: number } | undefined): Usage {
  const inputTokens = usage?.inputTokens ?? usage?.promptTokens ?? 0
  const outputTokens = usage?.outputTokens ?? usage?.completionTokens ?? 0
  return withCost({ model, inputTokens, outputTokens })
}

export async function extractClaims(markdown: string, runtime = resolveRuntime()) {
  if (runtime.provider === 'mock') {
    const claims = extractClaimsMock(markdown)
    return { claims, usage: withCost(mockUsage(runtime.extractionModel, markdown, JSON.stringify(claims).length)) }
  }
  const result = await generateObject({
    model: google(runtime.extractionModel),
    schema: extractedClaimsSchema,
    prompt: claimPrompt(markdown)
  })
  return { claims: result.object.claims, usage: usageFrom(runtime.extractionModel, result.usage) }
}

export async function judgeClaims(
  claims: ExtractedClaim[],
  evidence: unknown,
  runtime = resolveRuntime()
) {
  if (runtime.provider === 'mock') {
    const verdicts = judgeClaimsMock(claims)
    return { verdicts, usage: withCost(mockUsage(runtime.verdictModel, JSON.stringify(claims), JSON.stringify(verdicts).length)) }
  }
  const result = await generateObject({
    model: google(runtime.verdictModel),
    schema: verdictSchema,
    prompt: verdictPrompt(claims, evidence)
  })
  return { verdicts: result.object.verdicts, usage: usageFrom(runtime.verdictModel, result.usage) }
}

export async function selfCheck(claim: string, verdict: ClaimVerdict, runtime = resolveRuntime()) {
  if (runtime.provider === 'mock') {
    const result = selfCheckMock(claim, verdict.confidence)
    return { ...result, usage: withCost(mockUsage(runtime.verdictModel, claim, 80)) }
  }
  const result = await generateObject({
    model: google(runtime.verdictModel),
    schema: selfCheckSchema,
    prompt: selfCheckPrompt(claim, verdict)
  })
  return { ...result.object, usage: usageFrom(runtime.verdictModel, result.usage) }
}

export async function extractGraph(markdown: string, runtime = resolveRuntime()) {
  if (runtime.provider === 'mock') {
    const graph = extractGraphMock(markdown)
    return { graph, usage: withCost(mockUsage(runtime.extractionModel, markdown, JSON.stringify(graph).length)) }
  }
  const result = await generateObject({
    model: google(runtime.extractionModel),
    schema: graphExtractionSchema,
    prompt: graphPrompt(markdown)
  })
  return { graph: result.object as GraphExtraction, usage: usageFrom(runtime.extractionModel, result.usage) }
}

export async function matchEntity(candidate: MatchCandidate, existing: MatchCandidate, runtime = resolveRuntime()): Promise<{ match: EntityMatch, usage: Usage }> {
  if (runtime.provider === 'mock') {
    const match = matchEntityMock(candidate, existing)
    return { match, usage: withCost(mockUsage(runtime.verdictModel, candidate.labelZh + existing.labelZh, 40)) }
  }
  const result = await generateObject({
    model: google(runtime.verdictModel),
    schema: entityMatchSchema,
    prompt: matchPrompt(candidate, existing)
  })
  return { match: result.object, usage: usageFrom(runtime.verdictModel, result.usage) }
}

const EMBED_DIM = 768

function fitDim(vector: number[]) {
  const next = vector.slice(0, EMBED_DIM)
  while (next.length < EMBED_DIM) next.push(0)
  const norm = Math.sqrt(next.reduce((sum, value) => sum + value * value, 0)) || 1
  return next.map(value => value / norm)
}

export async function embedTexts(texts: string[], runtime = resolveRuntime()) {
  if (!texts.length) return { vectors: [] as number[][], usage: withCost({ model: runtime.embeddingModel, inputTokens: 0, outputTokens: 0 }) }
  if (runtime.provider === 'mock') {
    return {
      vectors: texts.map(text => mockEmbedding(text, EMBED_DIM)),
      usage: withCost(mockUsage(runtime.embeddingModel, texts.join('\n'), 0))
    }
  }
  const client = createGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY || '' })
  const result = await embedMany({
    model: client.textEmbeddingModel(runtime.embeddingModel),
    values: texts,
    providerOptions: {
      google: { outputDimensionality: EMBED_DIM, taskType: 'RETRIEVAL_DOCUMENT' }
    }
  })
  return {
    vectors: result.embeddings.map(fitDim),
    usage: usageFrom(runtime.embeddingModel, result.usage)
  }
}

export { EMBED_DIM }
