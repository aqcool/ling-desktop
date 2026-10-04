import type { LingTokenUsage } from '../runtime/contract.js'

export function totalTokenUsage(usage: LingTokenUsage): number {
  return usage.uncachedInputTokens + usage.cacheReadTokens + usage.cacheWriteTokens + usage.outputTokens
}

export function sumTokenUsage(usages: readonly LingTokenUsage[]): LingTokenUsage {
  return usages.reduce<LingTokenUsage>((sum, usage) => ({
    uncachedInputTokens: sum.uncachedInputTokens + usage.uncachedInputTokens,
    cacheReadTokens: sum.cacheReadTokens + usage.cacheReadTokens,
    cacheWriteTokens: sum.cacheWriteTokens + usage.cacheWriteTokens,
    outputTokens: sum.outputTokens + usage.outputTokens,
  }), { uncachedInputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 })
}
