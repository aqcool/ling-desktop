import type { Context } from '@deepseek-ai/cordis'
import { parseCredentialKey, type CredentialRecord } from '@deepseek-ai/dsh-credentials'
import { createModels, type Credential, type CredentialStore, type OAuthCredential, type Provider } from '@earendil-works/pi-ai'
import { record, string } from '../model-catalog.ts'

const KEY = parseCredentialKey('llm-pi-ai/openai-codex')
function credential(value: CredentialRecord | undefined): OAuthCredential | undefined {
  const payload = value?.kind === 'grant' ? record(value.payload) : undefined
  return payload?.type === 'oauth' && string(payload.access) && string(payload.refresh) && typeof payload.expires === 'number' && Number.isFinite(payload.expires)
    ? payload as unknown as OAuthCredential : undefined
}

/** Resolve through Pi's locked refresh path over the existing DSH credential store. */
export async function codexCatalogAuth(ctx: Context, provider: Provider, signal: AbortSignal, refresh: boolean) {
  const stored = credential(await ctx.credentials.readRecord(KEY))
  if (!stored) return undefined
  let access = stored.access
  if (refresh) {
    // Catalog reads and inference share the same DSH record lock, so rotating a
    // token cannot overwrite another request's refresh or a concurrent logout.
    const store: CredentialStore = {
      read: async () => credential(await ctx.credentials.readRecord(KEY)),
      list: async () => [],
      modify: async (_id, mutate) => credential(await ctx.credentials.modifyRecord(KEY, async current => {
        const next: Credential | undefined = await mutate(credential(current))
        if (!next) return undefined
        if (next.type !== 'oauth') throw new Error('Codex 登录凭证类型已变更。')
        return { kind: 'grant', payload: JSON.parse(JSON.stringify(next)) as unknown }
      })),
      delete: async () => { throw new Error('模型目录刷新不能删除登录凭证。') },
    }
    try {
      const models = createModels({ credentials: store, authContext: { env: async () => undefined, fileExists: async () => false } })
      models.setProvider(provider)
      const resolved = await models.getAuth(provider.id, { signal })
      if (!resolved?.auth.apiKey) return undefined
      access = resolved.auth.apiKey
    } catch {
      signal.throwIfAborted()
      throw new Error('Codex 登录凭证无法刷新，已保留原模型目录。请检查登录状态。')
    }
  }
  signal.throwIfAborted()
  // Same claim Pi's Codex transport uses; never send account metadata to UI.
  let claims: Record<string, unknown> | undefined
  try { claims = record(JSON.parse(Buffer.from(access.split('.')[1] ?? '', 'base64url').toString('utf8'))) } catch {}
  const accountId = string(record(claims?.['https://api.openai.com/auth'])?.chatgpt_account_id)
  if (!accountId) throw new Error('Codex 登录凭证缺少账户信息，已保留原模型目录。请重新登录。')
  return { access, accountId, identity: JSON.stringify([accountId, string(claims?.sub) ?? '']) }
}
