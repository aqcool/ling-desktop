import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import { credentialRef, parseCredentialKey } from '@deepseek-ai/dsh-credentials'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import { resolveAdapterOptions, type Config } from '@deepseek-ai/dsh-llm-deepseek'
import type {} from '@deepseek-ai/dsh-settings'
import { builtinProviders } from '@earendil-works/pi-ai/providers/all'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { LingModelCatalogState, LingDiscoveredModel } from 'ling-desktop/runtime'
import { LING_MODEL_CATALOG_HOST } from '../model-catalog-contract.ts'
import { ModelCatalogStore } from '../model-catalog-store.ts'
import { connectionIdentity, fetchCatalog, listable, mergeCatalog, profileModels, record, string, type CatalogConnection, type CatalogCacheEntry, type CatalogModel, type ModelProfile } from '../model-catalog.ts'
import { codexCatalogAuth } from './codex-catalog-auth.ts'

declare module '@deepseek-ai/cordis' { interface Context { lingModelCatalog: LingModelCatalogController } }
const DAY = 24 * 60 * 60 * 1000
const RETRY_DELAY = 60 * 60 * 1000
const piProviders = new Map(builtinProviders().map(provider => [provider.id, provider]))

export class LingModelCatalogController extends TypertRemoteService {
  static inject = ['typert', 'settings', 'llm', 'credentials', 'agents']
  private readonly store: ModelCatalogStore
  private readonly pending = new Map<string, { connection: CatalogConnection; cache: CatalogCacheEntry }>()
  private readonly flights = new Map<string, Promise<LingModelCatalogState>>()
  private readonly errors = new Map<string, string>()
  private readonly attempted = new Map<string, { identity: string; at: number }>()
  private readonly lifetime = new AbortController()
  private timer: ReturnType<typeof setTimeout> | undefined
  private scheduledAt = Infinity
  private applying = false
  private credentialEpoch = 0
  private background: Promise<void> | undefined
  constructor(ctx: Context) {
    super(ctx, 'lingModelCatalog')
    if (!process.env.DSH_HOME) throw new Error('Model catalog requires the LING runtime home')
    this.store = new ModelCatalogStore(process.env.DSH_HOME)
    ctx.effect(() => ctx.typert.register(LING_MODEL_CATALOG_HOST), 'LING model catalog Remote')
    ctx.on('settings/document-updated', ns => { if (ns === 'llm-pi-ai' || ns === 'llm-deepseek') this.schedule(1500) })
    ctx.on('credentials/reference-updated', () => { this.credentialEpoch++; this.attempted.clear(); this.schedule(1500) })
    ctx.on('credentials/record-updated', () => { this.credentialEpoch++; this.attempted.clear(); this.schedule(1500) })
    ctx.on('agent/status', ({ status }) => { if (status === 'idle') this.schedule(250) })
    ctx.effect(() => async () => {
      this.lifetime.abort()
      clearTimeout(this.timer)
      await Promise.allSettled([...this.flights.values()])
      await this.background
      await this.store.settled()
    }, 'LING model catalog background refresh')
    this.schedule(5000)
  }
  private schedule(delay: number): void {
    if (this.lifetime.signal.aborted) return
    const at = Date.now() + delay
    if (this.timer && this.scheduledAt <= at) return
    clearTimeout(this.timer)
    this.scheduledAt = at
    this.timer = setTimeout(() => {
      this.timer = undefined; this.scheduledAt = Infinity
      if (this.background) { this.schedule(1000); return }
      this.background = this.tick().catch(() => {}).finally(() => { this.background = undefined; this.schedule(60 * 60 * 1000) })
    }, delay)
    this.timer.unref?.()
  }
  private busy(): boolean { return this.ctx.agents.list().some(agent => agent.status !== 'idle' || agent.inbox.nextTurn.length || agent.inbox.nextStep.length) }
  private entry(providerId: string) { return this.ctx.llm.listConfigurableProviders().find(provider => provider.provider === providerId) }
  private profile(providerId: string) {
    const entry = this.entry(providerId)
    if (!entry) return undefined
    const namespace = this.ctx.settings.describe().find(row => row.ns === entry.settingsNs)
    let value = namespace?.value
    for (const key of entry.settingsPath) value = record(value)?.[key]
    return namespace && record(value) ? { entry, namespace, profile: record(value)! } : undefined
  }
  private async connection(providerId: string, refreshAuth = false, signal = this.lifetime.signal): Promise<CatalogConnection | undefined> {
    const context = this.profile(providerId)
    if (!context) return undefined
    const { profile, entry } = context
    const native = entry.settingsNs === 'llm-deepseek'
    if (!native && entry.settingsNs !== 'llm-pi-ai') return undefined
    let api: string | undefined, baseUrl: string | undefined, reference: string | undefined
    if (native) {
      const options = resolveAdapterOptions(profile as Config, launchEnvironmentOf(this.ctx))
      api = options.protocol === 'messages' ? 'anthropic-messages' : 'openai-completions'
      baseUrl = options.baseURL
      reference = options.apiKeyEnv
      // The public DeepSeek Messages root shares the public /models directory.
      if (baseUrl.replace(/\/+$/, '') === 'https://api.deepseek.com/anthropic') { baseUrl = 'https://api.deepseek.com'; api = 'openai-completions' }
    } else {
      const builtin = piProviders.get(providerId), models = builtin?.getModels() ?? []
      api = string(profile.api) ?? (new Set(models.map(model => model.api)).size === 1 ? models[0]?.api : undefined)
      baseUrl = string(profile.baseURL) ?? builtin?.baseUrl ?? models[0]?.baseUrl
      reference = string(profile.apiKeyEnv)
    }
    if (!api || !baseUrl || !listable(api)) return undefined
    const headers = Object.fromEntries(Object.entries(record(profile.headers) ?? {}).filter((item): item is [string, string] => typeof item[1] === 'string'))
    if (api === 'openai-codex-responses') {
      // Only the configured Codex route owns these OAuth credentials. Never
      // export a login token to an unrelated custom provider or public API.
      if (native || providerId !== 'openai-codex' || reference) return undefined
      const auth = await codexCatalogAuth(this.ctx, piProviders.get(providerId)!, signal, refreshAuth)
      if (!auth) return undefined
      return { providerId, namespace: entry.settingsNs, path: [...entry.settingsPath], baseUrl, api,
        headers: { ...headers, 'ChatGPT-Account-Id': auth.accountId, originator: 'ling-desktop' }, apiKey: auth.access, credentialIdentity: auth.identity, native: false }
    }
    let apiKey: string | undefined
    if (reference) apiKey = (await this.ctx.credentials.resolve(credentialRef(reference)))?.value
    else {
      // Other OAuth catalogs remain owned by their Pi provider.
      const builtin = piProviders.get(providerId)
      const credential = builtin ? await this.ctx.credentials.readRecord(parseCredentialKey(`llm-pi-ai/${providerId}`)) : undefined
      if (credential?.kind === 'grant') return undefined
      const auth = await builtin?.auth.apiKey?.resolve({ ctx: { env: async name => (await this.ctx.credentials.resolve(credentialRef(name)))?.value ?? launchEnvironmentOf(this.ctx).get(name)?.value, fileExists: async () => false }, ...(credential?.kind === 'api-key' ? { credential: { type: 'api_key', key: credential.key, env: credential.env } as const } : {}), signal: this.lifetime.signal })
      apiKey = auth?.auth.apiKey
    }
    // A configured header can authenticate a keyless/private gateway; dormant
    // bundled providers must never be contacted with no configured credential.
    if ((native || piProviders.has(providerId)) && !apiKey && !Object.keys(headers).some(key => /authorization|api-key/i.test(key))) return undefined
    return { providerId, namespace: entry.settingsNs, path: [...entry.settingsPath], baseUrl, api, headers, ...(apiKey ? { apiKey: apiKey.trim() } : {}), native }
  }
  private state(providerId: string, connection?: CatalogConnection): LingModelCatalogState {
    const saved = this.store.get(providerId)
    const cache = connection && saved?.identity === connectionIdentity(connection) ? saved : undefined
    const current = this.profile(providerId)
    const existing = this.existing(providerId, current?.profile)
    const ids = new Set(cache?.models.map(model => model.id))
    const known = new Set(piProviders.get(providerId)?.getModels().map(model => model.id) ?? [])
    return {
      providerId, supported: !!connection && this.ctx.settings.writable, source: cache ? 'endpoint' : 'builtin',
      ...(cache ? { updatedAt: cache.updatedAt } : {}), refreshing: this.flights.has(providerId), pending: this.pending.has(providerId) || cache?.pending === true,
      ...(this.errors.has(providerId) ? { error: this.errors.get(providerId) } : {}),
      newModelIds: cache?.newModelIds ?? [],
      missingModelIds: cache ? existing.filter(model => !ids.has(model.id)).map(model => model.id) : [],
      unverifiedModelIds: cache?.models.filter(model => !model.conversational && !known.has(model.id) && cache.newModelIds.includes(model.id)).map(model => model.id) ?? [],
      ...(cache && !cache.pending ? { efforts: Object.fromEntries(cache.models.filter(model => model.efforts).map(model => [model.id, model.reasoningEfforts ? Object.keys(model.reasoningEfforts) : ['off', ...model.efforts!]])) } : {}),
    }
  }
  private existing(providerId: string, profile?: Record<string, unknown>): ModelProfile[] {
    if (Array.isArray(profile?.models)) return profileModels(profile.models)
    if (this.entry(providerId)?.settingsNs === 'llm-deepseek') return profileModels(resolveAdapterOptions((profile ?? {}) as Config, launchEnvironmentOf(this.ctx)).models)
    const overrides = record(profile?.modelOverrides) ?? {}
    return (piProviders.get(providerId)?.getModels() ?? []).map(model => ({ id: model.id, ...record(overrides[model.id]) }))
  }
  private initialOwnership(providerId: string, connection: CatalogConnection): CatalogCacheEntry | undefined {
    if (!connection.native) return undefined
    const current = this.profile(providerId)
    let user = current?.namespace.user
    for (const key of connection.path) user = record(user)?.[key]
    if (Array.isArray(record(user)?.models)) return undefined
    // Schemastery supplies a fully populated native default catalog. Those
    // advisory defaults are not user overrides; only identical default fields
    // may be updated on the first refresh. Explicit user catalogs stay intact.
    const defaults = new Map(profileModels(resolveAdapterOptions({} as Config, launchEnvironmentOf(this.ctx)).models).map(model => [model.id, model]))
    const generated: Record<string, Record<string, unknown>> = Object.create(null)
    for (const model of this.existing(providerId, current?.profile)) {
      const baseline = defaults.get(model.id)
      if (!baseline) continue
      for (const field of ['name', 'contextWindow', 'maxTokens', 'inputModalities', 'systemPromptUpdate']) {
        if (baseline[field] !== undefined && JSON.stringify(model[field]) === JSON.stringify(baseline[field])) (generated[model.id] ??= Object.create(null))[field] = model[field]
      }
    }
    return { identity: connectionIdentity(connection), updatedAt: Date.now(), models: [], generated, newModelIds: [], pending: false }
  }
  private async applyPending(): Promise<void> {
    if (this.applying || this.busy() || this.lifetime.signal.aborted) return
    this.applying = true
    try {
      for (const [id, pending] of this.pending) {
        if (this.lifetime.signal.aborted) return
        const connection = await this.connection(id)
        if (!connection || connectionIdentity(connection) !== pending.cache.identity) { this.pending.delete(id); continue }
        const current = this.profile(id)
        if (!current || !this.ctx.settings.writable || this.busy()) return
        const previous = this.store.get(id)
        const merged = mergeCatalog(this.existing(id, current.profile), pending.cache.models, connection.native, previous?.identity === pending.cache.identity ? previous : undefined)
        const path = [...connection.path]
        const ops = [{ op: 'set' as const, path: [...path, 'models'], value: merged.models },
          ...(!connection.native && current.profile.modelOverrides !== undefined ? [{ op: 'unset' as const, path: [...path, 'modelOverrides'] }] : [])]
        try {
          await this.ctx.settings.mutate(current.namespace.ns, ops, current.namespace.revision)
          await this.store.save(id, { ...pending.cache, pending: false, generated: merged.generated, newModelIds: merged.newModelIds })
        } catch {
          const message = '模型目录已缓存，暂未应用。原配置保持可用，请重试刷新。'
          this.errors.set(id, message)
          throw new Error(message)
        }
        this.pending.delete(id)
        this.errors.delete(id)
      }
    } finally { this.applying = false }
  }
  private async tick(): Promise<void> {
    await this.store.ready
    // A directory acquired during a running turn survives Host restarts.
    for (const provider of this.ctx.llm.listConfigurableProviders()) {
      const saved = this.store.get(provider.provider)
      if (!saved?.pending || this.pending.has(provider.provider)) continue
      const connection = await this.connection(provider.provider).catch(() => undefined)
      if (connection && connectionIdentity(connection) === saved.identity) this.pending.set(provider.provider, { connection, cache: saved })
    }
    await this.applyPending()
    if (!this.ctx.settings.writable) return
    // Sequential network operations keep background refresh quiet and bounded.
    for (const provider of this.ctx.llm.listConfigurableProviders()) {
      if (this.lifetime.signal.aborted) return
      const connection = await this.connection(provider.provider).catch(() => undefined)
      if (!connection || this.pending.has(provider.provider)) continue
      const saved = this.store.get(provider.provider), attempt = this.attempted.get(provider.provider)
      const last = attempt?.identity === connectionIdentity(connection) ? attempt.at : 0
      if (Date.now() - last < RETRY_DELAY || (saved?.identity === connectionIdentity(connection) && Date.now() - saved.updatedAt < DAY)) continue
      await this.refresh(provider.provider).catch(() => {})
    }
  }
  async list(signal?: AbortSignal): Promise<readonly LingModelCatalogState[]> {
    await this.store.ready
    const states = await Promise.all(this.ctx.llm.listConfigurableProviders().map(async entry => {
      signal?.throwIfAborted()
      return this.state(entry.provider, await this.connection(entry.provider).catch(() => undefined))
    }))
    return states
  }
  refresh(providerId: string, signal?: AbortSignal): Promise<LingModelCatalogState> {
    if (this.flights.has(providerId)) return this.flights.get(providerId)!
    const flight = this.performRefresh(providerId, signal).then(state => ({ ...state, refreshing: false })).finally(() => this.flights.delete(providerId))
    this.flights.set(providerId, flight)
    return flight
  }
  async probe(providerId: string, signal?: AbortSignal): Promise<readonly LingDiscoveredModel[]> {
    const combined = AbortSignal.any([this.lifetime.signal, AbortSignal.timeout(30000), ...(signal ? [signal] : [])])
    const connection = await this.connection(providerId, true, combined)
    if (!connection) throw new Error('此连接没有可探测的模型目录。')
    const models = await fetchCatalog(connection, combined)
    return models.map(({ id, name, contextWindow }) => ({ id, ...(name ? { name } : {}), ...(contextWindow ? { contextWindow } : {}) }))
  }
  private async performRefresh(providerId: string, signal?: AbortSignal): Promise<LingModelCatalogState> {
    await this.store.ready
    if (!this.ctx.settings.writable) throw new Error('当前模型设置不可写。')
    const combined = AbortSignal.any([this.lifetime.signal, AbortSignal.timeout(30000), ...(signal ? [signal] : [])])
    try {
      const connection = await this.connection(providerId, true, combined)
      if (!connection) throw new Error('此连接使用 Pi 内置模型目录，或尚未配置供应商凭证。')
      const epoch = this.credentialEpoch
      this.attempted.set(providerId, { identity: connectionIdentity(connection), at: Date.now() })
      const models: CatalogModel[] = await fetchCatalog(connection, combined)
      combined.throwIfAborted()
      const current = await this.connection(providerId)
      if (epoch !== this.credentialEpoch || !current || connectionIdentity(current) !== connectionIdentity(connection)) throw new Error('连接配置已变更，请重新刷新模型目录。')
      const saved = this.store.get(providerId)
      const previous = saved?.identity === connectionIdentity(connection) ? saved : this.initialOwnership(providerId, connection)
      const merged = mergeCatalog(this.existing(providerId, this.profile(providerId)?.profile), models, connection.native, previous)
      // Ownership must describe the last applied settings, not this acquisition.
      // Otherwise updating the cache first makes old generated values look like
      // manual overrides when application resumes, including after a restart.
      const cache: CatalogCacheEntry = { identity: connectionIdentity(connection), updatedAt: Date.now(), models, pending: true, newModelIds: merged.newModelIds, generated: previous?.generated ?? {} }
      this.pending.set(providerId, { connection, cache })
      // Durable intent allows configuration application to be resumed after restart.
      await this.store.save(providerId, cache)
      this.errors.delete(providerId)
      await this.applyPending()
      return this.state(providerId, current)
    } catch (error) {
      const message = combined.aborted ? signal?.aborted || this.lifetime.signal.aborted ? '已取消模型目录刷新，原目录保持可用。' : '模型目录刷新超时，已保留原目录。' : error instanceof Error ? error.message : '模型目录刷新失败，已保留原目录。'
      this.errors.set(providerId, message)
      throw new Error(message)
    }
  }
}
for (const method of ['list', 'refresh', 'probe'] as const) {
  const prototype = LingModelCatalogController.prototype
  const receiver = Object.create(prototype) as LingModelCatalogController
  const decorate = Remote as unknown as (implementation: (...args: never[]) => unknown, context: { name: string; private: boolean; static: boolean; addInitializer(initializer: (this: LingModelCatalogController) => void): void }) => void
  decorate(prototype[method] as (...args: never[]) => unknown, { name: method, private: false, static: false, addInitializer(initializer) { initializer.call(receiver) } })
}
