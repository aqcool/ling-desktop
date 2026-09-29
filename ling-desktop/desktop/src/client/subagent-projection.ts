import type { ClientRemote } from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-subagent/remote'
import type { SubagentPromptRequestId } from '@deepseek-ai/dsh-subagent/client'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { LingCommandRejectionReason, LingReadResult } from 'ling-desktop/runtime'

function rejected<Value>(
  reason: LingCommandRejectionReason,
  message: string,
  retryable = false,
): LingReadResult<Value> {
  return { ok: false, reason, message, retryable }
}

function remoteFailure<Value>(
  error: { readonly code: string; readonly message?: string },
  fallback: string,
): LingReadResult<Value> {
  const reason = /permission|denied|forbidden|unauthorized/i.test(error.code)
    ? 'permission-denied'
    : /not-found|missing/i.test(error.code)
      ? 'task-not-found'
      : /invalid|bad-request|validation|conflict|stale|not-resumable|parent-unavailable|delivery-unavailable/i.test(error.code)
        ? 'invalid-command'
        : 'runtime-unavailable'
  return rejected(reason, error.message?.trim() || fallback, /transport|connection|timeout|unavailable/i.test(error.code))
}

function clientTimeZone(): string | undefined {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined
}

export function createDshSubagentProjection(remote: ClientRemote) {
  return {
    async prompt(parentTaskId: string, subagentSessionId: string, text: string): Promise<LingReadResult<void>> {
      const value = text.trim()
      if (!value) return rejected('invalid-command', '请输入要追加的指令。')
      try {
        const zone = clientTimeZone()
        const result = await remote.subagents.prompt({
          requestId: crypto.randomUUID() as SubagentPromptRequestId,
          parentSessionId: brandString<SessionId>(parentTaskId),
          childSessionId: brandString<SessionId>(subagentSessionId),
          mode: 'continuable',
          delivery: 'queue',
          content: [{ type: 'text', text: value }],
          ...(zone === undefined ? {} : { clientTimeZone: zone }),
        })
        if (!result.ok) return remoteFailure(result.error, '追加指令发送失败。')
        return { ok: true, value: undefined }
      } catch {
        return rejected('runtime-unavailable', '追加指令暂时无法发送。', true)
      }
    },
    async interrupt(parentTaskId: string, subagentSessionId: string): Promise<LingReadResult<void>> {
      try {
        const result = await remote.subagents.interruptByParent(
          brandString<SessionId>(subagentSessionId),
          brandString<SessionId>(parentTaskId),
          'continuable',
        )
        if (!result.ok) return remoteFailure(result.error, '中断子任务失败。')
        return { ok: true, value: undefined }
      } catch {
        return rejected('runtime-unavailable', '中断子任务暂时不可用。', true)
      }
    },
  }
}
