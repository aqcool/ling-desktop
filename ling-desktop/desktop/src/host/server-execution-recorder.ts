import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { LingServerExecution } from 'ling-desktop/runtime'
import type { ServerCommandResult } from '../server-broker.ts'
import type { ServerExecutionStart, ServerOutput } from '../server-execution.ts'

/** LING-owned presentation storage. Never writes private terminal data or upstream session events. */
export class ServerExecutionRecorder {
  private readonly active = new Map<string, LingServerExecution>()
  constructor(private readonly directory: string) {}
  private key(taskId: string, callId: string) { return createHash('sha256').update(JSON.stringify([taskId, callId])).digest('hex') }

  async list(taskId: string, callIds: readonly string[]): Promise<readonly LingServerExecution[]> {
    return (await Promise.all(callIds.map(async callId => {
      const key = this.key(taskId, callId)
      const active = this.active.get(key)
      if (active) return active
      try {
        const parsed: unknown = JSON.parse(await readFile(join(this.directory, `${key}.json`), 'utf8'))
        if (!parsed || typeof parsed !== 'object') return
        const item = parsed as LingServerExecution
        if (item.callId !== callId || typeof item.output !== 'string' || typeof item.command !== 'string') return
        // A process crash can leave a checkpoint. It is never a live execution after restart.
        return item.status === 'running' ? { ...item, status: 'interrupted' as const } : item
      } catch { return }
    }))).filter((item): item is LingServerExecution => item !== undefined)
  }

  async run(taskId: string, start: ServerExecutionStart, signal: AbortSignal,
    run: (output: (chunk: ServerOutput) => void) => Promise<ServerCommandResult>): Promise<ServerCommandResult> {
    const key = this.key(taskId, start.callId)
    let item: LingServerExecution = { ...start, output: '', status: 'running' }
    this.active.set(key, item)
    let saving = Promise.resolve()
    const save = () => {
      const snapshot = item
      saving = saving.then(async () => {
        await mkdir(this.directory, { recursive: true, mode: 0o700 })
        const path = join(this.directory, `${key}.json`)
        await writeFile(`${path}.tmp`, JSON.stringify(snapshot), { mode: 0o600 })
        await rename(`${path}.tmp`, path)
      }).catch(() => { /* Presentation persistence must never rerun or fail a remote command. */ })
      return saving
    }
    await save()
    let checkpoint: ReturnType<typeof setTimeout> | undefined
    try {
      const result = await run(chunk => {
        item = { ...item, output: (item.output + chunk.data).slice(-256 * 1024) }
        this.active.set(key, item)
        if (!checkpoint) checkpoint = setTimeout(() => { checkpoint = undefined; void save() }, 1000)
      })
      item = { ...item, status: result.exitCode === 0 ? 'completed' : 'failed', exitCode: result.exitCode }
      return result
    } catch (error) {
      item = { ...item, status: signal.aborted ? 'interrupted' : 'failed', error: error instanceof Error ? error.message : '远端执行失败。' }
      throw error
    } finally {
      clearTimeout(checkpoint)
      this.active.set(key, item)
      await save()
      this.active.delete(key)
    }
  }
}
