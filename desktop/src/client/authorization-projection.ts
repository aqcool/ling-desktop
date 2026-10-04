import type { ClientRemote } from '@deepseek-ai/dsh-api-remotes/client'
import type { SettingsNamespaceView, SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'
import type {
  LingAuthorizationInteraction,
  LingAuthorizationStatus,
  LingCommandRejectionReason,
  LingReadResult,
} from 'ling-desktop/runtime'
import type { LingAuthorizationEntryView, LingAuthorizationRemote } from '../authorization-contract.ts'

const PROVIDER_NAMESPACE = 'llm-pi-ai'

function rejected<Value>(
  reason: LingCommandRejectionReason,
  message: string,
  retryable = false,
): LingReadResult<Value> {
  return { ok: false, reason, message, retryable }
}

function remoteFailure<Value>(error: { readonly code: string; readonly message?: string }): LingReadResult<Value> {
  return rejected(
    /permission|denied|forbidden/i.test(error.code) ? 'permission-denied' : 'runtime-unavailable',
    error.message?.trim() || '登录操作未能完成。',
    /transport|connection|timeout|unavailable|internal/i.test(error.code),
  )
}

function recordOf(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

async function enableOAuthProvider(remote: ClientRemote, providerId: string): Promise<LingReadResult<void>> {
  const settings = await remote.settings.describe()
  if (!settings.ok) return remoteFailure(settings.error)
  if (!settings.value.writable) return rejected('permission-denied', '当前设置不可写，无法启用 Codex 模型。')
  const namespace = settings.value.namespaces.find(candidate => candidate.ns === PROVIDER_NAMESPACE)
  if (namespace === undefined) return rejected('runtime-unavailable', '模型提供商设置不可用。', true)
  const providers = recordOf(namespace.value)?.providers
  const profile = recordOf(recordOf(providers)?.[providerId])
  const path = ['providers', providerId]
  const operations: SettingsPathOpView[] = profile === undefined
    ? [{ op: 'set', path, value: {} }]
    : typeof profile.apiKeyEnv === 'string'
      ? [{ op: 'unset', path: [...path, 'apiKeyEnv'] }]
      : []
  if (operations.length === 0) return { ok: true, value: undefined }
  const saved = await remote.settings.mutate(namespace.ns, operations, namespace.revision)
  if (!saved.ok) return remoteFailure(saved.error)
  return { ok: true, value: undefined }
}

export function createDshAuthorizationProjection(
  remote: ClientRemote,
  ready: Promise<unknown>,
  resolveAuthorization: () => LingAuthorizationRemote | undefined,
) {
  const waitUntilReady = async (): Promise<void> => { await ready }
  const authorizationRemote = (): LingAuthorizationRemote => {
    const service = resolveAuthorization()
    if (service === undefined) throw new Error('登录服务尚未挂载。')
    return service
  }

  return {
    async list(): Promise<LingReadResult<readonly LingAuthorizationEntryView[]>> {
      try {
        await waitUntilReady()
        const response = await authorizationRemote().list()
        return response.ok
          ? {
              ok: true,
              value: response.value.filter(entry => (
                entry.providerId === 'openai-codex'
                && entry.methods.some(method => method.id === 'oauth')
              )),
            }
          : remoteFailure(response.error)
      } catch {
        return rejected('runtime-unavailable', '登录服务暂时不可用。', true)
      }
    },

    async authorize(
      providerId: string,
      interaction: LingAuthorizationInteraction,
      signal: AbortSignal,
    ): Promise<LingReadResult<LingAuthorizationStatus>> {
      await waitUntilReady()
      const authorization = authorizationRemote()
      const directory = await authorization.list()
      if (!directory.ok) return remoteFailure(directory.error)
      const entry = directory.value.find(candidate => candidate.providerId === providerId)
      if (entry === undefined) return rejected('invalid-command', '该提供商没有可用的登录方式。')
      const method = entry.methods.find(candidate => candidate.id === 'oauth')?.id ?? entry.methods[0]?.id ?? ''
      const started = await authorization.start(entry.key, method)
      if (!started.ok) return remoteFailure(started.error)
      const { attemptId } = started.value
      const promptControllers = new Map<string, AbortController>()
      let sequence = 0
      const cancel = (): void => {
        for (const controller of promptControllers.values()) controller.abort()
        promptControllers.clear()
        void authorization.cancel(attemptId)
      }
      signal.addEventListener('abort', cancel, { once: true })
      try {
        while (!signal.aborted) {
          const response = await authorization.poll(attemptId, sequence, signal)
          if (!response.ok) {
            if (signal.aborted || response.error.code === 'gateway/cancelled') return { ok: true, value: 'cancelled' }
            return remoteFailure(response.error)
          }
          for (const frame of response.value.events) {
            sequence = Math.max(sequence, frame.seq)
            if (frame.type === 'notice') {
              interaction.notify({
                message: frame.message,
                ...(frame.url === undefined ? {} : { url: frame.url }),
                ...(frame.code === undefined ? {} : { code: frame.code }),
              })
              continue
            }
            if (frame.type === 'prompt') {
              const controller = new AbortController()
              promptControllers.set(frame.promptId, controller)
              void interaction.prompt({ ...frame.prompt, signal: controller.signal }).then(async value => {
                if (controller.signal.aborted || signal.aborted) return
                const answer = await authorization.answer(attemptId, frame.promptId, value)
                if (!answer.ok) interaction.notify({ message: answer.error.message ?? '登录问题已经失效。' })
              }, () => {
                if (!controller.signal.aborted && !signal.aborted) cancel()
              }).finally(() => { promptControllers.delete(frame.promptId) })
              continue
            }
            if (frame.type === 'prompt-dismissed') {
              promptControllers.get(frame.promptId)?.abort()
              promptControllers.delete(frame.promptId)
              continue
            }
            if (frame.type === 'failed') return rejected('runtime-unavailable', frame.message)
            if (frame.type === 'settled') {
              if (frame.status === 'authorized') {
                const enabled = await enableOAuthProvider(remote, providerId)
                if (!enabled.ok) return enabled
              }
              return { ok: true, value: frame.status }
            }
          }
          if (response.value.done) break
        }
        return { ok: true, value: 'cancelled' }
      } finally {
        signal.removeEventListener('abort', cancel)
        for (const controller of promptControllers.values()) controller.abort()
      }
    },

    async signOut(providerId: string): Promise<LingReadResult<void>> {
      try {
        await waitUntilReady()
        const authorization = authorizationRemote()
        const directory = await authorization.list()
        if (!directory.ok) return remoteFailure(directory.error)
        const entry = directory.value.find(candidate => candidate.providerId === providerId)
        if (entry === undefined) return rejected('invalid-command', '该提供商没有可退出的登录。')
        const response = await authorization.signOut(entry.key)
        return response.ok ? { ok: true, value: undefined } : remoteFailure(response.error)
      } catch {
        return rejected('runtime-unavailable', '无法退出当前登录。', true)
      }
    },
  }
}
