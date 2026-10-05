import type { LingWorkspaceDirectory, LingWorkspaceDocument } from './contract.js'

/** Human file operations are server-scoped; they never bind or create a task. */
export type LingRemoteFileRequest =
  | { readonly type: 'list'; readonly path: string }
  | { readonly type: 'read'; readonly path: string }
  | { readonly type: 'save'; readonly path: string; readonly text: string; readonly version: string }
  | { readonly type: 'create'; readonly path: string; readonly directory: boolean }
  | { readonly type: 'rename'; readonly path: string; readonly destination: string }
  | { readonly type: 'delete'; readonly path: string; readonly recursive: boolean }
  | { readonly type: 'upload'; readonly path: string; readonly directory: boolean }
  | { readonly type: 'download'; readonly path: string }
  | { readonly type: 'extract'; readonly path: string; readonly destination: string }
  | { readonly type: 'jobs' }
  | { readonly type: 'cancel'; readonly jobId: string }

export interface LingRemoteFileJob {
  readonly id: string
  readonly operation: 'upload' | 'download' | 'extract' | 'delete'
  readonly path: string
  readonly status: 'running' | 'completed' | 'failed' | 'cancelled'
  readonly phase: string
  readonly bytes: number
  readonly total?: number
  readonly error?: string
}
export type LingRemoteFileResult =
  | { readonly type: 'directory'; readonly directory: LingWorkspaceDirectory }
  | { readonly type: 'document'; readonly document: LingWorkspaceDocument }
  | { readonly type: 'saved'; readonly version: string }
  | { readonly type: 'ok' }
  | { readonly type: 'job'; readonly job: LingRemoteFileJob }
  | { readonly type: 'jobs'; readonly jobs: readonly LingRemoteFileJob[] }
