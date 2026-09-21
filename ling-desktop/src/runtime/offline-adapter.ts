import type {
  LingCommandResult,
  LingRuntimeAdapter,
  LingRuntimeCommand,
  LingRuntimeEvent,
  LingRuntimeSnapshot,
  LingTimelineItem,
} from './contract.js'

const OFFLINE_MESSAGE = 'LING runtime is not connected yet.'

/**
 * Provides a deterministic, credential-free starting point for Renderer work.
 * A production Host adapter will implement the same port later.
 */
export function createOfflineRuntimeAdapter(message = OFFLINE_MESSAGE): LingRuntimeAdapter {
  const snapshot: LingRuntimeSnapshot = {
    connection: {
      phase: 'offline',
      message,
    },
    workspaces: [],
    tasks: [],
  }

  return {
    async getSnapshot(): Promise<LingRuntimeSnapshot> {
      return snapshot
    },
    async getTaskTimeline(_taskId: string): Promise<readonly LingTimelineItem[]> {
      return []
    },
    async dispatch(command: LingRuntimeCommand): Promise<LingCommandResult> {
      return {
        accepted: false,
        requestId: command.requestId,
        reason: 'runtime-unavailable',
        message,
        retryable: false,
      }
    },
    subscribe(_listener: (event: LingRuntimeEvent) => void): () => void {
      return () => {}
    },
  }
}
