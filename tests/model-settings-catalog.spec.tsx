// @vitest-environment jsdom
import { act, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ModelSettings } from '../src/ui/ModelSettings.js'
import type { LingModelCatalogState, LingReadResult } from '../src/runtime/contract.js'

let root: Root | undefined
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.stubGlobal('CSS', { escape: (value: string) => value })
})
afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined; document.body.replaceChildren(); vi.unstubAllGlobals()
})
const state: LingModelCatalogState = { providerId: 'lab', supported: true, source: 'endpoint', updatedAt: Date.UTC(2026, 9, 6), refreshing: false, pending: false, newModelIds: ['fresh'], missingModelIds: ['old'], unverifiedModelIds: ['fresh'] }
function props(): ComponentProps<typeof ModelSettings> {
  return {
    loading: false, onModelEnabledChange: vi.fn(), onTestProvider: vi.fn(), onUpdateCustomProvider: vi.fn(),
    onCreateCustomProvider: vi.fn(), onDeleteProvider: vi.fn(), onRefresh: vi.fn(), onSaveApiKey: vi.fn(), onSelectDefault: vi.fn(),
    onRefreshProviderModels: vi.fn(async () => ({ ok: true as const, value: state })),
    settings: { writable: true, defaultSelection: { provider: 'lab', model: 'old' }, providers: [{ providerId: 'lab', displayName: 'Lab', active: true, configured: true, configurable: true, credential: 'not-required', canStoreApiKey: false, catalog: state, models: [{ id: 'old', name: 'Old', catalogMissing: true }, { id: 'fresh', name: 'Fresh', catalogNew: true, catalogUnverified: true, enabled: false }] }] },
  }
}
async function mount(value: ComponentProps<typeof ModelSettings>) {
  const container = document.createElement('div'); document.body.append(container); root = createRoot(container)
  await act(async () => root!.render(<ModelSettings {...value} />))
}
describe('model catalog settings controls', () => {
  it('connects the per-provider action, blocks duplicate presses and explains failure while keeping existing models visible', async () => {
    let finish!: (result: LingReadResult<LingModelCatalogState>) => void
    const pending = new Promise<LingReadResult<LingModelCatalogState>>(resolve => { finish = resolve })
    const value = { ...props(), onRefreshProviderModels: vi.fn(() => pending) }
    await mount(value)
    const button = document.querySelector<HTMLButtonElement>('[aria-label="刷新Lab模型目录"]')!
    expect(button).not.toBeNull()
    await act(async () => button.click())
    await act(async () => button.click())
    expect(value.onRefreshProviderModels).toHaveBeenCalledExactlyOnceWith('lab')
    expect(value.onSelectDefault).not.toHaveBeenCalled()
    await act(async () => finish({ ok: false, reason: 'runtime-unavailable', message: '无法连接供应商，已保留原模型目录。', retryable: true }))
    expect(document.body.textContent).toContain('无法连接供应商，已保留原模型目录。')
    expect(document.body.textContent).toContain('Old')
    expect(document.body.textContent).toContain('已保留你的选择')
    expect(document.body.textContent).toContain('能力待确认')
    expect(document.querySelector('[aria-label="将Fresh设为默认模型"]')).toBeNull()
  })
  it('reports deferred application during active tasks instead of claiming the new directory is already in use', async () => {
    const initial = props()
    const value = { ...initial, settings: { ...initial.settings!, providers: initial.settings!.providers.map(provider => ({ ...provider, catalog: { ...state, pending: true } })) } }
    await mount(value)
    expect(document.body.textContent).toContain('目录已更新，任务空闲后应用')
  })
})
