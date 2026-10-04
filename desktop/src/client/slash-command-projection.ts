import type {} from '@deepseek-ai/dsh-commands/remote'
import type { ClientRemote } from '@deepseek-ai/dsh-api-remotes/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { LingCommandRejectionReason, LingReadResult, LingSlashCommand } from 'ling-desktop/runtime'

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
  return rejected(reason, error.message?.trim() || '指令列表读取失败。', /transport|connection|timeout|unavailable/i.test(error.code))
}

export function createDshSlashCommandProjection(remote: ClientRemote) {
  return {
    async list(taskId: string): Promise<LingReadResult<readonly LingSlashCommand[]>> {
      try {
        const result = await remote.commands.list(taskId as SessionId)
        if (!result.ok) return remoteFailure(result.error)
        return {
          ok: true,
          value: result.value.map(descriptor => ({
            name: descriptor.name,
            description: descriptor.description,
            ...(descriptor.input === undefined ? {} : { hint: descriptor.input.hint }),
          })),
        }
      } catch {
        return rejected('runtime-unavailable', '指令列表暂时不可用。', true)
      }
    },
  }
}
