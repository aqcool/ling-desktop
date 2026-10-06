import { useEffect, useState } from 'react'
import { updateAppearance, isPalette, type LingPalette } from '../theme.js'

export const behaviorKey = 'ling.behavior.v1'
const changedEvent = 'ling:behavior-changed'
export type WorkMode = 'coding' | 'general'
export interface ModePreferences {
  palette: LingPalette | 'inherit'
  locationControls: boolean
  environmentLabels: boolean
  monitorEnvironment: boolean
  localServices: boolean
  fileChanges: boolean
}
export interface BehaviorPreferences {
  artifactOpen: 'right' | 'system'
  promptSuggestions: boolean
  quickNotes: boolean
  replyAnnotations: boolean
  workspaceActions: boolean
  separateTaskLists: boolean
  terminalLinksInBrowser: boolean
  questionTimeout: number
  readingStart: boolean
  toolCounts: boolean
  expandTools: boolean
  collapseProcess: boolean
  elapsedFormat: 'seconds' | 'clock' | 'precise'
  thinkingLoader: 'matrix' | 'spinner' | 'dots' | 'none'
  thinkingPhrases: string[]
  goalRounds: number
  completionNotification: 'off' | 'background' | 'always'
  approvalNotification: boolean
  questionNotification: boolean
  tray: boolean
  workMode: WorkMode
  modes: Record<WorkMode, ModePreferences>
}
const coding: ModePreferences = { palette: 'inherit', locationControls: true, environmentLabels: true, monitorEnvironment: true, localServices: true, fileChanges: true }
export const defaultBehavior: BehaviorPreferences = {
  artifactOpen: 'right', promptSuggestions: false,
  quickNotes: true, replyAnnotations: false, workspaceActions: true, separateTaskLists: false, terminalLinksInBrowser: true,
  questionTimeout: 0, readingStart: false, toolCounts: true, expandTools: false, collapseProcess: false,
  elapsedFormat: 'seconds', thinkingLoader: 'matrix', thinkingPhrases: ['正在思考', '正在整理思路'], goalRounds: 20,
  completionNotification: 'background', approvalNotification: false, questionNotification: false, tray: false,
  workMode: 'coding', modes: { coding, general: { ...coding, locationControls: false, environmentLabels: false, monitorEnvironment: false, localServices: false, fileChanges: false } },
}
export function parseBehavior(raw: string | null): BehaviorPreferences {
  let value: Record<string, unknown> = {}
  try { const parsed: unknown = JSON.parse(raw ?? '{}'); if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) value = parsed as Record<string, unknown> } catch {}
  const result = { ...defaultBehavior, thinkingPhrases: [...defaultBehavior.thinkingPhrases], modes: { coding: { ...coding }, general: { ...defaultBehavior.modes.general } } }
  const enums = { artifactOpen: ['right', 'system'], elapsedFormat: ['seconds', 'clock', 'precise'], thinkingLoader: ['matrix', 'spinner', 'dots', 'none'], completionNotification: ['off', 'background', 'always'], workMode: ['coding', 'general'] }
  for (const [key, options] of Object.entries(enums)) if (options.includes(value[key] as string)) Object.assign(result, { [key]: value[key] })
  for (const key of ['promptSuggestions', 'quickNotes', 'replyAnnotations', 'workspaceActions', 'separateTaskLists', 'terminalLinksInBrowser', 'readingStart', 'toolCounts', 'expandTools', 'collapseProcess', 'approvalNotification', 'questionNotification', 'tray'] as const) if (typeof value[key] === 'boolean') result[key] = value[key]
  if ([0, 60, 120, 300].includes(value.questionTimeout as number)) result.questionTimeout = value.questionTimeout as number
  if (Number.isSafeInteger(value.goalRounds) && Number(value.goalRounds) >= 1 && Number(value.goalRounds) <= 256) result.goalRounds = Number(value.goalRounds)
  if (Array.isArray(value.thinkingPhrases)) {
    const phrases = value.thinkingPhrases.filter((item): item is string => typeof item === 'string').map(item => item.trim().slice(0, 60)).filter(Boolean).slice(0, 12)
    if (phrases.length) result.thinkingPhrases = phrases
  }
  if (value.modes && typeof value.modes === 'object') for (const mode of ['coding', 'general'] as const) {
    const saved = (value.modes as Record<string, unknown>)[mode]
    if (!saved || typeof saved !== 'object') continue
    const record = saved as Record<string, unknown>
    for (const key of ['locationControls', 'environmentLabels', 'monitorEnvironment', 'localServices', 'fileChanges'] as const) if (typeof record[key] === 'boolean') result.modes[mode][key] = record[key]
    if ((record.palette === 'inherit' || isPalette(record.palette))) result.modes[mode].palette = record.palette as ModePreferences['palette']
  }
  return result
}
export function readBehavior(): BehaviorPreferences {
  try { return parseBehavior(localStorage.getItem(behaviorKey)) } catch { return parseBehavior(null) }
}
export function updateBehavior(patch: Partial<BehaviorPreferences>): void {
  const current = readBehavior()
  const next = parseBehavior(JSON.stringify({ ...current, ...patch }))
  localStorage.setItem(behaviorKey, JSON.stringify(next))
  window.dispatchEvent(new Event(changedEvent))
  const palette = next.modes[next.workMode].palette
  if (palette !== 'inherit' && (current.workMode !== next.workMode || current.modes[current.workMode].palette !== palette)) updateAppearance({ palette })
}
export function useBehavior(): BehaviorPreferences {
  const [value, setValue] = useState(readBehavior)
  useEffect(() => {
    const refresh = () => setValue(readBehavior())
    const storage = (event: StorageEvent) => { if (event.key === behaviorKey || event.key === null) refresh() }
    window.addEventListener(changedEvent, refresh); window.addEventListener('storage', storage)
    return () => { window.removeEventListener(changedEvent, refresh); window.removeEventListener('storage', storage) }
  }, [])
  return value
}
export function formatElapsed(milliseconds: number, format: BehaviorPreferences['elapsedFormat']): string {
  const seconds = Math.max(0, milliseconds / 1000)
  if (format === 'clock') return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`
  return `${format === 'precise' ? seconds.toFixed(1) : Math.floor(seconds)} 秒`
}
