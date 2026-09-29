import type { ServerOutput } from '../server-execution.ts'
import type { ServerCommandResult, ServerDirectoryManifest, ServerDownloadResult, ServerTerminalSnapshot, ServerUploadResult } from '../server-broker.ts'

interface Pending {
  readonly kind: 'run' | 'upload' | 'download' | 'manifest' | 'terminal-open' | 'terminal-poll' | 'terminal-action'
  readonly resolve: (value: never) => void
  readonly reject: (error: Error) => void
  readonly signal: AbortSignal
  readonly abort: () => void
  readonly onOutput?: (chunk: ServerOutput) => void
}

/** Host-side request channel. It transfers only the bound server ID and command, never credentials. */
export class ServerBridge {
  private nextId = 1
  private readonly pending = new Map<number, Pending>()

  constructor(private readonly send: (message: object) => void) {}

  run(serverId: string, cwd: string, command: string, signal: AbortSignal, outputLimit?: number, onOutput?: (chunk: ServerOutput) => void): Promise<ServerCommandResult> {
    return this.request('run', { type: 'server-request', serverId, cwd, command, ...(onOutput ? { stream: true } : {}), ...(outputLimit === undefined ? {} : { outputLimit }) }, signal, onOutput)
  }

  upload(serverId: string, root: string, source: string, destination: string,
    sha256: string, remoteSha256: string | null, signal: AbortSignal): Promise<ServerUploadResult> {
    return this.request('upload', { type: 'server-upload-request', serverId, root, source, destination, sha256, remoteSha256 }, signal)
  }

  download(serverId: string, root: string, source: string, destination: string,
    sha256: string, localSha256: string | null, signal: AbortSignal): Promise<ServerDownloadResult> {
    return this.request('download', { type: 'server-download-request', serverId, root, source, destination, sha256, localSha256 }, signal)
  }

  manifest(serverId: string, directory: string, signal: AbortSignal, shallow = false): Promise<ServerDirectoryManifest> {
    return this.request('manifest', { type: 'server-manifest-request', serverId, directory, shallow }, signal)
  }

  terminalOpen(serverId: string, cwd: string, cols: number, rows: number, signal: AbortSignal): Promise<{ terminalId: string }> {
    return this.request('terminal-open', { type: 'server-terminal-request', action: 'open', serverId, cwd, cols, rows }, signal)
  }

  terminalPoll(terminalId: string, offset: number, signal: AbortSignal): Promise<ServerTerminalSnapshot> {
    return this.request('terminal-poll', { type: 'server-terminal-request', action: 'poll', terminalId, offset }, signal)
  }

  terminalWrite(terminalId: string, data: string, signal: AbortSignal): Promise<{ ok: true }> {
    return this.request('terminal-action', { type: 'server-terminal-request', action: 'write', terminalId, data }, signal)
  }

  terminalResize(terminalId: string, cols: number, rows: number, signal: AbortSignal): Promise<{ ok: true }> {
    return this.request('terminal-action', { type: 'server-terminal-request', action: 'resize', terminalId, cols, rows }, signal)
  }

  terminalClose(terminalId: string, signal: AbortSignal): Promise<{ ok: true }> {
    return this.request('terminal-action', { type: 'server-terminal-request', action: 'close', terminalId }, signal)
  }

  private request<T extends ServerCommandResult | ServerUploadResult | ServerDownloadResult | ServerDirectoryManifest | ServerTerminalSnapshot | { terminalId: string } | { ok: true }>(kind: Pending['kind'], request: object, signal: AbortSignal, onOutput?: (chunk: ServerOutput) => void): Promise<T> {
    if (signal.aborted) return Promise.reject(new Error('远端命令已取消。'))
    const requestId = this.nextId++
    return new Promise((resolve, reject) => {
      const abort = () => {
        this.pending.delete(requestId)
        try { this.send({ type: 'server-cancel', requestId }) } catch { /* the request is already cancelled */ }
        reject(new Error('远端命令已取消。'))
      }
      this.pending.set(requestId, { kind, resolve: resolve as (value: never) => void, reject, signal, abort, onOutput })
      signal.addEventListener('abort', abort, { once: true })
      try { this.send({ ...request, requestId }) }
      catch (error) { this.settle(requestId, undefined, error instanceof Error ? error.message : '远端服务不可用。') }
    })
  }

  receive(message: unknown): boolean {
    if (!message || typeof message !== 'object' || !('type' in message)) return false
    if (message.type === 'server-output') {
      const chunk = message as { requestId?: number; stream?: unknown; data?: unknown }
      if (Number.isSafeInteger(chunk.requestId) && (chunk.stream === 'stdout' || chunk.stream === 'stderr')
        && typeof chunk.data === 'string' && chunk.data.length <= 256 * 1024) {
        const pending = this.pending.get(chunk.requestId!)
        if (pending?.kind === 'run') pending.onOutput?.({ stream: chunk.stream, data: chunk.data })
      }
      return true
    }
    if (message.type !== 'server-response') return false
    if (!('requestId' in message) || !Number.isSafeInteger(message.requestId)) return true
    const response = message as { requestId: number; result?: ServerCommandResult | ServerUploadResult | ServerDownloadResult | ServerDirectoryManifest | ServerTerminalSnapshot | { terminalId: string } | { ok: true }; error?: string }
    this.settle(response.requestId, response.result, response.error)
    return true
  }

  close(): void {
    for (const id of this.pending.keys()) this.settle(id, undefined, '远端服务已断开。')
  }

  private settle(id: number, value?: ServerCommandResult | ServerUploadResult | ServerDownloadResult | ServerDirectoryManifest | ServerTerminalSnapshot | { terminalId: string } | { ok: true }, error?: string): void {
    const pending = this.pending.get(id)
    if (!pending) return
    this.pending.delete(id)
    pending.signal.removeEventListener('abort', pending.abort)
    if (error !== undefined) pending.reject(new Error(error))
    else if (pending.kind === 'run' && value && 'stdout' in value && typeof value.stdout === 'string' && typeof value.stderr === 'string' && Number.isInteger(value.exitCode)) pending.resolve(value as never)
    else if ((pending.kind === 'upload' || pending.kind === 'download') && value && 'destination' in value && typeof value.destination === 'string' && Number.isSafeInteger(value.bytes) && typeof value.sha256 === 'string') pending.resolve(value as never)
    else if (pending.kind === 'manifest' && value && 'exists' in value && typeof value.exists === 'boolean' && 'entries' in value && Array.isArray(value.entries) && 'sha256' in value && typeof value.sha256 === 'string') pending.resolve(value as never)
    else if (pending.kind === 'terminal-open' && value && 'terminalId' in value && typeof value.terminalId === 'string') pending.resolve(value as never)
    else if (pending.kind === 'terminal-poll' && value && 'terminalId' in value && typeof value.terminalId === 'string'
      && 'offset' in value && Number.isSafeInteger(value.offset) && 'data' in value && typeof value.data === 'string'
      && 'closed' in value && typeof value.closed === 'boolean') pending.resolve(value as never)
    else if (pending.kind === 'terminal-action' && value && 'ok' in value && value.ok === true) pending.resolve(value as never)
    else pending.reject(new Error('远端服务返回了无效结果。'))
  }
}

// Host bootstrap and Cordis plugin are separate build entrypoints; share only the
// process-local instance, never a socket or Web-facing global.
const bridgeKey = Symbol.for('ling-desktop.server-bridge')
type BridgeGlobal = typeof globalThis & { [bridgeKey]?: ServerBridge }
export function installServerBridge(bridge: ServerBridge): void { (globalThis as BridgeGlobal)[bridgeKey] = bridge }
export function getServerBridge(): ServerBridge {
  const bridge = (globalThis as BridgeGlobal)[bridgeKey]
  if (!bridge) throw new Error('远端服务未连接。')
  return bridge
}
