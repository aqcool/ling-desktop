import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { z } from 'zod'
import type { LingTaskServers, LingTaskServersUpdate } from 'ling-desktop/runtime'
import { serverCwdSchema as cwdSchema, taskServersSchema, taskServersUpdateSchema } from './server-task-contract.ts'
export { taskServersSchema, taskServersUpdateSchema } from './server-task-contract.ts'
const taskIdSchema = z.string().min(1).max(128)
const documentSchema = z.object({ version: z.literal(1), sessions: z.record(taskIdSchema, taskServersSchema) }).strict()
type Document = z.infer<typeof documentSchema>
export interface ServerSessionBinding { readonly serverId: string; readonly cwd: string }

/** The new, non-secret multi-server store. Legacy single-server files are never read. */
export class ServerSessions {
  private pending: Promise<unknown> = Promise.resolve()
  constructor(private readonly file: string) {}

  async get(taskId: string): Promise<LingTaskServers> {
    taskIdSchema.parse(taskId)
    return this.enqueue(async () => (await this.read()).sessions[taskId] ?? { revision: 0, servers: [] })
  }

  async set(taskId: string, input: LingTaskServersUpdate): Promise<LingTaskServers> {
    taskIdSchema.parse(taskId)
    const request = taskServersUpdateSchema.parse(input)
    return this.update(document => {
      const current = document.sessions[taskId] ?? { revision: 0, servers: [] }
      if (current.revision !== request.expectedRevision) throw new Error('服务器关联已变化，请刷新后重试。')
      const previous = new Map(current.servers.map(item => [item.serverId, item]))
      const next = taskServersSchema.parse({ revision: current.revision + 1,
        ...(request.developmentServerId ? { developmentServerId: request.developmentServerId } : {}),
        servers: request.serverIds.map(serverId => previous.get(serverId) ?? { serverId }),
      })
      document.sessions[taskId] = next
      return next
    })
  }

  /** Fork only Host-owned bindings; the ordinary association update never accepts a caller-supplied cwd. */
  async copy(sourceTaskId: string, targetTaskId: string): Promise<LingTaskServers> {
    taskIdSchema.parse(sourceTaskId)
    taskIdSchema.parse(targetTaskId)
    if (sourceTaskId === targetTaskId) throw new Error('无法将服务器关联复制到原会话。')
    return this.update(document => {
      const source = document.sessions[sourceTaskId] ?? { revision: 0, servers: [] }
      const target = document.sessions[targetTaskId] ?? { revision: 0, servers: [] }
      if (target.servers.length) throw new Error('目标会话已有关联服务器，无法覆盖。')
      const next = taskServersSchema.parse({
        revision: target.revision + 1,
        ...(source.developmentServerId ? { developmentServerId: source.developmentServerId } : {}),
        servers: source.servers.map(binding => ({ ...binding })),
      })
      document.sessions[targetTaskId] = next
      return next
    })
  }

  async changeDirectory(taskId: string, serverId: string, cwd: string, expected?: { readonly revision: number; readonly cwd?: string }, initialize = false): Promise<ServerSessionBinding> {
    cwdSchema.parse(cwd)
    return this.update(document => {
      const current = document.sessions[taskId]
      const binding = current?.servers.find(item => item.serverId === serverId)
      if (!current || !binding) throw new Error('此服务器未关联当前会话。')
      if (expected && current.revision !== expected.revision) throw new Error('服务器关联或工作目录已变化，请重新执行。')
      if (initialize && binding.cwd) return { serverId, cwd: binding.cwd }
      if (expected && binding.cwd !== expected.cwd) throw new Error('服务器关联或工作目录已变化，请重新执行。')
      document.sessions[taskId] = { ...current,
        servers: current.servers.map(item => item.serverId === serverId ? { serverId, cwd } : item) }
      return { serverId, cwd }
    })
  }

  private async read(): Promise<Document> {
    try { return documentSchema.parse(JSON.parse(await readFile(this.file, 'utf8'))) }
    catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return { version: 1, sessions: {} }
      throw new Error('服务器任务记录无法读取。', { cause: error })
    }
  }

  // Reads share the mutation queue: callers must not see an older state after
  // requesting a write, or hold the destination open during a Windows rename.
  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.pending.then(operation)
    this.pending = result.catch(() => undefined)
    return result
  }

  private update<T>(change: (document: Document) => T): Promise<T> {
    return this.enqueue(async () => {
      const document = await this.read()
      const value = change(document)
      await mkdir(dirname(this.file), { recursive: true, mode: 0o700 })
      const temporary = `${this.file}.${randomUUID()}.tmp`
      try { await writeFile(temporary, `${JSON.stringify(document)}\n`, { flag: 'wx', mode: 0o600 }); await rename(temporary, this.file) }
      finally { await rm(temporary, { force: true }) }
      return value
    })
  }
}
