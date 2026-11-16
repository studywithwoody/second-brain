import { z } from 'zod'

export const claimVerdicts = ['supported', 'contradicted', 'uncertain', 'not_checkable'] as const
export const evidenceSources = ['knowledge_base', 'web', 'none'] as const
export const entityTypes = ['concept', 'law', 'quantity', 'person', 'other'] as const

export const extractedClaimsSchema = z.object({
  claims: z.array(z.object({
    text: z.string(),
    spanStart: z.number().int(),
    spanEnd: z.number().int(),
    checkable: z.boolean()
  }))
})

export const verdictSchema = z.object({
  verdicts: z.array(z.object({
    index: z.number().int(),
    verdict: z.enum(claimVerdicts),
    confidence: z.number().min(0).max(1),
    reasoning: z.string(),
    suggestedFix: z.string().optional(),
    evidenceSource: z.enum(evidenceSources)
  }))
})

export const selfCheckSchema = z.object({
  agree: z.boolean(),
  confidence: z.number().min(0).max(1),
  reasoning: z.string()
})

export const graphExtractionSchema = z.object({
  entities: z.array(z.object({
    labelZh: z.string(),
    labelEn: z.string(),
    aliases: z.array(z.string()),
    type: z.enum(entityTypes),
    confidence: z.number().min(0).max(1)
  })),
  relations: z.array(z.object({
    sourceZh: z.string(),
    targetZh: z.string(),
    relation: z.string(),
    relationZh: z.string(),
    relationEn: z.string(),
    confidence: z.number().min(0).max(1)
  }))
})

export const entityMatchSchema = z.object({
  same: z.boolean(),
  confidence: z.number().min(0).max(1),
  reason: z.string()
})

export type ExtractedClaim = z.infer<typeof extractedClaimsSchema>['claims'][number]
export type ClaimVerdict = z.infer<typeof verdictSchema>['verdicts'][number]
export type GraphExtraction = z.infer<typeof graphExtractionSchema>
export type EntityMatch = z.infer<typeof entityMatchSchema>
