import type { ServerOutput } from './server-execution.ts'
/** Electron Node-mode child lifecycle for the shared Web application. */

import { spawn, type ChildProcess } from 'node:child_process'
import { join } from 'node:path'
import { desktopNodeEnvironment } from './node-environment.ts'

interface ReadyEvent {
  readonly type: 'ready'
  readonly url: string
  readonly injections?: readonly unknown[] | undefined
}

interface FatalEvent {
  readonly type: 'fatal'
  readonly message: string
}

export type ServerTerminalRequest =
  | { readonly action: 'open'; readonly serverId: string; readonly cwd: string; readonly cols: number; readonly rows: number }
  | { readonly action: 'poll'; readonly terminalId: string; readonly offset: number }
  | { readonly action: 'write'; readonly terminalId: string; readonly data: string }
  | { readonly action: 'resize'; readonly terminalId: string; readonly cols: number; readonly rows: number }
  | { readonly action: 'close'; readonly terminalId: string }

type DesktopHostEvent = ReadyEvent | FatalEvent | { readonly type: 'shutdown-complete' } | { readonly type: 'desktop-action'; readonly action: 'restart' } | {
  readonly type: 'update-tasks'
  readonly requestId: number
  readonly active: boolean
  readonly error?: string
} | { readonly type: 'server-request'; readonly requestId: number; readonly serverId: string; readonly cwd: string; readonly command: string; readonly outputLimit?: number; readonly stream?: boolean }
  | { readonly type: 'server-upload-request'; readonly requestId: number; readonly serverId: string; readonly root: string; readonly source: string;
    readonly destination: string; readonly sha256: string; readonly remoteSha256: string | null }
  | { readonly type: 'server-download-request'; readonly requestId: number; readonly serverId: string; readonly root: string; readonly source: string;
    readonly destination: string; readonly sha256: string; readonly localSha256: string | null }
  | { readonly type: 'server-manifest-request'; readonly requestId: number; readonly serverId: string; readonly directory: string; readonly shallow?: boolean }
  | ({ readonly type: 'server-terminal-request'; readonly requestId: number } & ServerTerminalRequest)
  | { readonly type: 'server-cancel'; readonly requestId: number }

const MAX_HOST_DIAGNOSTIC_CHARS = 64 * 1024

function isDesktopHostEvent(message: unknown): message is DesktopHostEvent {
  if (typeof message !== 'object' || message === null || !('type' in message)) return false
  const candidate = message as Record<string, unknown>
  switch (candidate.type) {
    case 'shutdown-complete':
      return true
    case 'ready':
      return typeof candidate.url === 'string'
    case 'fatal':
      return typeof candidate.message === 'string'
    case 'desktop-action':
      return candidate.action === 'restart'
    case 'update-tasks':
      return Number.isSafeInteger(candidate.requestId) && typeof candidate.active === 'boolean'
        && (candidate.error === undefined || typeof candidate.error === 'string')
    case 'server-request':
      return (candidate.stream === undefined || typeof candidate.stream === 'boolean') && Number.isSafeInteger(candidate.requestId) && typeof candidate.serverId === 'string' && typeof candidate.cwd === 'string'
        && typeof candidate.command === 'string' && candidate.cwd.length <= 4096 && candidate.command.length <= 16384
        && (candidate.outputLimit === undefined || Number.isSafeInteger(candidate.outputLimit) && Number(candidate.outputLimit) >= 1 && Number(candidate.outputLimit) <= 16 * 1024 * 1024)
    case 'server-upload-request':
      return Number.isSafeInteger(candidate.requestId) && typeof candidate.serverId === 'string' && typeof candidate.root === 'string'
        && typeof candidate.source === 'string' && typeof candidate.destination === 'string' && typeof candidate.sha256 === 'string'
        && /^[a-f0-9]{64}$/.test(candidate.sha256)
        && (candidate.remoteSha256 === null || typeof candidate.remoteSha256 === 'string' && /^[a-f0-9]{64}$/.test(candidate.remoteSha256))
        && candidate.root.length <= 4096 && candidate.source.length <= 4096 && candidate.destination.length <= 4096
    case 'server-download-request':
      return Number.isSafeInteger(candidate.requestId) && typeof candidate.serverId === 'string' && typeof candidate.root === 'string'
        && typeof candidate.source === 'string' && typeof candidate.destination === 'string' && typeof candidate.sha256 === 'string'
        && /^[a-f0-9]{64}$/.test(candidate.sha256)
        && (candidate.localSha256 === null || typeof candidate.localSha256 === 'string' && /^[a-f0-9]{64}$/.test(candidate.localSha256))
        && candidate.root.length <= 4096 && candidate.source.length <= 4096 && candidate.destination.length <= 4096
    case 'server-manifest-request':
      return Number.isSafeInteger(candidate.requestId) && typeof candidate.serverId === 'string'
        && typeof candidate.directory === 'string' && candidate.directory.length <= 4096
        && (candidate.shallow === undefined || typeof candidate.shallow === 'boolean')
    case 'server-terminal-request':
      if (!Number.isSafeInteger(candidate.requestId)) return false
      if (candidate.action === 'open') return typeof candidate.serverId === 'string' && typeof candidate.cwd === 'string'
        && candidate.cwd.length <= 4096 && Number.isInteger(candidate.cols) && Number.isInteger(candidate.rows)
      if (candidate.action === 'poll') return typeof candidate.terminalId === 'string' && Number.isSafeInteger(candidate.offset)
      if (candidate.action === 'write') return typeof candidate.terminalId === 'string' && typeof candidate.data === 'string' && candidate.data.length <= 64 * 1024
      if (candidate.action === 'resize') return typeof candidate.terminalId === 'string' && Number.isInteger(candidate.cols) && Number.isInteger(candidate.rows)
      return candidate.action === 'close' && typeof candidate.terminalId === 'string'
    case 'server-cancel':
      return Number.isSafeInteger(candidate.requestId)
    default:
      return false
  }
}

async function exitsWithin(exit: Promise<void>, milliseconds: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => { resolve(false) }, milliseconds)
    timer.unref()
  })
  try {
    return await Promise.race([exit.then(() => true), timeout])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/** Browser authentication URL reported by the running Web application. */
export interface DesktopHostReady {
  readonly url: string
  readonly injections?: readonly unknown[] | undefined
}

/** The child has exited, but task teardown did not finish successfully. */
export class DesktopHostUncleanExitError extends Error {}

/** One Web backend running under the Electron executable in Node mode. */
export class DesktopHostProcess {
  private child: ChildProcess | undefined
  private readyResolve!: (ready: DesktopHostReady) => void
  private readyReject!: (error: Error) => void
  private readonly readyPromise = new Promise<DesktopHostReady>((resolve, reject) => {
    this.readyResolve = resolve
    this.readyReject = reject
  })
  private exitPromise: Promise<void> | undefined
  private stderr = ''
  private failureReported = false
  private stopping = false
  private shutdownCompleted = false
  private nextControlId = 1
  private readonly taskQueries = new Map<number, { resolve: (active: boolean) => void; reject: (error: Error) => void }>()
  private readonly serverRequests = new Map<number, AbortController>()

  /**
   * @param node - Absolute Electron executable in Node mode.
   * @param runtimeDir - Immutable packages carried by the current application.
   * @param projectDir - Desktop plugin profile and child working directory.
   * @param inspectPort - Optional loopback inspector port for workspace development.
   * @param environment - Environment inherited by the Host and its plugin subprocesses.
   * @param onFailure - Receives the first unexpected child failure, including after readiness.
   * @param primaryRuntime - Optional bundled dependency payload; when supplied, missing sibling
   *   `office-skills` resources fail Host startup.
   * @param packageManager - Bundled pnpm entry and Node launcher directory, scoped to package operations.
   * @param profileResolution - Package resolution mode for the application-owned profile.
   */
  constructor(
    private readonly node: string,
    private readonly runtimeDir: string,
    private readonly projectDir: string,
    private readonly inspectPort?: number,
    private readonly environment: NodeJS.ProcessEnv = process.env,
    private readonly onFailure?: (error: Error) => void,
    private readonly primaryRuntime?: string,
    private readonly profileResolution: 'link' | 'runtime' = 'link',
    private readonly packageManager?: { readonly pnpm: string; readonly nodeBin: string },
    private readonly hostEntry?: string,
    private readonly onRestart?: () => void,
    private readonly onServerRequest?: (serverId: string, cwd: string, command: string, signal: AbortSignal, outputLimit?: number, onOutput?: (chunk: ServerOutput) => void) => Promise<{ stdout: string; stderr: string; exitCode: number }>,
    private readonly onServerUpload?: (serverId: string, root: string, source: string, destination: string,
      sha256: string, remoteSha256: string | null, signal: AbortSignal) => Promise<{ destination: string; bytes: number; sha256: string }>,
    private readonly onServerDownload?: (serverId: string, root: string, source: string, destination: string,
      sha256: string, localSha256: string | null, signal: AbortSignal) => Promise<{ destination: string; bytes: number; sha256: string }>,
    private readonly onServerManifest?: (serverId: string, directory: string, signal: AbortSignal, shallow?: boolean) => Promise<{ exists: boolean; entries: readonly unknown[]; sha256: string }>,
    private readonly onServerTerminal?: (request: ServerTerminalRequest, signal: AbortSignal) => Promise<unknown>,
  ) {}

  /**
   * Start this child once and await its Web application URL.
   * @returns Ready facts supplied by the child after application startup.
   */
  async start(): Promise<DesktopHostReady> {
    if (this.child !== undefined) return this.readyPromise
    const entry = this.hostEntry ?? join(this.runtimeDir, 'node_modules', '@deepseek-ai', 'dsh-desktop-host', 'lib', 'index.js')
    const child = spawn(this.node, [
      '--expose-internals',
      ...(this.inspectPort === undefined ? [] : [`--inspect=127.0.0.1:${String(this.inspectPort)}`]),
      entry,
      this.runtimeDir,
      this.projectDir,
      this.primaryRuntime ?? join(this.runtimeDir, '..', 'runtime', 'primary-runtime'),
      this.profileResolution,
      ...this.packageManager === undefined ? [] : [this.packageManager.pnpm, this.packageManager.nodeBin],
    ], {
      cwd: this.projectDir,
      env: desktopNodeEnvironment(this.node, undefined, this.environment),
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    })
    this.child = child
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => { this.stderr = (this.stderr + chunk).slice(-MAX_HOST_DIAGNOSTIC_CHARS) })
    child.stdout?.pipe(process.stdout)
    child.on('message', (message: unknown) => {
      if (!isDesktopHostEvent(message)) {
        this.fail(new Error('dsh desktop host sent an invalid IPC event'))
        child.kill('SIGTERM')
        return
      }
      if (message.type === 'ready') this.readyResolve({ url: message.url, injections: message.injections })
      else if (message.type === 'shutdown-complete') {
        if (this.stopping) this.shutdownCompleted = true
        else this.fail(new Error('dsh desktop host acknowledged an unrequested shutdown'))
      }
      else if (message.type === 'fatal') this.fail(new Error(message.message))
      else if (message.type === 'desktop-action') {
        if (!this.stopping && !this.failureReported) this.onRestart?.()
      }
      else if (message.type === 'server-request' || message.type === 'server-upload-request' || message.type === 'server-download-request' || message.type === 'server-manifest-request' || message.type === 'server-terminal-request') {
        if (this.serverRequests.has(message.requestId) || this.serverRequests.size >= 8) {
          if (child.connected) child.send({ type: 'server-response', requestId: message.requestId, error: '远端服务正忙，请稍后重试。' })
          return
        }
        const controller = new AbortController()
        this.serverRequests.set(message.requestId, controller)
        void Promise.resolve().then(async () => {
          if (this.stopping) throw new Error('远端服务暂不可用。')
          if (message.type === 'server-request') {
            if (!this.onServerRequest) throw new Error('远端服务暂不可用。')
            return await this.onServerRequest(message.serverId, message.cwd, message.command, controller.signal, message.outputLimit,
              message.stream ? chunk => {
                if (child.connected && !controller.signal.aborted) child.send({ type: 'server-output', requestId: message.requestId, ...chunk })
              } : undefined)
          }
          if (message.type === 'server-upload-request') {
            if (!this.onServerUpload) throw new Error('远端部署暂不可用。')
            return await this.onServerUpload(message.serverId, message.root, message.source, message.destination,
              message.sha256, message.remoteSha256, controller.signal)
          }
          if (message.type === 'server-download-request') {
            if (!this.onServerDownload) throw new Error('远端取回暂不可用。')
            return await this.onServerDownload(message.serverId, message.root, message.source, message.destination,
              message.sha256, message.localSha256, controller.signal)
          }
          if (message.type === 'server-manifest-request') {
            if (!this.onServerManifest) throw new Error('远端目录清单暂不可用。')
            return await this.onServerManifest(message.serverId, message.directory, controller.signal, message.shallow)
          }
          if (!this.onServerTerminal) throw new Error('远端终端暂不可用。')
          return await this.onServerTerminal(message, controller.signal)
        }).then(result => {
          if (child.connected && !controller.signal.aborted) child.send({ type: 'server-response', requestId: message.requestId, result })
        }, error => {
          if (child.connected && !controller.signal.aborted) child.send({ type: 'server-response', requestId: message.requestId,
            error: error instanceof Error ? error.message : '远端命令失败。' })
        }).finally(() => { this.serverRequests.delete(message.requestId) })
      }
      else if (message.type === 'server-cancel') this.serverRequests.get(message.requestId)?.abort()
      else {
        const query = this.taskQueries.get(message.requestId)
        if (message.error === undefined) query?.resolve(message.active)
        else query?.reject(new Error(message.error))
      }
    })
    child.once('error', (error) => { this.fail(error) })
    this.exitPromise = new Promise<void>((resolve) => {
      child.once('close', (code) => {
        for (const controller of this.serverRequests.values()) controller.abort()
        this.serverRequests.clear()
        const suffix = this.stderr.trim() === '' ? '' : `: ${this.stderr.trim()}`
        if (code !== 0 && code !== null) this.fail(new Error(`dsh desktop host exited with ${String(code)}${suffix}`))
        else this.fail(new Error(`dsh desktop host stopped${suffix}`))
        resolve()
      })
    })
    return this.readyPromise
  }

  /**
   * Inspect active work or lock request admission for update handoff.
   * @param action - Read-only inspection, admission lock, or recovery unlock.
   * @returns Whether live tasks would be affected. Locking drains admitted API requests before inspecting tasks;
   * an unanswered drain fails at the control-request deadline without authorizing installation.
   */
  async updateTasks(action: 'inspect' | 'lock' | 'unlock'): Promise<boolean> {
    const child = this.child
    if (child === undefined || !child.connected || this.failureReported || this.stopping) {
      throw new Error('desktop update: Host is unavailable')
    }
    const requestId = this.nextControlId++
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await new Promise<boolean>((resolve, reject) => {
        this.taskQueries.set(requestId, { resolve, reject })
        timer = setTimeout(() => { reject(new Error('desktop update: task inspection timed out')) }, 10_000)
        child.send({ type: 'update-tasks', requestId, action }, (error) => { if (error !== null) reject(error) })
      })
    } finally {
      clearTimeout(timer)
      this.taskQueries.delete(requestId)
    }
  }

  /**
   * Request teardown and await child exit, escalating termination when needed.
   * @param requireGraceful - Reject update handoff after forced termination or unsuccessful child exit.
   * @returns Completion of owned process teardown. DesktopHostUncleanExitError confirms exit but refuses installation;
   * other failures do not confirm exit.
   */
  async stop(requireGraceful = false): Promise<void> {
    const child = this.child
    if (child === undefined) return
    this.stopping = true
    for (const controller of this.serverRequests.values()) controller.abort()
    if (child.connected) child.send({ type: 'shutdown' }, (error) => { if (error !== null) this.fail(error) })
    const exited = this.exitPromise ?? Promise.resolve()
    const graceful = await exitsWithin(exited, 10_000)
    if (!graceful) child.kill('SIGTERM')
    if (!await exitsWithin(exited, 5_000)) {
      child.kill('SIGKILL')
      if (!await exitsWithin(exited, 5_000)) {
        throw new Error('dsh desktop host did not exit after SIGKILL')
      }
    }
    this.child = undefined
    if (requireGraceful && (!graceful || child.exitCode !== 0 || !this.shutdownCompleted)) {
      // This diagnostic reaches expandable UI; arbitrary plugin stderr can contain credentials.
      throw new DesktopHostUncleanExitError(`desktop update: Host did not complete graceful task teardown (exit ${String(child.exitCode)}, signal ${String(child.signalCode)}, shutdown acknowledged ${String(this.shutdownCompleted)}, graceful deadline exceeded ${String(!graceful)})`)
    }
  }

  private fail(error: Error): void {
    this.readyReject(error)
    for (const query of this.taskQueries.values()) query.reject(error)
    this.taskQueries.clear()
    if (!this.failureReported && !this.stopping) {
      this.failureReported = true
      try { this.onFailure?.(error) } catch (listenerError) {
        console.error('desktop host failure listener failed', listenerError)
      }
    }
  }
}
