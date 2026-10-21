import { describe, expect, it, vi } from 'vitest'
import type { ClientRemote } from '@deepseek-ai/dsh-api-remotes/client'
import type { SessionBinding } from '@deepseek-ai/dsh-api-session-controller/client'
import { createDshModeProjection } from '../src/client/mode-projection.js'

describe('goal creation projection', () => {
  it('preserves the objective and requested round limit in the official API', async () => {
    const create = vi.fn(async () => ({ ok: true, value: {} }))
    const projection = createDshModeProjection({ goals: { create } } as unknown as ClientRemote)
    await expect(projection.createGoal('session', '修复所有错误', 10)).resolves.toEqual({ ok: true, value: undefined })
    expect(create).toHaveBeenCalledExactlyOnceWith('session', { objective: '修复所有错误', maxGoalRounds: 10 })
  })
  it('propagates authorization failures and transport errors without claiming success', async () => {
    const create = vi.fn().mockResolvedValueOnce({ ok: false, error: { code: 'permission-denied', message: '禁止创建目标' } }).mockRejectedValueOnce(new Error('offline'))
    const projection = createDshModeProjection({ goals: { create } } as unknown as ClientRemote)
    await expect(projection.createGoal('session', 'Fix', 5)).resolves.toMatchObject({ ok: false, reason: 'permission-denied', message: '禁止创建目标', retryable: false })
    await expect(projection.createGoal('session', 'Fix', 5)).resolves.toMatchObject({ ok: false, reason: 'runtime-unavailable', retryable: true })
  })
  it('preserves live goal counters, phase and activation returned by the get API', async () => {
    const get = vi.fn(async () => ({ ok: true, value: {
      id: 'goal', revision: 2, objective: '继续已有目标', phase: 'active', activation: 'disarmed',
      roundsStarted: 3, maxGoalRounds: 256, createdAt: 1, updatedAt: 2,
    } }))
    const projection = createDshModeProjection({ goals: { get } } as unknown as ClientRemote)
    await expect(projection.goal('session')).resolves.toEqual({ ok: true, value: {
      goalId: 'goal', revision: 2, objective: '继续已有目标', phase: 'active', activation: 'disarmed',
      roundsStarted: 3, maxGoalRounds: 256,
    } })
    expect(get).toHaveBeenCalledExactlyOnceWith('session')
  })
  it('invalidates on goal and plan projection changes and releases both subscriptions', () => {
    const goalListeners = new Set<() => void>()
    const planListeners = new Set<() => void>()
    const face = (listeners: Set<() => void>) => ({ subscribe(listener: () => void) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    } })
    const faces = { goal: face(goalListeners), plan: face(planListeners) }
    const binding = { session: { projections: { faceOf: (key: keyof typeof faces) => faces[key] } } } as unknown as SessionBinding
    const listener = vi.fn()
    const stop = createDshModeProjection({ $on: () => () => {} } as unknown as ClientRemote).subscribe(binding, listener)
    for (const notify of goalListeners) notify()
    for (const notify of planListeners) notify()
    expect(listener).toHaveBeenCalledTimes(2)
    stop()
    expect(goalListeners.size).toBe(0)
    expect(planListeners.size).toBe(0)
  })
  it('keeps the available mode subscription when the other optional projection is missing', () => {
    const stopPlan = vi.fn()
    const subscribe = vi.fn(() => stopPlan)
    const binding = { session: { projections: { faceOf(key: string) {
      if (key === 'goal') throw new Error('missing optional projection')
      return { subscribe }
    } } } } as unknown as SessionBinding
    const listener = vi.fn()
    const stop = createDshModeProjection({ $on: () => () => {} } as unknown as ClientRemote).subscribe(binding, listener)
    expect(subscribe).toHaveBeenCalledExactlyOnceWith(listener)
    stop()
    expect(stopPlan).toHaveBeenCalledOnce()
  })
  it('invalidates activation changes for the owning session and releases the remote event listener', () => {
    let notify: ((event: { sessionId: string }) => void) | undefined
    const stopEvent = vi.fn(() => { notify = undefined })
    const on = vi.fn((_event: string, listener: (event: { sessionId: string }) => void) => { notify = listener; return stopEvent })
    const binding = { sessionId: 'session', session: { projections: { faceOf: () => ({ subscribe: () => () => {} }) } } } as unknown as SessionBinding
    const listener = vi.fn()
    const stop = createDshModeProjection({ $on: on } as unknown as ClientRemote).subscribe(binding, listener)
    expect(on).toHaveBeenCalledExactlyOnceWith('goal/activation-changed', expect.any(Function))
    notify?.({ sessionId: 'another-session' })
    expect(listener).not.toHaveBeenCalled()
    notify?.({ sessionId: 'session' })
    expect(listener).toHaveBeenCalledOnce()
    stop()
    expect(stopEvent).toHaveBeenCalledOnce()
    expect(notify).toBeUndefined()
  })
})
