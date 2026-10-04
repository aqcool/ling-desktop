import { Context } from '@deepseek-ai/cordis'
import { SshFileSystem } from '@deepseek-ai/dsh-fs-ssh'
import { SshSubprocessRuntime } from '@deepseek-ai/dsh-subprocess-ssh'
import { SshSandboxProvider } from '@deepseek-ai/dsh-sandbox-ssh'
import type { SshConnection } from '@deepseek-ai/dsh-ssh'
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox'
import type { SubprocessTerminalHandle } from '@deepseek-ai/dsh-subprocess'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { StringDecoder } from 'node:string_decoder'

/** Public DSH connection surface: also accepts the stock OpenSSH provider. */
export type RemoteConnection = Pick<SshConnection, 'ready' | 'request' | 'connectStream' | 'dispose' | 'nodeExecutable' | 'bootstrapPath'>
export type RemotePolicy = Pick<SandboxExecutionPolicy, 'mode' | 'workspaceRoot'>
export interface RemoteOutput { stream: 'stdout' | 'stderr'; data: string }
export interface RemoteResult { stdout: string; stderr: string; exitCode: number }

/** Shared by Electron and ordinary DSH hosts. No vault, IPC, or Renderer dependencies. */
export class DshRemoteRuntime {
  readonly ctx = new Context()
  private readonly disposers: Array<() => Promise<unknown>> = []
  private closing?: Promise<void>
  private constructor(readonly connection: RemoteConnection) {}

  static async create(connection: RemoteConnection): Promise<DshRemoteRuntime> {
    const runtime = new DshRemoteRuntime(connection)
    await connection.ready
    runtime.ctx.provide('ssh', connection as SshConnection)
    // Every mutation receives an explicit per-call policy, never a mutable global mode.
    runtime.ctx.provide('sandboxPolicy', { defaultMode: 'read-only', resolve: () => {
      throw new Error('Remote operations require an explicit session policy')
    } } as never)
    try {
      for (const plugin of [SshFileSystem, SshSubprocessRuntime, SshSandboxProvider]) {
        const fiber = runtime.ctx.plugin(plugin)
        runtime.disposers.push(() => fiber.dispose())
        await fiber
      }
    } catch (error) { await runtime.close(); throw error }
    return runtime
  }

  async execute(cwd: string, command: string, policy: RemotePolicy, signal?: AbortSignal,
    options: { limit?: number; onOutput?: (output: RemoteOutput) => void; inputPath?: string; onStdout?: (chunk: Buffer) => void } = {}): Promise<RemoteResult> {
    signal?.throwIfAborted()
    let argv: readonly string[] = ['/bin/sh', '-c', command]
    if (policy.mode !== 'danger-full-access') argv = (await this.ctx.sandbox.confine(argv,
      { ...policy, mode: policy.mode }, signal)).argv
    const process = this.ctx.subprocess.spawn({ argv, cwd, signal, graceMs: 1500,
      stdio: { stdin: options.inputPath ? 'pipe' : 'ignore', stdout: 'pipe', stderr: 'pipe' } })
    const limit = options.limit ?? 256 * 1024
    const output = { stdout: '', stderr: '' }
    const truncated = { stdout: false, stderr: false }
    const consume = async (name: 'stdout' | 'stderr') => {
      const decoder = new StringDecoder('utf8')
      const publish = (value: string) => {
        if (!value) return
        if (options.onOutput) options.onOutput({ stream: name, data: value })
        output[name] += value
        if (output[name].length > limit) { output[name] = output[name].slice(-limit); truncated[name] = true }
      }
      for await (const data of process[name]!) {
        const chunk = Buffer.from(data)
        if (name === 'stdout' && options.onStdout) options.onStdout(chunk)
        else publish(decoder.write(chunk))
      }
      publish(decoder.end())
    }
    const reading = Promise.all([consume('stdout'), consume('stderr')])
    void reading.catch(() => process.terminate())
    const input = options.inputPath ? createReadStream(options.inputPath) : undefined
    input?.on('error', () => process.terminate())
    if (input) input.pipe(process.stdin!)
    try {
      const result = await process.done
      await reading
      signal?.throwIfAborted()
      return { stdout: (truncated.stdout ? '[earlier output omitted]\n' : '') + output.stdout,
        stderr: (truncated.stderr ? '[earlier output omitted]\n' : '') + output.stderr,
        exitCode: result.exitCode ?? 255 }
    } finally {
      input?.destroy()
      // Join the upstream managed range rather than assuming closing SSH killed it.
      process.terminate()
      try { await process.waitForExit() } finally { process.stdin?.destroy(); process.stdout?.destroy(); process.stderr?.destroy() }
      await reading.catch(() => {})
    }
  }

  async readFile(path: string, signal?: AbortSignal, root?: string, maxBytes?: number) {
    const target = await this.ctx.fs.resolve(path, { signal })
    if (root && !this.ctx.fs.contains(await this.ctx.fs.resolve(root, { signal }), target)) throw new Error('文件不属于此 SSH 工作区。')
    if (maxBytes !== undefined) {
      const bytes = await this.ctx.fs.readBytes(target, signal, maxBytes)
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      if (text.includes('\0')) throw new Error('此文件不是文本。')
      return { path, text, sha256: createHash('sha256').update(text).digest('hex'), truncated: false }
    }
    let text = ''
    for await (const part of await this.ctx.fs.streamText(target, signal)) text += part
    return { path, text, sha256: createHash('sha256').update(text).digest('hex'), truncated: false }
  }

  async writeFile(path: string, text: string, expected: string | null, policy: RemotePolicy, signal?: AbortSignal) {
    const target = await this.ctx.fs.resolve(path, { signal })
    const before = await this.ctx.fs.stat(target, signal)
    if (expected === null ? before !== undefined : before === undefined || (await this.readFile(path, signal)).sha256 !== expected)
      throw new Error('远端文件已变化，请重新读取后保存。')
    await this.ctx.fs.writeText(target, text, before ? { kind: 'replaceIfVersion', version: before.version }
      : { kind: 'createIfAbsent' }, signal, policy)
    return { path, sha256: createHash('sha256').update(text).digest('hex') }
  }

  async listFiles(path: string, signal?: AbortSignal, root?: string) {
    const target = await this.ctx.fs.resolve(path, { signal })
    const boundary = root ? await this.ctx.fs.resolve(root, { signal }) : undefined
    if (boundary && !this.ctx.fs.contains(boundary, target)) throw new Error('目录不属于此 SSH 工作区。')
    const entries = await this.ctx.fs.listDir(target, signal)
    return boundary ? entries.filter(entry => this.ctx.fs.contains(boundary, entry.target)) : entries
  }

  async terminal(cwd: string, cols: number, rows: number, signal?: AbortSignal): Promise<SubprocessTerminalHandle> {
    const environment = await this.ctx.subprocess.terminalEnvironment(signal)
    return this.ctx.subprocess.spawnTerminal({ argv: [environment.defaultShell ?? '/bin/sh', '-l'], cwd,
      cols, rows, terminalType: 'xterm-256color', graceMs: 1500, signal })
  }

  async close(): Promise<void> {
    this.closing ??= (async () => {
      try { for (const dispose of this.disposers.splice(0).reverse()) await dispose() }
      finally { await this.connection.dispose() }
    })()
    return this.closing
  }
}
