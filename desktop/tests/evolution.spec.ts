import { Context } from '@deepseek-ai/cordis'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import TypertGatewayService from '@deepseek-ai/dsh-api-gateway'
import { FileSystemSkillProvider } from '@deepseek-ai/dsh-skill-filesystem'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LingEvolutionController, evolutionProjectRoot, parseEvolutionProposals } from '../src/host/evolution-controller.ts'
import { EvolutionStore } from '../src/evolution/store.ts'
import { createEvolutionProjection } from '../src/client/evolution-projection.ts'
import type { LingEvolutionRemote } from '../src/evolution-contract.ts'

const cleanups: (() => Promise<void> | void)[] = []
afterEach(async () => {
  vi.useRealTimers()
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
  vi.unstubAllEnvs()
})
const proposal = { name: 'validated-release', description: '用于原生发布签名排障与验证。', content: '## 使用时机\n原生发布签名失败时。\n\n## 步骤\n核对签名配置，重新构建，验证生成产物。', seqs: [4] }
async function fixture(watched = false) {
  const scratch = await realpath(await mkdtemp(join(tmpdir(), 'ling-evolution-')))
  cleanups.push(() => rm(scratch, { recursive: true, force: true }))
  const home = join(scratch, 'profile'), root = join(scratch, 'project'), cwd = join(root, 'nested')
  await mkdir(home); await mkdir(cwd, { recursive: true }); await mkdir(join(root, '.git'))
  vi.stubEnv('DSH_HOME', home)
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  const events = [
    { seq: 0, time: 1, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'inherited private text' }] } },
    { seq: 1, time: 2, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '修复签名发布并验证。' }] } },
    { seq: 2, time: 3, type: 'request/header', data: { header: { config: { provider: 'fixture-provider', model: 'fixture-model' } } } },
    { seq: 3, time: 4, type: 'tool/call', data: { turn: 1, step: 1, callId: 'c1', name: 'bash', arguments: '{"command":"verify-signature"}' } },
    { seq: 4, time: 5, type: 'tool/result', data: { turn: 1, step: 1, message: { role: 'user', source: { kind: 'tool' }, content: [{ type: 'tool-result', toolCallId: 'c1', content: [{ type: 'text', text: 'signature verified' }], isError: false }] } } },
    { seq: 5, time: 6, type: 'assistant/message', data: { turn: 1, message: { role: 'assistant', content: [{ type: 'text', text: '签名验证通过。' }] } } },
    { seq: 6, time: 7, type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
  ]
  const bindings = new Set<string>()
  const catalog: { name: string }[] = []
  const workspaces = [{ id: 'project', path: cwd, title: 'project', sessionIds: ['task'] }]
  const sessionCwd = { value: cwd }
  const config = { watch: watched, dshHome: home, agentsHome: join(home, 'agents'), watchStabilityThresholdMs: 25, watchPollIntervalMs: 10 }
  if (watched) await ctx.plugin(SkillRegistry)
  let provider!: FileSystemSkillProvider
  if (watched) ctx.skills.registerProvider(control => (provider = new FileSystemSkillProvider(ctx, control, config)))
  else provider = new FileSystemSkillProvider(ctx, { signal: new AbortController().signal, invalidate: () => {} }, config)
  cleanups.push(() => provider.dispose())
  const providerSkills = async () => { const result = await provider.list({ cwd }); return Array.isArray(result) ? result : [...result.candidates] }
  const stream = vi.fn(async function* (_options: unknown) {
    yield { type: 'text-delta', text: JSON.stringify([proposal]) }
    yield { type: 'finish', reason: { kind: 'stop' } }
  })
  ctx.provide('sessionQuery', { readSession: async (id: string) => ({ session: { id, cwd: sessionCwd.value }, inheritedEventCount: 1, events }) } as never)
  ctx.provide('workspaceRegistry', { list: () => workspaces } as never)
  ctx.provide('lingServers', { taskBinding: async (id: string) => bindings.has(id) ? { serverId: 'remote', cwd } : null } as never)
  const getSkill = vi.fn(async (name: string) => {
    const candidate = (await providerSkills()).find(skill => skill.name === name)
    return candidate ? provider.get(candidate, { cwd }) : undefined
  })
  const listSkills = vi.fn(async (_options: { signal?: AbortSignal; scope?: unknown }) => [...catalog, ...await providerSkills()])
  if (!watched) ctx.provide('skills', { list: listSkills, get: getSkill } as never)
  ctx.provide('llm', { stream } as never)
  await ctx.plugin(TypertRegistry); await ctx.plugin(TypertGatewayService)
  const controller = new LingEvolutionController(ctx)
  const invoke = (method: string, args: Record<string, unknown>) => ctx.typertGateway.invoke({ namespace: 'lingEvolution', method, args, signal: new AbortController().signal })
  return { controller, ctx, root, cwd, home, events, stream, catalog, bindings, invoke, workspaces, getSkill, sessionCwd, listSkills }
}

describe('saved self-evolution suggestions', () => {
  it('lists saved candidates without generating or writing a skill, then generates only from successful owned evidence', async () => {
    const { controller, stream, invoke, root } = await fixture()
    expect(await invoke('list', { taskId: 'task' })).toEqual([])
    expect(stream).not.toHaveBeenCalled()
    await controller.analyzeCompletedTurn('task', 6)
    const suggestions = await controller.list('task')
    expect(suggestions).toHaveLength(1)
    expect(suggestions[0]).toMatchObject({ name: proposal.name, description: proposal.description, version: 1, source: { taskId: 'task', throughSeq: 6, seqs: [4] } })
    expect(suggestions[0]).not.toHaveProperty('content')
    await expect(readFile(join(root, '.dsh', 'skills', proposal.name, 'SKILL.md'))).rejects.toMatchObject({ code: 'ENOENT' })
    const options = stream.mock.calls[0]![0] as { provider: string; model: string; maxTokens: number; messages: { content: { text: string }[] }[]; tools?: unknown }
    expect(options).toMatchObject({ provider: 'fixture-provider', model: 'fixture-model', maxTokens: 5000 })
    expect(options.tools).toBeUndefined()
    expect(options.messages[0]!.content[0]!.text).toContain('signature verified')
    expect(options.messages[0]!.content[0]!.text).not.toContain('inherited private text')
    await controller.analyzeCompletedTurn('task', 6)
    expect(stream).toHaveBeenCalledOnce()
  })
  it('creates through the gateway into the same project root discovered by the pinned skill provider', async () => {
    const { controller, invoke, root, cwd, home, ctx } = await fixture()
    await controller.analyzeCompletedTurn('task', 6)
    const suggestion = (await controller.list('task'))[0]!
    expect(await invoke('create', { request: { taskId: 'task', id: suggestion.id, version: suggestion.version } })).toEqual({ completed: true })
    expect(await controller.list('task')).toEqual([])
    const path = join(root, '.dsh', 'skills', proposal.name, 'SKILL.md')
    expect(await readFile(path, 'utf8')).toContain('throughSeq: 6')
    expect(await evolutionProjectRoot(cwd)).toBe(root)
    const provider = new FileSystemSkillProvider(ctx, { signal: new AbortController().signal, invalidate: () => {} }, { watch: false, dshHome: home, agentsHome: join(home, 'agents') })
    cleanups.push(() => provider.dispose())
    const found = await provider.list({ cwd })
    const skills = Array.isArray(found) ? found : found.candidates
    expect(skills.find(skill => skill.name === proposal.name)).toMatchObject({ source: 'project-dsh', path })
    const reopened = new EvolutionStore(join(home, 'ling-evolution.sqlite'))
    try { expect(reopened.read(suggestionScope(root), 'task', suggestion.id)?.status).toBe('created') }
    finally { reopened.close() }
  })
  it('persists ignored decisions across reopening and later reworded generations', async () => {
    const { controller, home, root, events, invoke } = await fixture()
    await controller.analyzeCompletedTurn('task', 6)
    const suggestion = (await controller.list('task'))[0]!
    expect(await invoke('ignore', { request: { taskId: 'task', id: suggestion.id, version: suggestion.version } })).toEqual({ completed: true })
    const reopened = new EvolutionStore(join(home, 'ling-evolution.sqlite'))
    try {
      reopened.publish(suggestionScope(root), 'task', 16, [{ ...proposal, description: 'different wording' }])
      expect(reopened.list(suggestionScope(root), 'task')).toEqual([])
      expect(reopened.read(suggestionScope(root), 'task', suggestion.id)?.status).toBe('ignored')
      reopened.publish(suggestionScope(root), 'other-task', 16, [proposal])
      expect(reopened.list(suggestionScope(root), 'other-task')).toEqual([])
    } finally { reopened.close() }
    expect(events).toHaveLength(7)
    await expect(readFile(join(root, '.dsh', 'skills', proposal.name, 'SKILL.md'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('creates unassigned local task skills in the active profile provider user directory', async () => {
    const { controller, workspaces, home, root, getSkill } = await fixture()
    workspaces.splice(0)
    await controller.analyzeCompletedTurn('task', 6)
    const suggestion = (await controller.list('task'))[0]!
    expect(await controller.create({ taskId: 'task', id: suggestion.id, version: suggestion.version })).toEqual({ completed: true })
    const path = join(home, 'skills', proposal.name, 'SKILL.md')
    expect(await readFile(path, 'utf8')).toContain(proposal.content)
    expect(await getSkill(proposal.name)).toMatchObject({ source: 'user-dsh', path })
    await expect(readFile(join(root, '.dsh', 'skills', proposal.name, 'SKILL.md'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('recognizes a workspace through the canonical cwd when a session uses a path alias', async () => {
    const { controller, workspaces, sessionCwd, cwd, root, home } = await fixture()
    const alias = join(root, 'cwd-alias')
    await symlink(cwd, alias, 'dir')
    sessionCwd.value = alias
    workspaces[0]!.sessionIds = [] // Exercise canonical path matching before live membership adoption.
    await controller.analyzeCompletedTurn('task', 6)
    const suggestion = (await controller.list('task'))[0]!
    sessionCwd.value = cwd
    expect(await controller.list('task')).toEqual([suggestion])
    await controller.create({ taskId: 'task', id: suggestion.id, version: suggestion.version })
    expect(await readFile(join(root, '.dsh', 'skills', proposal.name, 'SKILL.md'), 'utf8')).toContain(proposal.content)
    await expect(readFile(join(home, 'skills', proposal.name, 'SKILL.md'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('uses the task agent scope and cancellation signal for both extraction and publish catalog checks', async () => {
    const { controller, ctx, listSkills, stream } = await fixture()
    const agent = {}
    ctx.provide('agents', { get: () => agent } as never)
    listSkills.mockImplementation(async options => options.scope === agent ? [{ name: proposal.name }] : [])
    await controller.analyzeCompletedTurn('task', 6)
    expect(listSkills).toHaveBeenCalledTimes(2)
    for (const [options] of listSkills.mock.calls) {
      expect(options.scope).toBe(agent)
      expect(options.signal).toBeInstanceOf(AbortSignal)
    }
    expect((stream.mock.calls[0]![0] as { messages: { content: { text: string }[] }[] }).messages[0]!.content[0]!.text).toContain(`Existing names: ["${proposal.name}"]`)
    expect(await controller.list('task')).toEqual([])
  })
  it('cancels a create waiting on the provider catalog during Host disposal before writing a directory', async () => {
    const { controller, ctx, root, listSkills } = await fixture()
    await controller.analyzeCompletedTurn('task', 6)
    const suggestion = (await controller.list('task'))[0]!
    let waiting = false
    listSkills.mockImplementationOnce(options => new Promise((_, reject) => {
      expect(options.signal).toBeInstanceOf(AbortSignal)
      waiting = true
      options.signal!.addEventListener('abort', () => reject(options.signal!.reason), { once: true })
    }))
    const pending = controller.create({ taskId: 'task', id: suggestion.id, version: suggestion.version })
    const cancelled = expect(pending).rejects.toThrow()
    await vi.waitFor(() => expect(waiting).toBe(true))
    await ctx.fiber.dispose()
    await cancelled
    await expect(readFile(join(root, '.dsh', 'skills', proposal.name, 'SKILL.md'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('waits for the actual DSH registry and filesystem watcher to discover a newly created skill', async () => {
    const { controller, ctx, root, cwd } = await fixture(true)
    await controller.analyzeCompletedTurn('task', 6)
    const suggestion = (await controller.list('task'))[0]!
    await controller.create({ taskId: 'task', id: suggestion.id, version: suggestion.version })
    expect(await ctx.skills.get(proposal.name, { cwd })).toMatchObject({ path: join(root, '.dsh', 'skills', proposal.name, 'SKILL.md'), source: 'project-dsh' })
  })
  it('removes only its new file when the active provider cannot discover the configured directory', async () => {
    const { controller, root, getSkill } = await fixture()
    await controller.analyzeCompletedTurn('task', 6)
    const suggestion = (await controller.list('task'))[0]!
    getSkill.mockResolvedValue(undefined)
    await expect(controller.create({ taskId: 'task', id: suggestion.id, version: suggestion.version })).rejects.toThrow('未能发现新技能')
    await expect(readFile(join(root, '.dsh', 'skills', proposal.name, 'SKILL.md'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await controller.list('task')).toEqual([suggestion])
  })
  it('preserves candidates on model failure and rejects stale versions', async () => {
    const { controller, stream, events } = await fixture()
    await controller.analyzeCompletedTurn('task', 6)
    const suggestion = (await controller.list('task'))[0]!
    await expect(controller.ignore({ taskId: 'task', id: suggestion.id, version: 2 })).rejects.toThrow('建议已更新')
    events.push(...events.slice(1).map(event => ({ ...event, seq: event.seq + 10 })))
    stream.mockImplementationOnce(async function* () {
      yield { type: 'text-delta', text: 'invalid' }
      yield { type: 'finish', reason: { kind: 'stop' } }
    })
    await expect(controller.analyzeCompletedTurn('task', 16)).rejects.toThrow()
    expect(await controller.list('task')).toEqual([suggestion])
  })
  it('does not generate from failed turns, tool failures or remote bindings', async () => {
    const { controller, events, stream, bindings } = await fixture()
    events[6]!.data.reason = { kind: 'error' }
    await controller.analyzeCompletedTurn('task', 6)
    expect(stream).not.toHaveBeenCalled()
    events[6]!.data.reason = { kind: 'completed' }
    const block = events[4]!.data.message!.content[0]!
    if ('isError' in block) block.isError = true
    await controller.analyzeCompletedTurn('task', 6)
    expect(stream).not.toHaveBeenCalled()
    bindings.add('remote')
    await expect(controller.list('remote')).rejects.toThrow('远程服务器暂不支持')
    await expect(controller.analyzeCompletedTurn('remote', 6)).rejects.toThrow('远程服务器暂不支持')
    expect(stream).not.toHaveBeenCalled()
  })
  it('refuses existing catalog entries and same-name files without overwriting their contents', async () => {
    const { controller, catalog, root } = await fixture()
    await controller.analyzeCompletedTurn('task', 6)
    const suggestion = (await controller.list('task'))[0]!
    const request = { taskId: 'task', id: suggestion.id, version: suggestion.version }
    catalog.push({ name: proposal.name })
    await expect(controller.create(request)).rejects.toThrow('已有同名技能')
    catalog.splice(0)
    const directory = join(root, '.dsh', 'skills', proposal.name)
    await mkdir(directory, { recursive: true }); await writeFile(join(directory, 'SKILL.md'), 'original')
    await expect(controller.create(request)).rejects.toThrow('已有同名技能目录')
    expect(await readFile(join(directory, 'SKILL.md'), 'utf8')).toBe('original')
    expect(await controller.list('task')).toHaveLength(1)
  })
  it('rejects linked directories and traversal names before writing', async () => {
    const { controller, root, home } = await fixture()
    await controller.analyzeCompletedTurn('task', 6)
    const suggestion = (await controller.list('task'))[0]!
    await symlink(home, join(root, '.dsh'), 'dir')
    await expect(controller.create({ taskId: 'task', id: suggestion.id, version: suggestion.version })).rejects.toThrow('符号链接')
    expect(() => parseEvolutionProposals(JSON.stringify([{ ...proposal, name: '../outside' }]), new Set([4]), new Set([4]))).toThrow()
    expect(() => parseEvolutionProposals(JSON.stringify([{ ...proposal, seqs: [3] }]), new Set([3, 4]), new Set([4]))).toThrow('已成功执行')
    await expect(readFile(join(home, 'skills', proposal.name, 'SKILL.md'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('runs the completed-turn hook in the background and ignores non-completion events', async () => {
    const { controller, ctx, stream } = await fixture()
    vi.useFakeTimers()
    ctx.emit('session/event', { id: 'task' } as never, { seq: 5, type: 'assistant/message', data: {} } as never)
    await vi.advanceTimersByTimeAsync(1600)
    expect(stream).not.toHaveBeenCalled()
    ctx.emit('session/event', { id: 'task' } as never, { seq: 6, type: 'turn/end', data: { reason: { kind: 'completed' } } } as never)
    await vi.advanceTimersByTimeAsync(1600)
    vi.useRealTimers()
    await vi.waitFor(async () => expect(await controller.list('task')).toHaveLength(1))
    expect(stream).toHaveBeenCalledOnce()
  })
  it('keeps every completed turn in order when later turns finish while the first analysis is pending', async () => {
    const { controller, ctx, stream, events } = await fixture()
    const firstTurn = events.slice(1)
    events.push(...firstTurn.map(event => ({ ...event, seq: event.seq + 10 })), ...firstTurn.map(event => ({ ...event, seq: event.seq + 20 })))
    let releaseFirst!: () => void
    const held = new Promise<void>(resolveHeld => { releaseFirst = resolveHeld })
    let generation = 0
    stream.mockImplementation(async function* () {
      const ordinal = generation++
      if (ordinal === 0) await held
      yield { type: 'text-delta', text: JSON.stringify([{ ...proposal, name: `${proposal.name}-${ordinal}`, seqs: [4 + ordinal * 10] }]) }
      yield { type: 'finish', reason: { kind: 'stop' } }
    })
    vi.useFakeTimers()
    const complete = (seq: number) => ctx.emit('session/event', { id: 'task' } as never, { seq, type: 'turn/end', data: { reason: { kind: 'completed' } } } as never)
    complete(6)
    await vi.advanceTimersByTimeAsync(1600)
    await vi.waitFor(() => expect(stream).toHaveBeenCalledOnce())
    complete(16); complete(26); complete(16)
    expect(await controller.list('task')).toEqual([])
    releaseFirst()
    await vi.waitFor(async () => expect(await controller.list('task')).toHaveLength(1))
    await vi.advanceTimersByTimeAsync(1600)
    await vi.waitFor(async () => expect(await controller.list('task')).toHaveLength(2))
    await vi.advanceTimersByTimeAsync(1600)
    await vi.waitFor(async () => expect(await controller.list('task')).toHaveLength(3))
    vi.useRealTimers()
    expect(stream).toHaveBeenCalledTimes(3)
    const suggestions = await controller.list('task')
    expect(suggestions.map(suggestion => suggestion.source.throughSeq).sort((left, right) => left - right)).toEqual([6, 16, 26])
    expect(suggestions.map(suggestion => suggestion.name).sort()).toEqual([0, 1, 2].map(ordinal => `${proposal.name}-${ordinal}`))
  })
})

const suggestionScope = (root: string) => createHash('sha256').update(root).digest('hex')

describe('self-evolution client errors', () => {
  it('keeps unavailable and conflict reasons clear, and forwards mutation versions', async () => {
    const remote = {
      list: vi.fn(async () => ({ ok: false, error: { code: 'evolution/unavailable', message: '远程服务器暂不支持自进化技能建议。' } })),
      create: vi.fn(async () => ({ ok: false, error: { code: 'evolution/conflict', message: '已有同名技能，无法覆盖。' } })),
      ignore: vi.fn(async () => ({ ok: true, value: { completed: true } })),
    } as unknown as LingEvolutionRemote
    const service = createEvolutionProjection(() => remote, Promise.resolve())
    expect(await service.list('remote')).toMatchObject({ ok: false, reason: 'runtime-unavailable', retryable: false })
    expect(await service.create('task', 'proposal', 3)).toMatchObject({ ok: false, reason: 'document-conflict' })
    expect(remote.create).toHaveBeenCalledWith({ taskId: 'task', id: 'proposal', version: 3 })
    expect(await service.ignore('task', 'proposal', 3)).toEqual({ ok: true, value: undefined })
    const signal = new AbortController(); signal.abort()
    expect(await service.list('task', signal.signal)).toMatchObject({ ok: false })
    expect(remote.list).toHaveBeenCalledOnce()
  })
})
