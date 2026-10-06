import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { scheduleIdleQuestion } from '../src/ui/InteractionPanel.js'
import { BehaviorSettings } from '../src/ui/BehaviorSettings.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LingTaskSummary, LingTimelineItem, LingPendingInteraction } from '../src/runtime/contract.js'
import { parseBehavior, formatElapsed, updateBehavior, behaviorKey } from '../src/ui/behavior-preferences.js'
import { notificationEvents } from '../src/ui/behavior-notifications.js'
import { displayTimeline } from '../src/ui/Conversation.js'
import { goalObjective } from '../src/runtime/dsh-adapter.js'

afterEach(() => vi.unstubAllGlobals())
describe('behavior preferences', () => {
  it('validates stored settings and keeps independent mode defaults', () => {
    expect(parseBehavior('{')).toEqual(parseBehavior(null))
    const settings = parseBehavior(JSON.stringify({ goalRounds: -1, sendMode: 'bad', questionTimeout: 1, toolCounts: 'false', modes: { general: { fileChanges: true, palette: 'unknown' } }, thinkingPhrases: ['  ', 3, ' 思考中 '] }))
    expect(settings).toMatchObject({ goalRounds: 20, questionTimeout: 0, toolCounts: true, thinkingPhrases: ['思考中'] })
    expect(settings.modes.general).toMatchObject({ fileChanges: true, locationControls: false, palette: 'inherit' })
    expect(settings.modes.coding.locationControls).toBe(true)
    settings.modes.coding.fileChanges = false
    expect(parseBehavior(null).modes.coding.fileChanges).toBe(true)
  })
  it('persists a partial update without losing other settings and announces it', () => {
    const data = new Map([[behaviorKey, JSON.stringify({ goalRounds: 50 })]])
    vi.stubGlobal('localStorage', { getItem: (key: string) => data.get(key), setItem: (key: string, value: string) => data.set(key, value) })
    const target = new EventTarget(); const changed = vi.fn()
    target.addEventListener('ling:behavior-changed', changed); vi.stubGlobal('window', target)
    updateBehavior({ goalRounds: 40 })
    expect(parseBehavior(data.get(behaviorKey)!)).toMatchObject({ goalRounds: 40 })
    expect(changed).toHaveBeenCalledOnce()
  })
  it('formats long durations and clamps negative elapsed time', () => {
    expect(formatElapsed(61_234, 'clock')).toBe('01:01')
    expect(formatElapsed(61_234, 'precise')).toBe('61.2 秒')
    expect(formatElapsed(-100, 'seconds')).toBe('0 秒')
  })
})
describe('notification transitions', () => {
  const task: LingTaskSummary = { taskId: 'task', title: 'Build', status: 'running', archived: false, updatedAt: 'before' }
  const question: LingPendingInteraction = { interactionId: 'q', taskId: 'task', kind: 'question', questions: [] }
  it('only notifies observed completion and failure, not loaded history or cancellations', () => {
    const settings = parseBehavior(null)
    const done = { ...task, status: 'completed' as const, updatedAt: 'after' }
    expect(notificationEvents([], [done], new Set(), [], settings)).toEqual([])
    expect(notificationEvents([done], [done], new Set(), [], settings)).toEqual([])
    expect(notificationEvents([task], [{ ...done, status: 'cancelled' }], new Set(), [], settings)).toEqual([])
    expect(notificationEvents([task], [done], new Set(), [], settings)[0]).toMatchObject({ key: 'turn:task:after', backgroundOnly: true })
    settings.completionNotification = 'off'
    expect(notificationEvents([task], [done], new Set(), [], settings)).toEqual([])
  })
  it('honors individual interaction preferences and suppresses already observed requests', () => {
    const settings = parseBehavior(JSON.stringify({ questionNotification: true }))
    const approval: LingPendingInteraction = { interactionId: 'a', taskId: 'task', kind: 'approval', toolName: 'bash' }
    expect(notificationEvents([task], [task], new Set(), [question, approval], settings).map(event => event.key)).toEqual(['interaction:q'])
    expect(notificationEvents([task], [task], new Set(['q']), [question, approval], settings)).toEqual([])
  })
})
describe('completed response folding', () => {
  const base: LingTimelineItem = { taskId: 'task', itemId: 'user', kind: 'user-message', text: 'Fix', status: 'completed', createdAt: '2026-09-27T00:00:00Z' }
  const timeline: LingTimelineItem[] = [base, { ...base, itemId: 'analysis', kind: 'assistant-message', text: 'Working' }, { ...base, itemId: 'tool', kind: 'tool-activity' }, { ...base, itemId: 'final', kind: 'assistant-message', text: 'Done' }]
  it('folds intermediate messages after completion while preserving the final answer', () => {
    const groups = displayTimeline(timeline, false, true)
    expect(groups.map(group => [group.process, group.items.map(item => item.itemId)])).toEqual([[false, ['user']], [true, ['analysis', 'tool']], [false, ['final']]])
    expect(displayTimeline(timeline, true, true).find(group => group.items[0]?.itemId === 'analysis')?.process).toBe(false)
  })
  it('does not hide failures inside a collapsed process', () => {
    expect(displayTimeline([{ ...base, itemId: 'error', kind: 'tool-activity', status: 'failed' }], false, true)[0]?.process).toBe(false)
  })
})
it('distinguishes goal creation from control commands', () => {
  expect(goalObjective('/goal pause')).toBeUndefined()
  expect(goalObjective('/goal edit new objective')).toBeUndefined()
  expect(goalObjective('/goal pause background jobs')).toBe('pause background jobs')
  expect(goalObjective('/goal 修复\n全部问题')).toBe('修复\n全部问题')
  expect(goalObjective('/plan goal')).toBeUndefined()
})

it('renders accessible interactive switches rather than visual-only controls', () => {
  const markup = renderToStaticMarkup(createElement(BehaviorSettings, { section: 'general', supportsGoalLimit: true }))
  expect(markup).toContain('role="switch"')
  expect(markup).toContain('aria-label="显示工具调用次数"')
})

it('skips only after uninterrupted idle time and cancels when a question is edited or unmounted', () => {
  vi.useFakeTimers()
  try {
    const events = new EventTarget(); const skip = vi.fn()
    const dispose = scheduleIdleQuestion(events, 60_000, skip)
    vi.advanceTimersByTime(59_000); events.dispatchEvent(new Event('keydown'))
    vi.advanceTimersByTime(59_000); expect(skip).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1000); expect(skip).toHaveBeenCalledOnce()
    events.dispatchEvent(new Event('pointerdown')); vi.advanceTimersByTime(60_000)
    expect(skip).toHaveBeenCalledOnce()
    dispose()
    const cancel = scheduleIdleQuestion(events, 60_000, skip)
    cancel(); vi.advanceTimersByTime(60_000)
    expect(skip).toHaveBeenCalledOnce()
  } finally { vi.useRealTimers() }
})
