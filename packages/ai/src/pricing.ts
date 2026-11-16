export const MODEL_PRICES: Record<string, { input: number, output: number }> = {
  'gemini-3.5-flash-lite': { input: 0.3 / 1_000_000, output: 2.5 / 1_000_000 },
  'gemini-3.8-flash': { input: 0.75 / 1_000_000, output: 3.75 / 1_000_000 },
  'gemini-embedding-001': { input: 0.15 / 1_000_000, output: 0 }
}

export function tokenCost(model: string, inputTokens: number, outputTokens: number) {
  const price = MODEL_PRICES[model] || MODEL_PRICES['gemini-3.8-flash']!
  return inputTokens * price.input + outputTokens * price.output
}

export function estimateTokens(text: string) {
  return Math.max(1, Math.ceil(text.length / 2))
}

export function budgetDecision(spent: number, cap: number, estimate = 0) {
  if (!(cap > 0)) {
    return { ratio: 1, warn: true, block: true, remaining: 0 }
  }
  const ratio = spent / cap
  return {
    ratio,
    warn: ratio >= 0.8,
    block: spent >= cap || spent + Math.max(0, estimate) > cap + 1e-9,
    remaining: Math.max(0, cap - spent)
  }
}

export function estimateFactcheckCost(chars: number) {
  const input = estimateTokens('x'.repeat(chars)) + 800
  const output = 500
  return tokenCost('gemini-3.5-flash-lite', input, 200) + tokenCost('gemini-3.8-flash', input + 1500, output)
}

export function estimateGraphCost(chars: number) {
  const input = estimateTokens('x'.repeat(chars)) + 600
  return tokenCost('gemini-3.5-flash-lite', input, 700) + tokenCost('gemini-3.8-flash', 2000, 300)
}
