/** Entry point for LING-owned desktop presentation. */
export const LING_DESKTOP_RENDERER_OWNER = 'LING' as const

export {
  createDshRuntimeAdapter,
  createOfflineRuntimeAdapter,
  type DshRuntimeFacades,
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

export { LingShell } from './ui/LingShell.js'
export {
  createLingUiPluginHost,
  lingUiPluginHost,
  type LingUiPluginContext,
  type LingUiPluginDefinition,
  type LingUiPluginHost,
  type LingUiPluginRegistration,
  type LingUiPluginSlots,
} from './ui/plugin-host.js'
export {
  createLingUiExtensionRegistry,
  lingUiExtensions,
  mergeLingUiSlots,
  useLingUiSlots,
  type LingUiExtensionRegistry,
  type LingUiListRegistration,
  type LingUiRegistration,
  type LingUiSingleRegistration,
} from './ui/registry.js'
export {
  lingUiSlotKinds,
  type LingUiListSlotName,
  type LingUiSingleSlotName,
  type LingUiSlotName,
  type LingUiSlots,
} from './ui/slots.js'
