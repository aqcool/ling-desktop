import { describe, expect, it, vi } from 'vitest'
import { createPluginProjection } from '../src/client/plugin-projection.js'

const ok = <T>(value: T) => ({ ok: true as const, value })
const projection = (remote: Record<string, unknown>) => createPluginProjection(remote as never)

describe('plugin management adapter', () => {
  const unloadingFailure = {
    application: 'failed', target: 'team', changed: true,
    error: { code: 'operation-error', diagnostic: 'dsh: warning: 1 entry did not activate\ntool-team (team/tool): failed to import' },
  }

  it('reconfirms a disabled bundle after its transiently audited entries disappear', async () => {
    const setBundleEnabled = vi.fn().mockResolvedValueOnce(ok(unloadingFailure)).mockResolvedValueOnce(ok({ application: 'applied', target: 'team', changed: false, warnings: [] }))
    const manager = projection({ pluginManager: {
      setBundleEnabled,
      listBundles: async () => ok([{ name: 'team', enabled: false, rows: [{ rowId: 'tool-team', moduleName: 'team/tool' }] }]),
      listPlugins: async () => ok([]),
    } })
    expect(await manager.setBundleEnabled('team', false)).toMatchObject({ ok: true, value: { application: 'applied', changed: true } })
    expect(setBundleEnabled.mock.calls).toEqual([['team', false], ['team', false]])
  })

  it.each(['enable', 'still-enabled', 'live-entry', 'unrelated-error', 'inventory-error'])('does not conceal %s failures', async scenario => {
    const failure = scenario === 'unrelated-error' ? { ...unloadingFailure, error: { ...unloadingFailure.error, diagnostic: 'dsh: warning: 1 entry did not activate\nother (other/plugin): failed to import' } } : unloadingFailure
    const setBundleEnabled = vi.fn(async () => ok(failure))
    const manager = projection({ pluginManager: {
      setBundleEnabled,
      listBundles: async () => ok([{ name: 'team', enabled: scenario === 'still-enabled', rows: [{ rowId: 'tool-team', moduleName: 'team/tool' }] }]),
      listPlugins: async () => scenario === 'inventory-error' ? { ok: false, error: { code: 'unavailable' } } : ok(scenario === 'live-entry' ? [{ moduleName: 'team/tool', entryId: 'live', fiberPhase: 'failed' }] : []),
    } })
    expect(await manager.setBundleEnabled('team', scenario === 'enable')).toEqual(ok(failure))
    expect(setBundleEnabled).toHaveBeenCalledTimes(1)
  })

  it('does not retry indefinitely or convert a failed reconfirmation into success', async () => {
    const setBundleEnabled = vi.fn(async () => ok(unloadingFailure))
    const manager = projection({ pluginManager: {
      setBundleEnabled,
      listBundles: async () => ok([{ name: 'team', enabled: false, rows: [{ rowId: 'tool-team', moduleName: 'team/tool' }] }]),
      listPlugins: async () => ok([]),
    } })
    expect(await manager.setBundleEnabled('team', false)).toEqual(ok(unloadingFailure))
    expect(setBundleEnabled).toHaveBeenCalledTimes(2)
  })

  it('joins declared bundle rows with live runtime state', async () => {
    const manager = projection({
      pluginManager: {
        listBundles: async () => ok([{ name: 'example', installed: true, enabled: true, rows: [{ rowId: 'tool', moduleName: 'example/tool', entryId: 'entry-1' }] }]),
        listPlugins: async () => ok([{ entryId: 'entry-1', enabled: false, fiberPhase: 'failed', readOnlyReason: 'unaddressable' }]),
      },
      settings: { describe: async () => ok({ writable: true, namespaces: [{ ns: 'shell', revision: 2, value: { timeoutMs: 1000 }, applies: 'live' }] }) },
    })
    const result = await manager.read()
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.bundles[0]?.rows[0]).toMatchObject({ enabled: false, phase: 'failed', readOnlyReason: 'unaddressable' })
    expect(result.value.namespaces[0]?.ns).toBe('shell')
  })

  it('still serves config namespaces when plugin management is unavailable', async () => {
    const result = await projection({ settings: { describe: async () => ok({ writable: false, namespaces: [] }) } }).read()
    expect(result).toMatchObject({ ok: true, value: { writable: false, bundles: [], managementError: expect.any(String) } })
  })

  it('preserves failed application results and separate install consent', async () => {
    const failure = { application: 'failed', target: 'bundle', error: { code: 'operation-error', diagnostic: 'Build failed' }, pendingBuilds: ['example/native'] }
    const installBundle = vi.fn(async () => ok(failure))
    const manager = projection({ pluginManager: { installBundle } })
    expect(await manager.install('example', 'attempt-1')).toEqual(ok(failure))
    expect(installBundle).toHaveBeenLastCalledWith('example', { enabled: false, requestId: 'attempt-1' })
    await manager.install('example', 'attempt-2', ['example/native'])
    expect(installBundle).toHaveBeenLastCalledWith('example', { enabled: false, requestId: 'attempt-2', approvedBuilds: ['example/native'] })
  })

  it('resets only selected keys and preserves the namespace revision fence', async () => {
    const mutate = vi.fn(async () => ({ ok: false, error: { code: 'settings/conflict', message: '配置已更新' } }))
    const manager = projection({ settings: { mutate } })
    expect(await manager.save('shell', { timeoutMs: undefined, maxOutputBytes: 2048 }, 7)).toMatchObject({ ok: false, message: '配置已更新' })
    expect(mutate).toHaveBeenCalledWith('shell', [{ op: 'unset', path: ['timeoutMs'] }, { op: 'set', path: ['maxOutputBytes'], value: 2048 }], 7)
  })

  it('keeps search secrets in credentials and exposes only their status', async () => {
    const set = vi.fn(async () => ok(undefined))
    const describe = vi.fn(async () => ok({ SEARCH_KEY: { configured: true, writable: false } }))
    const manager = projection({ credentials: { describe, set } })
    expect(await manager.credential('SEARCH_KEY')).toEqual(ok({ configured: true, writable: false }))
    await manager.saveCredential('SEARCH_KEY', 'test-key')
    expect(set).toHaveBeenCalledWith('SEARCH_KEY', 'test-key')
  })

  it('preserves provider identity and partial failures in model selection', async () => {
    const manager = projection({ session: { modelCatalog: async () => ok({ failures: [{}], groups: [{ id: 'provider-a', name: 'Provider A', models: [{ id: 'model-1', name: 'Model 1' }] }] }) } })
    expect(await manager.models()).toEqual(ok({ partial: true, models: [{ provider: 'provider-a', providerName: 'Provider A', model: 'model-1', name: 'Model 1' }] }))
  })

  it('unsubscribes all runtime events and retains install request correlation', () => {
    const listeners = new Map<string, (event: unknown) => void>()
    const off = vi.fn()
    const manager = projection({ $on: (name: string, listener: (event: unknown) => void) => { listeners.set(name, listener); return off } })
    const receive = vi.fn()
    const dispose = manager.subscribe(receive)
    listeners.get('plugin-manager/install-state')?.({ requestId: 'attempt-1', phase: 'applying' })
    expect(receive).toHaveBeenLastCalledWith({ type: 'progress', requestId: 'attempt-1', phase: 'applying' })
    dispose()
    expect(off).toHaveBeenCalledTimes(4)
  })
})
