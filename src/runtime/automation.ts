import type { LingReadResult, LingModelSelection } from './contract.js'
export type AutomationSchedule =
  | { kind: 'daily' | 'weekly'; time: string; timeZone: string; weekdays: number[] }
  | { kind: 'interval'; minutes: number }
  | { kind: 'once'; at: number }
export interface AutomationSpec {
  name: string
  prompt: string
  workspaceId: string | null
  model: LingModelSelection | null
  schedule: AutomationSchedule
  expiresAt: number | null
  permission: 'read-only' | 'workspace-write' | 'danger-full-access'
  output: 'separate' | 'reuse'
  missed: 'skip' | 'latest'
  enabled: boolean
}
export interface AutomationPlan extends AutomationSpec {
  id: string
  version: number
  createdAt: number
  updatedAt: number
  nextAt: number | null
  taskId: string | null
  archived: boolean
}
export type AutomationStatus =
  | 'queued'
  | 'running'
  | 'waiting-approval'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'interrupted'
  | 'skipped'
export interface AutomationRun {
  id: string
  planId: string
  spec: AutomationSpec
  scheduledAt: number
  createdAt: number
  updatedAt: number
  cancelRequested?: boolean
  admitted?: boolean
  status: AutomationStatus
  taskId: string
  requestId: string
  summary: string
  retryOf?: string
}
export interface AutomationSnapshot {
  plans: AutomationPlan[]
  runs: AutomationRun[]
  keepAwake: boolean
}
export type AutomationRequest =
  | { type: 'snapshot' }
  | { type: 'save'; spec: AutomationSpec; id?: string; version?: number }
  | { type: 'toggle' | 'remove'; id: string; version: number; enabled?: boolean }
  | { type: 'run'; id: string }
  | { type: 'retry' | 'cancel'; runId: string }
  | { type: 'settings'; keepAwake: boolean }
  | { type: 'draft'; text: string; model: LingModelSelection; timeZone: string }
export interface AutomationResponse {
  snapshot?: AutomationSnapshot
  plan?: AutomationPlan
  run?: AutomationRun
  draft?: AutomationSpec
}
export interface LingAutomationService {
  request(request: AutomationRequest, signal?: AbortSignal): Promise<LingReadResult<AutomationResponse>>
}
export const automationActive = (status: AutomationStatus) =>
  ['queued', 'running', 'waiting-approval'].includes(status)
