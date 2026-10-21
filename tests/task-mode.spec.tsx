// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { LingGoalPhase, LingReadResult, LingTaskMode } from '../src/runtime/contract.js'
import { useTaskMode } from '../src/ui/use-task-mode.js'

let root: Root
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); root = createRoot(document.createElement('div')) })
afterEach(async () => { await act(async () => { root.unmount() }); vi.unstubAllGlobals() })
function deferred<Value>() {
  let resolve!: (value: Value) => void
  const promise = new Promise<Value>(finish => { resolve = finish })
  return { promise, resolve }
}
function mode(rounds: number, phase: LingGoalPhase = 'active', objective = '目标'): LingReadResult<LingTaskMode> {
  return { ok: true, value: { goal: { goalId: 'goal', revision: 1, objective, phase, roundsStarted: rounds, maxGoalRounds: 20 } } }
}

it('refreshes rounds, edited objectives and completion while task status stays running', async () => {
  let value = mode(0)
  const read = vi.fn(async () => value)
  let notify!: () => void
  const stop = vi.fn()
  const subscribe = vi.fn((_id: string, listener: () => void) => { notify = listener; return stop })
  let state!: ReturnType<typeof useTaskMode>
  function Harness() { state = useTaskMode('task', 'running', read, subscribe); return null }
  await act(async () => { root.render(<Harness />) })
  expect(read).toHaveBeenCalledOnce()
  expect(state.mode?.goal?.roundsStarted).toBe(0)
  await act(async () => { value = mode(1); notify() })
  expect(state.mode?.goal?.roundsStarted).toBe(1)
  await act(async () => { value = mode(1, 'active', '修改后的目标'); notify() })
  expect(state.mode?.goal?.objective).toBe('修改后的目标')
  await act(async () => {
    const active = mode(1)
    value = active.ok ? { ok: true, value: { goal: { ...active.value.goal!, activation: 'disarmed' } } } : active
    notify()
  })
  expect(state.mode?.goal?.activation).toBe('disarmed')
  await act(async () => { value = mode(1, 'complete'); notify() })
  expect(state.mode?.goal?.phase).toBe('complete')
  expect(read).toHaveBeenCalledTimes(5)
})

it('coalesces invalidations during each RPC and reads the final state without overlapping requests', async () => {
  const first = deferred<LingReadResult<LingTaskMode>>()
  const second = deferred<LingReadResult<LingTaskMode>>()
  const read = vi.fn<() => Promise<LingReadResult<LingTaskMode>>>()
    .mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise).mockResolvedValue(mode(2, 'complete'))
  let notify!: () => void
  const subscribe = (_id: string, listener: () => void) => { notify = listener; return () => {} }
  let state!: ReturnType<typeof useTaskMode>
  function Harness() { state = useTaskMode('task', 'running', read, subscribe); return null }
  await act(async () => { root.render(<Harness />) })
  await act(async () => { for (let count = 0; count < 10; count++) notify() })
  expect(read).toHaveBeenCalledOnce()
  await act(async () => { first.resolve(mode(0)) })
  expect(read).toHaveBeenCalledTimes(2)
  expect(state.mode).toBeUndefined()
  await act(async () => { notify(); notify(); notify() })
  expect(read).toHaveBeenCalledTimes(2)
  await act(async () => { second.resolve(mode(1)) })
  expect(read).toHaveBeenCalledTimes(3)
  expect(state.mode?.goal).toMatchObject({ roundsStarted: 2, phase: 'complete' })
})

it('ignores old task reads and notifications after switching or unmounting', async () => {
  const old = deferred<LingReadResult<LingTaskMode>>()
  const read = vi.fn((id: string) => id === 'old' ? old.promise : Promise.resolve(mode(2, 'complete', '当前任务')))
  const listeners = new Map<string, () => void>()
  const stops = new Map<string, ReturnType<typeof vi.fn>>()
  const subscribe = (id: string, listener: () => void) => {
    listeners.set(id, listener)
    const stop = vi.fn()
    stops.set(id, stop)
    return stop
  }
  let state!: ReturnType<typeof useTaskMode>
  function Harness({ id }: { id: string }) { state = useTaskMode(id, 'running', read, subscribe); return null }
  await act(async () => { root.render(<Harness id="old" />) })
  await act(async () => { root.render(<Harness id="new" />) })
  await act(async () => { listeners.get('old')!(); old.resolve(mode(9, 'active', '过期目标')) })
  expect(state.mode?.goal?.objective).toBe('当前任务')
  expect(read).toHaveBeenCalledTimes(2)
  expect(stops.get('old')).toHaveBeenCalledOnce()
  await act(async () => { root.unmount() })
  expect(stops.get('new')).toHaveBeenCalledOnce()
  await act(async () => { listeners.get('new')!() })
  expect(read).toHaveBeenCalledTimes(2)
})
