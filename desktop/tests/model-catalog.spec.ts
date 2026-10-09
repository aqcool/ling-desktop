import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createLaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment'
import { Config as DeepSeekConfig } from '@deepseek-ai/dsh-llm-deepseek'
import { connectionIdentity, fetchCatalog, mergeCatalog, type CatalogConnection, type CatalogCacheEntry } from '../src/model-catalog.ts'
import { ModelCatalogStore } from '../src/model-catalog-store.ts'
import { LingModelCatalogController } from '../src/host/model-catalog-controller.ts'
import { LING_MODEL_CATALOG_HOST, LING_MODEL_CATALOG_REMOTE } from '../src/model-catalog-contract.ts'

const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks() })
const connection: CatalogConnection = { providerId: 'lab', namespace: 'llm-pi-ai', path: ['providers', 'lab'], baseUrl: 'https://gateway.example/deploy/openai/v1/', api: 'openai-completions', headers: { 'x-project': 'project' }, apiKey: 'private-key', native: false }
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status })
const listed = { id: 'fresh', name: 'Fresh', context_window: 128000, max_output_tokens: 32000, input_modalities: ['text', 'image'], output_modalities: ['text'], effort: { supported_levels: ['high', 'max'] } }
async function home() { const directory = await mkdtemp(join(tmpdir(), 'ling-model-catalog-')); cleanup.push(() => rm(directory, { recursive: true, force: true })); return directory }

describe('configured endpoint model directory', () => {
  it('contacts the configured gateway for a known Pi provider and keeps prefixes, auth and deployment headers', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => json({ data: [listed, { id: 'unclassified' }] }))
    const result = await fetchCatalog({ ...connection, providerId: 'openai' }, new AbortController().signal, fetcher)
    expect(String(fetcher.mock.calls[0]![0])).toBe('https://gateway.example/deploy/openai/v1/models')
    const request = fetcher.mock.calls[0]![1] as RequestInit
    expect(new Headers(request.headers).get('authorization')).toBe('Bearer private-key')
    expect(new Headers(request.headers).get('x-project')).toBe('project')
    expect(request.redirect).toBe('error')
    expect(result[0]).toMatchObject({ id: 'fresh', input: ['text', 'image'], contextWindow: 128000, maxTokens: 32000, efforts: ['high', 'max'], conversational: true })
    expect(result[1]).toEqual({ id: 'unclassified', conversational: false })
  })
  it('reads every Anthropic page with native auth, without following arbitrary returned URLs', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(json({ data: [{ id: 'a', display_name: 'A', max_input_tokens: 200000 }], has_more: true, last_id: 'a', next: 'https://elsewhere.example' })).mockResolvedValueOnce(json({ data: [{ id: 'b' }], has_more: false }))
    const result = await fetchCatalog({ ...connection, api: 'anthropic-messages', baseUrl: 'https://gateway.example/claude/v1' }, new AbortController().signal, fetcher)
    expect(result.map(model => model.id)).toEqual(['a', 'b'])
    expect(String(fetcher.mock.calls[1]![0])).toBe('https://gateway.example/claude/v1/models?limit=1000&after_id=a')
    expect(new Headers(fetcher.mock.calls[0]![1].headers).get('x-api-key')).toBe('private-key')
    expect(new Headers(fetcher.mock.calls[0]![1].headers).get('anthropic-version')).toBe('2023-06-01')
  })
  it('accepts enriched maps but refuses empty, partially malformed and looping pages instead of treating them as removals', async () => {
    const signal = new AbortController().signal
    expect(await fetchCatalog(connection, signal, vi.fn(async () => json({ models: { fresh: { name: 'Fresh', limit: { context: 128000 } } } })))).toMatchObject([{ id: 'fresh', contextWindow: 128000 }])
    for (const response of [{ data: [] }, { data: [{ id: 'valid' }, { name: 'missing id' }] }, { data: [{ id: 'valid' }], has_more: 'true' }, { error: 'unauthorized' }]) await expect(fetchCatalog(connection, signal, vi.fn(async () => json(response)))).rejects.toThrow('原目录')
    await expect(fetchCatalog(connection, signal, vi.fn(async () => json({ data: [{ id: 'a' }], has_more: true, last_id: 'a' })))).rejects.toThrow('分页不完整')
  })
  it('does not leak HTTP bodies/credentials and aborts before contacting an endpoint', async () => {
    await expect(fetchCatalog(connection, new AbortController().signal, vi.fn(async () => json({ error: 'private-key' }, 401)))).rejects.toThrow('供应商授权失败')
    const fetcher = vi.fn()
    await expect(fetchCatalog(connection, AbortSignal.abort(), fetcher)).rejects.toThrow()
    expect(fetcher).not.toHaveBeenCalled()
    await expect(fetchCatalog({ ...connection, api: 'google-generative-ai' }, new AbortController().signal, fetcher)).rejects.toThrow('内置')
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('reads the account-scoped Codex directory, lists visible models and preserves exact supported portable efforts', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => json({ models: [
      { slug: 'gpt-6.1-sol', display_name: 'GPT-6.1-Sol', context_window: 272000, input_modalities: ['text', 'image'], visibility: 'list', supported_reasoning_levels: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'].map(effort => ({ effort })) },
      { slug: 'internal', visibility: 'hide' },
    ] }))
    const codex = { ...connection, api: 'openai-codex-responses', baseUrl: 'https://chatgpt.com/backend-api', credentialIdentity: 'account', headers: { 'ChatGPT-Account-Id': 'account' } }
    const models = await fetchCatalog(codex, new AbortController().signal, fetcher)
    expect(String(fetcher.mock.calls[0]![0])).toBe('https://chatgpt.com/backend-api/codex/models?client_version=0.160.0')
    expect(new Headers(fetcher.mock.calls[0]![1]!.headers).get('ChatGPT-Account-Id')).toBe('account')
    expect(models).toEqual([{ id: 'gpt-6.1-sol', name: 'GPT-6.1-Sol', contextWindow: 272000, input: ['text', 'image'], conversational: true, efforts: ['low', 'medium', 'high', 'xhigh', 'max'], reasoningEfforts: { low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' } }])
    expect(mergeCatalog([], models, false).models[0]).toMatchObject({ reasoningEfforts: { low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' } })
    expect(mergeCatalog([], models, false).models[0]!.reasoningEfforts).not.toHaveProperty('off')
    expect(connectionIdentity(codex)).toBe(connectionIdentity({ ...codex, apiKey: 'rotated-token' }))
    expect(connectionIdentity(codex)).not.toBe(connectionIdentity({ ...codex, credentialIdentity: 'other-account' }))
    await expect(fetchCatalog(codex, new AbortController().signal, vi.fn(async () => json({ models: [{ slug: 'internal', visibility: 'hide' }] })))).rejects.toThrow('空')
  })
  it('limits actual response bytes even when content-length is missing', async () => {
    await expect(fetchCatalog(connection, new AbortController().signal, vi.fn(async () => new Response('x'.repeat(4 * 1024 * 1024 + 1))))).rejects.toThrow('过大')
  })
})

describe('catalog merge and offline persistence', () => {
  it('retains manual fields and missing models, refreshing only the fields this feature still owns', () => {
    const original = [{ id: 'fresh', name: 'My name', contextWindow: 90000, input: ['text'] }, { id: 'custom', name: 'Manual', compat: { supportsStore: false } }]
    const rows = [{ id: 'fresh', name: 'Endpoint', contextWindow: 128000, maxTokens: 32000, conversational: true }, { id: 'added', conversational: false }]
    const first = mergeCatalog(original, rows, false)
    expect(first.models[0]).toMatchObject({ name: 'My name', contextWindow: 90000, input: ['text'], maxTokens: 32000 })
    expect(first.models[1]).toEqual(original[1])
    const previous: CatalogCacheEntry = { identity: connectionIdentity(connection), updatedAt: 1, models: rows, newModelIds: first.newModelIds, generated: first.generated, pending: false }
    const second = mergeCatalog(first.models, [{ ...rows[0]!, maxTokens: 64000 }], false, previous)
    expect(second.models[0]).toMatchObject({ name: 'My name', contextWindow: 90000, maxTokens: 64000 })
    expect(second.models.map(row => row.id)).toEqual(['fresh', 'custom', 'added'])
    first.models[0]!.maxTokens = 1000
    expect(mergeCatalog(first.models, [{ ...rows[0]!, maxTokens: 64000 }], false, previous).models[0]!.maxTokens).toBe(1000)
    expect(original[0]).not.toHaveProperty('maxTokens')
  })
  it('persists pending acquisitions, reopens offline, retains private file permissions, and tolerates corrupt caches', async () => {
    const directory = await home(), store = new ModelCatalogStore(directory)
    await store.ready
    const entry: CatalogCacheEntry = { identity: connectionIdentity(connection), updatedAt: 1, models: [{ id: 'new', conversational: true }], newModelIds: ['new'], generated: { new: { contextWindow: 128000 } }, pending: true }
    await store.save('lab', entry)
    const reopened = new ModelCatalogStore(directory); await reopened.ready
    expect(reopened.get('lab')).toEqual(entry)
    const path = join(directory, 'ling-model-catalog.json')
    expect(await readFile(path, 'utf8')).not.toContain('private-key')
    expect(await readFile(path, 'utf8')).not.toContain('gateway.example')
    if (process.platform !== 'win32') expect((await stat(path)).mode & 0o777).toBe(0o600)
    await writeFile(path, 'not-json')
    const corrupt = new ModelCatalogStore(directory); await corrupt.ready
    expect(corrupt.get('lab')).toBeUndefined()
  })
})

async function controllerFixture(options: { directory?: string; busy?: boolean; native?: boolean; pi?: boolean; codex?: boolean; readonly?: boolean } = {}) {
  vi.useFakeTimers()
  const directory = options.directory ?? await home()
  vi.stubEnv('DSH_HOME', directory)
  const ctx = new Context(); cleanup.push(() => ctx.fiber.dispose())
  const id = options.native ? 'deepseek-official' : options.codex ? 'openai-codex' : options.pi ? 'openai' : 'lab'
  const namespace = options.native ? 'llm-deepseek' : 'llm-pi-ai'
  const path = options.native ? [] : ['providers', id]
  let profile: Record<string, unknown> = options.native ? { apiKeyEnv: 'LAB_API_KEY' } : { api: 'openai-completions', baseURL: 'https://lab.example.test/v1', apiKeyEnv: 'LAB_API_KEY', ...(options.pi ? { modelOverrides: { 'gpt-5': { name: 'My GPT', contextWindow: 128000 } } } : { models: [{ id: 'old', name: 'My model', contextWindow: 1000 }] }), retryPolicy: { mode: 'normal', maxRetries: 2 } }
  if (options.codex) profile = {}
  const token = (accountId: string) => `header.${Buffer.from(JSON.stringify({ sub: 'user', 'https://api.openai.com/auth': { chatgpt_account_id: accountId } })).toString('base64url')}.signature`
  let grant = { kind: 'grant', payload: { type: 'oauth', access: token('account'), refresh: 'private-refresh-token', expires: Date.now() + 3600000 } }
  let revision = 1, busy = options.busy ?? false
  const agents = { list: () => busy ? [{ status: 'running', inbox: { nextTurn: [], nextStep: [] } }] : [] }
  const mutate = vi.fn(async (_ns: string, ops: { op: string; path: string[]; value?: unknown }[], expected: number) => {
    if (expected !== revision) throw new Error('SETTINGS_CONFLICT')
    if (options.native) for (const op of ops) if (op.path.at(-1) === 'models') DeepSeekConfig({ ...profile, models: op.value } as Parameters<typeof DeepSeekConfig>[0])
    for (const op of ops) { const field = op.path.at(-1)!; if (op.op === 'unset') delete profile[field]; else profile[field] = structuredClone(op.value) }
    revision++
  })
  const listProviders = vi.fn(() => [{ provider: id, displayName: 'Lab', settingsNs: namespace, settingsPath: path }])
  ctx.provide('typert', { register: () => () => {} } as never)
  ctx.provide('launchEnvironment', createLaunchEnvironmentSnapshot([]))
  ctx.provide('agents', agents as never)
  ctx.provide('llm', { listConfigurableProviders: listProviders } as never)
  ctx.provide('credentials', { resolve: async () => ({ value: 'test-key', source: 'user' }), readRecord: async () => options.codex ? grant : undefined } as never)
  ctx.provide('settings', { writable: !options.readonly, describe: () => [{ ns: namespace, revision, value: options.native ? profile : { providers: { [id]: profile } } }], mutate } as never)
  const controller = new LingModelCatalogController(ctx)
  return { controller, ctx, directory, id, mutate, profile: () => profile, setBusy(value: boolean) { busy = value }, changeEndpoint() { profile.baseURL = 'https://changed.example.test/v1'; revision++ }, changeAccount() { grant = { ...grant, payload: { ...grant.payload, access: token('other-account') } } }, dispose: async () => ctx.fiber.dispose() }
}

describe('Host catalog application lifecycle', () => {
  it('refreshes an existing Codex OAuth connection without relogin or exposing credentials, and supports offline cache', async () => {
    const fixture = await controllerFixture({ codex: true })
    const fetcher = vi.fn<typeof fetch>(async () => json({ models: [{ slug: 'gpt-6.1-sol', visibility: 'list', display_name: 'GPT-6.1-Sol', context_window: 272000, input_modalities: ['text', 'image'], supported_reasoning_levels: [{ effort: 'low' }, { effort: 'high' }] }] })); vi.stubGlobal('fetch', fetcher)
    expect((await fixture.controller.list())[0]).toMatchObject({ supported: true, source: 'builtin' })
    expect(fetcher).not.toHaveBeenCalled()
    expect(await fixture.controller.refresh(fixture.id)).toMatchObject({ source: 'endpoint', pending: false, newModelIds: ['gpt-6.1-sol'], efforts: { 'gpt-6.1-sol': ['low', 'high'] } })
    expect(fixture.profile().models).toContainEqual(expect.objectContaining({ id: 'gpt-6.1-sol', contextWindow: 272000, input: ['text', 'image'], reasoningEfforts: { low: 'low', high: 'high' } }))
    const persisted = await readFile(join(fixture.directory, 'ling-model-catalog.json'), 'utf8')
    expect(persisted).not.toContain('private-refresh-token'); expect(persisted).not.toContain('header.'); expect(persisted).not.toContain('account')
    fetcher.mockImplementation(async () => { throw new Error('offline') })
    await expect(fixture.controller.refresh(fixture.id)).rejects.toThrow('原模型目录')
    expect((await fixture.controller.list())[0]).toMatchObject({ source: 'endpoint', supported: true })
  })
  it('refuses stale Codex catalog results after an account switch', async () => {
    const fixture = await controllerFixture({ codex: true })
    let finish!: (value: Response) => void
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { finish = resolve })))
    const refreshing = fixture.controller.refresh(fixture.id)
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    fixture.changeAccount(); finish(json({ models: [{ slug: 'gpt-6.1-sol', visibility: 'list' }] }))
    await expect(refreshing).rejects.toThrow('连接配置已变更')
    expect(fixture.mutate).not.toHaveBeenCalled()
  })
  it('refreshes actual built-in Pi connections, preserving model overrides, protocol settings and all existing IDs', async () => {
    const fixture = await controllerFixture({ pi: true })
    vi.stubGlobal('fetch', vi.fn(async () => json({ data: [listed] })))
    const state = await fixture.controller.refresh(fixture.id)
    expect(state).toMatchObject({ source: 'endpoint', pending: false, refreshing: false, newModelIds: ['fresh'] })
    expect(fixture.profile().modelOverrides).toBeUndefined()
    expect(fixture.profile()).toMatchObject({ apiKeyEnv: 'LAB_API_KEY', retryPolicy: { mode: 'normal', maxRetries: 2 } })
    expect(fixture.profile().models).toContainEqual(expect.objectContaining({ id: 'gpt-5', name: 'My GPT', contextWindow: 128000 }))
    expect(fixture.profile().models).toContainEqual(expect.objectContaining({ id: 'fresh', contextWindow: 128000, reasoningEfforts: { off: null, high: 'high', max: 'max' } }))
    expect(fixture.mutate.mock.calls.every(call => call[0] === 'llm-pi-ai')).toBe(true)
  })
  it('keeps running task configuration unchanged and applies cached data after idle, including across restart', async () => {
    const fixture = await controllerFixture({ busy: true })
    const fetcher = vi.fn(async () => json({ data: [listed] })); vi.stubGlobal('fetch', fetcher)
    expect(await fixture.controller.refresh('lab')).toMatchObject({ pending: true })
    expect(fixture.mutate).not.toHaveBeenCalled()
    expect(fixture.profile().models).toEqual([{ id: 'old', name: 'My model', contextWindow: 1000 }])
    await fixture.dispose()
    const reopened = await controllerFixture({ directory: fixture.directory })
    expect(await reopened.controller.list()).toContainEqual(expect.objectContaining({ pending: true }))
    await vi.advanceTimersByTimeAsync(5000)
    await vi.waitFor(() => expect(reopened.mutate).toHaveBeenCalledTimes(1))
    expect(reopened.profile().models).toContainEqual(expect.objectContaining({ id: 'fresh' }))
    expect(fetcher).toHaveBeenCalledTimes(1)
    await vi.waitFor(async () => expect(await reopened.controller.list()).toContainEqual(expect.objectContaining({ pending: false, updatedAt: expect.any(Number) })))
  })
  it('updates previously generated metadata on a second refresh, while preserving later user overrides', async () => {
    const fixture = await controllerFixture()
    const fetcher = vi.fn(async () => json({ data: [listed] })); vi.stubGlobal('fetch', fetcher)
    await fixture.controller.refresh('lab')
    fetcher.mockImplementation(async () => json({ data: [{ ...listed, max_output_tokens: 64000 }] }))
    await fixture.controller.refresh('lab')
    const fresh = (fixture.profile().models as Record<string, unknown>[]).find(model => model.id === 'fresh')!
    expect(fresh.maxTokens).toBe(64000)
    fresh.contextWindow = 90000
    fetcher.mockImplementation(async () => json({ data: [{ ...listed, context_window: 256000, max_output_tokens: 128000 }] }))
    await fixture.controller.refresh('lab')
    expect(fixture.profile().models).toContainEqual(expect.objectContaining({ id: 'fresh', contextWindow: 90000, maxTokens: 128000 }))
  })
  it('uses the hourly timer for daily refreshes and retries failures without replacing settings', async () => {
    const fixture = await controllerFixture()
    const fetcher = vi.fn(async () => json({ data: [listed] })); vi.stubGlobal('fetch', fetcher)
    await fixture.controller.list()
    await vi.advanceTimersByTimeAsync(5000)
    await vi.waitFor(async () => expect((await fixture.controller.list())[0]?.pending).toBe(false))
    await vi.waitFor(() => expect(fixture.mutate).toHaveBeenCalledTimes(1))
    await vi.advanceTimersByTimeAsync(23 * 60 * 60 * 1000)
    expect(fetcher).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000)
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
  })
  it('retains the last successful cache and settings when a provider later fails, and coalesces refreshes', async () => {
    const fixture = await controllerFixture()
    const fetcher = vi.fn(async () => json({ data: [listed] })); vi.stubGlobal('fetch', fetcher)
    const [first, concurrent] = await Promise.all([fixture.controller.refresh('lab'), fixture.controller.refresh('lab')])
    expect(first).toEqual(concurrent); expect(fetcher).toHaveBeenCalledTimes(1)
    const before = structuredClone(fixture.profile())
    const updatedAt = first.updatedAt
    fetcher.mockImplementation(async () => json({ error: 'secret-body' }, 503))
    await expect(fixture.controller.refresh('lab')).rejects.toThrow('HTTP 503')
    expect(fixture.profile()).toEqual(before)
    expect((await fixture.controller.list())[0]).toMatchObject({ source: 'endpoint', updatedAt, error: expect.stringContaining('HTTP 503') })
  })
  it('discards a response if the connection changes while it is being fetched, without writing stale metadata', async () => {
    const fixture = await controllerFixture()
    let resolve!: (value: Response) => void
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(done => { resolve = done })))
    const result = fixture.controller.refresh('lab')
    await vi.waitFor(() => expect(resolve).toBeTypeOf('function'))
    fixture.changeEndpoint(); resolve(json({ data: [listed] }))
    await expect(result).rejects.toThrow('连接配置已变更')
    expect(fixture.mutate).not.toHaveBeenCalled()
    expect((await fixture.controller.list())[0]).toMatchObject({ source: 'builtin' })
  })
  it('refreshes native DeepSeek metadata through its model endpoint and keeps protocol configuration intact', async () => {
    const fixture = await controllerFixture({ native: true })
    const fetcher = vi.fn<typeof fetch>(async () => json({ data: [{ ...listed, id: 'deepseek-flash', api_capabilities: { anthropic_messages: { system_prompt_update: 'in-history' } } }, { ...listed, id: 'deepseek-v4-pro', api_capabilities: { anthropic_messages: { system_prompt_update: 'leading-only' } } }] })); vi.stubGlobal('fetch', fetcher)
    const state = await fixture.controller.refresh(fixture.id)
    expect(String(fetcher.mock.calls[0]![0])).toBe('https://api.deepseek.com/models')
    expect(fixture.profile().models).toContainEqual(expect.objectContaining({ id: 'deepseek-flash', inputModalities: ['text', 'image'], systemPromptUpdate: 'in-history' }))
    expect(fixture.profile().models).toContainEqual(expect.objectContaining({ id: 'deepseek-flash', name: 'Fresh', contextWindow: 128000 }))
    expect((fixture.profile().models as Record<string, unknown>[]).find(model => model.id === 'deepseek-v4-pro')).not.toHaveProperty('systemPromptUpdate')
    expect(fixture.profile()).not.toHaveProperty('api')
    expect(state.efforts).toEqual({ 'deepseek-flash': ['off', 'high', 'max'], 'deepseek-v4-pro': ['off', 'high', 'max'] })
  })
  it('does not touch read-only settings or allow unsupported/OAuth routes to be probed', async () => {
    const fixture = await controllerFixture({ readonly: true })
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
    await expect(fixture.controller.refresh('lab')).rejects.toThrow('不可写')
    expect(fetcher).not.toHaveBeenCalled()
    fixture.profile().api = 'openai-codex-responses'
    expect((await fixture.controller.list())[0]).toMatchObject({ supported: false })
  })
  it('registers matching explicit Remote descriptors with cancellation for every method', () => {
    expect(LING_MODEL_CATALOG_HOST.invocations).toBe(LING_MODEL_CATALOG_REMOTE.descriptors)
    expect(LING_MODEL_CATALOG_REMOTE.descriptors.map(method => [method.method, method.cancellation?.parameter])).toEqual([['list', 'signal'], ['refresh', 'signal'], ['probe', 'signal']])
  })
})
