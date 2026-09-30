import type { LingRuntimeAdapter, LingTimelineItem } from './contract.js'

const pendingAttempts = new WeakMap<object, Map<string, string>>()

/** Resend a saved message independently of the composer, reusing failed admission attempts. */
export async function resendMessage(runtime: Pick<LingRuntimeAdapter, 'dispatch'>, item: LingTimelineItem): Promise<void> {
  let attempts = pendingAttempts.get(runtime)
  if (!attempts) { attempts = new Map(); pendingAttempts.set(runtime, attempts) }
  const key = `${item.taskId}:${item.itemId}`
  const requestId = attempts.get(key) ?? crypto.randomUUID()
  attempts.set(key, requestId)
  const result = await runtime.dispatch({ type: 'task.resend-message', requestId, taskId: item.taskId, itemId: item.itemId })
  if (!result.accepted) { if (!result.retryable) attempts.delete(key); throw new Error(result.message) }
  attempts.delete(key)
}
