import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { z } from 'zod'
import { type LingServer, type LingServerInput, serverInputSchema, serverSchema } from './server-contract.ts'

const documentSchema = z.object({ version: z.literal(1), servers: z.array(serverSchema).max(200) }).strict()

/** Stores connection metadata only; never passwords or private keys. */
export class ServerStore {
  private pending: Promise<unknown> = Promise.resolve()
  constructor(private readonly file: string) {}

  async list(): Promise<readonly LingServer[]> {
    try { return documentSchema.parse(JSON.parse(await readFile(this.file, 'utf8'))).servers }
    catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return []
      throw new Error('服务器清单无法读取，请检查数据文件。', { cause: error })
    }
  }

  add(input: LingServerInput): Promise<LingServer> {
    return this.update(async servers => {
      const value = serverInputSchema.parse(input)
      if (servers.some(server => sameEndpoint(server, value))) throw new Error('此 SSH 连接已添加。')
      const added: LingServer = { ...value, id: randomUUID() }
      return { servers: [...servers, added], value: added }
    })
  }

  configure(id: string, input: LingServerInput): Promise<LingServer> {
    return this.update(async servers => {
      const value = serverInputSchema.parse(input)
      if (!servers.some(server => server.id === id)) throw new Error('服务器已不存在。')
      if (servers.some(server => server.id !== id && sameEndpoint(server, value))) throw new Error('此 SSH 连接已添加。')
      const configured: LingServer = { ...value, id }
      return { servers: servers.map(server => server.id === id ? configured : server), value: configured }
    })
  }

  remove(id: string): Promise<void> {
    return this.update(async servers => {
      if (!servers.some(server => server.id === id)) throw new Error('服务器已不存在。')
      return { servers: servers.filter(server => server.id !== id), value: undefined }
    })
  }

  private update<T>(change: (servers: readonly LingServer[]) => Promise<{ servers: readonly LingServer[]; value: T }>): Promise<T> {
    const result = this.pending.then(async () => {
      const current = await this.list()
      const next = await change(current)
      await mkdir(dirname(this.file), { recursive: true, mode: 0o700 })
      const temporary = join(dirname(this.file), `.ling-servers-${randomUUID()}.tmp`)
      try {
        await writeFile(temporary, `${JSON.stringify({ version: 1, servers: next.servers }, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
        await rename(temporary, this.file)
      } finally { await rm(temporary, { force: true }) }
      return next.value
    })
    this.pending = result.catch(() => undefined)
    return result
  }
}

function sameEndpoint(a: LingServerInput, b: LingServerInput): boolean {
  return a.alias.toLowerCase() === b.alias.toLowerCase() && (a.user ?? '') === (b.user ?? '') && (a.port ?? 22) === (b.port ?? 22)
}
