export const monitorPreferencesStorageKey = 'ling.task-monitor.v1'

export interface MonitorPreferences {
  readonly presentation: 'fixed' | 'floating'
  readonly showByDefault: boolean
  readonly recap: boolean
  readonly goal: boolean
  readonly plan: boolean
  readonly subagents: boolean
  readonly processes: boolean
  readonly sideChats: boolean
  readonly skills: boolean
  readonly outputs: boolean
  readonly web: boolean
  readonly sources: boolean
  readonly quickNotes: boolean
  readonly memoryUpdates: boolean
  readonly demoScreen: boolean
}

export function effectiveMonitorPresentation(
  preferred: MonitorPreferences['presentation'],
  workbenchOpen: boolean,
  availableWidth = Infinity,
): MonitorPreferences['presentation'] {
  return workbenchOpen || availableWidth < 800 ? 'floating' : preferred
}

export const defaultMonitorPreferences: MonitorPreferences = {
  presentation: 'fixed',
  showByDefault: true,
  recap: true,
  goal: true,
  plan: true,
  subagents: true,
  processes: true,
  sideChats: true,
  skills: true,
  outputs: true,
  web: true,
  sources: true,
  quickNotes: true,
  memoryUpdates: true,
  demoScreen: true,
}

export function readMonitorPreferences(raw: string | null): MonitorPreferences {
  if (!raw) return defaultMonitorPreferences
  try {
    const saved: unknown = JSON.parse(raw)
    if (saved === null || typeof saved !== 'object') return defaultMonitorPreferences
    const record = saved as Record<string, unknown>
    const preferences = { ...defaultMonitorPreferences }
    if (record.presentation === 'fixed' || record.presentation === 'floating') Object.assign(preferences, { presentation: record.presentation })
    for (const key of Object.keys(defaultMonitorPreferences) as (keyof MonitorPreferences)[]) {
      if (key !== 'presentation' && typeof record[key] === 'boolean') {
        Object.assign(preferences, { [key]: record[key] })
      }
    }
    return preferences
  } catch {
    return defaultMonitorPreferences
  }
}
