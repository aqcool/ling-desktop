import { useEffect, useRef } from 'react'
import type { LingPendingInteraction, LingTaskSummary } from '../runtime/contract.js'
import type { BehaviorPreferences } from './behavior-preferences.js'
import { nativeBehavior } from './BehaviorSettings.js'

export function notificationEvents(previous: readonly LingTaskSummary[], tasks: readonly LingTaskSummary[], seen: ReadonlySet<string>, interactions: readonly LingPendingInteraction[], settings: BehaviorPreferences) {
  const prior = new Map(previous.map(task => [task.taskId, task]))
  const completed = settings.completionNotification === 'off' ? [] : tasks.filter(task => {
    const old = prior.get(task.taskId)
    return old && ['running', 'queued', 'waiting-for-input'].includes(old.status) && ['completed', 'failed'].includes(task.status)
  }).map(task => ({ key: `turn:${task.taskId}:${task.updatedAt}`, title: task.status === 'failed' ? '任务失败' : '本轮已完成', body: task.title, taskId: task.taskId, backgroundOnly: settings.completionNotification === 'background' }))
  return [...completed, ...interactions.filter(item => !seen.has(item.interactionId) && (item.kind === 'approval' ? settings.approvalNotification : settings.questionNotification)).map(item => ({
    key: `interaction:${item.interactionId}`, title: item.kind === 'approval' ? '等待工具审批' : item.kind === 'plan-review' ? '等待计划审阅' : '等待你的回答',
    body: tasks.find(task => task.taskId === item.taskId)?.title ?? '灵创', taskId: item.taskId, backgroundOnly: false,
  }))]
}
export function useBehaviorNotifications(tasks: readonly LingTaskSummary[], interactions: readonly LingPendingInteraction[], settings: BehaviorPreferences, onFailure: (message: string) => void) {
  const previous = useRef<readonly LingTaskSummary[] | undefined>(undefined)
  const seen = useRef(new Set<string>())
  const notify = nativeBehavior()?.notify
  useEffect(() => {
    const events = previous.current ? notificationEvents(previous.current, tasks, seen.current, interactions, settings) : []
    previous.current = tasks
    seen.current = new Set(interactions.map(item => item.interactionId))
    if (notify) for (const event of events) void notify(event).catch(() => onFailure('系统通知未送达，请检查系统通知权限。'))
  }, [tasks, interactions, settings, notify, onFailure])
}
