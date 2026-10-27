import type { LingGitRequest, LingGitResult, LingReadResult } from './contract.js'
import type { LingRemoteFileRequest, LingRemoteFileResult } from './remote-files.js'

export type LingServerEnvironment = 'development' | 'staging' | 'production'
export interface LingServerInput {
  readonly name: string
  readonly alias: string
  readonly user?: string
  readonly port?: number
  readonly environment: LingServerEnvironment
}
export interface LingServer extends LingServerInput { readonly id: string }
export interface LingTaskServerBinding { readonly serverId: string; readonly cwd?: string }
export interface LingTaskServers {
  readonly revision: number
  readonly developmentServerId?: string
  readonly servers: readonly LingTaskServerBinding[]
}
export interface LingTaskServersUpdate {
  readonly expectedRevision: number
  readonly serverIds: readonly string[]
  readonly developmentServerId?: string
}
export type LingTerminalTarget = { readonly kind: 'local' } | { readonly kind: 'server'; readonly serverId: string }
export interface LingServerTerminalScope {
  readonly taskId?: string
  readonly serverId: string
  readonly placement: 'side' | 'bottom'
}
export interface LingServerProbe { readonly home: string }
export interface LingServerDirectory {
  readonly path: string
  readonly directories: readonly { readonly path: string; readonly name: string }[]
}
export interface LingServerTerminalSnapshot {
  readonly terminalId: string
  readonly offset: number
  readonly data: string
  readonly closed: boolean
  readonly truncated?: boolean
  readonly exitCode?: number
  readonly error?: string
}
export interface LingServerFilesDirectory { readonly path: string; readonly entries: readonly { readonly name: string; readonly type: 'directory' | 'file' | 'other' }[] }
export interface LingServerTextFile { readonly path: string; readonly text: string; readonly sha256: string; readonly truncated: boolean }
export interface LingServerService {
  fileManager(serverId: string, request: LingRemoteFileRequest, signal?: AbortSignal): Promise<LingReadResult<LingRemoteFileResult>>
  list(): Promise<LingReadResult<readonly LingServer[]>>
  add(input: LingServerInput): Promise<LingReadResult<LingServer>>
  update(id: string, input: LingServerInput): Promise<LingReadResult<LingServer>>
  remove(id: string): Promise<LingReadResult<{ readonly ok: true }>>
  probe(id: string, signal?: AbortSignal): Promise<LingReadResult<LingServerProbe>>
  directories(id: string, path: string, signal?: AbortSignal): Promise<LingReadResult<LingServerDirectory>>
  taskServers(taskId: string): Promise<LingReadResult<LingTaskServers>>
  setTaskServers(taskId: string, request: LingTaskServersUpdate): Promise<LingReadResult<LingTaskServers>>
  copyTaskServers(sourceTaskId: string, targetTaskId: string): Promise<LingReadResult<LingTaskServers>>
  takeTerminalUiRequest(taskId: string): Promise<LingReadResult<{ readonly open: boolean; readonly serverId?: string }>>
  terminalList(ownerId: string): Promise<LingReadResult<readonly string[]>>
  terminalScope(request: LingServerTerminalScope, signal?: AbortSignal): Promise<LingReadResult<{ readonly ownerId: string }>>
  terminalOpen(ownerId: string, cols: number, rows: number, signal?: AbortSignal): Promise<LingReadResult<{ readonly terminalId: string }>>
  terminalPoll(ownerId: string, terminalId: string, offset: number, signal?: AbortSignal): Promise<LingReadResult<LingServerTerminalSnapshot>>
  terminalWrite(ownerId: string, terminalId: string, data: string, signal?: AbortSignal): Promise<LingReadResult<{ readonly ok: true }>>
  terminalResize(ownerId: string, terminalId: string, cols: number, rows: number, signal?: AbortSignal): Promise<LingReadResult<{ readonly ok: true }>>
  terminalClose(ownerId: string, terminalId: string, signal?: AbortSignal): Promise<LingReadResult<{ readonly ok: true }>>
  filesList(taskId: string, serverId: string, path: string, signal?: AbortSignal): Promise<LingReadResult<LingServerFilesDirectory>>
  filesRead(taskId: string, serverId: string, path: string, signal?: AbortSignal): Promise<LingReadResult<LingServerTextFile>>
  filesSave(taskId: string, serverId: string, path: string, text: string, expectedSha256: string | null, signal?: AbortSignal): Promise<LingReadResult<{ readonly path: string; readonly sha256: string }>>
  gitRequest(taskId: string, serverId: string, request: LingGitRequest, signal?: AbortSignal): Promise<LingReadResult<LingGitResult>>
}
