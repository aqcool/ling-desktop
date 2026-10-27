import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createScope } from '@deepseek-ai/dsh-scope'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { type PreToolDecision } from '@deepseek-ai/dsh-tools'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { SandboxPolicyService } from '@deepseek-ai/dsh-sandbox-policy'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LingServersController } from '../src/host/server-controller.ts'
import { ServerSessions } from '../src/server-sessions.ts'
import { installServerBridge, ServerBridge } from '../src/host/server-bridge.ts'

const cleanups: (() => void | Promise<void>)[] = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); vi.unstubAllEnvs() })
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(finish => { resolve = finish })
  return { promise, resolve }
}
async function fixture() {
  const home = await mkdtemp(join(tmpdir(), 'ling-multi-server-'))
  cleanups.push(() => rm(home, { recursive: true, force: true }))
  vi.stubEnv('DSH_HOME', home)
  const ctx = new Context(); cleanups.push(() => ctx.fiber.dispose())
  await ctx.plugin(SessionStore); await ctx.plugin(SessionProjectionRegistry); await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime); await ctx.plugin(SandboxPolicyService, { mode: 'workspace-write', workspaceRoot: home })
  ctx.provide('typert', { register: () => () => {} } as never)
  const agents = new Map<string, Agent>()
  ctx.provide('agents', { get: (id: string) => agents.get(id) } as never)
  const admission = deferred<PreToolDecision>(), approval = deferred<void>()
  let hold = false
  ctx.on('tools/pre-execute', async (exec, next) => {
    const decision = await next()
    if (hold && exec.name === 'server_exec') {
      admission.resolve(decision)
      await approval.promise
      return { kind: 'allow' }
    }
    return decision
  })
  const controller = new LingServersController(ctx)
  const a = await controller.add({ name: 'Alpha', alias: 'alpha', environment: 'development' })
  const b = await controller.add({ name: 'Beta', alias: 'beta', environment: 'production' })
  let owner!: Context
  await ctx.plugin({ inject: ['tools', 'systemPrompt', 'sandboxPolicy'], apply(value: Context) { owner = value } })
  const makeAgent = (id: string) => {
    const session = ctx.sessions.create(SessionId(id), { meta: { cwd: home } })
    const agent = { id: session.id, session, status: 'idle' } as Agent
    Object.assign(agent, { ctx: createScope(owner, agent).ctx })
    agents.set(id, agent)
    return agent
  }
  const agent = makeAgent('task')
  const sent: Record<string, unknown>[] = []
  const bridge = new ServerBridge(message => {
    const request = message as Record<string, unknown>; sent.push(request)
    const file = request.request as { action: string; path: string } | undefined
    let result: unknown
    if (request.type === 'server-request') result = { stdout: String(request.command).includes('__LING_HOME__') ? '__LING_HOME__\n/home/fixture\n' : 'ok\n', stderr: '', exitCode: 0 }
    else if (request.type === 'server-file-request') result = file!.action === 'list' ? { path: file!.path, entries: [] }
      : file!.action === 'read' ? { path: file!.path, text: 'remote text', sha256: 'a'.repeat(64), truncated: false }
        : { path: file!.path, sha256: 'b'.repeat(64) }
    else if (request.action === 'open') result = { terminalId: randomUUID() }
    else if (request.action === 'poll') result = { terminalId: request.terminalId, offset: 1, data: 'private terminal output', closed: false }
    else result = { ok: true }
    queueMicrotask(() => bridge.receive({ type: 'server-response', requestId: request.requestId, result }))
  })
  installServerBridge(bridge); cleanups.push(() => bridge.close())
  const execute = (name: string, serverId: string, command = 'pwd') => ctx.tools.execute({
    name, agent, arguments: { serverId, command, description: '检查选定服务器' }, signal: new AbortController().signal, callId: ToolCallId(randomUUID()),
  })
  return { home, ctx, controller, bridge, a, b, agent, makeAgent, sent, execute, hold: () => { hold = true }, admission, approval }
}

describe('explicit task server targets', () => {
  it('copies Host-owned fork directories without connecting and uses them for subsequent file operations', async () => {
    const { home, ctx, controller, a, b, makeAgent, sent } = await fixture()
    await controller.setTaskServers('task', { expectedRevision: 0, serverIds: [a.id, b.id], developmentServerId: a.id })
    const sessions = new ServerSessions(join(home, 'ling-task-servers.json'))
    await sessions.changeDirectory('task', a.id, '/srv/project/.worktrees/feature')
    await sessions.changeDirectory('task', b.id, '/opt/ops')
    const fork = makeAgent('fork')
    expect(await controller.copyTaskServers('task', 'fork')).toEqual({ revision: 1, developmentServerId: a.id,
      servers: [{ serverId: a.id, cwd: '/srv/project/.worktrees/feature' }, { serverId: b.id, cwd: '/opt/ops' }] })
    expect(sent).toEqual([])
    expect(ctx.tools.schemas(fork).some(tool => tool.name === 'remote_read')).toBe(true)
    const signal = new AbortController().signal
    await controller.filesRead('fork', a.id, 'package.json', signal)
    await controller.filesRead('fork', b.id, 'status.txt', signal)
    expect(sent).toHaveLength(2)
    expect(sent[0]).toMatchObject({ type: 'server-file-request', request: { serverId: a.id, path: '/srv/project/.worktrees/feature/package.json' } })
    expect(sent[1]).toMatchObject({ type: 'server-file-request', request: { serverId: b.id, path: '/opt/ops/status.txt' } })
    const scope = await controller.terminalScope({ taskId: 'fork', serverId: a.id, placement: 'side' }, signal)
    expect(await controller.terminalList(scope.ownerId)).toEqual([])
  })

  it('refuses fork copies into running, missing or already-bound tasks', async () => {
    const { controller, a, b, makeAgent, sent } = await fixture()
    await controller.setTaskServers('task', { expectedRevision: 0, serverIds: [a.id], developmentServerId: a.id })
    const running = makeAgent('running')
    Object.assign(running, { status: 'running' })
    await expect(controller.copyTaskServers('task', 'running')).rejects.toThrow('运行中')
    await expect(controller.copyTaskServers('task', 'missing')).rejects.toThrow('不存在')
    makeAgent('bound')
    const existing = await controller.setTaskServers('bound', { expectedRevision: 0, serverIds: [b.id] })
    await expect(controller.copyTaskServers('task', 'bound')).rejects.toThrow('无法覆盖')
    expect(await controller.taskServers('bound')).toEqual(existing)
    expect(sent).toEqual([])
  })

  it('saves offline associations and installs one tool set without changing local execution', async () => {
    const { ctx, controller, a, b, agent, sent } = await fixture()
    const state = await controller.setTaskServers('task', { expectedRevision: 0, serverIds: [a.id, b.id] })
    expect(state).toEqual({ revision: 1, servers: [{ serverId: a.id }, { serverId: b.id }] })
    expect(sent).toEqual([])
    const assembly = await ctx.systemPrompt.assemble({ scope: agent })
    expect(assembly.contexts.find(item => item.name === 'ling:server-targets')?.text).toContain(a.id)
    expect(assembly.contexts.find(item => item.name === 'ling:server-targets')?.text).toContain(b.id)
    const schemas = ctx.tools.schemas(agent)
    expect(schemas.filter(tool => tool.name === 'server_exec')).toHaveLength(1)
    expect(schemas.find(tool => tool.name === 'server_exec')?.parameters.required).toContain('serverId')
    await controller.setTaskServers('task', { expectedRevision: 1, serverIds: [a.id, b.id], developmentServerId: a.id })
    expect(ctx.tools.schemas(agent).filter(tool => tool.name === 'server_exec')).toHaveLength(1)
    expect(sent).toEqual([])
  })

  it('routes concurrent first-use calls to their explicit server and keeps cwd initialization independent', async () => {
    const { controller, a, b, execute, sent } = await fixture()
    await controller.setTaskServers('task', { expectedRevision: 0, serverIds: [a.id, b.id] })
    const results = await Promise.all([execute('server_exec', a.id), execute('server_exec', b.id)])
    expect(results.map(result => result.isError)).toEqual([false, false])
    const calls = sent.filter(request => request.command === 'pwd')
    expect(calls.map(request => request.serverId).sort()).toEqual([a.id, b.id].sort())
    expect((await controller.taskServers('task')).revision).toBe(1)
    const invalid = await execute('server_exec', randomUUID())
    expect(invalid.isError).toBe(true)
    expect(sent.filter(request => request.command === 'pwd')).toHaveLength(2)
  })

  it.each([false, true])('rejects an old approval after unlinking the target (re-added: %s)', async readd => {
    const { controller, a, b, execute, sent, hold, admission, approval } = await fixture()
    await controller.setTaskServers('task', { expectedRevision: 0, serverIds: [a.id, b.id] })
    hold()
    const run = execute('server_exec', a.id, 'systemctl restart app')
    expect((await admission.promise).kind).toBe('ask')
    await controller.setTaskServers('task', { expectedRevision: 1, serverIds: [b.id] })
    if (readd) await controller.setTaskServers('task', { expectedRevision: 2, serverIds: [a.id, b.id] })
    approval.resolve()
    const result = await run
    expect(result.isError).toBe(true)
    expect(sent.some(request => request.command === 'systemctl restart app')).toBe(false)
  })

  it('rejects an in-flight home probe after unlinking and re-adding the same server', async () => {
    const { controller, a, b, execute, sent } = await fixture()
    await controller.setTaskServers('task', { expectedRevision: 0, serverIds: [a.id, b.id] })
    const started = deferred<void>(), home = deferred<{ home: string }>()
    vi.spyOn(controller, 'probe').mockImplementationOnce(async () => { started.resolve(); return home.promise })
    const run = execute('server_exec', a.id)
    await started.promise
    await controller.setTaskServers('task', { expectedRevision: 1, serverIds: [b.id] })
    await controller.setTaskServers('task', { expectedRevision: 2, serverIds: [a.id, b.id] })
    home.resolve({ home: '/stale-home' })
    expect((await run).isError).toBe(true)
    expect((await controller.taskServers('task')).servers.find(item => item.serverId === a.id)?.cwd).toBeUndefined()
    expect(sent.some(request => request.command === 'pwd')).toBe(false)
  })

  it('rejects an old approval after reconfiguring the same server ID to a different endpoint', async () => {
    const { controller, a, execute, sent, hold, admission, approval } = await fixture()
    await controller.setTaskServers('task', { expectedRevision: 0, serverIds: [a.id] })
    hold()
    const run = execute('server_exec', a.id, 'systemctl restart app')
    expect((await admission.promise).kind).toBe('ask')
    await controller.configure(a.id, { name: a.name, alias: 'different-host', user: 'different-user', port: 2222, environment: a.environment })
    approval.resolve()
    expect((await run).isError).toBe(true)
    expect(sent.some(request => request.command === 'systemctl restart app')).toBe(false)
  })

  it('pins terminal owners per task/server/placement and preserves existing PTYs after unlinking', async () => {
    const { controller, a, b, makeAgent, sent } = await fixture()
    await controller.setTaskServers('task', { expectedRevision: 0, serverIds: [a.id, b.id] })
    makeAgent('other')
    await controller.setTaskServers('other', { expectedRevision: 0, serverIds: [a.id] })
    const signal = new AbortController().signal
    const first = await controller.terminalScope({ taskId: 'task', serverId: a.id, placement: 'side' }, signal)
    expect(await controller.terminalScope({ taskId: 'task', serverId: a.id, placement: 'side' }, signal)).toEqual(first)
    const second = await controller.terminalScope({ taskId: 'task', serverId: b.id, placement: 'side' }, signal)
    const other = await controller.terminalScope({ taskId: 'other', serverId: a.id, placement: 'side' }, signal)
    expect(new Set([first.ownerId, second.ownerId, other.ownerId]).size).toBe(3)
    const opened = await controller.terminalOpen(first.ownerId, 80, 24, signal)
    expect(sent.find(request => request.action === 'open')?.serverId).toBe(a.id)
    await controller.setTaskServers('task', { expectedRevision: 1, serverIds: [b.id] })
    await expect(controller.terminalOpen(first.ownerId, 80, 24, signal)).rejects.toThrow('未关联')
    await expect(controller.terminalPoll(first.ownerId, opened.terminalId, 0, signal)).resolves.toMatchObject({ data: 'private terminal output' })
    await expect(controller.terminalWrite(first.ownerId, opened.terminalId, 'input', signal)).resolves.toEqual({ ok: true })
    await expect(controller.terminalWrite(second.ownerId, opened.terminalId, 'input', signal)).rejects.toThrow('不属于')
    await controller.terminalClose(first.ownerId, opened.terminalId, signal)
    expect(await controller.terminalList(first.ownerId)).toEqual([])
  })

  it('routes file reads to the requested association and never interprets a terminal owner as a task', async () => {
    const { controller, a, b, sent } = await fixture()
    await controller.setTaskServers('task', { expectedRevision: 0, serverIds: [a.id, b.id] })
    const signal = new AbortController().signal
    await controller.filesRead('task', b.id, 'package.json', signal)
    expect(sent.find(request => request.type === 'server-file-request')).toMatchObject({ request: { serverId: b.id, path: '/home/fixture/package.json' } })
    await expect(controller.filesRead('task', randomUUID(), 'package.json', signal)).rejects.toThrow('未关联')
  })

  it('forgets explicitly closed terminals after cleanup fails while preserving owner checks and other terminals', async () => {
    const { controller, bridge, a, b } = await fixture()
    await controller.setTaskServers('task', { expectedRevision: 0, serverIds: [a.id, b.id] })
    const signal = new AbortController().signal
    const first = await controller.terminalScope({ taskId: 'task', serverId: a.id, placement: 'side' }, signal)
    const second = await controller.terminalScope({ taskId: 'task', serverId: b.id, placement: 'side' }, signal)
    const dismissed = await controller.terminalOpen(first.ownerId, 80, 24, signal)
    const sibling = await controller.terminalOpen(first.ownerId, 80, 24, signal)
    const other = await controller.terminalOpen(second.ownerId, 80, 24, signal)
    const close = vi.spyOn(bridge, 'terminalClose').mockRejectedValueOnce(new Error('SSH connection lost'))

    await expect(controller.terminalClose(second.ownerId, dismissed.terminalId, signal)).rejects.toThrow('不属于')
    await expect(controller.terminalClose(first.ownerId, randomUUID(), signal)).rejects.toThrow('不属于')
    expect(close).not.toHaveBeenCalled()
    expect(await controller.terminalList(first.ownerId)).toEqual([dismissed.terminalId, sibling.terminalId])

    await expect(controller.terminalClose(first.ownerId, dismissed.terminalId, signal)).rejects.toThrow('SSH connection lost')
    expect(close).toHaveBeenCalledExactlyOnceWith(dismissed.terminalId, signal)
    expect(await controller.terminalList(first.ownerId)).toEqual([sibling.terminalId])
    expect(await controller.terminalList(second.ownerId)).toEqual([other.terminalId])
    await expect(controller.terminalWrite(first.ownerId, sibling.terminalId, 'still live', signal)).resolves.toEqual({ ok: true })
  })
})
