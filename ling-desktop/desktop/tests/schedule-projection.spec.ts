import { describe, expect, it } from 'vitest'
import { createDshScheduleProjection } from '../src/client/schedule-projection.ts'

type Projection = ReturnType<typeof createDshScheduleProjection>
type Binding = Parameters<Projection['list']>[0]

function fakeBinding(value: unknown): Binding {
  return {
    session: { projections: { faceOf: () => ({ getSnapshot: () => value }) } },
  } as unknown as Binding
}

function brokenBinding(): Binding {
  return {
    session: {
      projections: {
        faceOf: () => {
          throw new Error('missing face')
        },
      },
    },
  } as unknown as Binding
}

describe('schedule projection', () => {
  it('projects active reminders from the session schedule projection', () => {
    const projection = createDshScheduleProjection()
    const schedules = projection.list(fakeBinding([
      { id: 'sch-1', kind: 'after', prompt: 'check in', afterSeconds: 60, scheduledAt: '2026-09-22T15:00:00.000Z' },
      { id: 'sch-2', kind: 'at', prompt: 'demo', scheduledAt: '2026-09-22T15:30:00.000Z' },
      { id: 'sch-3', kind: 'every', prompt: 'status', everySeconds: 600, scheduledAt: '2026-09-22T16:00:00.000Z' },
    ]))
    expect(schedules).toEqual([
      {
        scheduleId: 'sch-1',
        kind: 'after',
        prompt: 'check in',
        scheduledAt: '2026-09-22T15:00:00.000Z',
        afterSeconds: 60,
      },
      { scheduleId: 'sch-2', kind: 'at', prompt: 'demo', scheduledAt: '2026-09-22T15:30:00.000Z' },
      {
        scheduleId: 'sch-3',
        kind: 'every',
        prompt: 'status',
        scheduledAt: '2026-09-22T16:00:00.000Z',
        everySeconds: 600,
      },
    ])
  })

  it('skips malformed records', () => {
    const projection = createDshScheduleProjection()
    const schedules = projection.list(fakeBinding([
      { id: 'sch-1', kind: 'at', prompt: 'demo', scheduledAt: '2026-09-22T15:00:00.000Z' },
      { id: 7, kind: 'at', prompt: 'broken', scheduledAt: '2026-09-22T15:00:00.000Z' },
      { id: 'sch-3', kind: 'cron', prompt: 'unknown kind', scheduledAt: '2026-09-22T15:00:00.000Z' },
      null,
    ]))
    expect(schedules).toEqual([
      { scheduleId: 'sch-1', kind: 'at', prompt: 'demo', scheduledAt: '2026-09-22T15:00:00.000Z' },
    ])
  })

  it('returns undefined when the schedule projection is absent', () => {
    const projection = createDshScheduleProjection()
    expect(projection.list(fakeBinding(undefined))).toBeUndefined()
    expect(projection.list(fakeBinding({ active: [] }))).toBeUndefined()
    expect(projection.list(brokenBinding())).toBeUndefined()
  })
})
