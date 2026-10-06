import type {
  CredentialInfo,
  LlmConfigurableProvider,
  LlmProviderInfo,
  ModelCatalog,
  SettingsDescribeValue,
  SettingsNamespaceView,
  SettingsPathOpView,
} from '@deepseek-ai/dsh-api-remotes/client'
import type { ClientRemote } from '@deepseek-ai/dsh-api-remotes/client'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type {
  LingCustomProviderDraft,
  LingCommandRejectionReason,
  LingDiscoveredModel,
  LingModelOption,
  LingModelProvider,
  LingModelSelection,
  LingModelSettings,
  LingModelCatalogState,
  LingProviderTestTarget,
  LingReadResult,
} from 'ling-desktop/runtime'
import type { LingAuthorizationEntryView } from '../authorization-contract.ts'
import { DEEPSEEK_MODELS } from '@earendil-works/pi-ai/providers/deepseek.models'
import type { LingModelCatalogRemote } from '../model-catalog-contract.ts'

const DEFAULT_MODEL_NAMESPACE = 'agent-default-model'
const CUSTOM_PROVIDER_NAMESPACE = 'llm-pi-ai'
const CUSTOM_PROVIDER_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/

interface ProviderEntry {
  readonly provider: string
  readonly displayName: string
  readonly active: boolean
  readonly configurable: boolean
  readonly settingsNs?: string
  readonly settingsPath?: readonly string[]
  readonly declared?: boolean
  readonly error?: string
}

interface ProviderContext {
  readonly entry: ProviderEntry
  readonly namespace?: SettingsNamespaceView
  readonly profile: unknown
  readonly credentialRef?: string
}

interface ProviderDirectory {
  readonly settings: SettingsDescribeValue
  readonly entries: readonly ProviderEntry[]
  readonly namespaces: ReadonlyMap<string, SettingsNamespaceView>
}

function messageOf(error: { readonly message?: string }, fallback: string): string {
  return error.message?.trim() || fallback
}

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
  return rejected(reason, messageOf(error, '操作未能完成。'), /transport|connection|timeout|unavailable/i.test(error.code))
}

function recordOf(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function atPath(value: unknown, path: readonly string[]): unknown {
  let current = value
  for (const part of path) {
    const record = recordOf(current)
    if (record === undefined || !(part in record)) return undefined
    current = record[part]
  }
  return current
}

function configured(namespace: SettingsNamespaceView | undefined, path: readonly string[] | undefined): boolean {
  if (namespace === undefined || path === undefined) return false
  return path.length === 0 || atPath(namespace.value, path) !== undefined
}

function layerHas(
  namespace: SettingsNamespaceView | undefined,
  layer: 'base' | 'user',
  path: readonly string[] | undefined,
): boolean {
  return namespace !== undefined && path !== undefined && atPath(namespace[layer], path) !== undefined
}

function stringField(value: unknown, key: string): string | undefined {
  const field = recordOf(value)?.[key]
  return typeof field === 'string' && field.length > 0 ? field : undefined
}

function credentialRef(profile: unknown): string | undefined {
  const value = recordOf(profile)?.apiKeyEnv
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function derivedCredentialRef(provider: string): string {
  return `${provider.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY`
}

function customProviderPath(entry: ProviderEntry): readonly string[] | undefined {
  return entry.settingsNs === CUSTOM_PROVIDER_NAMESPACE ? entry.settingsPath : undefined
}

function jsonRecord(value: Record<string, JsonValue>): Record<string, JsonValue> {
  return value
}

function directoryEntries(
  registered: readonly LlmProviderInfo[],
  configurableProviders: readonly LlmConfigurableProvider[],
): readonly ProviderEntry[] {
  const active = new Set(registered.map(provider => provider.id))
  const configured = new Set(configurableProviders.map(provider => provider.provider))
  return [
    ...configurableProviders.map(provider => ({
      provider: provider.provider,
      displayName: provider.displayName,
      active: active.has(provider.provider),
      configurable: true,
      settingsNs: provider.settingsNs,
      settingsPath: [...provider.settingsPath],
      ...(provider.declared === undefined ? {} : { declared: provider.declared }),
      ...(provider.error === undefined ? {} : { error: provider.error }),
    })),
    ...registered.filter(provider => !configured.has(provider.id)).map(provider => ({
      provider: provider.id,
      displayName: provider.name,
      active: true,
      configurable: false,
    })),
  ]
}

async function readDirectory(remote: ClientRemote): Promise<LingReadResult<ProviderDirectory>> {
  const [settings, registered, configurableProviders] = await Promise.all([
    remote.settings.describe(),
    remote.llm.listProviders(),
    remote.llm.listConfigurableProviders(),
  ])
  if (!settings.ok) return remoteFailure(settings.error)
  if (!registered.ok) return remoteFailure(registered.error)
  if (!configurableProviders.ok) return remoteFailure(configurableProviders.error)
  const namespaces = new Map(settings.value.namespaces.map(namespace => [namespace.ns, namespace]))
  return {
    ok: true,
    value: {
      settings: settings.value,
      entries: directoryEntries(registered.value, configurableProviders.value),
      namespaces,
    },
  }
}

function providerContext(directory: ProviderDirectory, providerId: string): ProviderContext | undefined {
  const entry = directory.entries.find(candidate => candidate.provider === providerId)
  if (entry === undefined) return undefined
  const namespace = entry.settingsNs === undefined ? undefined : directory.namespaces.get(entry.settingsNs)
  const profile = atPath(namespace?.value, entry.settingsPath ?? [])
  return {
    entry,
    namespace,
    profile,
    ...(credentialRef(profile) === undefined ? {} : { credentialRef: credentialRef(profile) }),
  }
}

function credentialReference(context: ProviderContext): string | undefined {
  if (context.credentialRef !== undefined) return context.credentialRef
  return context.entry.configurable && !configured(context.namespace, context.entry.settingsPath)
    ? derivedCredentialRef(context.entry.provider)
    : undefined
}

function writableCredentialReference(context: ProviderContext): string | undefined {
  return context.credentialRef ?? (context.entry.configurable ? derivedCredentialRef(context.entry.provider) : undefined)
}

function modelsByProvider(catalog: ModelCatalog, directory: ProviderDirectory, states?: ReadonlyMap<string, LingModelCatalogState>): ReadonlyMap<string, readonly LingModelOption[]> {
  return new Map(catalog.groups.map(group => [
    group.id,
    group.models.map(model => {
      // Pi routes already resolve profile overrides in DSH. Only narrow the native
      // DeepSeek adapter's shared effort list with an exact Pi catalog match.
      const nativeDeepSeek = directory.entries.some(entry => entry.provider === group.id && entry.settingsNs === 'llm-deepseek')
      const advertised = nativeDeepSeek ? states?.get(group.id)?.efforts?.[model.id] : undefined
      const piModel = nativeDeepSeek && !advertised ? Object.values(DEEPSEEK_MODELS).find(entry => entry.id === model.id) : undefined
      const efforts = (model.reasoning?.efforts ?? []).filter(effort => {
        if (advertised) return advertised.includes(String(effort.id))
        if (!piModel) return true
        if (!piModel.reasoning) return false
        const mapped = (piModel.thinkingLevelMap as Readonly<Record<string, string | null>> | undefined)?.[effort.id]
        return mapped !== null && (!['xhigh', 'max'].includes(effort.id) || mapped !== undefined)
      })
      const defaultEffort = model.reasoning?.defaultEffort
      return {
        id: model.id,
        name: model.name,
        ...(model.description === undefined ? {} : { description: model.description }),
        ...(efforts.length === 0 ? {} : {
          efforts: efforts.map(effort => ({
            id: String(effort.id),
            name: effort.name,
            ...(effort.description === undefined ? {} : { description: effort.description }),
          })),
        }),
        ...(defaultEffort !== undefined && efforts.some(effort => effort.id === defaultEffort)
          ? { defaultEffort: String(defaultEffort) } : {}),
      }
    }),
  ]))
}

function validateModelEffort(models: ReadonlyMap<string, readonly LingModelOption[]>, selection: LingModelSelection): LingReadResult<void> {
  const model = models.get(selection.provider)?.find(model => model.id === selection.model)
  if (!model) return rejected('invalid-command', '该模型当前不可用。')
  if (selection.reasoningEffort !== undefined && !model.efforts?.some(effort => effort.id === selection.reasoningEffort)) {
    return rejected('invalid-command', '该模型不支持所选推理强度，请重新选择。')
  }
  return { ok: true, value: undefined }
}

function credentialState(
  reference: string | undefined,
  values: Readonly<Record<string, CredentialInfo>>,
): LingModelProvider['credential'] {
  if (reference === undefined) return 'not-required'
  const value = values[reference]
  if (value === undefined) return 'unknown'
  return value.configured ? 'configured' : 'missing'
}

function customProfile(
  context: ProviderContext,
): { readonly namespace: SettingsNamespaceView; readonly path: readonly string[] } | undefined {
  const path = customProviderPath(context.entry)
  if (path === undefined || context.namespace === undefined) return undefined
  if (!configured(context.namespace, path)) return undefined
  return { namespace: context.namespace, path }
}

function draftOf(providerId: string, profile: unknown): LingCustomProviderDraft | undefined {
  const record = recordOf(profile)
  const baseUrl = stringField(record, 'baseURL')
  const protocol = stringField(record, 'api')
  if (record === undefined || baseUrl === undefined || protocol === undefined) return undefined
  const models = Array.isArray(record.models)
    ? record.models.flatMap(entry => {
        const id = stringField(entry, 'id')
        if (id === undefined) return []
        const name = stringField(entry, 'name')
        return [{ id, ...(name === undefined ? {} : { name }) }]
      })
    : []
  const displayName = stringField(record, 'displayName')
  return {
    providerId,
    ...(displayName === undefined ? {} : { displayName }),
    baseUrl,
    protocol,
    models,
  }
}

function toProvider(
  context: ProviderContext,
  models: readonly LingModelOption[],
  credentials: Readonly<Record<string, CredentialInfo>>,
  writable: boolean,
  authorizations: ReadonlyMap<string, LingAuthorizationEntryView>,
): LingModelProvider {
  const reference = credentialReference(context)
  const profile = customProfile(context)
  const deletable = profile !== undefined && !layerHas(context.namespace, 'base', profile.path)
  const draft = draftOf(context.entry.provider, context.profile)
  const authorization = authorizations.get(context.entry.provider)
  return {
    providerId: context.entry.provider,
    displayName: authorization?.label ?? context.entry.displayName,
    active: context.entry.active,
    configurable: context.entry.configurable,
    configured: context.entry.configurable
      ? configured(context.namespace, context.entry.settingsPath)
      : context.entry.active,
    credential: credentialState(reference, credentials),
    canStoreApiKey: writableCredentialReference(context) !== undefined,
    ...(authorization === undefined ? {} : {
      authorization: {
        key: authorization.key,
        label: authorization.label,
        configured: authorization.configured,
        writable: authorization.writable,
        inFlight: authorization.inFlight,
        methods: authorization.methods,
      },
    }),
    ...(profile === undefined || !writable ? {} : { canEdit: true }),
    ...(deletable && writable ? { canDelete: true } : {}),
    ...(profile !== undefined && writable && draft !== undefined ? { canTest: true } : {}),
    ...(draft === undefined ? {} : { draft }),
    models,
    ...(context.entry.error === undefined ? {} : { error: context.entry.error }),
  }
}

function selectionFromCatalog(catalog: ModelCatalog): LingModelSelection {
  return {
    provider: catalog.default.provider,
    model: catalog.default.model,
    ...(catalog.default.reasoningEffort === undefined ? {} : { reasoningEffort: String(catalog.default.reasoningEffort) }),
  }
}

function isHttpUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

function validSelection(selection: LingModelSelection): boolean {
  return selection.provider.trim().length > 0 && selection.model.trim().length > 0
}

function customModels(models: readonly LingCustomProviderDraft['models'][number][]): readonly LingCustomProviderDraft['models'][number][] | undefined {
  const seen = new Set<string>()
  const normalized = models.flatMap(model => {
    const id = model.id.trim()
    if (!id || seen.has(id)) return []
    seen.add(id)
    const name = model.name?.trim()
    return [{ id, ...(name ? { name } : {}) }]
  })
  return normalized.length > 0 ? normalized : undefined
}

interface NormalizedDraft {
  readonly providerId: string
  readonly displayName?: string
  readonly baseUrl: string
  readonly protocol: string
  readonly models: readonly LingCustomProviderDraft['models'][number][]
  readonly apiKey?: string
}

function normalizeDraft(draft: LingCustomProviderDraft): LingReadResult<NormalizedDraft> {
  const providerId = draft.providerId.trim()
  const baseUrl = draft.baseUrl.trim()
  const protocol = draft.protocol.trim()
  const models = customModels(draft.models)
  if (!CUSTOM_PROVIDER_ID.test(providerId)) return rejected('invalid-command', '提供商标识格式不正确。')
  if (!isHttpUrl(baseUrl)) return rejected('invalid-command', '请输入有效的服务地址。')
  if (!protocol) return rejected('invalid-command', '请选择协议。')
  if (models === undefined) return rejected('invalid-command', '请至少添加一个模型。')
  const displayName = draft.displayName?.trim()
  const apiKey = draft.apiKey?.trim()
  return {
    ok: true,
    value: {
      providerId,
      baseUrl,
      protocol,
      models,
      ...(displayName ? { displayName } : {}),
      ...(apiKey ? { apiKey } : {}),
    },
  }
}

function profileModels(models: NormalizedDraft['models']): JsonValue[] {
  return models.map(model => jsonRecord({ id: model.id, ...(model.name === undefined ? {} : { name: model.name }) }))
}
function profileModelsFromProfile(value: unknown): (Record<string, JsonValue> & { id: string })[] {
  const models = recordOf(value)?.models
  return Array.isArray(models) ? models.flatMap(model => {
    const row = recordOf(model), id = stringField(row, 'id')
    return row && id ? [{ ...row, id } as Record<string, JsonValue> & { id: string }] : []
  }) : []
}

function discoveryOf(
  models: readonly { readonly id: string; readonly name?: string; readonly contextWindow?: number }[],
): readonly LingDiscoveredModel[] {
  return models.map(model => ({
    id: model.id,
    ...(model.name === undefined ? {} : { name: model.name }),
    ...(model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow }),
  }))
}

export function createDshModelSettingsProjection(
  remote: ClientRemote,
  authorization?: { list(): Promise<LingReadResult<readonly LingAuthorizationEntryView[]>> },
  catalogService?: () => Promise<LingModelCatalogRemote>,
) {
  const emitters = new Set<() => void>()
  let disposeEvents: (() => void) | undefined
  const emit = () => {
    for (const listener of [...emitters]) {
      try { listener() } catch {}
    }
  }

  return {
    async getSnapshot(_signal?: AbortSignal): Promise<LingReadResult<LingModelSettings>> {
      const [directory, catalog, authorizationDirectory, catalogDirectory] = await Promise.all([
        readDirectory(remote),
        remote.session.modelCatalog(),
        authorization?.list(),
        catalogService?.().then(service => service.list(_signal)).catch(() => undefined),
      ])
      if (!directory.ok) return directory
      if (!catalog.ok) return remoteFailure(catalog.error)
      const contexts = directory.value.entries.map(entry => providerContext(directory.value, entry.provider)).filter(
        (context): context is ProviderContext => context !== undefined,
      )
      const references = [...new Set(contexts.map(credentialReference).filter((value): value is string => value !== undefined))]
      const credentials = references.length === 0
        ? undefined
        : await remote.credentials.describe(references)
      const credentialValues = credentials?.ok ? credentials.value : {}
      const authorizations = new Map(
        authorizationDirectory?.ok === true
          ? authorizationDirectory.value.map(entry => [entry.providerId, entry] as const)
          : [],
      )
      const catalogStates = new Map(catalogDirectory?.ok ? catalogDirectory.value.map(state => [state.providerId, state] as const) : [])
      const models = modelsByProvider(catalog.value, directory.value, catalogStates)
      return {
        ok: true,
        value: {
          writable: directory.value.settings.writable,
          defaultSelection: selectionFromCatalog(catalog.value),
          providers: contexts.map(context => {
            const state = catalogStates.get(context.entry.provider)
            const provider = toProvider(context, models.get(context.entry.provider) ?? [], credentialValues, directory.value.settings.writable, authorizations)
            if (!state) return provider
            return { ...provider, catalog: state, models: provider.models.map(model => ({
              ...model,
              ...(state.newModelIds.includes(model.id) ? { catalogNew: true } : {}),
              ...(state.missingModelIds.includes(model.id) ? { catalogMissing: true } : {}),
              ...(state.unverifiedModelIds.includes(model.id) ? { catalogUnverified: true } : {}),
            })) }
          }),
        },
      }
    },
    async refreshProviderModels(providerId: string, signal?: AbortSignal): Promise<LingReadResult<LingModelCatalogState>> {
      if (!catalogService) return rejected('runtime-unavailable', '模型目录刷新暂不可用。', true)
      const result = await (await catalogService()).refresh(providerId, signal)
      emit()
      return result.ok ? { ok: true, value: result.value } : remoteFailure(result.error)
    },
    async validateSelection(selection: LingModelSelection): Promise<LingReadResult<void>> {
      const [directory, catalog, states] = await Promise.all([readDirectory(remote), remote.session.modelCatalog(), catalogService?.().then(service => service.list()).catch(() => undefined)])
      if (!directory.ok) return directory
      if (!catalog.ok) return remoteFailure(catalog.error)
      return validateModelEffort(modelsByProvider(catalog.value, directory.value, new Map(states?.ok ? states.value.map(state => [state.providerId, state]) : [])), selection)
    },
    async selectDefault(selection: LingModelSelection): Promise<LingReadResult<void>> {
      if (!validSelection(selection)) return rejected('invalid-command', '请选择有效的模型。')
      const [directory, catalog, states] = await Promise.all([
        readDirectory(remote),
        remote.session.modelCatalog(),
        catalogService?.().then(service => service.list()).catch(() => undefined),
      ])
      if (!directory.ok) return directory
      if (!catalog.ok) return remoteFailure(catalog.error)
      if (!directory.value.settings.writable) return rejected('permission-denied', '当前设置不可写。')
      const valid = validateModelEffort(modelsByProvider(catalog.value, directory.value, new Map(states?.ok ? states.value.map(state => [state.providerId, state]) : [])), selection)
      if (!valid.ok) return valid
      const namespace = directory.value.namespaces.get(DEFAULT_MODEL_NAMESPACE)
      if (namespace === undefined) return rejected('runtime-unavailable', '默认模型设置不可用。', true)
      const next = jsonRecord({
        provider: selection.provider,
        model: selection.model,
        ...(selection.reasoningEffort === undefined ? {} : { reasoningEffort: selection.reasoningEffort }),
      })
      const response = await remote.settings.replace(DEFAULT_MODEL_NAMESPACE, next, namespace.revision)
      if (!response.ok) return remoteFailure(response.error)
      return { ok: true, value: undefined }
    },
    async storeApiKey(providerId: string, apiKey: string): Promise<LingReadResult<void>> {
      const value = apiKey.trim()
      if (!value) return rejected('invalid-command', '请输入 API Key。')
      const directory = await readDirectory(remote)
      if (!directory.ok) return directory
      if (!directory.value.settings.writable) return rejected('permission-denied', '当前设置不可写。')
      const context = providerContext(directory.value, providerId)
      if (context === undefined || !context.entry.configurable) return rejected('invalid-command', '该提供商不支持在这里配置。')
      const reference = writableCredentialReference(context)
      if (reference === undefined) return rejected('invalid-command', '该提供商没有可配置的 API Key。')
      if (context.credentialRef === undefined) {
        const namespace = context.namespace
        const path = customProviderPath(context.entry) ?? context.entry.settingsPath
        if (namespace === undefined || path === undefined) return rejected('runtime-unavailable', '提供商设置不可用。', true)
        const op: SettingsPathOpView = { op: 'set', path: [...path, 'apiKeyEnv'], value: reference }
        const linked = await remote.settings.mutate(namespace.ns, [op], namespace.revision)
        if (!linked.ok) return remoteFailure(linked.error)
      }
      const stored = await remote.credentials.set(reference, value)
      if (!stored.ok) return remoteFailure(stored.error)
      return { ok: true, value: undefined }
    },
    async createCustomProvider(draft: LingCustomProviderDraft): Promise<LingReadResult<void>> {
      const normalized = normalizeDraft(draft)
      if (!normalized.ok) return normalized
      const value = normalized.value
      const directory = await readDirectory(remote)
      if (!directory.ok) return directory
      if (!directory.value.settings.writable) return rejected('permission-denied', '当前设置不可写。')
      if (directory.value.entries.some(entry => entry.provider === value.providerId)) {
        return rejected('invalid-command', '该提供商标识已存在。')
      }
      const namespace = directory.value.namespaces.get(CUSTOM_PROVIDER_NAMESPACE)
      if (namespace === undefined) return rejected('runtime-unavailable', '自定义提供商不可用。', true)
      const profile = jsonRecord({
        ...(value.displayName === undefined ? {} : { displayName: value.displayName }),
        ...(value.apiKey === undefined ? {} : { apiKeyEnv: derivedCredentialRef(value.providerId) }),
        api: value.protocol,
        baseURL: value.baseUrl,
        models: profileModels(value.models),
      })
      const operation: SettingsPathOpView = {
        op: 'set',
        path: ['providers', value.providerId],
        value: profile,
      }
      const saved = await remote.settings.mutate(namespace.ns, [operation], namespace.revision)
      if (!saved.ok) return remoteFailure(saved.error)
      if (value.apiKey !== undefined) {
        const stored = await remote.credentials.set(derivedCredentialRef(value.providerId), value.apiKey)
        if (!stored.ok) return remoteFailure(stored.error)
      }
      return { ok: true, value: undefined }
    },
    async updateCustomProvider(draft: LingCustomProviderDraft): Promise<LingReadResult<void>> {
      const normalized = normalizeDraft(draft)
      if (!normalized.ok) return normalized
      const value = normalized.value
      const directory = await readDirectory(remote)
      if (!directory.ok) return directory
      if (!directory.value.settings.writable) return rejected('permission-denied', '当前设置不可写。')
      const context = providerContext(directory.value, value.providerId)
      if (context === undefined) return rejected('invalid-command', '未找到该提供商。')
      const profile = customProfile(context)
      if (profile === undefined) return rejected('invalid-command', '该提供商暂不支持在这里修改。')
      const stored = context.profile
      const existingModels = new Map(profileModelsFromProfile(stored).map(model => [model.id, model]))
      const reference = credentialRef(stored) ?? derivedCredentialRef(value.providerId)
      const ops: SettingsPathOpView[] = [
        { op: 'set', path: [...profile.path, 'api'], value: value.protocol },
        { op: 'set', path: [...profile.path, 'baseURL'], value: value.baseUrl },
        { op: 'set', path: [...profile.path, 'models'], value: value.models.map(model => ({ ...existingModels.get(model.id), id: model.id, ...(model.name ? { name: model.name } : {}) })) },
      ]
      if (value.displayName === undefined) {
        if (stringField(stored, 'displayName') !== undefined) ops.push({ op: 'unset', path: [...profile.path, 'displayName'] })
      } else {
        ops.push({ op: 'set', path: [...profile.path, 'displayName'], value: value.displayName })
      }
      if (value.apiKey !== undefined && credentialRef(stored) === undefined) {
        ops.push({ op: 'set', path: [...profile.path, 'apiKeyEnv'], value: reference })
      }
      const saved = await remote.settings.mutate(profile.namespace.ns, ops, profile.namespace.revision)
      if (!saved.ok) return remoteFailure(saved.error)
      if (value.apiKey !== undefined) {
        const storedKey = await remote.credentials.set(reference, value.apiKey)
        if (!storedKey.ok) return remoteFailure(storedKey.error)
      }
      return { ok: true, value: undefined }
    },
    async deleteProvider(providerId: string): Promise<LingReadResult<void>> {
      const directory = await readDirectory(remote)
      if (!directory.ok) return directory
      if (!directory.value.settings.writable) return rejected('permission-denied', '当前设置不可写。')
      const context = providerContext(directory.value, providerId)
      if (context === undefined) return rejected('invalid-command', '未找到该提供商。')
      const profile = customProfile(context)
      if (profile === undefined) return rejected('invalid-command', '该提供商暂不支持在这里删除。')
      if (layerHas(context.namespace, 'base', profile.path)) return rejected('permission-denied', '该提供商暂不支持在这里删除。')
      const reference = credentialRef(atPath(profile.namespace.value, profile.path))
      if (reference !== undefined) {
        const cleared = await remote.credentials.unset(reference)
        if (!cleared.ok) return remoteFailure(cleared.error)
      }
      const removed = await remote.settings.mutate(
        profile.namespace.ns,
        [{ op: 'unset', path: [...profile.path] }],
        profile.namespace.revision,
      )
      if (!removed.ok) return remoteFailure(removed.error)
      return { ok: true, value: undefined }
    },
    async testProvider(target: LingProviderTestTarget, signal?: AbortSignal): Promise<LingReadResult<readonly LingDiscoveredModel[]>> {
      const providerId = target.providerId?.trim()
      if (providerId !== undefined && providerId.length > 0) {
        if (catalogService) {
          const result = await (await catalogService()).probe(providerId, signal)
          return result.ok ? { ok: true, value: result.value } : remoteFailure(result.error)
        }
        const directory = await readDirectory(remote)
        if (!directory.ok) return directory
        const context = providerContext(directory.value, providerId)
        if (context === undefined) return rejected('invalid-command', '该提供商暂不支持在这里测试。')
        const profile = customProfile(context)
        if (profile === undefined) return rejected('invalid-command', '该提供商暂不支持在这里测试。')
        const stored = atPath(profile.namespace.value, profile.path)
        const endpoint = stringField(stored, 'baseURL')
        if (endpoint === undefined) return rejected('invalid-command', '该提供商没有可探测的服务地址。')
        const api = stringField(stored, 'api')
        const response = await remote.llm.discoverModels(profile.namespace.ns, {
          provider: providerId,
          baseURL: endpoint,
          ...(api === undefined ? {} : { api }),
        }, signal)
        if (!response.ok) return remoteFailure(response.error)
        return { ok: true, value: discoveryOf(response.value) }
      }
      const baseUrl = target.baseUrl?.trim()
      if (baseUrl === undefined || baseUrl.length === 0) return rejected('invalid-command', '请先填写服务地址。')
      if (!isHttpUrl(baseUrl)) return rejected('invalid-command', '请输入有效的服务地址。')
      const protocol = target.protocol?.trim()
      const apiKey = target.apiKey?.trim()
      const response = await remote.llm.discoverModels(CUSTOM_PROVIDER_NAMESPACE, {
        baseURL: baseUrl,
        ...(protocol === undefined || protocol.length === 0 ? {} : { api: protocol }),
        ...(apiKey === undefined || apiKey.length === 0 ? {} : { apiKey }),
      }, signal)
      if (!response.ok) return remoteFailure(response.error)
      return { ok: true, value: discoveryOf(response.value) }
    },
    subscribe(listener: () => void): () => void {
      emitters.add(listener)
      if (disposeEvents === undefined) {
        const disposers = [
          remote.$on('llm/adapters-updated', emit),
          remote.$on('settings/document-updated', emit),
          remote.$on('credentials/reference-updated', emit),
        ]
        disposeEvents = () => {
          for (const dispose of disposers) dispose()
        }
      }
      return () => {
        emitters.delete(listener)
        if (emitters.size === 0) {
          disposeEvents?.()
          disposeEvents = undefined
        }
      }
    },
  }
}
