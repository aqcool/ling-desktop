import type { SessionBinding } from '@deepseek-ai/dsh-api-session-controller/client'
import type { LingTaskSchedule } from 'ling-desktop/runtime'

function projectSchedule(value: unknown): LingTaskSchedule | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Record<string, unknown>
  const kind = record.kind
  if (kind !== 'after' && kind !== 'at' && kind !== 'every') return undefined
  if (typeof record.id !== 'string' || typeof record.prompt !== 'string' || typeof record.scheduledAt !== 'string') {
    return undefined
  }
  return {
    scheduleId: record.id,
    kind,
    prompt: record.prompt,
    scheduledAt: record.scheduledAt,
    ...(typeof record.afterSeconds === 'number' ? { afterSeconds: record.afterSeconds } : {}),
    ...(typeof record.everySeconds === 'number' ? { everySeconds: record.everySeconds } : {}),
  }
}

export function createDshScheduleProjection() {
  return {
    list(binding: SessionBinding): readonly LingTaskSchedule[] | undefined {
      try {
        const value = binding.session.projections.faceOf('schedule').getSnapshot() as unknown
        if (!Array.isArray(value)) return undefined
        return value.flatMap(item => {
          const schedule = projectSchedule(item)
          return schedule === undefined ? [] : [schedule]
        })
      } catch {
        return undefined
      }
    },
  }
}
