import * as cordis from '@deepseek-ai/cordis'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import TypertGatewayService from '@deepseek-ai/dsh-api-gateway'
import { LING_AUTOMATION_REMOTE, type LingAutomationRemote } from '../src/automation-contract.ts'
import { ApiSessionNotFound } from '@deepseek-ai/dsh-api-session-controller'
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LingAutomationController } from '../src/host/automation-controller.ts'
import { newAutomation } from '../../src/ui/automation-view.ts'
const cleanup: (() => void | Promise<void>)[] = []
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn()
  vi.unstubAllEnvs()
})
async function fixture(gateway = false) {
  const home = await mkdtemp(join(tmpdir(), 'ling-auto-controller-'))
  cleanup.push(() => rm(home, { recursive: true, force: true }))
  vi.stubEnv('DSH_HOME', home)
  const ctx = new Context(),
    tasks = new Map<string, any>()
  const create = vi.fn(async ({ sessionId, cwd }: { sessionId: string; cwd?: string }) => {
    const events: any[] = [],
      append = (type: string, data: any) => events.push({ type, data, seq: events.length, time: Date.now() })
    tasks.set(sessionId, {
      meta: { id: sessionId, cwd },
      events,
      status: 'idle',
      session: { append },
      inbox: { nextTurn: [], nextStep: [] },
      cancel: vi.fn(() => {
        tasks.get(sessionId).maintenanceAbort?.abort()
        tasks.get(sessionId).inbox.nextTurn = []
        tasks.get(sessionId).inbox.nextStep = []
      }),
      whenIdle: async () => {
        await tasks.get(sessionId).maintenance
      },
      runMaintenance: async (fn: (signal: AbortSignal) => Promise<void>) => {
        const task = tasks.get(sessionId)
        task.maintenanceAbort = new AbortController()
        const work = fn(task.maintenanceAbort.signal)
        task.maintenance = work.catch(() => {})
        return work
      },
    })
  })
  const prompt = vi.fn(async (r: any) => {
    const task = tasks.get(r.sessionId)
    task.session.append('turn/start', { turn: 0 })
    task.session.append('user/message', { source: { kind: 'user', rpcId: r.requestId }, content: r.content })
    task.status = 'running'
  })
  const stream = vi.fn(async function* () {
    yield {
      type: 'text-delta',
      text: JSON.stringify({
        name: '草稿',
        prompt: '检查代码',
        schedule: { kind: 'daily', time: '09:00', timeZone: 'Asia/Shanghai', weekdays: [] },
        expiresAt: null,
      }),
    }
    yield { type: 'finish', reason: { kind: 'stop' } }
  })
  if (gateway) {
    await ctx.plugin(TypertRegistry)
    await ctx.plugin(TypertGatewayService)
  } else ctx.provide('typert', { register: () => () => {} } as never)
  ctx.provide('agents', { get: (id: string) => tasks.get(id) } as never)
  ctx.provide('workspaceRegistry', {
    get: (id: string) => (id === 'workspace' ? { id, path: '/project' } : undefined),
  } as never)
  ctx.provide('agentDefaultModel', {
    currentSelection: () => ({ provider: 'provider', model: 'model' }),
  } as never)
  ctx.provide('llm', { stream } as never)
  ctx.provide('sessionController', {
    create,
    prompt,
    inspect: async (id: string) => {
      const t = tasks.get(id)
      if (!t) throw new ApiSessionNotFound('session not found')
      return { meta: t.meta, events: t.events }
    },
    resolveAgent: async (id: string) =>
      tasks.has(id) ? { agent: tasks.get(id) } : { error: new Error('not found') },
    selectModel: vi.fn(async () => {}),
    rename: vi.fn(async () => {}),
  } as never)
  const controller = new LingAutomationController(ctx)
  cleanup.push(async () => {
    controller.engine.close()
    await ctx.fiber.dispose()
    controller.engine.store.close()
  })
  const spec = {
    ...newAutomation('Asia/Shanghai'),
    name: '日报',
    prompt: '查看近期变更',
    workspaceId: 'workspace',
  }
  return { controller, ctx, tasks, create, prompt, stream, spec }
}
describe('automation uses the public DSH session boundary', () => {
  it('round trips plans through the published browser Remote and Host Gateway without creating tasks', async () => {
    const { ctx: host, spec, create } = await fixture(true),
      client = new Context()
    cleanup.push(async () => {
      await client.fiber.dispose()
    })
    await client.plugin(TypertRegistry)
    client.provide('connection', {
      rpc: {
        call: async (
          _base: string,
          endpoint: string,
          payload: { args: Record<string, unknown> },
          signal: AbortSignal,
        ) => {
          const [namespace, method] = endpoint.split('/')
          return {
            ok: true,
            value: await host.typertGateway.invoke({
              namespace: namespace!,
              method: method!,
              args: payload.args,
              signal,
            }),
          }
        },
      },
      registerGenerationSource: () => () => {},
      start: () => ({ stop() {} }),
    } as never)
    const source = await readFile(
      createRequire(import.meta.url).resolve('@deepseek-ai/dsh-api-gateway/client'),
      'utf8',
    )
    let browser: { apply(ctx: Context): void; inject: string[] } | undefined
    new Function('window', source)({
      __ModuleLoader__: {
        load: ({ factory }: { factory(require: (id: string) => unknown): unknown }) => {
          browser = factory(() => cordis) as typeof browser
        },
      },
    })
    await client.plugin(browser!)
    await client.remote.$mount(LING_AUTOMATION_REMOTE)
    const remote = client.get('remote.lingAutomation') as unknown as LingAutomationRemote
    const saved = await remote.request({ type: 'save', spec })
    expect(saved).toMatchObject({ ok: true, value: { plan: { name: '日报', version: 1 } } })
    const snapshot = await remote.request({ type: 'snapshot' })
    expect(snapshot).toMatchObject({
      ok: true,
      value: { snapshot: { plans: [{ name: '日报' }], runs: [], keepAwake: false } },
    })
    expect(create).not.toHaveBeenCalled()
    const invalid = await remote.request({
      type: 'save',
      spec: { ...spec, schedule: { kind: 'interval', minutes: 1 } },
    })
    expect(invalid.ok).toBe(false)
  })

  it('saves without a conversation, then applies real sandbox/approval events before prompting', async () => {
    const f = await fixture(),
      saved = await f.controller.request({ type: 'save', spec: f.spec })
    expect(f.create).not.toHaveBeenCalled()
    expect(f.prompt).not.toHaveBeenCalled()
    const result = await f.controller.request({ type: 'run', id: saved.plan!.id }),
      run = result.run!,
      task = f.tasks.get(run.taskId)
    expect(f.create).toHaveBeenCalledWith({ sessionId: run.taskId, cwd: '/project' })
    expect(task.events.slice(0, 2)).toMatchObject([
      { type: 'sandbox/mode', data: { mode: 'read-only' } },
      { type: 'approval/policy', data: { policy: 'ask' } },
    ])
    expect(f.prompt).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: run.taskId, requestId: run.requestId, mode: 'queue' }),
      expect.any(AbortSignal),
    )
    await f.controller.engine.tick()
    expect(f.controller.engine.store.run(run.id)?.status).toBe('running')
    task.session.append('approval/asked', { id: 'approval' })
    await f.controller.engine.tick()
    expect(f.controller.engine.store.run(run.id)?.status).toBe('waiting-approval')
    task.session.append('approval/decided', { id: 'approval' })
    task.session.append('turn/end', {
      turn: 0,
      reason: { kind: 'error', error: { message: 'fetch failed' } },
    })
    await f.controller.engine.tick()
    expect(f.controller.engine.store.run(run.id)).toMatchObject({ status: 'failed', summary: 'fetch failed' })
  })
  it('binds completion to this execution request and turn, not an earlier turn', async () => {
    const f = await fixture(),
      plan = (await f.controller.request({ type: 'save', spec: f.spec })).plan!,
      run = (await f.controller.request({ type: 'run', id: plan.id })).run!,
      task = f.tasks.get(run.taskId)
    task.events.unshift({ type: 'turn/end', seq: -1, data: { turn: -1, reason: { kind: 'completed' } } })
    await f.controller.engine.tick()
    expect(f.controller.engine.store.run(run.id)?.status).toBe('running')
    task.session.append('turn/end', { turn: 0, reason: { kind: 'completed' } })
    await f.controller.engine.tick()
    expect(f.controller.engine.store.run(run.id)?.status).toBe('completed')
  })
  it('cancels queued work without preserving the inbox', async () => {
    const f = await fixture(),
      plan = (await f.controller.request({ type: 'save', spec: f.spec })).plan!,
      run = (await f.controller.request({ type: 'run', id: plan.id })).run!,
      task = f.tasks.get(run.taskId)
    task.inbox.nextTurn = [{ source: { kind: 'user', rpcId: run.requestId } }]
    await f.controller.request({ type: 'cancel', runId: run.id })
    expect(task.cancel).toHaveBeenCalledWith({ kind: 'user' }, { keepInbox: false })
    expect(task.inbox.nextTurn).toHaveLength(0)
    expect(f.controller.engine.store.run(run.id)?.status).toBe('cancelled')
  })
  it('cancels during model preparation before input can wake the Agent', async () => {
    const f = await fixture(),
      plan = (await f.controller.request({ type: 'save', spec: f.spec })).plan!
    let release!: () => void, started!: () => void
    const ready = new Promise<void>((resolve) => {
        started = resolve
      }),
      hold = new Promise<void>((resolve) => {
        release = resolve
      })
    vi.mocked(f.ctx.sessionController.selectModel).mockImplementationOnce(async () => {
      started()
      await hold
      return {} as never
    })
    const work = f.controller.request({ type: 'run', id: plan.id })
    await ready
    const run = f.controller.engine.store.active()[0]!
    const cancel = f.controller.request({ type: 'cancel', runId: run.id })
    release()
    await Promise.all([work, cancel])
    expect(f.prompt).not.toHaveBeenCalled()
    expect(f.controller.engine.store.run(run.id)?.status).toBe('cancelled')
  })
  it('generates only an editable draft, ignores model-suggested permission escalation, and rejects invalid scope', async () => {
    const f = await fixture(),
      result = await f.controller.request({
        type: 'draft',
        text: '每天检查代码',
        model: { provider: 'provider', model: 'model' },
        timeZone: 'Asia/Shanghai',
      })
    expect(result.draft).toMatchObject({ name: '草稿', permission: 'read-only', workspaceId: null })
    expect(f.controller.engine.store.plans()).toHaveLength(0)
    expect(f.create).not.toHaveBeenCalled()
    await expect(
      f.controller.request({ type: 'save', spec: { ...f.spec, workspaceId: 'missing' } }),
    ).rejects.toThrow('不存在')
  })
})
