import { describe, expect, it, vi } from 'vitest'
import { createDshModelSettingsProjection } from '../src/client/model-settings-projection.js'

const answer = <Value>(value: Value) => ({ ok: true as const, value })

interface FixtureOptions {
  readonly baseLayer?: boolean
  readonly noCredentialRef?: boolean
  readonly writable?: boolean
}

function remoteFixture(options: FixtureOptions = {}) {
  const profile: Record<string, unknown> = {
    displayName: 'OpenAI',
    baseURL: 'https://api.openai.test/v1',
    api: 'openai-responses',
    models: [{ id: 'gpt-5', name: 'GPT-5' }],
    ...(options.noCredentialRef === true ? {} : { apiKeyEnv: 'OPENAI_API_KEY' }),
  }
  const layer = { providers: { openai: profile } }
  const describe = vi.fn(async () => answer({
    writable: options.writable ?? true,
    hasDocument: true,
    namespaces: [
      { ns: 'agent-default-model', schema: {}, value: { provider: 'openai', model: 'gpt-5' }, applies: true, secrets: [], revision: 4 },
      { ns: 'llm-deepseek', schema: {}, value: { apiKeyEnv: 'DEEPSEEK_API_KEY' }, applies: true, secrets: [], revision: 5 },
      {
        ns: 'llm-pi-ai',
        schema: {},
        value: layer,
        ...(options.baseLayer === true ? { base: layer } : {}),
        user: layer,
        applies: true,
        secrets: [],
        revision: 6,
      },
    ],
  }))
  const replace = vi.fn(async () => answer({ ns: 'agent-default-model', schema: {}, value: {}, applies: true, secrets: [], revision: 5 }))
  const mutate = vi.fn(async () => answer({ ns: 'llm-pi-ai', schema: {}, value: {}, applies: true, secrets: [], revision: 7 }))
  const set = vi.fn(async () => answer(undefined))
  const unset = vi.fn(async () => answer(undefined))
  const discoverModels = vi.fn(async () => answer([
    { id: 'gpt-5', name: 'GPT-5', contextWindow: 200000 },
  ]))
  const remove = vi.fn()
  const remote = {
    settings: { describe, replace, mutate },
    llm: {
      listProviders: vi.fn(async () => answer([
        { id: 'deepseek-official', name: 'DeepSeek' },
        { id: 'openai', name: 'OpenAI' },
      ])),
      listConfigurableProviders: vi.fn(async () => answer([
        { provider: 'deepseek-official', displayName: 'DeepSeek', settingsNs: 'llm-deepseek', settingsPath: [] },
        { provider: 'openai', displayName: 'OpenAI', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'openai'] },
      ])),
      discoverModels,
    },
    session: {
      modelCatalog: vi.fn(async () => answer({
        default: { provider: 'openai', model: 'gpt-5' },
        routableProviders: ['deepseek-official', 'openai'],
        groups: [
          { id: 'deepseek-official', name: 'DeepSeek', models: [{ id: 'deepseek-chat', name: 'DeepSeek Chat', reasoning: { efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High', description: '深度推理' }], defaultEffort: 'low' } }] },
          { id: 'openai', name: 'OpenAI', models: [{ id: 'gpt-5', name: 'GPT-5', reasoning: { efforts: [] } }] },
        ],
        failures: [],
      })),
    },
    credentials: {
      describe: vi.fn(async () => answer({
        DEEPSEEK_API_KEY: { configured: true, writable: true },
        OPENAI_API_KEY: { configured: false, writable: true },
      })),
      set,
      unset,
    },
    $on: vi.fn((_event, _listener) => remove),
  }
  return {
    projection: createDshModelSettingsProjection(remote as never),
    modelCatalog: remote.session.modelCatalog,
    describe,
    discoverModels,
    mutate,
    remove,
    replace,
    set,
    unset,
  }
}

describe('DSH model settings projection', () => {
  it('narrows native DeepSeek choices using the exact Pi model map', async () => {
    const { projection, modelCatalog } = remoteFixture()
    const catalog = (await modelCatalog()).value
    const model = catalog.groups[0]!.models[0]!
    model.id = 'deepseek-v4-pro'
    model.reasoning!.efforts = ['off', 'low', 'high', 'xhigh', 'max'].map(id => ({ id, name: id }))
    model.reasoning = { ...model.reasoning!, defaultEffort: 'high' }
    modelCatalog.mockResolvedValue(answer(catalog))
    const result = await projection.getSnapshot()
    expect(result.ok && result.value.providers[0]!.models[0]).toMatchObject({
      id: 'deepseek-v4-pro', defaultEffort: 'high',
      efforts: [{ id: 'off' }, { id: 'high' }, { id: 'max' }],
    })
    await expect(projection.validateSelection({ provider: 'deepseek-official', model: model.id, reasoningEffort: 'low' })).resolves.toMatchObject({ ok: false, reason: 'invalid-command' })
    await expect(projection.validateSelection({ provider: 'deepseek-official', model: model.id, reasoningEffort: 'max' })).resolves.toEqual({ ok: true, value: undefined })
  })

  it('preserves resolved Pi route overrides and rejects unadvertised levels before saving', async () => {
    const { projection, modelCatalog, replace } = remoteFixture()
    const catalog = (await modelCatalog()).value
    const model = catalog.groups[1]!.models[0]!
    model.id = 'deepseek-v4-pro'
    model.reasoning!.efforts = [{ id: 'low', name: 'Deployment low' }]
    modelCatalog.mockResolvedValue(answer(catalog))
    await expect(projection.validateSelection({ provider: 'openai', model: model.id, reasoningEffort: 'low' })).resolves.toEqual({ ok: true, value: undefined })
    await expect(projection.selectDefault({ provider: 'openai', model: model.id, reasoningEffort: 'max' })).resolves.toMatchObject({ ok: false, reason: 'invalid-command' })
    expect(replace).not.toHaveBeenCalled()
  })

  it('allows provider default but no explicit reasoning for a model without capabilities', async () => {
    const { projection } = remoteFixture()
    await expect(projection.validateSelection({ provider: 'openai', model: 'gpt-5' })).resolves.toEqual({ ok: true, value: undefined })
    await expect(projection.validateSelection({ provider: 'openai', model: 'gpt-5', reasoningEffort: 'off' })).resolves.toMatchObject({ ok: false })
  })

  it('projects catalog, configuration, and credential state without exposing credential values', async () => {
    const { projection } = remoteFixture()

    await expect(projection.getSnapshot()).resolves.toEqual({
      ok: true,
      value: {
        writable: true,
        defaultSelection: { provider: 'openai', model: 'gpt-5' },
        providers: [
          {
            providerId: 'deepseek-official',
            displayName: 'DeepSeek',
            active: true,
            configurable: true,
            configured: true,
            credential: 'configured',
            canStoreApiKey: true,
            models: [{
              id: 'deepseek-chat',
              name: 'DeepSeek Chat',
              defaultEffort: 'low',
              efforts: [
                { id: 'low', name: 'Low' },
                { id: 'high', name: 'High', description: '深度推理' },
              ],
            }],
          },
          {
            providerId: 'openai',
            displayName: 'OpenAI',
            active: true,
            configurable: true,
            configured: true,
            credential: 'missing',
            canStoreApiKey: true,
            canEdit: true,
            canDelete: true,
            canTest: true,
            draft: {
              providerId: 'openai',
              displayName: 'OpenAI',
              baseUrl: 'https://api.openai.test/v1',
              protocol: 'openai-responses',
              models: [{ id: 'gpt-5', name: 'GPT-5' }],
            },
            models: [{ id: 'gpt-5', name: 'GPT-5' }],
          },
        ],
      },
    })
  })

  it('writes the default selection through the settings document revision', async () => {
    const { projection, replace } = remoteFixture()

    await expect(projection.selectDefault({ provider: 'deepseek-official', model: 'deepseek-chat' })).resolves.toEqual({ ok: true, value: undefined })
    expect(replace).toHaveBeenCalledWith('agent-default-model', {
      provider: 'deepseek-official',
      model: 'deepseek-chat',
    }, 4)
  })

  it('carries a reasoning effort into the default selection document', async () => {
    const { projection, replace } = remoteFixture()

    await projection.selectDefault({ provider: 'deepseek-official', model: 'deepseek-chat', reasoningEffort: 'high' })
    expect(replace).toHaveBeenLastCalledWith('agent-default-model', {
      provider: 'deepseek-official',
      model: 'deepseek-chat',
      reasoningEffort: 'high',
    }, 4)
  })

  it('stores a provider credential through its declared reference', async () => {
    const { projection, mutate, set } = remoteFixture()

    await expect(projection.storeApiKey('openai', 'fixture-key')).resolves.toEqual({ ok: true, value: undefined })
    expect(mutate).not.toHaveBeenCalled()
    expect(set).toHaveBeenCalledWith('OPENAI_API_KEY', 'fixture-key')
  })

  it('creates a custom provider through the pi-ai settings profile', async () => {
    const { projection, mutate, set } = remoteFixture()

    await expect(projection.createCustomProvider({
      providerId: 'acme-gateway',
      displayName: 'Acme Gateway',
      baseUrl: 'https://api.acme.test/v1',
      protocol: 'openai-responses',
      models: [{ id: 'acme-code' }],
      apiKey: 'fixture-key',
    })).resolves.toEqual({ ok: true, value: undefined })
    expect(mutate).toHaveBeenCalledWith('llm-pi-ai', [{
      op: 'set',
      path: ['providers', 'acme-gateway'],
      value: {
        displayName: 'Acme Gateway',
        apiKeyEnv: 'ACME_GATEWAY_API_KEY',
        api: 'openai-responses',
        baseURL: 'https://api.acme.test/v1',
        models: [{ id: 'acme-code' }],
      },
    }], 6)
    expect(set).toHaveBeenCalledWith('ACME_GATEWAY_API_KEY', 'fixture-key')
  })

  it('rewrites a stored custom profile as a path-addressed diff and keeps the unsaved key out of it', async () => {
    const { projection, mutate, set } = remoteFixture()

    await expect(projection.updateCustomProvider({
      providerId: 'openai',
      baseUrl: 'https://api.openai.test/v2',
      protocol: 'openai-completions',
      models: [{ id: 'gpt-5', name: 'GPT-5' }, { id: 'gpt-5-mini' }],
      apiKey: 'fixture-key',
    })).resolves.toEqual({ ok: true, value: undefined })
    expect(mutate).toHaveBeenCalledWith('llm-pi-ai', [
      { op: 'set', path: ['providers', 'openai', 'api'], value: 'openai-completions' },
      { op: 'set', path: ['providers', 'openai', 'baseURL'], value: 'https://api.openai.test/v2' },
      { op: 'set', path: ['providers', 'openai', 'models'], value: [{ id: 'gpt-5', name: 'GPT-5' }, { id: 'gpt-5-mini' }] },
      { op: 'unset', path: ['providers', 'openai', 'displayName'] },
    ], 6)
    expect(set).toHaveBeenCalledWith('OPENAI_API_KEY', 'fixture-key')
  })

  it('refuses to edit a provider that has no configurable profile of its own', async () => {
    const { projection, mutate } = remoteFixture()

    await expect(projection.updateCustomProvider({
      providerId: 'deepseek-official',
      baseUrl: 'https://api.deepseek.test/v1',
      protocol: 'openai-completions',
      models: [{ id: 'deepseek-chat' }],
    })).resolves.toMatchObject({ ok: false, reason: 'invalid-command' })
    expect(mutate).not.toHaveBeenCalled()
  })

  it('removes a user-layer provider and clears only the credential reference it declares', async () => {
    const { projection, mutate, unset } = remoteFixture()

    await expect(projection.deleteProvider('openai')).resolves.toEqual({ ok: true, value: undefined })
    expect(unset).toHaveBeenCalledWith('OPENAI_API_KEY')
    expect(mutate).toHaveBeenCalledWith('llm-pi-ai', [{ op: 'unset', path: ['providers', 'openai'] }], 6)
  })

  it('leaves an inherited credential name untouched when the profile does not declare it', async () => {
    const { projection, mutate, unset } = remoteFixture({ noCredentialRef: true })

    await expect(projection.deleteProvider('openai')).resolves.toEqual({ ok: true, value: undefined })
    expect(unset).not.toHaveBeenCalled()
    expect(mutate).toHaveBeenCalledWith('llm-pi-ai', [{ op: 'unset', path: ['providers', 'openai'] }], 6)
  })

  it('keeps a base-layer provider out of the delete surface', async () => {
    const { mutate, projection, unset } = remoteFixture({ baseLayer: true })

    const snapshot = await projection.getSnapshot()
    if (!snapshot.ok) throw new Error('expected a readable snapshot')
    expect(snapshot.value.providers[1]).not.toHaveProperty('canDelete')
    expect(snapshot.value.providers[1]).toHaveProperty('canEdit', true)

    await expect(projection.deleteProvider('openai')).resolves.toMatchObject({ ok: false, reason: 'permission-denied' })
    expect(unset).not.toHaveBeenCalled()
    expect(mutate).not.toHaveBeenCalled()
  })

  it('withholds edit, delete and test affordances from a read-only configuration', async () => {
    const { projection } = remoteFixture({ writable: false })

    const snapshot = await projection.getSnapshot()
    if (!snapshot.ok) throw new Error('expected a readable snapshot')
    expect(snapshot.value.writable).toBe(false)
    expect(snapshot.value.providers[1]).not.toHaveProperty('canEdit')
    expect(snapshot.value.providers[1]).not.toHaveProperty('canDelete')
    expect(snapshot.value.providers[1]).not.toHaveProperty('canTest')
    await expect(projection.deleteProvider('openai')).resolves.toMatchObject({ ok: false, reason: 'permission-denied' })
  })

  it('tests a stored provider against its saved endpoint and protocol', async () => {
    const { discoverModels, projection } = remoteFixture()

    await expect(projection.testProvider({ providerId: 'openai' })).resolves.toEqual({
      ok: true,
      value: [{ id: 'gpt-5', name: 'GPT-5', contextWindow: 200000 }],
    })
    expect(discoverModels).toHaveBeenCalledWith('llm-pi-ai', {
      provider: 'openai',
      baseURL: 'https://api.openai.test/v1',
      api: 'openai-responses',
    }, undefined)
  })

  it('tests an unsaved draft without writing the supplied key anywhere', async () => {
    const { discoverModels, projection, set } = remoteFixture()

    await projection.testProvider({
      baseUrl: 'https://api.acme.test/v1',
      protocol: 'openai-responses',
      apiKey: 'fixture-key',
    })
    expect(discoverModels).toHaveBeenCalledWith('llm-pi-ai', {
      baseURL: 'https://api.acme.test/v1',
      api: 'openai-responses',
      apiKey: 'fixture-key',
    }, undefined)
    expect(set).not.toHaveBeenCalled()
  })

  it('rejects a connectivity test before touching the network for a non-http endpoint', async () => {
    const { discoverModels, projection } = remoteFixture()

    await expect(projection.testProvider({ baseUrl: 'ftp://api.acme.test/v1' })).resolves.toMatchObject({
      ok: false,
      reason: 'invalid-command',
    })
    expect(discoverModels).not.toHaveBeenCalled()
  })

  it('owns one subscription set until the last listener leaves', () => {
    const { projection, remove } = remoteFixture()
    const first = projection.subscribe(() => {})
    const second = projection.subscribe(() => {})

    first()
    expect(remove).not.toHaveBeenCalled()
    second()
    expect(remove).toHaveBeenCalledTimes(3)
  })
})
