import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { CredentialRecord } from '@deepseek-ai/dsh-credentials'
import type { OAuthCredential, Provider } from '@earendil-works/pi-ai'
import { codexCatalogAuth } from '../src/host/codex-catalog-auth.ts'

const token = (account = 'account', marker = '') => `header.${Buffer.from(JSON.stringify({ sub: 'subject', marker, 'https://api.openai.com/auth': { chatgpt_account_id: account } })).toString('base64url')}.signature`
function fixture(expired = false) {
  const original: OAuthCredential = { type: 'oauth', access: token(), refresh: 'private-refresh', expires: Date.now() + (expired ? -1 : 3600000) }
  let saved: CredentialRecord | undefined = { kind: 'grant', payload: original }
  let tail: Promise<unknown> = Promise.resolve()
  const refresh = vi.fn(async () => ({ ...original, access: token('account', 'renewed'), refresh: 'rotated-refresh', expires: Date.now() + 3600000 }))
  const credentials = {
    readRecord: async () => saved,
    modifyRecord: vi.fn((_key, change: (value: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>) => {
      const result = tail.then(async () => { const next = await change(saved); if (next) saved = next; return saved })
      tail = result.catch(() => {}); return result
    }),
  }
  const ctx = { credentials } as unknown as Context
  const provider = { id: 'openai-codex', auth: { oauth: { refresh, toAuth: async (value: OAuthCredential) => ({ apiKey: value.access }) } }, getModels: () => [] } as unknown as Provider
  return { ctx, provider, refresh, credentials, saved: () => saved, logout: () => { saved = undefined } }
}

describe('Codex catalog authentication through existing Pi/DSH credentials', () => {
  it('never refreshes or writes credentials just to display catalog status', async () => {
    const f = fixture(true)
    expect(await codexCatalogAuth(f.ctx, f.provider, new AbortController().signal, false)).toMatchObject({ accountId: 'account', identity: '["account","subject"]' })
    expect(f.refresh).not.toHaveBeenCalled(); expect(f.credentials.modifyRecord).not.toHaveBeenCalled()
  })
  it('serializes concurrent token refreshes with inference-compatible DSH record locks', async () => {
    const f = fixture(true)
    const results = await Promise.all([codexCatalogAuth(f.ctx, f.provider, new AbortController().signal, true), codexCatalogAuth(f.ctx, f.provider, new AbortController().signal, true)])
    expect(f.refresh).toHaveBeenCalledTimes(1)
    expect(results[0]).toEqual(results[1])
    expect(results[0]?.access).toBe(token('account', 'renewed'))
    expect(f.saved()).toMatchObject({ kind: 'grant', payload: { refresh: 'rotated-refresh' } })
  })
  it('preserves credentials and sanitizes refresh failures without echoing token details', async () => {
    const f = fixture(true), before = structuredClone(f.saved())
    f.refresh.mockRejectedValue(new Error('private-refresh rotated-refresh'))
    await expect(codexCatalogAuth(f.ctx, f.provider, new AbortController().signal, true)).rejects.toThrow('请检查登录状态')
    expect(f.saved()).toEqual(before)
  })
  it('does not authenticate logged-out accounts or ignore cancellation', async () => {
    const f = fixture()
    f.logout()
    expect(await codexCatalogAuth(f.ctx, f.provider, new AbortController().signal, true)).toBeUndefined()
    const live = fixture()
    await expect(codexCatalogAuth(live.ctx, live.provider, AbortSignal.abort(), true)).rejects.toThrow()
    expect(live.refresh).not.toHaveBeenCalled()
  })
})
