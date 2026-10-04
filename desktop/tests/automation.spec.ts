import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { newAutomation } from '../../src/ui/automation-view.ts'
import { nextOccurrence, wallTime } from '../src/automation/calendar.ts'
import { AutomationStore } from '../src/automation/store.ts'
import { AutomationEngine, type AutomationPorts } from '../src/automation/engine.ts'
import { automationRequestSchema } from '../src/automation-contract.ts'
import type { AutomationRun } from 'ling-desktop/runtime'
const cleanup: (() => void)[] = []
afterEach(() => {
  for (const fn of cleanup.splice(0).reverse()) fn()
})
const spec = () => ({
  ...newAutomation('Asia/Shanghai'),
  name: '检查',
  prompt: '检查项目',
  schedule: { kind: 'interval' as const, minutes: 5 },
})
function fixture(now = 1_000_000, ports: Partial<AutomationPorts> = {}) {
  const store = new AutomationStore(':memory:')
  cleanup.push(() => store.close())
  let clock = now
  const dispatch = vi.fn(async () => {}),
    inspect = vi.fn(async () => ({ status: 'running' as const })),
    cancel = vi.fn(async () => {})
  const engine = new AutomationEngine(store, { dispatch, inspect, cancel, ...ports }, () => clock)
  return {
    store,
    engine,
    dispatch,
    inspect,
    cancel,
    time: (at: number) => {
      clock = at
    },
  }
}
describe('calendar schedules', () => {
  it('uses wall time and selected weekdays instead of drifting by 24-hour intervals', () => {
    const s = { kind: 'weekly' as const, time: '09:00', timeZone: 'Asia/Shanghai', weekdays: [1, 5] }
    expect(new Date(nextOccurrence(s, Date.parse('2026-10-01T02:00:00Z'), 0)!).toISOString()).toBe(
      '2026-10-02T01:00:00.000Z',
    )
    const daily = { kind: 'daily' as const, time: '09:00', timeZone: 'America/New_York', weekdays: [] }
    expect(new Date(nextOccurrence(daily, Date.parse('2026-03-07T15:00:00Z'), 0)!).toISOString()).toBe(
      '2026-03-08T13:00:00.000Z',
    )
  })
  it('skips nonexistent times and dispatches an overlap only once', () => {
    expect(wallTime([2026, 3, 8], '02:30', 'America/New_York')).toBeNull()
    expect(new Date(wallTime([2026, 11, 1], '01:30', 'America/New_York')!).toISOString()).toBe(
      '2026-11-01T05:30:00.000Z',
    )
    expect(
      new Date(
        nextOccurrence(
          { kind: 'daily', time: '01:30', timeZone: 'America/New_York', weekdays: [] },
          Date.parse('2026-11-01T05:31:00Z'),
          0,
        )!,
      ).toISOString(),
    ).toBe('2026-11-02T06:30:00.000Z')
    expect(new Date(wallTime([2026, 4, 5], '01:45', 'Australia/Lord_Howe')!).toISOString()).toBe(
      '2026-04-04T14:45:00.000Z',
    )
  })
  it('honors interval anchors, one-off dates, expiry and input bounds', () => {
    expect(nextOccurrence({ kind: 'interval', minutes: 5 }, 601000, 1000)).toBe(901000)
    expect(nextOccurrence({ kind: 'once', at: 2000 }, 2000, 0)).toBeNull()
    expect(nextOccurrence({ kind: 'interval', minutes: 5 }, 0, 0, 200000)).toBeNull()
    expect(
      automationRequestSchema.safeParse({
        type: 'save',
        spec: { ...spec(), schedule: { kind: 'interval', minutes: 1 } },
      }).success,
    ).toBe(false)
    expect(
      automationRequestSchema.safeParse({
        type: 'save',
        spec: { ...spec(), schedule: { kind: 'weekly', time: '25:00', timeZone: 'bad', weekdays: [] } },
      }).success,
    ).toBe(false)
  })
})
describe('persistent local execution lifecycle', () => {
  it('does not create tasks on save and claims a trigger only once across repeated ticks', async () => {
    const f = fixture(),
      plan = f.engine.save(spec())
    expect(f.dispatch).not.toHaveBeenCalled()
    f.time(plan.nextAt!)
    await Promise.all([f.engine.tick(), f.engine.tick()])
    await f.engine.tick()
    expect(f.dispatch).toHaveBeenCalledTimes(1)
    expect(f.store.runs()).toHaveLength(1)
    expect(f.store.active()[0]).toMatchObject({ status: 'running', spec: { name: '检查' } })
  })
  it('freezes old execution specs, refuses stale edits, and keeps history after deletion', async () => {
    const f = fixture(),
      plan = f.engine.save(spec()),
      run = await f.engine.run(plan.id)
    const edited = f.engine.save({ ...spec(), prompt: '新的任务' }, plan.id, plan.version)
    expect(f.store.run(run.id)?.spec.prompt).toBe('检查项目')
    expect(() => f.engine.save(spec(), plan.id, plan.version)).toThrow('计划已变化')
    f.store.toggle(plan.id, edited.version, false, 2_000_000, true)
    expect(f.store.snapshot().plans).toHaveLength(0)
    expect(f.store.run(run.id)).toBeDefined()
    await expect(f.engine.run(plan.id)).rejects.toThrow('不存在')
  })
  it('prevents overlap, lets pause preserve an active run and records skipped occurrences', async () => {
    const f = fixture(),
      plan = f.engine.save(spec())
    await f.engine.run(plan.id)
    f.time(plan.nextAt!)
    await f.engine.tick()
    expect(f.dispatch).toHaveBeenCalledTimes(1)
    expect(f.store.runs().some((r) => r.status === 'skipped')).toBe(true)
    f.store.toggle(plan.id, 1, false, plan.nextAt!)
    f.time(plan.nextAt! + 300000)
    await f.engine.tick()
    expect(f.dispatch).toHaveBeenCalledTimes(1)
    expect(f.store.active()).toHaveLength(1)
    await expect(f.engine.run(plan.id)).rejects.toThrow('未结束')
  })
  it('starts interval schedules from the last edit or resume without shifting phase on the following tick', async () => {
    const f = fixture(),
      plan = f.engine.save(spec())
    f.time(1_100_000)
    const edited = f.engine.save(spec(), plan.id, 1)
    expect(edited.nextAt).toBe(1_400_000)
    f.time(edited.nextAt!)
    await f.engine.tick()
    expect(f.store.plan(plan.id)?.nextAt).toBe(1_700_000)
    f.store.toggle(plan.id, 2, false, 1_500_000)
    const resumed = f.store.toggle(plan.id, 3, true, 1_510_000)
    expect(resumed.nextAt).toBe(1_810_000)
  })
  it('skips a downtime backlog by default, or dispatches only its latest occurrence', async () => {
    const f = fixture(),
      skip = f.engine.save(spec()),
      latest = f.engine.save({ ...spec(), missed: 'latest' })
    f.time(2_500_000)
    await f.engine.tick()
    expect(f.dispatch).toHaveBeenCalledTimes(1)
    expect(f.store.runs()[0]).toMatchObject({ planId: latest.id, scheduledAt: 2500000 })
    expect(f.store.plan(skip.id)?.nextAt).toBe(2_800_000)
  })
  it('never blindly retries transport uncertainty and distinguishes approval from completion', async () => {
    let state: AutomationRun['status'] = 'waiting-approval'
    const inspect = vi.fn(async () => ({ status: state, summary: state === 'completed' ? '检查完成' : '' })),
      dispatch = vi.fn(async () => {
        throw new Error('transport')
      })
    const f = fixture(1_000_000, { inspect, dispatch }),
      plan = f.engine.save(spec()),
      run = await f.engine.run(plan.id)
    expect(run.status).toBe('waiting-approval')
    await f.engine.tick()
    expect(dispatch).toHaveBeenCalledTimes(1)
    state = 'completed'
    await f.engine.tick()
    expect(f.store.run(run.id)).toMatchObject({ status: 'completed', summary: '检查完成' })
    await f.engine.tick()
    expect(dispatch).toHaveBeenCalledTimes(1)
  })
  it('reuses stable admission ids after restart and does not repeat completed work', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'ling-automation-'))
    cleanup.push(() => rmSync(folder, { recursive: true, force: true }))
    let store = new AutomationStore(join(folder, 'auto.sqlite')),
      plan = store.save(spec(), 1_000_000)
    const claimed = store.claim(plan, plan.nextAt!, plan.nextAt!, `${plan.id}:${plan.nextAt}`)!
    store.close()
    store = new AutomationStore(join(folder, 'auto.sqlite'))
    cleanup.push(() => store.close())
    const dispatch = vi.fn(async (run: AutomationRun) => {
      store.putRun({ ...run, status: 'running' })
    })
    let state: { status: AutomationRun['status'] } | null = null
    const engine = new AutomationEngine(
      store,
      { dispatch, inspect: async () => state, cancel: async () => {} },
      () => plan.nextAt!,
    )
    await engine.tick()
    expect(dispatch.mock.calls[0]?.[0]).toMatchObject({
      id: claimed.id,
      requestId: claimed.requestId,
      taskId: claimed.taskId,
    })
    state = { status: 'completed' }
    await engine.tick()
    await engine.tick()
    expect(dispatch).toHaveBeenCalledTimes(1)
  })
  it('creates a fresh execution record on retry, and gives reuse plans their own stable task', async () => {
    const f = fixture(1_000_000, { inspect: async () => ({ status: 'failed' }) }),
      plan = f.engine.save({ ...spec(), output: 'reuse' })
    const first = await f.engine.run(plan.id)
    await f.engine.tick()
    const second = await f.engine.run(plan.id, first.id)
    expect(second.id).not.toBe(first.id)
    expect(second.taskId).toBe(first.taskId)
    expect(second.requestId).not.toBe(first.requestId)
    expect(second.retryOf).toBe(first.id)
  })
})
