import { describe, expect, it } from 'vitest'
import { enabledModelOptions, modelVisibilityKey, parseDisabledModels, replacementDefaultModel, withModelVisibility } from '../src/model-visibility.js'
import type { LingModelSettings } from '../src/runtime/contract.js'

const settings: LingModelSettings = {
  writable: true,
  defaultSelection: { provider: 'one', model: 'shared' },
  providers: [
    { providerId: 'one', displayName: 'One', active: true, configurable: false, configured: true, credential: 'not-required', canStoreApiKey: false, models: [{ id: 'shared', name: 'Shared' }, { id: 'other', name: 'Other' }] },
    { providerId: 'two', displayName: 'Two', active: true, configurable: false, configured: true, credential: 'not-required', canStoreApiKey: false, models: [{ id: 'shared', name: 'Shared' }] },
  ],
}

describe('model visibility', () => {
  it('ignores invalid saved entries and deduplicates valid provider/model pairs', () => {
    const key = modelVisibilityKey({ provider: 'one', model: 'shared' })
    expect(parseDisabledModels(JSON.stringify([key, key, 'bad', '["one"]', 42]))).toEqual([key])
    expect(parseDisabledModels('{')).toEqual([])
  })

  it('scopes disabled state to one provider and preserves the model catalog', () => {
    const hidden = modelVisibilityKey({ provider: 'one', model: 'shared' })
    const result = withModelVisibility(settings, [hidden])!
    expect(result.providers[0]?.models.map(model => model.enabled)).toEqual([false, true])
    expect(result.providers[1]?.models[0]?.enabled).toBe(true)
    expect(enabledModelOptions(result).map(option => `${option.provider}/${option.model.id}`)).toEqual(['one/other', 'two/shared'])
    expect(settings.providers[0]?.models[0]?.enabled).toBeUndefined()
  })

  it('chooses another connected, enabled model before hiding the default', () => {
    const hidden = [modelVisibilityKey({ provider: 'one', model: 'shared' })]
    expect(replacementDefaultModel(settings, hidden)).toEqual({ provider: 'one', model: 'other' })
    expect(replacementDefaultModel({ ...settings, defaultSelection: { provider: 'one', model: 'other' } }, [modelVisibilityKey({ provider: 'one', model: 'other' })])).toEqual({ provider: 'one', model: 'shared' })
    expect(replacementDefaultModel(settings, [...hidden, modelVisibilityKey({ provider: 'one', model: 'other' })])).toEqual({ provider: 'two', model: 'shared' })
    expect(replacementDefaultModel(settings, [...hidden, modelVisibilityKey({ provider: 'one', model: 'other' }), modelVisibilityKey({ provider: 'two', model: 'shared' })])).toBeUndefined()
  })

  it('keeps newly discovered models with unknown capabilities off until enabled, preserving the current default and hidden states', () => {
    const fresh: LingModelSettings = { ...settings, providers: settings.providers.map((provider, index) => index === 0 ? { ...provider, models: provider.models.map(model => ({ ...model, catalogUnverified: true })) } : provider) }
    const current = modelVisibilityKey({ provider: 'one', model: 'shared' })
    const other = modelVisibilityKey({ provider: 'one', model: 'other' })
    expect(withModelVisibility(fresh, [])!.providers[0]!.models.map(model => model.enabled)).toEqual([true, false])
    expect(withModelVisibility(fresh, [], [other])!.providers[0]!.models.map(model => model.enabled)).toEqual([true, true])
    expect(withModelVisibility(fresh, [current, other], [other])!.providers[0]!.models.map(model => model.enabled)).toEqual([false, false])
    expect(replacementDefaultModel(fresh, [current])).toEqual({ provider: 'two', model: 'shared' })
  })
})
