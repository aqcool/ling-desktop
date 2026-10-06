import { createHash } from 'node:crypto'

export interface CatalogModel {
  readonly id: string
  readonly name?: string
  readonly contextWindow?: number
  readonly maxTokens?: number
  readonly input?: readonly ('text' | 'image')[]
  readonly efforts?: readonly string[]
  readonly reasoningEfforts?: Readonly<Record<string, string | null>>
  readonly systemPromptUpdate?: 'leading-only' | 'in-history'
  readonly conversational: boolean
}
export interface CatalogConnection {
  readonly providerId: string
  readonly namespace: string
  readonly path: readonly string[]
  readonly baseUrl: string
  readonly api: string
  readonly headers: Readonly<Record<string, string>>
  readonly apiKey?: string
  /** Stable account identity for OAuth catalogs; rotating access tokens are not catalog identities. */
  readonly credentialIdentity?: string
  readonly native: boolean
}
export type ModelProfile = Record<string, unknown> & { id: string }
export interface CatalogCacheEntry {
  readonly identity: string
  readonly updatedAt: number
  readonly models: readonly CatalogModel[]
  readonly newModelIds: readonly string[]
  readonly pending: boolean
  // Only fields written by this feature. User edits always win over these.
  readonly generated: Readonly<Record<string, Readonly<Record<string, unknown>>>>
}

export function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}
export function string(value: unknown): string | undefined { return typeof value === 'string' && value.trim() ? value.trim() : undefined }
function positive(value: unknown): number | undefined { return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined }
export function profileModels(value: unknown): ModelProfile[] {
  return Array.isArray(value) ? value.flatMap(item => {
    const row = record(item), id = string(row?.id)
    return row && id ? [{ ...row, id }] : []
  }) : []
}

/** Hash connection/account identity; credentials and endpoint headers never leave the Host. */
export function connectionIdentity(connection: CatalogConnection): string {
  return createHash('sha256').update(JSON.stringify([
    connection.providerId, connection.namespace, connection.path, connection.baseUrl, connection.api,
    Object.entries(connection.headers).filter(([key]) => !connection.credentialIdentity || !/^(authorization|chatgpt-account-id)$/i.test(key)).sort(([a], [b]) => a.localeCompare(b)), connection.credentialIdentity ?? connection.apiKey ?? '',
  ])).digest('hex')
}
export function listable(api: string): boolean {
  return ['openai-completions', 'openai-responses', 'anthropic-messages', 'openai-codex-responses'].includes(api)
}
export function catalogUrl(connection: CatalogConnection): URL {
  const url = new URL(connection.baseUrl)
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('服务地址不支持模型目录刷新。')
  const base = url.pathname.replace(/\/+$/, '')
  if (connection.api === 'openai-codex-responses') {
    url.pathname = `${base.replace(/\/codex(?:\/responses)?$/, '')}/codex/models`
    // Catalog schema compatibility baseline, independent of LING's product version.
    // Verified against the official Codex 0.160.0 ModelsResponse contract.
    url.searchParams.set('client_version', '0.160.0')
    return url
  }
  url.pathname = connection.api === 'anthropic-messages'
    ? `${base.replace(/\/v1$/, '')}/v1/models`
    : `${base}/models`
  if (connection.api === 'anthropic-messages') url.searchParams.set('limit', '1000')
  return url
}

function parseModel(row: unknown, idFromMap: string | undefined, connection: CatalogConnection): CatalogModel {
  const codex = connection.api === 'openai-codex-responses'
  const value = record(row), id = string(codex ? value?.slug : value?.id) ?? idFromMap
  if (!value || !id || id.length > 1024 || /[\u0000-\u001f]/.test(id)) throw new Error('供应商返回了不完整的模型目录，已保留原目录。')
  const name = string(value.name) ?? string(value.display_name)
  const limits = record(value.limit)
  const contextWindow = positive(value.context_window) ?? positive(value.contextWindow) ?? positive(value.max_input_tokens) ?? positive(value.context_length) ?? positive(limits?.context)
  const maxTokens = positive(value.max_output_tokens) ?? positive(value.max_tokens) ?? positive(value.maxTokens) ?? positive(limits?.output)
  const modalities = value.input_modalities ?? value.input ?? record(value.modalities)?.input
  const input = Array.isArray(modalities) && modalities.every(item => item === 'text' || item === 'image') && modalities.length
    ? [...new Set(modalities)] as ('text' | 'image')[] : undefined
  const levels = codex && Array.isArray(value.supported_reasoning_levels) ? value.supported_reasoning_levels.map(level => record(level)?.effort) : record(value.effort)?.supported_levels
  // Pi exposes these portable levels. Codex ultra also delegates tasks, which
  // the current DSH/Pi request contract cannot represent.
  const codexEfforts = codex && Array.isArray(levels) ? levels.filter((level): level is string => ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(String(level))) : undefined
  const reasoningEfforts = codexEfforts?.length ? Object.fromEntries(codexEfforts.map(level => [level === 'none' ? 'off' : level, level])) : undefined
  const efforts = Array.isArray(levels) && levels.every(level => ['low', 'medium', 'high', 'xhigh', 'max'].includes(String(level)))
    ? levels as string[] : undefined
  const update = record(record(value.api_capabilities)?.anthropic_messages)?.system_prompt_update
  const outputs = value.output_modalities ?? record(value.modalities)?.output
  const conversational = codex || connection.api === 'anthropic-messages' || (Array.isArray(outputs) && outputs.includes('text') && (!Array.isArray(modalities) || modalities.includes('text')))
  return { id, conversational, ...(name ? { name: name.slice(0, 1024) } : {}), ...(contextWindow ? { contextWindow } : {}), ...(maxTokens ? { maxTokens } : {}), ...(input ? { input } : {}), ...(reasoningEfforts ? { reasoningEfforts, efforts: Object.keys(reasoningEfforts) } : efforts ? { efforts } : {}), ...(update === 'in-history' || update === 'leading-only' ? { systemPromptUpdate: update } : {}) }
}

const MAX_BYTES = 4 * 1024 * 1024
async function boundedJson(response: Response): Promise<unknown> {
  if (Number(response.headers.get('content-length')) > MAX_BYTES) { await response.body?.cancel(); throw new Error('供应商模型目录过大，已保留原目录。') }
  if (!response.body) throw new Error('供应商返回了空的模型目录，已保留原目录。')
  const reader = response.body.getReader(), chunks: Uint8Array[] = []
  let bytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > MAX_BYTES) throw new Error('供应商模型目录过大，已保留原目录。')
      chunks.push(value)
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
  const buffer = Buffer.concat(chunks)
  try { return JSON.parse(buffer.toString('utf8')) } catch { throw new Error('供应商没有返回有效的模型目录，已保留原目录。') }
}

/** Fetch the configured endpoint, including all pages; never fall back to a public vendor URL. */
export async function fetchCatalog(connection: CatalogConnection, signal: AbortSignal, fetcher: typeof fetch = globalThis.fetch): Promise<CatalogModel[]> {
  if (!listable(connection.api)) throw new Error('当前协议使用内置模型目录。')
  const url = catalogUrl(connection), headers = new Headers(connection.headers)
  headers.set('accept', 'application/json')
  if (connection.api === 'anthropic-messages') {
    if (connection.apiKey) headers.set('x-api-key', connection.apiKey)
    if (!headers.has('anthropic-version')) headers.set('anthropic-version', '2023-06-01')
  } else if (connection.apiKey) headers.set('authorization', `Bearer ${connection.apiKey}`)
  const models = new Map<string, CatalogModel>(), cursors = new Set<string>()
  for (let page = 0; page < 20; page++) {
    signal.throwIfAborted()
    let response: Response
    try { response = await fetcher(url, { headers, signal, redirect: 'error' }) }
    catch { signal.throwIfAborted(); throw new Error('无法连接供应商，已保留原模型目录。') }
    if (!response.ok) {
      await response.body?.cancel()
      // Neither response bodies nor URLs may expose credentials in diagnostics.
      throw new Error(response.status === 401 || response.status === 403 ? '供应商授权失败，已保留原模型目录。' : `供应商刷新失败（HTTP ${response.status}），已保留原模型目录。`)
    }
    const value = record(await boundedJson(response))
    if (value?.has_more !== undefined && typeof value.has_more !== 'boolean') throw new Error('供应商目录分页不完整，已保留原目录。')
    const codex = connection.api === 'openai-codex-responses'
    const rows = codex && Array.isArray(value?.models) ? value.models.map(row => [undefined, row] as const)
      : Array.isArray(value?.data) ? value.data.map(row => [undefined, row] as const)
      : record(value?.models) ? Object.entries(record(value!.models)!) : undefined
    if (!rows || !rows.length) throw new Error('供应商返回了空的模型目录，已保留原目录。')
    for (const [key, row] of rows) {
      const model = parseModel(row, key, connection)
      if (codex && record(row)?.visibility !== 'list') continue
      models.set(model.id, model)
      if (models.size > 10000) throw new Error('供应商模型目录过大，已保留原目录。')
    }
    if (value?.has_more !== true) {
      if (!models.size) throw new Error('供应商返回了空的模型目录，已保留原目录。')
      return [...models.values()]
    }
    const cursor = string(value.last_id) ?? string(record(rows.at(-1)?.[1])?.id)
    if (!cursor || cursors.has(cursor)) throw new Error('供应商目录分页不完整，已保留原目录。')
    cursors.add(cursor)
    url.searchParams.set('after_id', cursor)
    if (!url.searchParams.has('limit')) url.searchParams.set('limit', '1000')
  }
  throw new Error('供应商目录分页不完整，已保留原目录。')
}

export function modelFields(model: CatalogModel, native: boolean): Record<string, unknown> {
  return {
    ...(model.name ? { name: model.name } : {}),
    ...(model.contextWindow ? { contextWindow: model.contextWindow } : {}),
    ...(model.maxTokens ? { maxTokens: model.maxTokens } : {}),
    ...(model.input ? { [native ? 'inputModalities' : 'input']: model.input } : {}),
    // This pinned DSH represents leading-only by absence, and accepts only
    // in-history explicitly. Keep the endpoint's full metadata in the cache.
    ...(native && model.systemPromptUpdate === 'in-history' ? { systemPromptUpdate: 'in-history' } : {}),
    ...(!native && model.reasoningEfforts ? { reasoningEfforts: model.reasoningEfforts } : !native && model.efforts?.length ? { reasoningEfforts: Object.fromEntries([['off', null], ...model.efforts.map(level => [level, level])]) } : {}),
  }
}
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** Additive merge: explicit fields win, only our unchanged fields can be refreshed. */
export function mergeCatalog(existing: readonly ModelProfile[], discovered: readonly CatalogModel[], native: boolean, previous?: CatalogCacheEntry) {
  const models = existing.map(model => structuredClone(model)), byId = new Map(models.map(model => [model.id, model]))
  const generated: Record<string, Record<string, unknown>> = Object.create(null)
  const newModelIds = previous?.newModelIds.filter(id => byId.has(id)) ?? []
  for (const advertised of discovered) {
    let model = byId.get(advertised.id)
    if (!model) { model = { id: advertised.id }; models.push(model); byId.set(model.id, model); newModelIds.push(model.id) }
    const owned = previous?.generated[advertised.id] ?? {}
    const fields = modelFields(advertised, native)
    const leadingOnly = native && advertised.systemPromptUpdate === 'leading-only'
    if (leadingOnly && 'systemPromptUpdate' in owned && equal(model.systemPromptUpdate, owned.systemPromptUpdate)) delete model.systemPromptUpdate
    for (const [field, value] of Object.entries(fields)) {
      if (!(field in model) || (field in owned && equal(model[field], owned[field]))) {
        model[field] = value
        ;(generated[model.id] ??= Object.create(null))[field] = value
      }
    }
    // Missing capability fields never erase the last successful metadata.
    for (const [field, value] of Object.entries(owned)) if (!(field in fields) && !(leadingOnly && field === 'systemPromptUpdate') && equal(model[field], value)) (generated[model.id] ??= Object.create(null))[field] = value
  }
  for (const model of models) if (!discovered.some(row => row.id === model.id) && previous?.generated[model.id]) generated[model.id] = structuredClone(previous.generated[model.id]) as Record<string, unknown>
  return { models, generated, newModelIds: [...new Set(newModelIds)] }
}
