import { mkdtemp, mkdir, readFile, realpath, rm, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChangeHistoryStore, LingChangeHistoryController } from '../src/host/change-history-controller.ts'
import { savedChangeSummary, type SavedChangeSummary } from '../src/change-history-contract.ts'

const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose() })
const summary: SavedChangeSummary = { turn: 1, total: 1, added: 1, deleted: 0, files: [{ path: 'new.ts', display: 'new.ts', added: 1, deleted: 0 }] }
const diff = { kind: 'text' as const, path: 'new.ts', display: 'new.ts', before: false, after: true, coarse: false,
  hunks: [{ oldStart: 0, oldLines: 0, newStart: 1, newLines: 1, lines: ['+export {}'] }] }
async function directory() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'ling-change-history-')))
  cleanup.push(() => rm(root, { recursive: true, force: true }))
  const session = join(root, 'session')
  await mkdir(session)
  return { root, session }
}

describe('durable turn change history', () => {
  it('retains the original counts and comparisons after reopening without reading today’s workspace', async () => {
    const { session } = await directory()
    await new ChangeHistoryStore(session).capture(8, summary, async () => diff)
    const reopened = new ChangeHistoryStore(session)
    expect(await reopened.summary(8)).toEqual(summary)
    expect(await reopened.diff(8, 0)).toEqual(diff)
    expect(await reopened.summary(9)).toBeNull()
    expect(await reopened.diff(8, 1)).toBeNull()
    await rm(session, { recursive: true })
    await expect(reopened.capture(9, summary, async () => diff)).rejects.toThrow()
    expect(await reopened.summary(8)).toBeNull()
  })

  it('keeps counts when a comparison is unavailable and rejects redirected storage', async () => {
    const { root, session } = await directory()
    const store = new ChangeHistoryStore(session)
    await store.capture(8, summary, async () => { throw new Error('snapshot expired') })
    expect(await store.summary(8)).toEqual(summary)
    expect(await store.diff(8, 0)).toBeNull()
    await rm(join(session, 'ling-changes'), { recursive: true })
    await symlink(root, join(session, 'ling-changes'))
    await expect(store.capture(9, summary, async () => diff)).rejects.toThrow('存储路径异常')
  })

  it('captures after DSH publishes its record, drains at flush, and serves it after the live recorder disappears', async () => {
    const { session: directoryPath } = await directory()
    const ctx = new Context()
    cleanup.push(() => ctx.fiber.dispose())
    const header = { id: SessionId('task'), createdAt: 1, cwd: '/isolated-project' }
    const event = { type: 'workspace/changes', seq: 8, data: { turn: 1 } }
    const history = { meta: { cwd: header.cwd }, events: [event] }
    let live = false
    const inspect = vi.fn(async () => history)
    ctx.provide('typert', { register: () => () => {} } as never)
    ctx.provide('sessionController', { inspect } as never)
    ctx.provide('lingSessionStorage', { storedSessionDirectory: (value: { id: string; cwd: string }) => {
      expect(value).toMatchObject({ id: 'task', cwd: header.cwd }); return directoryPath
    } } as never)
    ctx.provide('lingSessionLifecycle', { withSessionOperation: async (_id: string, action: () => Promise<unknown>) => await action() } as never)
    ctx.provide('workspaceChanges', { summary: () => live ? { ...summary, cwd: header.cwd } : undefined, diff: async () => live ? diff : undefined } as never)
    const controller = new LingChangeHistoryController(ctx)
    ctx.emit('session/event', { id: header.id, header } as never, event as never)
    live = true
    await ctx.parallel('session/flush', { id: header.id } as never)
    live = false
    const rootedSummary = { ...summary, workspacePath: header.cwd }
    expect(JSON.parse(await readFile(join(directoryPath, 'ling-changes', '8.summary.json'), 'utf8'))).toEqual(rootedSummary)
    expect(await controller.summary({ taskId: 'task', seq: 8 })).toEqual(rootedSummary)
    expect(await controller.diff({ taskId: 'task', seq: 8, index: 0 })).toEqual(diff)
    history.events = []
    expect(await controller.summary({ taskId: 'task', seq: 8 })).toBeNull()
    expect(await controller.diff({ taskId: 'task', seq: 8, index: 0 })).toBeNull()
    await expect(controller.summary({ taskId: 'task', seq: -1 })).rejects.toThrow()
    expect(inspect).toHaveBeenCalledTimes(4)
  })

  it('does not invent zero-count history for already disposed pre-upgrade turns', async () => {
    const { session } = await directory()
    expect(await new ChangeHistoryStore(session).read('8.summary.json', savedChangeSummary)).toBeNull()
  })
})
