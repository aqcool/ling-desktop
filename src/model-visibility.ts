import type { LingModelSelection, LingModelSettings } from './runtime/contract.js'

export const modelVisibilityStorageKey = 'ling:model-visibility:v1'
const confirmedModelsStorageKey = 'ling:model-confirmed:v1'

export function modelVisibilityKey(selection: LingModelSelection): string {
  return JSON.stringify([selection.provider, selection.model])
}

export function parseDisabledModels(value: string | null): readonly string[] {
  if (!value) return []
  try {
    const parsed: unknown = JSON.parse(value)
    if (!Array.isArray(parsed)) return []
    return [...new Set(parsed.filter((key): key is string => {
      if (typeof key !== 'string') return false
      try {
        const pair: unknown = JSON.parse(key)
        return Array.isArray(pair) && pair.length === 2 && pair.every(part => typeof part === 'string' && part.length > 0)
      } catch { return false }
    }))]
  } catch { return [] }
}

export function readDisabledModels(): readonly string[] {
  try { return parseDisabledModels(window.localStorage.getItem(modelVisibilityStorageKey)) }
  catch { return [] }
}

export function saveDisabledModels(keys: readonly string[]): boolean {
  try {
    window.localStorage.setItem(modelVisibilityStorageKey, JSON.stringify(keys))
    return true
  } catch { return false }
}
export function readConfirmedModels(): readonly string[] {
  try { return parseDisabledModels(window.localStorage.getItem(confirmedModelsStorageKey)) } catch { return [] }
}
export function saveConfirmedModels(keys: readonly string[]): boolean {
  try { window.localStorage.setItem(confirmedModelsStorageKey, JSON.stringify(keys)); return true } catch { return false }
}

export function withModelVisibility(settings: LingModelSettings | undefined, disabled: readonly string[], confirmed: readonly string[] = []): LingModelSettings | undefined {
  if (!settings) return undefined
  const hidden = new Set(disabled)
  const accepted = new Set(confirmed)
  return {
    ...settings,
    providers: settings.providers.map(provider => ({
      ...provider,
      models: provider.models.map(model => ({
        ...model,
        enabled: !hidden.has(modelVisibilityKey({ provider: provider.providerId, model: model.id })) && (
          model.catalogUnverified !== true || accepted.has(modelVisibilityKey({ provider: provider.providerId, model: model.id }))
          || (settings.defaultSelection.provider === provider.providerId && settings.defaultSelection.model === model.id)
        ),
      })),
    })),
  }
}

export function enabledModelOptions(settings: LingModelSettings | undefined) {
  return (settings?.providers ?? []).flatMap(provider => provider.models
    .filter(model => model.enabled !== false)
    .map(model => ({
      key: modelVisibilityKey({ provider: provider.providerId, model: model.id }),
      provider: provider.providerId,
      model,
    })))
}

export function replacementDefaultModel(settings: LingModelSettings, disabled: readonly string[], confirmed: readonly string[] = []): LingModelSelection | undefined {
  settings = withModelVisibility(settings, disabled, confirmed)!
  const hidden = new Set(disabled)
  const connected = settings.providers.filter(provider => provider.authorization?.configured
      || ((provider.configured || provider.active) && provider.credential === 'configured')
      || (provider.active && provider.credential === 'not-required'))
  const currentProvider = connected.find(provider => provider.providerId === settings.defaultSelection.provider)
  const currentIndex = currentProvider?.models.findIndex(model => model.id === settings.defaultSelection.model) ?? -1
  const sameProvider = currentProvider === undefined ? [] : [
    ...currentProvider.models.slice(currentIndex + 1).filter(model => model.enabled !== false),
    ...currentProvider.models.slice(0, Math.max(currentIndex, 0)).reverse().filter(model => model.enabled !== false),
  ].map(model => ({ provider: currentProvider.providerId, model: model.id }))
  const otherProviders = connected
    .filter(provider => provider.providerId !== currentProvider?.providerId)
    .flatMap(provider => provider.models.filter(model => model.enabled !== false).map(model => ({ provider: provider.providerId, model: model.id })))
  return [...sameProvider, ...otherProviders].find(selection => !hidden.has(modelVisibilityKey(selection)))
}
