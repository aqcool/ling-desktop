import type { LingReadResult } from './contract.js'

export type PluginValue = string | number | boolean | null | PluginValue[] | { [key: string]: PluginValue }
export interface LingManagedPlugin {
  name: string; version?: string; description?: string; installed: boolean; optional: boolean; removable: boolean; enabled: boolean
  readOnlyReason?: string; error?: { code: string; diagnostic?: string }
  rows: { rowId: string; moduleName: string; entryId?: string; enabled: boolean; phase?: string; readOnlyReason?: string }[]
}
export interface LingPluginNamespace {
  ns: string; value: PluginValue; user?: PluginValue; revision: number; applies: 'live' | 'restart'
}
export interface LingPluginOverview {
  bundles: LingManagedPlugin[]
  managementError?: string
  writable: boolean
  namespaces: LingPluginNamespace[]
}
export interface LingPluginChange {
  application: 'applied' | 'restart-required' | 'overridden' | 'failed' | 'cancelled'
  target: string; bundle?: string; error?: { code: string; diagnostic?: string }
  packageResult?: { output: string; logPath: string; exitCode: number; truncated: boolean; kind?: string }
  pendingBuilds?: string[]
}
export type LingPluginEvent = { type: 'changed' } | { type: 'progress'; requestId: string; phase: 'installing' | 'cancelling' | 'applying' } | { type: 'log'; requestId?: string; text: string; jobId: string; argv: readonly string[]; cwd: string }
export interface LingPluginManager {
  read(): Promise<LingReadResult<LingPluginOverview>>
  subscribe(listener: (event: LingPluginEvent) => void): () => void
  setBundleEnabled(name: string, enabled: boolean): Promise<LingReadResult<LingPluginChange>>
  setPluginEnabled(id: string, enabled: boolean): Promise<LingReadResult<LingPluginChange>>
  remove(name: string): Promise<LingReadResult<LingPluginChange>>
  inspect(spec: string, signal: AbortSignal): Promise<LingReadResult<{ status: 'accepted'; name?: string; version?: string; kind: string } | { status: 'refused'; problem: string; reason: string }>>
  install(spec: string, requestId: string, approvedBuilds?: string[]): Promise<LingReadResult<LingPluginChange>>
  cancel(requestId: string): Promise<LingReadResult<{ status: 'cancelled' | 'too-late' | 'not-running' }>>
  save(ns: string, edits: Record<string, PluginValue | undefined>, revision: number): Promise<LingReadResult<LingPluginNamespace>>
  credential(ref: string): Promise<LingReadResult<{ configured: boolean; writable: boolean }>>
  saveCredential(ref: string, value: string): Promise<LingReadResult<void>>
  models(): Promise<LingReadResult<{ partial: boolean; models: { provider: string; providerName: string; model: string; name: string }[] }>>
}
