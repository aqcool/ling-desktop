import type { ClientRemote, PluginEntryId, PluginInstallRequestId } from '@deepseek-ai/dsh-api-remotes/client'
import type { LingReadResult } from 'ling-desktop/runtime'
import type { LingPluginManager } from 'ling-desktop/runtime'
import { brandString } from '@deepseek-ai/dsh-brand'

async function request<T>(call: () => Promise<{ ok: true; value: T } | { ok: false; error: { code: string; message?: string } }>): Promise<LingReadResult<T>> {
  try {
    const result = await call()
    return result.ok ? result : { ok: false, reason: 'runtime-unavailable', message: result.error.message || result.error.code, retryable: true }
  } catch {
    return { ok: false, reason: 'runtime-unavailable', message: '插件服务暂时不可用，请重试。', retryable: true }
  }
}

export function createPluginProjection(remote: ClientRemote): LingPluginManager {
  const setBundleEnabled: LingPluginManager['setBundleEnabled'] = async (name, enabled) => {
    const result = await request(() => remote.pluginManager.setBundleEnabled(name, enabled))
    if (enabled || !result.ok || result.value.application !== 'failed' || result.value.error?.code !== 'operation-error') return result

    // DSH 0.1.6 can audit a removed dependent between clearing its Fiber and
    // deleting its Loader entry. Reconfirm this idempotent disable only when
    // every reported import failure belongs to this bundle and those entries
    // have actually disappeared. Never recover an enable or a live failure.
    const diagnostic = result.value.error.diagnostic?.trim().split('\n') ?? []
    if (!/^dsh: warning: \d+ entr(?:y|ies) did not activate$/.test(diagnostic[0] ?? '') || diagnostic.length < 2) return result
    const bundles = await request(() => remote.pluginManager.listBundles())
    if (!bundles.ok) return result
    const bundle = bundles.value.find(bundle => bundle.name === name)
    if (!bundle || bundle.enabled || !bundle.rows.length) return result
    if (!diagnostic.slice(1).every(line => bundle.rows.some(row => line === `${row.rowId} (${row.moduleName}): failed to import`))) return result
    const plugins = await request(() => remote.pluginManager.listPlugins())
    if (!plugins.ok || plugins.value.some(entry => bundle.rows.some(row => entry.moduleName === row.moduleName || (row.entryId && entry.entryId === row.entryId)))) return result
    const confirmed = await request(() => remote.pluginManager.setBundleEnabled(name, false))
    return confirmed.ok ? { ...confirmed, value: { ...confirmed.value, changed: result.value.changed || confirmed.value.changed } } : confirmed
  }
  return {
    async read() {
      const [bundles, plugins, settings] = await Promise.all([
        request(() => remote.pluginManager.listBundles()), request(() => remote.pluginManager.listPlugins()), request(() => remote.settings.describe()),
      ])
      if (!settings.ok) return settings
      return { ok: true, value: {
        writable: settings.value.writable, namespaces: settings.value.namespaces,
        managementError: !bundles.ok ? bundles.message : !plugins.ok ? plugins.message : undefined,
        bundles: bundles.ok ? bundles.value.map(bundle => ({ ...bundle, rows: bundle.rows.map(row => {
          const entry = plugins.ok ? plugins.value.find(plugin => plugin.entryId === row.entryId) : undefined
          return { ...row, enabled: entry?.enabled ?? false, phase: entry?.fiberPhase ?? undefined, readOnlyReason: entry?.readOnlyReason ?? (!plugins.ok ? plugins.message : undefined) }
        }) })) : [],
      } }
    },
    subscribe(listener) {
      const offs = [
        remote.$on('plugin-manager/changed', () => listener({ type: 'changed' })),
        remote.$on('settings/document-updated', () => listener({ type: 'changed' })),
        remote.$on('plugin-manager/install-state', event => listener({ type: 'progress', ...event })),
        remote.$on('plugin-manager/install-log', event => listener({ type: 'log', ...event })),
      ]
      return () => { for (const off of offs) off() }
    },
    setBundleEnabled,
    setPluginEnabled: (id, enabled) => request(() => remote.pluginManager.setPluginEnabled(brandString<PluginEntryId>(id), enabled)),
    remove: name => request(() => remote.pluginManager.removeBundle(name)),
    inspect: (spec, signal) => request(() => remote.pluginManager.inspect(spec, signal)),
    install: (spec, id, approvedBuilds) => request(() => remote.pluginManager.installBundle(spec, { enabled: false, requestId: brandString<PluginInstallRequestId>(id), ...(approvedBuilds ? { approvedBuilds } : {}) })),
    cancel: id => request(() => remote.pluginManager.cancelInstall(brandString<PluginInstallRequestId>(id))),
    save: (ns, edits, revision) => request(() => remote.settings.mutate(ns, Object.entries(edits).map(([key, value]) => value === undefined ? { op: 'unset', path: [key] } : { op: 'set', path: [key], value }), revision)),
    async credential(ref) {
      const result = await request(() => remote.credentials.describe([ref]))
      if (!result.ok) return result
      const value = result.value[ref]
      return { ok: true, value: { configured: value?.configured ?? false, writable: value?.writable ?? true } }
    },
    saveCredential: (ref, value) => request(() => remote.credentials.set(ref, value)),
    async models() {
      const result = await request(() => remote.session.modelCatalog())
      if (!result.ok) return result
      return { ok: true, value: { partial: result.value.failures.length > 0, models: result.value.groups.flatMap(group => group.models.map(model => ({ provider: group.id, providerName: group.name, model: model.id, name: model.name }))) } }
    },
  }
}
