import type { LingReadResult } from './contract.js'

/** Coordinates refer to a durable DSH delivery, never a renderer-supplied native path. */
export interface LingPresentedFile {
  readonly seq: number
  readonly index: number
  readonly path: string
  readonly description?: string
}

export interface LingReplyFeatures {
  suggestions(taskId: string, seq: number, signal: AbortSignal): Promise<LingReadResult<readonly string[]>>
  openFile(taskId: string, file: LingPresentedFile, signal: AbortSignal): Promise<LingReadResult<void>>
}
