import type { LingReadResult } from './contract.js'

export const hookEvents = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop', 'SubagentStart', 'SubagentStop'] as const
export type LingHookEvent = typeof hookEvents[number]
export type LingHookDialect = 'claude-code' | 'codex'
export interface LingHookEntry {
  id: string
  event: LingHookEvent
  command: string
  matcher: string
  timeoutSec: number
  enabled: boolean
}
export interface LingHookSettings {
  enabled: boolean
  dialect: LingHookDialect
  entries: LingHookEntry[]
}
export interface LingHookRun {
  taskId: string
  point: string
  handlerId: string
  time: number
  decision: string
  durationMs: number
  exitCode?: number
  stderrSummary?: string
}
export interface LingHooksSnapshot {
  settings: LingHookSettings
  revision: number
  configPath: string
  scope: 'process'
  state: 'disabled' | 'loaded' | 'error'
  error?: string
  activeCount: number
  busy: boolean
  history: LingHookRun[]
}
export type LingHooksRequest =
  | { type: 'snapshot' }
  | { type: 'save'; revision: number; settings: LingHookSettings }
  | { type: 'import'; path: string; dialect: LingHookDialect }
export interface LingHooksResponse { snapshot?: LingHooksSnapshot; imported?: LingHookEntry[] }
export interface LingHooksService {
  request(request: LingHooksRequest, signal?: AbortSignal): Promise<LingReadResult<LingHooksResponse>>
}
export const hooksForDialect = (dialect: LingHookDialect): readonly LingHookEvent[] => dialect === 'codex' ? hookEvents.slice(0, 5) : hookEvents
