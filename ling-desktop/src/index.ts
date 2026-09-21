/** Entry point for LING-owned desktop presentation. */
export const LING_DESKTOP_RENDERER_OWNER = 'LING' as const

export {
  createOfflineRuntimeAdapter,
  type LingCommandRejectionReason,
  type LingCommandResult,
  type LingConnectionPhase,
  type LingRuntimeAdapter,
  type LingRuntimeCommand,
  type LingRuntimeConnection,
  type LingRuntimeEvent,
  type LingRuntimeSnapshot,
  type LingTaskStatus,
  type LingTaskSummary,
  type LingTimelineItem,
  type LingTimelineItemKind,
  type LingWorkspaceSummary,
} from './runtime/index.js'
