import type { ClientRemote } from '@deepseek-ai/dsh-api-remotes/client'
import type { LingCommandRejectionReason, LingReadResult } from 'ling-desktop/runtime'

interface DesktopDirectoryPicker {
  pick(): Promise<string | null>
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
  return rejected(reason, error.message?.trim() || '选择目录未能完成。', /transport|connection|timeout|unavailable/i.test(error.code))
}

function normalizePath(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

export function createDshDirectoryPicker(remote: ClientRemote) {
  return {
    async pick(): Promise<LingReadResult<string | undefined>> {
      const desktop = (globalThis as { __DSH_DIRECTORY_PICKER__?: DesktopDirectoryPicker }).__DSH_DIRECTORY_PICKER__
      if (desktop !== undefined) {
        try {
          return { ok: true, value: normalizePath(await desktop.pick()) }
        } catch {
          return rejected('runtime-unavailable', '无法打开目录选择。', true)
        }
      }
      try {
        const result = await remote.directoryPicker.pick()
        return result.ok
          ? { ok: true, value: normalizePath(result.value) }
          : remoteFailure(result.error)
      } catch {
        return rejected('runtime-unavailable', '目录选择暂时不可用。', true)
      }
    },
  }
}
