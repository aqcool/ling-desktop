import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open } from 'node:fs/promises'
import { join } from 'node:path'

export type ServerAuditAction = 'exec' | 'deploy-file' | 'deploy-directory' | 'download-file' | 'git'

/** Durable, independent operation history. Commands are hashed so secrets in arguments are not copied here. */
export class ServerAudit {
  private queue: Promise<unknown> = Promise.resolve()
  constructor(private readonly home: string) {}

  async record(taskId: string, serverId: string, action: ServerAuditAction, detail: string,
    state: 'started' | 'succeeded' | 'failed', operationId: string): Promise<void> {
    const item = { at: new Date().toISOString(), operationId, taskId, serverId, action, state,
      detailSha256: createHash('sha256').update(detail).digest('hex') }
    const next = this.queue.then(async () => {
      await mkdir(this.home, { recursive: true, mode: 0o700 })
      const file = await open(join(this.home, 'ling-server-operations.jsonl'), 'a', 0o600)
      try { await file.chmod(0o600); await file.writeFile(`${JSON.stringify(item)}\n`); await file.sync() }
      finally { await file.close() }
    })
    this.queue = next.catch(() => undefined)
    await next
  }

  async perform<T>(taskId: string, serverId: string, action: ServerAuditAction, detail: string,
    operation: () => Promise<T>): Promise<T> {
    const id = randomUUID()
    await this.record(taskId, serverId, action, detail, 'started', id)
    let result: T
    try {
      result = await operation()
    } catch (error) {
      await this.record(taskId, serverId, action, detail, 'failed', id).catch(() => undefined)
      throw error
    }
    await this.record(taskId, serverId, action, detail, 'succeeded', id)
    return result
  }
}
