import type { SettingsNamespaceView, SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'
import type { ClientRemote } from '@deepseek-ai/dsh-api-remotes/client'
import type { LingCommandRejectionReason, LingLocalePreference, LingReadResult } from 'ling-desktop/runtime'

const LOCALE_NAMESPACE = 'locale'
const LOCALE_PREFERENCE_FIELD = 'preference'
const BUILT_IN_PREFERENCES = new Set(['zh', 'en'])

function rejected<Value>(
  reason: LingCommandRejectionReason,
  message: string,
  retryable = false,
): LingReadResult<Value> {
  return { ok: false, reason, message, retryable }
}

function remoteFailure<Value>(error: { readonly code: string; readonly message?: string }): LingReadResult<Value> {
  const reason = /conflict/i.test(error.code)
    ? 'settings-conflict'
    : /permission|denied|forbidden/i.test(error.code)
      ? 'permission-denied'
      : /invalid|bad-request|not-found|missing|rejected/i.test(error.code)
        ? 'invalid-command'
        : 'runtime-unavailable'
  return rejected(reason, error.message?.trim() || '操作未能完成。', /transport|connection|timeout|unavailable/i.test(error.code))
}

function preferenceOf(namespace: SettingsNamespaceView | undefined): 'zh' | 'en' | undefined {
  const value = namespace?.value
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const preference = (value as Record<string, unknown>)[LOCALE_PREFERENCE_FIELD]
  return typeof preference === 'string' && BUILT_IN_PREFERENCES.has(preference)
    ? preference as 'zh' | 'en'
    : undefined
}

export function createDshLocaleProjection(remote: ClientRemote) {
  return {
    async get(): Promise<LingReadResult<LingLocalePreference>> {
      try {
        const result = await remote.settings.describe()
        if (!result.ok) return remoteFailure(result.error)
        const namespace = result.value.namespaces.find(candidate => candidate.ns === LOCALE_NAMESPACE)
        const preference = preferenceOf(namespace)
        return { ok: true, value: preference === undefined ? {} : { preference } }
      } catch {
        return rejected('runtime-unavailable', '语言设置暂时不可用。', true)
      }
    },
    async set(preference: 'zh' | 'en' | undefined): Promise<LingReadResult<void>> {
      try {
        const result = await remote.settings.describe()
        if (!result.ok) return remoteFailure(result.error)
        if (!result.value.writable) return rejected('permission-denied', '当前设置不可写。')
        const namespace = result.value.namespaces.find(candidate => candidate.ns === LOCALE_NAMESPACE)
        if (namespace === undefined) return rejected('runtime-unavailable', '语言设置不可用。', true)
        const op: SettingsPathOpView = preference === undefined
          ? { op: 'unset', path: [LOCALE_PREFERENCE_FIELD] }
          : { op: 'set', path: [LOCALE_PREFERENCE_FIELD], value: preference }
        const saved = await remote.settings.mutate(namespace.ns, [op], namespace.revision)
        if (!saved.ok) return remoteFailure(saved.error)
        return { ok: true, value: undefined }
      } catch {
        return rejected('runtime-unavailable', '语言设置暂时不可用。', true)
      }
    },
  }
}
