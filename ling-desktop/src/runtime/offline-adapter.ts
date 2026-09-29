import type {
  LingCommandResult,
  LingRuntimeAdapter,
  LingRuntimeCommand,
  LingRuntimeEvent,
  LingRuntimeSnapshot,
  LingTimelineItem,
} from './contract.js'

const OFFLINE_MESSAGE = 'LING runtime is not connected yet.'

export function createOfflineRuntimeAdapter(message = OFFLINE_MESSAGE): LingRuntimeAdapter {
  const snapshot: LingRuntimeSnapshot = {
    connection: {
      phase: 'offline',
      message,
    },
    workspaces: [],
    tasks: [],
    pendingInteractions: [],
    backgroundJobs: {},
    subagents: {},
  }

  return {
    async getSnapshot(): Promise<LingRuntimeSnapshot> {
      return snapshot
    },
    async getModelSettings() {
      return {
        ok: false,
        reason: 'runtime-unavailable',
        message,
        retryable: false,
      } as const
    },
    async getTaskTimeline(_taskId: string): Promise<readonly LingTimelineItem[]> {
      return []
    },
    async searchTasks() {
      return {
        ok: false,
        reason: 'runtime-unavailable',
        message,
        retryable: false,
      }
    },
    async getTaskChanges() {
      return {
        ok: false,
        reason: 'runtime-unavailable',
        message,
        retryable: false,
      }
    },
    async getTaskFileDiff() {
      return {
        ok: false,
        reason: 'runtime-unavailable',
        message,
        retryable: false,
      }
    },
    async promptTaskSubagent() {
      return {
        ok: false,
        reason: 'runtime-unavailable',
        message,
        retryable: false,
      }
    },
    async interruptTaskSubagent() {
      return {
        ok: false,
        reason: 'runtime-unavailable',
        message,
        retryable: false,
      }
    },
    async getLocalePreference() {
      return {
        ok: false,
        reason: 'runtime-unavailable',
        message,
        retryable: false,
      }
    },
    async setLocalePreference() {
      return {
        ok: false,
        reason: 'runtime-unavailable',
        message,
        retryable: false,
      }
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
    subscribeModelSettings(_listener: () => void): () => void {
      return () => {}
    },
    subscribeTaskTimeline(
      _taskId: string,
      listener: (items: readonly LingTimelineItem[]) => void,
    ): () => void {
      listener([])
      return () => {}
    },
  }
}
