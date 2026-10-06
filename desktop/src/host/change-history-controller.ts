import { constants } from 'node:fs'
import { mkdir, open, realpath, rename, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { SessionId, type SessionHeader } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-workspace-changes'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '../session-lifecycle.ts'
import type {} from '../session-storage.ts'
import { changeSummaryRequest, changeDiffRequest, savedChangeSummary, savedChangeDiff, LING_CHANGE_HISTORY_HOST, type SavedChangeSummary, type SavedChangeDiff } from '../change-history-contract.ts'
import type { z } from 'zod'

declare module '@deepseek-ai/cordis' { interface Context { lingChangeHistory: LingChangeHistoryController } }

/** A sidecar inside the session directory follows its ordinary deletion lifecycle. */
export class ChangeHistoryStore {
  constructor(private readonly directory: string) {}
  private async root(create = false): Promise<string> {
    // Never recreate a missing/deleted session or follow a redirected sidecar.
    if (await realpath(this.directory) !== this.directory) throw new Error('会话变更存储路径异常。')
    const root = join(this.directory, 'ling-changes')
    if (create) await mkdir(root, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error })
    if (await realpath(root) !== root) throw new Error('会话变更存储路径异常。')
    return root
  }
  async read<T>(name: string, schema: z.ZodType<T>): Promise<T | null> {
    try {
      const handle = await open(join(await this.root(), name), constants.O_RDONLY | constants.O_NOFOLLOW)
      try { return schema.parse(JSON.parse(await handle.readFile('utf8'))) } finally { await handle.close() }
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }
  }
  async write(name: string, value: unknown): Promise<void> {
    const root = await this.root(true), temporary = join(root, `${name}.${randomUUID()}.tmp`)
    try {
      const handle = await open(temporary, 'wx', 0o600)
      try { await handle.writeFile(JSON.stringify(value)); await handle.sync() } finally { await handle.close() }
      await rename(temporary, join(root, name))
    } finally { await rm(temporary, { force: true }) }
  }
  summary(seq: number) { return this.read(`${seq}.summary.json`, savedChangeSummary) }
  diff(seq: number, index: number) { return this.read(`${seq}.${index}.diff.json`, savedChangeDiff) }
  async capture(seq: number, summary: SavedChangeSummary, diff: (index: number) => Promise<SavedChangeDiff | null>): Promise<void> {
    await this.write(`${seq}.summary.json`, savedChangeSummary.parse(summary))
    // Bound comparison work, including large repositories; a missing comparison
    // stays missing instead of being recomputed from today's working tree.
    let next = 0
    await Promise.all(Array.from({ length: Math.min(2, summary.files.length) }, async () => {
      while (next < summary.files.length) {
        const index = next++
        const value = await diff(index).catch(() => null)
        if (value) await this.write(`${seq}.${index}.diff.json`, savedChangeDiff.parse(value))
      }
    }))
  }
}

export class LingChangeHistoryController extends TypertRemoteService {
  static inject = ['typert', 'sessions', 'sessionController', 'workspaceChanges', 'lingSessionStorage', 'lingSessionLifecycle']
  private readonly pending = new Map<string, Promise<void>>()
  constructor(ctx: Context) {
    super(ctx, 'lingChangeHistory')
    ctx.effect(() => ctx.typert.register(LING_CHANGE_HISTORY_HOST), 'LING change history Remote')
    ctx.on('session/event', (session, event) => {
      if (event.type !== 'workspace/changes') return
      const key = `${session.id}:${event.seq}`
      // DSH fills its record immediately after appending the announcement.
      const pending = ctx.lingSessionLifecycle.withSessionOperation(session.id, async () => {
        await Promise.resolve()
        const summary = ctx.workspaceChanges.summary(session.id, event.seq)
        if (!summary) return
        const { turn, files, total, added, deleted, cwd } = summary
        await this.store(session.header).capture(event.seq, { turn, files, total, added, deleted, workspacePath: cwd }, async index =>
          await ctx.workspaceChanges.diff(session.id, event.seq, index, new AbortController().signal) ?? null)
      }).catch(() => { ctx.logger.warn('无法保存本轮文件变更记录。') }).finally(() => { this.pending.delete(key) })
      this.pending.set(key, pending)
    })
    ctx.on('session/flush', async session => { await this.settled(String(session.id)) })
    ctx.effect(() => () => Promise.all(this.pending.values()).then(() => {}), 'LING change history durability')
  }
  private store(header: Pick<SessionHeader, 'id' | 'cwd'>) { return new ChangeHistoryStore(this.ctx.lingSessionStorage.storedSessionDirectory(header)) }
  private async settled(taskId: string) { await Promise.all([...this.pending].filter(([key]) => key.startsWith(`${taskId}:`)).map(([, value]) => value)) }
  async summary(request: z.infer<typeof changeSummaryRequest>, signal?: AbortSignal): Promise<SavedChangeSummary | null> {
    changeSummaryRequest.parse(request)
    const id = SessionId(request.taskId)
    return this.ctx.lingSessionLifecycle.withSessionOperation(id, async () => {
      const session = await this.ctx.sessionController.inspect(id, signal)
      signal?.throwIfAborted()
      if (!session.events.some(event => event.type === 'workspace/changes' && event.seq === request.seq)) return null
      const live = this.ctx.workspaceChanges.summary(id, request.seq)
      if (live) { const { turn, files, total, added, deleted, cwd } = live; return { turn, files, total, added, deleted, workspacePath: cwd } }
      await this.settled(request.taskId)
      signal?.throwIfAborted()
      const saved = await this.store({ id, ...(session.meta.cwd ? { cwd: session.meta.cwd } : {}) }).summary(request.seq)
      return saved ? { ...saved, workspacePath: saved.workspacePath ?? session.meta.cwd } : null
    })
  }
  async diff(request: z.infer<typeof changeDiffRequest>, signal?: AbortSignal): Promise<SavedChangeDiff | null> {
    changeDiffRequest.parse(request)
    const id = SessionId(request.taskId)
    return this.ctx.lingSessionLifecycle.withSessionOperation(id, async () => {
      const session = await this.ctx.sessionController.inspect(id, signal)
      signal?.throwIfAborted()
      if (!session.events.some(event => event.type === 'workspace/changes' && event.seq === request.seq)) return null
      const live = await this.ctx.workspaceChanges.diff(id, request.seq, request.index, signal ?? new AbortController().signal)
      if (live) return live
      await this.settled(request.taskId)
      signal?.throwIfAborted()
      return await this.store({ id, ...(session.meta.cwd ? { cwd: session.meta.cwd } : {}) }).diff(request.seq, request.index)
    })
  }
}
const prototype = LingChangeHistoryController.prototype
const receiver = Object.create(prototype) as LingChangeHistoryController
const decorate = Remote as unknown as (implementation: (...args: never[]) => unknown, context: { name: string; private: boolean; static: boolean; addInitializer(initializer: (this: LingChangeHistoryController) => void): void }) => void
for (const name of ['summary', 'diff'] as const) decorate(prototype[name] as (...args: never[]) => unknown, { name, private: false, static: false, addInitializer(initializer) { initializer.call(receiver) } })
