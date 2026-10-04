import type { ClientRemote } from '@deepseek-ai/dsh-api-remotes/client'
import type { ISessions, SessionBinding } from '@deepseek-ai/dsh-api-session-controller/client'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  LingCommandRejectionReason,
  LingModelSelection,
  LingReadResult,
} from 'ling-desktop/runtime'

interface TaskModelSnapshot {
  getSnapshot(): LingModelSelection | undefined
  subscribe(listener: () => void): () => void
}

function rejected<Value>(
  reason: LingCommandRejectionReason,
  message: string,
  retryable = false,
): LingReadResult<Value> {
  return { ok: false, reason, message, retryable }
}

function remoteFailure<Value>(error: { readonly code: string; readonly message?: string }): LingReadResult<Value> {
  const reason = /permission|denied|forbidden/i.test(error.code)
    ? 'permission-denied'
    : /not-found|missing/i.test(error.code)
      ? 'task-not-found'
      : /invalid|bad-request|validation/i.test(error.code)
        ? 'invalid-command'
        : 'runtime-unavailable'
  return rejected(reason, error.message?.trim() || '操作未能完成。', /transport|connection|timeout|unavailable/i.test(error.code))
}

function selectionFrom(value: unknown): LingModelSelection | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Record<string, unknown>
  if (typeof record.provider !== 'string' || typeof record.model !== 'string') return undefined
  return {
    provider: record.provider,
    model: record.model,
    ...(typeof record.reasoningEffort === 'string' ? { reasoningEffort: record.reasoningEffort } : {}),
  }
}

function projectedSelection(value: unknown): LingModelSelection | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Record<string, unknown>
  return selectionFrom(record.next) ?? selectionFrom(record.lastUsed)
}

export function createDshTaskModelProjection(remote: ClientRemote, sessions: ISessions, validateSelection?: (selection: LingModelSelection) => Promise<LingReadResult<void>>) {
  return {
    canSelect(taskId: string): boolean {
      return sessions.subagentAddress(brandString<SessionId>(taskId)) === undefined
    },
    async select(taskId: string, selection: LingModelSelection): Promise<LingReadResult<void>> {
      if (validateSelection) {
        const valid = await validateSelection(selection)
        if (!valid.ok) return valid
      }
      const result = await remote.session.selectModel({
        sessionId: brandString<SessionId>(taskId),
        provider: selection.provider,
        model: selection.model,
        ...(selection.reasoningEffort === undefined ? {} : { reasoningEffort: selection.reasoningEffort }),
      })
      return result.ok ? { ok: true, value: undefined } : remoteFailure(result.error)
    },
    watch(binding: SessionBinding): TaskModelSnapshot {
      const face = binding.session.projections.faceOf('modelSelection')
      return {
        getSnapshot: () => projectedSelection(face.getSnapshot()),
        subscribe: listener => face.subscribe(listener),
      }
    },
  }
}
