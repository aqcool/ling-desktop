import { mkdtemp, mkdir, readFile, readdir, rm, writeFile, symlink, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId, SessionSeq, SessionLogOffset, type SessionEvent } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import LlmRuntime, { createUserMessage } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LingSessionStorage, sessionDirectory } from '../src/session-storage.ts'
import { LingSessionLifecycle } from '../src/session-lifecycle.ts'
import { LingSessionDeleteController } from '../src/host/session-delete-controller.ts'

const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn() })
const events: SessionEvent[] = [
  { type: 'turn/start', seq: SessionSeq(0), time: 1, data: { turn: 1 } },
  { type: 'user/message', seq: SessionSeq(1), time: 2, surfaceOp: 'append', data: createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'isolated deletion needle' }] }) },
  { type: 'turn/end', seq: SessionSeq(2), time: 3, data: { turn: 1, reason: { kind: 'completed' } } },
]
async function fixture(compression: 'none' | 'zstd' = 'none') {
  const home = await realpath(await mkdtemp(join(tmpdir(), 'ling-delete-test-')))
  cleanup.push(() => rm(home, { recursive: true, force: true }))
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(LingSessionStorage, { root: join(home, 'sessions'), compression })
  await ctx.plugin(LingSessionLifecycle, { agents: [] })
  cleanup.push(() => ctx.fiber.dispose())
  const archived = new Set<SessionId>()
  ctx.provide('typert', { register: () => () => {} } as never)
  ctx.provide('workspaceRegistry', { get archivedSessionIds() { return [...archived] }, unarchiveSession: async (id: SessionId) => { archived.delete(id) } } as never)
  const controller = new LingSessionDeleteController(ctx)
  async function seed(id: string, parent?: SessionId) {
    const sessionId = SessionId(id)
    const handle = await ctx.agents.create({ sessionId, meta: { cwd: '/isolated-project', ...(parent ? { parentSession: parent, isSeeded: true } : {}) }, seed: events, ...(parent ? { inheritedEventCount: SessionLogOffset(events.length) } : {}), agentOptions: { provider: 'unused', model: 'unused' } })
    const session = handle.agent.session
    await handle.dispose()
    archived.add(sessionId)
    return session
  }
  return { ctx, home, controller, archived, seed }
}

describe('archived session deletion with the published JSONL backend', () => {
  it.each(['none', 'zstd'] as const)('removes all log generations and survives reopening (%s)', async compression => {
    const { ctx, home, controller, seed, archived } = await fixture(compression)
    const target = await seed('target')
    const other = await seed('other')
    const directory = sessionDirectory(join(home, 'sessions'), target.header)
    await writeFile(join(directory, 'old-generation.txt'), 'old private content')
    await mkdir(join(home, 'attachments'))
    await writeFile(join(home, 'attachments', 'shared'), 'shared attachment')
    expect((await ctx.sessionPersistence.list()).length).toBe(2)
    const removed: SessionId[] = []
    ctx.on('api-session/removed', id => { removed.push(id) })
    await expect(controller.deleteArchived({ taskId: 'target' })).resolves.toEqual({ deleted: true })
    expect(removed).toEqual([target.id])
    expect(await ctx.sessionPersistence.stat(target.id)).toBeUndefined()
    expect((await ctx.sessionPersistence.list()).map(s => s.header.id)).toEqual([other.id])
    expect(archived.has(target.id)).toBe(false)
    expect(await readFile(join(home, 'attachments', 'shared'), 'utf8')).toBe('shared attachment')
    expect(await readdir(join(home, 'ling-deleted-session-data'))).toEqual([])
    const fresh = new Context()
    await fresh.plugin(LingSessionStorage, { root: join(home, 'sessions'), compression })
    cleanup.push(() => fresh.fiber.dispose())
    expect(await fresh.sessionPersistence.stat(target.id)).toBeUndefined()
    await expect(fresh.sessionPersistence.open(target.id, 'read')).rejects.toThrow()
    expect((await fresh.sessionPersistence.list()).map(s => s.header.id)).toEqual([other.id])
  })
  it('disposes a resumed idle Agent before deleting its durable log', async () => {
    const { ctx, controller, seed } = await fixture()
    const target = await seed('live')
    const handle = await ctx.agents.resume({ resumeSessionId: target.id, agentOptions: { provider: 'unused', model: 'unused' } })
    expect(ctx.agents.get(target.id)).toBe(handle.agent)
    await controller.deleteArchived({ taskId: 'live' })
    expect(ctx.agents.get(target.id)).toBeUndefined()
    expect(ctx.sessions.get(target.id)).toBeUndefined()
    expect(await ctx.sessionPersistence.stat(target.id)).toBeUndefined()
  })
  it('does not touch non-archived, queued or maintenance-busy sessions', async () => {
    const { ctx, controller, seed, archived } = await fixture()
    const target = await seed('busy')
    archived.delete(target.id)
    await expect(controller.deleteArchived({ taskId: 'busy' })).rejects.toThrow('先归档')
    archived.add(target.id)
    const handle = await ctx.agents.resume({ resumeSessionId: target.id, agentOptions: { provider: 'unused', model: 'unused' } })
    let finish!: () => void
    const maintenance = handle.agent.runMaintenance(() => new Promise<void>(resolve => { finish = resolve }))
    await expect(controller.deleteArchived({ taskId: 'busy' })).rejects.toThrow()
    finish(); await maintenance
    handle.agent.send(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'queued' }] }), 'next-turn', false)
    await expect(controller.deleteArchived({ taskId: 'busy' })).rejects.toThrow('仍在运行')
    expect(await ctx.sessionPersistence.stat(target.id)).toBeDefined()
    expect(ctx.agents.get(target.id)).toBe(handle.agent)
  })
  it('reserves deletion against concurrent resume and mutation', async () => {
    const { ctx, controller, seed } = await fixture()
    const target = await seed('reserved')
    let enter!: () => void, finish!: () => void
    const entered = new Promise<void>(resolve => { enter = resolve })
    const work = ctx.lingSessionLifecycle.withSessionOperation(target.id, async () => { enter(); await new Promise<void>(resolve => { finish = resolve }) })
    await entered
    await expect(controller.deleteArchived({ taskId: 'reserved' })).rejects.toThrow('其他操作')
    finish(); await work
    const deleting = ctx.lingSessionLifecycle.deletingSession(target.id, async () => {
      await expect(ctx.agents.resume({ resumeSessionId: target.id })).rejects.toThrow('正在删除')
      await expect(ctx.lingSessionLifecycle.withSessionOperation(target.id, async () => {})).rejects.toThrow('正在删除')
    })
    await deleting
    expect(await ctx.sessionPersistence.stat(target.id)).toBeDefined()
  })
  it('refuses a foreign write owner and symlinked session directory', async () => {
    const { ctx, home, controller, seed } = await fixture()
    const target = await seed('owned')
    const owner = await ctx.sessionPersistence.open(target.id, 'write')
    await expect(controller.deleteArchived({ taskId: 'owned' })).rejects.toThrow()
    await owner.close()
    const directory = sessionDirectory(join(home, 'sessions'), target.header)
    const moved = join(home, 'untouched')
    const fs = await import('node:fs/promises')
    await fs.rename(directory, moved)
    await symlink(moved, directory)
    await expect(controller.deleteArchived({ taskId: 'owned' })).rejects.toThrow()
    expect((await readdir(moved)).length).toBeGreaterThan(0)
  })
  it('retains self-contained fork history after deleting the parent', async () => {
    const { ctx, controller, seed } = await fixture()
    const parent = await seed('parent')
    const child = await seed('fork', parent.id)
    await controller.deleteArchived({ taskId: 'parent' })
    const reader = await ctx.sessionPersistence.open(child.id, 'read')
    try { expect((await reader.read()).events.some(e => e.type === 'user/message')).toBe(true) } finally { await reader.close() }
    const resumed = await ctx.agents.resume({ resumeSessionId: child.id, agentOptions: { provider: 'unused', model: 'unused' } })
    expect(resumed.agent.session.header.parentSession).toBe(parent.id)
    expect(resumed.agent.status).toBe('idle')
  })
  it('cleans committed staging data left by a crash', async () => {
    const { home } = await fixture()
    const pending = join(home, 'ling-deleted-session-data', 'deleted-crash', 'session')
    await mkdir(pending, { recursive: true })
    await writeFile(join(pending, 'private-log'), 'gone')
    const fresh = new Context()
    await fresh.plugin(LingSessionStorage, { root: join(home, 'sessions'), compression: 'none' })
    cleanup.push(() => fresh.fiber.dispose())
    await fresh.lingSessionStorage.deleteStoredSession(SessionId('absent'))
    expect(await readdir(join(home, 'ling-deleted-session-data'))).toEqual([])
  })
  it('refuses automation that still reuses the identity or has an active run', async () => {
    const { ctx, controller, seed } = await fixture()
    const target = await seed('automation')
    let plans: unknown[] = [{ archived: false, output: 'reuse', taskId: target.id }]
    let runs: unknown[] = []
    ctx.provide('lingAutomation', { engine: { store: { plans: () => plans, runs: () => runs } } } as never)
    await expect(controller.deleteArchived({ taskId: target.id })).rejects.toThrow('仍在复用')
    plans = []
    runs = [{ taskId: target.id, status: 'running' }]
    await expect(controller.deleteArchived({ taskId: target.id })).rejects.toThrow('尚未结束')
    expect(await ctx.sessionPersistence.stat(target.id)).toBeDefined()
    runs = [{ taskId: target.id, status: 'completed' }]
    await expect(controller.deleteArchived({ taskId: target.id })).resolves.toEqual({ deleted: true })
  })
  it('does not report a committed delete as failed when archive metadata cleanup fails', async () => {
    const { ctx, controller, seed } = await fixture()
    const target = await seed('metadata')
    vi.spyOn(ctx.workspaceRegistry, 'unarchiveSession').mockRejectedValueOnce(new Error('metadata unavailable'))
    await expect(controller.deleteArchived({ taskId: target.id })).resolves.toEqual({ deleted: true })
    expect(await ctx.sessionPersistence.stat(target.id)).toBeUndefined()
  })
})
