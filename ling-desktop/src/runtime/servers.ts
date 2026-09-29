import type { LingGitRequest, LingGitResult, LingReadResult } from './contract.js'

export type LingServerEnvironment = 'development' | 'staging' | 'production'
export interface LingServerInput {
  readonly name: string
  readonly alias: string
  readonly user?: string
  readonly port?: number
  readonly environment: LingServerEnvironment
}
export interface LingServer extends LingServerInput { readonly id: string }
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
  list(): Promise<LingReadResult<readonly LingServer[]>>
  add(input: LingServerInput): Promise<LingReadResult<LingServer>>
  update(id: string, input: LingServerInput): Promise<LingReadResult<LingServer>>
  remove(id: string): Promise<LingReadResult<{ readonly ok: true }>>
  probe(id: string, signal?: AbortSignal): Promise<LingReadResult<LingServerProbe>>
  directories(id: string, path: string, signal?: AbortSignal): Promise<LingReadResult<LingServerDirectory>>
  bindTask(taskId: string, serverId: string, home: string): Promise<LingReadResult<{ readonly serverId: string; readonly cwd: string }>>
  taskBinding(taskId: string): Promise<LingReadResult<{ readonly serverId: string; readonly cwd: string } | null>>
  attachOperations(taskId: string, serverId: string, home: string): Promise<LingReadResult<{ readonly serverId: string; readonly cwd: string }>>
  operationsBinding(taskId: string): Promise<LingReadResult<{ readonly serverId: string; readonly cwd: string } | null>>
  takeTerminalUiRequest(taskId: string): Promise<LingReadResult<{ readonly open: boolean }>>
  terminalList(taskId: string): Promise<LingReadResult<readonly string[]>>
  terminalOpen(taskId: string, cols: number, rows: number, signal?: AbortSignal): Promise<LingReadResult<{ readonly terminalId: string }>>
  terminalPoll(taskId: string, terminalId: string, offset: number, signal?: AbortSignal): Promise<LingReadResult<LingServerTerminalSnapshot>>
  terminalWrite(taskId: string, terminalId: string, data: string, signal?: AbortSignal): Promise<LingReadResult<{ readonly ok: true }>>
  terminalResize(taskId: string, terminalId: string, cols: number, rows: number, signal?: AbortSignal): Promise<LingReadResult<{ readonly ok: true }>>
  terminalClose(taskId: string, terminalId: string, signal?: AbortSignal): Promise<LingReadResult<{ readonly ok: true }>>
  filesList(taskId: string, path: string, signal?: AbortSignal): Promise<LingReadResult<LingServerFilesDirectory>>
  filesRead(taskId: string, path: string, signal?: AbortSignal): Promise<LingReadResult<LingServerTextFile>>
  filesSave(taskId: string, path: string, text: string, expectedSha256: string | null, signal?: AbortSignal): Promise<LingReadResult<{ readonly path: string; readonly sha256: string }>>
  gitRequest(taskId: string, request: LingGitRequest, signal?: AbortSignal): Promise<LingReadResult<LingGitResult>>
}
