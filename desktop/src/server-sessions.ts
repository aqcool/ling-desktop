import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, posix } from 'node:path'
import { z } from 'zod'

const bindingSchema = z.object({ serverId: z.string().uuid(), cwd: z.string().startsWith('/').max(4096) }).strict()
const documentSchema = z.object({ version: z.literal(1), sessions: z.record(z.string().min(1).max(128), bindingSchema) }).strict()
export type ServerSessionBinding = z.infer<typeof bindingSchema>
type Document = z.infer<typeof documentSchema>

/** Non-secret task-to-server bindings; credentials stay in Electron main. */
export class ServerSessions {
  private pending: Promise<unknown> = Promise.resolve()
  constructor(private readonly file: string) {}

  async get(taskId: string): Promise<ServerSessionBinding | undefined> {
    return (await this.read()).sessions[taskId]
  }

  async bind(taskId: string, serverId: string, cwd: string): Promise<ServerSessionBinding> {
    if (!posix.isAbsolute(cwd) || cwd.includes('\0') || posix.normalize(cwd) !== cwd) throw new Error('远端目录无效。')
    const binding = bindingSchema.parse({ serverId, cwd })
    return this.update(document => {
      if (document.sessions[taskId]) throw new Error('此任务已经绑定服务器。')
      document.sessions[taskId] = binding
      return binding
    })
  }

  async changeDirectory(taskId: string, cwd: string): Promise<ServerSessionBinding> {
    if (!posix.isAbsolute(cwd) || cwd.includes('\0') || posix.normalize(cwd) !== cwd) throw new Error('远端目录无效。')
    return this.update(document => {
      const binding = document.sessions[taskId]
      if (!binding) throw new Error('此任务尚未绑定服务器。')
      const next = bindingSchema.parse({ ...binding, cwd })
      document.sessions[taskId] = next
      return next
    })
  }

  private async read(): Promise<Document> {
    try { return documentSchema.parse(JSON.parse(await readFile(this.file, 'utf8'))) }
    catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return { version: 1, sessions: {} }
      throw new Error('服务器任务记录无法读取。', { cause: error })
    }
  }

  private update<T>(change: (document: Document) => T): Promise<T> {
    const result = this.pending.then(async () => {
      const document = await this.read()
      const value = change(document)
      await mkdir(dirname(this.file), { recursive: true, mode: 0o700 })
      const temporary = `${this.file}.${randomUUID()}.tmp`
      try { await writeFile(temporary, `${JSON.stringify(document)}\n`, { flag: 'wx', mode: 0o600 }); await rename(temporary, this.file) }
      finally { await rm(temporary, { force: true }) }
      return value
    })
    this.pending = result.catch(() => undefined)
    return result
  }
}
