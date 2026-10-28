import { Context } from '@deepseek-ai/cordis'
import type { TypertGateway } from '@deepseek-ai/dsh-api-gateway'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { guardUpdateGateway, handleUpdateTaskRequest, UpdateAdmission, updateAdmission, updateWorkActive } from '../src/update-admission.ts'
import LingWebServer from '../src/webserver.ts'

afterEach(() => { updateAdmission.unlock(); vi.useRealTimers() })

describe('update request admission', () => {
  it('drains admitted requests and their nested calls while rejecting new work', async () => {
    const gate = new UpdateAdmission()
    const finish = Promise.withResolvers<void>()
    const events: string[] = []
    const work = gate.run(async () => {
      await finish.promise
      await gate.run(() => { events.push('nested') })
    })
    const locking = gate.lock().then(() => events.push('locked'))
    await expect(gate.run(() => events.push('unexpected'))).rejects.toThrow('正在准备更新')
    expect(events).toEqual([])
    finish.resolve()
    await Promise.all([work, locking])
    expect(events).toEqual(['nested', 'locked'])
    expect(gate.active).toBe(0)
    gate.unlock()
    await gate.run(() => events.push('resumed'))
    expect(events.at(-1)).toBe('resumed')
  })

  it('keeps admission closed after a drain timeout until explicitly unlocked', async () => {
    vi.useFakeTimers()
    const gate = new UpdateAdmission(), work = Promise.withResolvers<void>()
    const running = gate.run(() => work.promise)
    const locking = expect(gate.lock(20)).rejects.toThrow('仍有请求')
    await vi.advanceTimersByTimeAsync(20)
    await locking
    expect(gate.isLocked).toBe(true)
    gate.unlock()
    work.resolve()
    await running
  })

  it('cancels a pending lock when an installation request times out and unlocks', async () => {
    const gate = new UpdateAdmission(), work = Promise.withResolvers<void>()
    const running = gate.run(() => work.promise)
    const locking = expect(gate.lock()).rejects.toThrow('已取消')
    gate.unlock()
    await locking
    work.resolve()
    await running
    expect(gate.isLocked).toBe(false)
  })

  it('blocks new RPC and stream opens on an existing gateway while retaining passive subscriptions', async () => {
    const gate = new UpdateAdmission()
    const stop = Promise.withResolvers<void>()
    const invoke = vi.fn(async () => 'ok')
    const stream = vi.fn(async () => ({ async *[Symbol.asyncIterator]() { yield 'snapshot'; await stop.promise } }))
    const gateway = { invoke, stream } as unknown as TypertGateway
    const restore = guardUpdateGateway(gateway, gate)
    const source = await gateway.stream({ namespace: 'session', method: 'follow', args: {} })
    const iterator = source[Symbol.asyncIterator]()
    expect(await iterator.next()).toEqual({ value: 'snapshot', done: false })
    await gate.lock()
    await expect(gateway.invoke({ namespace: 'session', method: 'prompt', args: {} })).rejects.toThrow('正在准备更新')
    await expect(gateway.stream({ namespace: 'session', method: 'follow', args: {} })).rejects.toThrow('正在准备更新')
    expect(invoke).not.toHaveBeenCalled()
    expect(stream).toHaveBeenCalledTimes(1)
    stop.resolve()
    await iterator.return?.()
    restore()
    expect(gateway.invoke).toBe(invoke)
  })

  it('waits for stream initialization and conservatively drains unfamiliar streams to completion', async () => {
    const gate = new UpdateAdmission(), finish = Promise.withResolvers<void>()
    const source = await gate.openStream(async () => ({ async *[Symbol.asyncIterator]() { yield 1; await finish.promise; yield 2 } }), false)
    const iterator = source[Symbol.asyncIterator]()
    await iterator.next()
    let locked = false
    const locking = gate.lock().then(() => { locked = true })
    expect(locked).toBe(false)
    const pending = iterator.next()
    finish.resolve()
    await pending
    expect(locked).toBe(false)
    await iterator.next()
    await locking
    expect(locked).toBe(true)
  })

  it('reports running agents, queued input, jobs and scheduled runs as active', () => {
    const gate = new UpdateAdmission()
    const agent = { status: 'idle', inbox: { nextTurn: [] as unknown[], nextStep: [] as unknown[] } }
    const jobs: { status: string }[] = [], scheduled: unknown[] = []
    const ctx = { agents: { list: () => [agent] }, get: (name: string) => name === 'jobs' ? { list: () => jobs }
      : name === 'lingAutomation' ? { engine: { store: { active: () => scheduled } } } : undefined } as unknown as Context
    expect(updateWorkActive(ctx, gate)).toBe(false)
    agent.status = 'running'; expect(updateWorkActive(ctx, gate)).toBe(true); agent.status = 'idle'
    agent.inbox.nextStep.push({}); expect(updateWorkActive(ctx, gate)).toBe(true); agent.inbox.nextStep.length = 0
    jobs.push({ status: 'stopping' }); expect(updateWorkActive(ctx, gate)).toBe(true); jobs.length = 0
    scheduled.push({}); expect(updateWorkActive(ctx, gate)).toBe(true)
  })

  it('returns correlated IPC results and fails closed on inspection errors', async () => {
    const gate = new UpdateAdmission()
    expect(await handleUpdateTaskRequest({ type: 'update-tasks', requestId: 3, action: 'lock' }, () => false, gate))
      .toEqual({ type: 'update-tasks', requestId: 3, active: false })
    expect(gate.isLocked).toBe(true)
    expect(await handleUpdateTaskRequest({ type: 'update-tasks', requestId: 4, action: 'inspect' }, () => { throw new Error('private detail') }, gate))
      .toEqual({ type: 'update-tasks', requestId: 4, active: true, error: expect.not.stringContaining('private') })
    await handleUpdateTaskRequest({ type: 'update-tasks', requestId: 5, action: 'unlock' }, () => false, gate)
    expect(gate.isLocked).toBe(false)
  })

  it('returns HTTP 503 without dispatching new requests while locked', async () => {
    const ctx = new Context()
    try {
      await ctx.plugin(LingWebServer, { host: '127.0.0.1', port: 0 })
      const handler = vi.fn((_request, response) => { response.end('ok') })
      ctx.webServer.register({ kind: 'prefix', path: '/api', handler })
      const url = `http://127.0.0.1:${ctx.webServer.port}/api/test`
      expect(await (await fetch(url)).text()).toBe('ok')
      await updateAdmission.lock()
      expect((await fetch(url)).status).toBe(503)
      expect(handler).toHaveBeenCalledTimes(1)
      updateAdmission.unlock()
      expect(await (await fetch(url)).text()).toBe('ok')
    } finally { await ctx.fiber.dispose() }
  })
})
