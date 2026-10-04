import type { SessionBinding } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ClientRemote } from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-permission-presets/remote'
import type { LingCommandRejectionReason, LingPermissionOption, LingReadResult } from 'ling-desktop/runtime'

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
  return rejected(reason, error.message?.trim() || '权限预设读取失败。', /transport|connection|timeout|unavailable/i.test(error.code))
}

export function createDshPermissionProjection(remote: ClientRemote) {
  return {
    async catalog(): Promise<LingReadResult<readonly LingPermissionOption[]>> {
      try {
        const result = await remote.permissionPresets.catalog()
        if (!result.ok) return remoteFailure(result.error)
        return {
          ok: true,
          value: result.value.options.map(option => ({
            value: option.value,
            label: option.name,
            ...(option.description === undefined ? {} : { description: option.description }),
          })),
        }
      } catch {
        return rejected('runtime-unavailable', '权限预设暂时不可用。', true)
      }
    },
    current(binding: SessionBinding): string | undefined {
      try {
        const selection = binding.session.projections.faceOf('permissions').getSnapshot() as { currentValue?: unknown } | undefined
        return typeof selection?.currentValue === 'string' ? selection.currentValue : undefined
      } catch {
        return undefined
      }
    },
  }
}
