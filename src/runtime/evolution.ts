import type { LingReadResult } from './contract.js'

/** A proposed reusable skill. Its instructions remain private to the Host until creation. */
export interface LingEvolutionSuggestion {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly version: number
  readonly createdAt: number
  readonly source: {
    readonly taskId: string
    readonly throughSeq: number
    readonly seqs: readonly number[]
  }
}

export interface LingEvolutionService {
  /** Reads saved proposals; opening the monitor never starts a model request. */
  list(taskId: string, signal?: AbortSignal): Promise<LingReadResult<readonly LingEvolutionSuggestion[]>>
  create(taskId: string, id: string, version: number): Promise<LingReadResult<void>>
  ignore(taskId: string, id: string, version: number): Promise<LingReadResult<void>>
}
