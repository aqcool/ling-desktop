import { describe, expect, it, vi } from 'vitest'
import type { LingComputerControlService, LingComputerSnapshot, LingPluginOverview } from '../src/runtime/contract.js'
import { computerPreferences, enabledSnapshotShortcut, prepareComputerSnapshot } from '../src/ui/computer-snapshot.js'

const overview: LingPluginOverview = { writable: true, bundles: [{ name: 'ling-desktop-host', installed: true, optional: false, removable: false, enabled: true, rows: [{ rowId: 'cua', moduleName: 'ling-desktop-host/computer-use', enabled: true, phase: 'active' }] }], namespaces: [{ ns: 'ling-computer-control', revision: 2, applies: 'live', value: { browserEnabled: true, snapshotShortcut: 'CommandOrControl+Shift+S' } }] }
const snapshot: LingComputerSnapshot = { title: 'Editor', text: '# Window', images: [{ name: 'snapshot.png', mediaType: 'image/png', data: 'aGVsbG8=' }] }
describe('computer settings and unsent snapshots', () => {
  it('keeps missing feature flags off and only registers snapshots for an active plugin', () => {
    expect(computerPreferences()).toMatchObject({ browserEnabled: false, recordingEnabled: false, snapshotShortcut: '' })
    expect(computerPreferences(overview)).toMatchObject({ browserEnabled: true, recordingEnabled: false })
    expect(enabledSnapshotShortcut(overview)).toBe('CommandOrControl+Shift+S')
    for (const phase of ['loading', 'failed', 'unloading']) expect(enabledSnapshotShortcut({ ...overview, bundles: [{ ...overview.bundles[0]!, rows: [{ ...overview.bundles[0]!.rows[0]!, phase }] }] })).toBe('')
  })
  it('prepares an image and quote for the existing draft and refuses to deliver to a switched conversation', async () => {
    const pending = Promise.withResolvers<{ ok: true; value: LingComputerSnapshot }>()
    const computer = { snapshot: () => pending.promise } as LingComputerControlService
    const deliver = vi.fn()
    let currentDraft = 'one'
    const request = prepareComputerSnapshot(computer, 'one', () => currentDraft, deliver)
    currentDraft = 'two'; pending.resolve({ ok: true, value: snapshot })
    await expect(request).rejects.toThrow('会话已切换'); expect(deliver).not.toHaveBeenCalled()
    await prepareComputerSnapshot(computer, 'two', () => currentDraft, deliver)
    const [files, text, title] = deliver.mock.calls[0]!
    expect(files[0].name).toBe('snapshot.png'); expect(files[0].type).toBe('image/png')
    expect(await files[0].text()).toBe('hello'); expect([text, title]).toEqual(['# Window', 'Editor'])
  })
  it('leaves the draft untouched when inspection is unavailable or the renderer has closed', async () => {
    const deliver = vi.fn()
    const computer = { snapshot: async () => ({ ok: false, reason: 'runtime-unavailable', message: '权限不足', retryable: false }) } as LingComputerControlService
    await expect(prepareComputerSnapshot(computer, 'one', () => 'one', deliver)).rejects.toThrow('权限不足')
    computer.snapshot = async () => ({ ok: true, value: snapshot })
    await expect(prepareComputerSnapshot(computer, 'one', () => undefined, deliver)).rejects.toThrow('会话已切换')
    expect(deliver).not.toHaveBeenCalled()
  })
})
