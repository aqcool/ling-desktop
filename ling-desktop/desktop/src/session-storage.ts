/** JSONL deletion adapter for the pinned published DSH layout; no upstream patch. */
import { mkdir, mkdtemp, readdir, realpath, lstat, rename, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import JsonlSessionPersistence, { type Config } from '@deepseek-ai/dsh-session-persistence-jsonl'
import { SessionPersistenceNotFoundError } from '@deepseek-ai/dsh-session-persistence'
import type { SessionHeader, SessionId } from '@deepseek-ai/dsh-session'

declare module '@deepseek-ai/cordis' { interface Context { lingSessionStorage: LingSessionStorage } }

// Layout compatibility boundary: matches dsh-session-persistence-jsonl 0.1.6-alpha.2.
function encode(raw: string): string {
  if (!raw) throw new Error('无效会话标识。')
  if (raw === '.' || raw === '..') return raw.replaceAll('.', '~002E')
  return raw.split('').map(ch => /^[A-Za-z0-9._-]$/.test(ch) ? ch : '~' + ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')).join('')
}
export function sessionDirectory(root: string, header: Pick<SessionHeader, 'id' | 'cwd'>): string {
  const slug = header.cwd === undefined ? undefined : encode(header.cwd.replace(/[\\/:]+/g, '-')).replace(/^-+/, '') || 'root'
  return join(root, slug === undefined ? '_no-cwd' : `--${slug.slice(0, 251)}--`, encode(header.id))
}
export class LingSessionStorage extends JsonlSessionPersistence {
  private deletionRoot: string
  private readonly cleanup: Promise<void>
  constructor(ctx: Context, config: Config) {
    super(ctx, config)
    this.deletionRoot = join(dirname(resolve(config.root)), 'ling-deleted-session-data')
    ctx.provide('lingSessionStorage', this)
    // Committed removals lie outside the session corpus; retry cleanup after a crash.
    this.cleanup = this.cleanDeletedData()
    ctx.effect(async () => { await this.cleanup; return () => {} }, 'LING deleted session cleanup')
  }
  async cleanDeletedData(): Promise<void> {
    this.deletionRoot = join(await realpath(dirname(resolve(this.config.root))), 'ling-deleted-session-data')
    await mkdir(this.deletionRoot, { recursive: true, mode: 0o700 })
    if ((await lstat(this.deletionRoot)).isSymbolicLink()) throw new Error('删除暂存路径异常。')
    for (const entry of await readdir(this.deletionRoot, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name.startsWith('deleted-')) await rm(join(this.deletionRoot, entry.name), { recursive: true, force: true })
    }
  }
  async deleteStoredSession(id: SessionId): Promise<void> {
    await this.cleanup
    let writer
    try { writer = await this.open(id, 'write') }
    catch (error) { if (error instanceof SessionPersistenceNotFoundError) return; throw error }
    let staging: string | undefined
    let committed = false
    try {
      const root = await realpath(this.config.root)
      const directory = sessionDirectory(root, writer.header)
      if ((await lstat(directory)).isSymbolicLink() || await realpath(directory) !== directory) throw new Error('会话存储路径异常，未删除。')
      await mkdir(this.deletionRoot, { recursive: true, mode: 0o700 })
      if ((await lstat(this.deletionRoot)).isSymbolicLink() || await realpath(this.deletionRoot) !== this.deletionRoot) throw new Error('删除暂存路径异常，未删除。')
      staging = await mkdtemp(join(this.deletionRoot, 'deleted-'))
      // One atomic rename removes every generation together. The write lease is held
      // through this commit; shared, content-addressed attachments are outside it.
      await rename(directory, join(staging, 'session'))
      committed = true
    } finally {
      try {
        await writer.close()
      } catch (error) {
        if (!committed) throw error
        this.ctx.logger.warn('会话已删除，关闭存储句柄失败：%s', String(error))
      } finally {
        if (staging) {
          if (committed) await rm(staging, { recursive: true, force: true }).catch(error => { this.ctx.logger.warn('会话已删除，残留数据将在下次启动时清理：%s', String(error)) })
          else await rm(staging, { recursive: true, force: true })
        }
      }
    }
  }
}
export default LingSessionStorage
