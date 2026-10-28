// @vitest-environment jsdom
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LingUpdateBridge, LingUpdateState } from '../src/runtime/application-update.js'
import { ApplicationUpdateReadyNotice, ApplicationUpdateSettings } from '../src/ui/ApplicationUpdateSettings.js'
import { settingsGroups } from '../src/ui/settings-navigation.js'

let root: Root
let container: HTMLDivElement
const idle: LingUpdateState = { currentVersion: '1.2.3', channel: 'stable', phase: 'idle' }

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(finish => { resolve = finish })
  return { promise, resolve }
}

function bridgeFixture(initial: LingUpdateState = idle) {
  let current = initial
  const listeners = new Set<(state: LingUpdateState) => void>()
  const bridge = {
    get: vi.fn(async () => current),
    check: vi.fn(async () => current),
    setChannel: vi.fn(async (channel: LingUpdateState['channel']) => { current = { ...current, channel }; return current }),
    install: vi.fn(async () => { current = { ...current, phase: 'installing' }; return current }),
    subscribe: vi.fn((callback: (state: LingUpdateState) => void) => {
      listeners.add(callback)
      return () => { listeners.delete(callback) }
    }),
  } satisfies LingUpdateBridge
  window.__LING_UPDATE__ = bridge
  return {
    bridge,
    async emit(next: LingUpdateState) {
      current = next
      await act(async () => { for (const listener of listeners) listener(next) })
    },
  }
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.stubGlobal('CSS', { escape: (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, character => `\\${character}`) })
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
  delete window.__LING_UPDATE__
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  document.body.replaceChildren()
  delete window.__LING_UPDATE__
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

async function render(element: ReactNode) {
  await act(async () => { root.render(element) })
}

function button(name: string) {
  return [...container.querySelectorAll<HTMLButtonElement>('button')]
    .find(item => item.getAttribute('aria-label') === name || item.textContent?.trim() === name)
}

async function click(name: string) {
  const target = button(name)
  expect(target, name).toBeDefined()
  await act(async () => { target!.click() })
}

describe('application update settings', () => {
  it('is reachable through the settings navigation', () => {
    expect(settingsGroups.some(group => group.items.some(item => item.id === 'updates'))).toBe(true)
  })

  it('explains desktop availability and does not offer an install action without the native bridge', async () => {
    await render(<><ApplicationUpdateSettings version="1.2.3" /><ApplicationUpdateReadyNotice onOpenSettings={vi.fn()} /></>)
    expect(container.textContent).toContain('软件更新仅在桌面应用中可用。')
    expect(button('重启并更新')).toBeUndefined()
    expect(button('查看更新')).toBeUndefined()
  })

  it('shows the installed version and exposes stable and preview update channels', async () => {
    const { bridge } = bridgeFixture()
    await render(<ApplicationUpdateSettings version="1.2.3" />)
    expect(container.textContent).toContain('1.2.3')
    const channel = container.querySelector<HTMLButtonElement>('button[aria-haspopup="listbox"]')
    expect(channel).not.toBeNull()
    expect(channel!.textContent).toContain('稳定版')
    await act(async () => { channel!.click() })
    const options = [...document.querySelectorAll<HTMLElement>('[role="option"]')]
    expect(options.map(option => option.textContent)).toEqual(expect.arrayContaining(['稳定版', '预览版']))
    const preview = options.find(option => option.textContent === '预览版')
    expect(preview).toBeDefined()
    await act(async () => { preview!.click() })
    expect(bridge.setChannel).toHaveBeenCalledExactlyOnceWith('preview')
    expect(bridge.install).not.toHaveBeenCalled()
  })

  it('checks on demand and displays download progress before offering a restart', async () => {
    const fixture = bridgeFixture()
    fixture.bridge.check.mockResolvedValueOnce({ ...idle, phase: 'checking' })
    await render(<ApplicationUpdateSettings version="1.2.3" />)
    expect(fixture.bridge.check).not.toHaveBeenCalled()
    expect(button('重启并更新')).toBeUndefined()
    await click('检查更新')
    expect(fixture.bridge.check).toHaveBeenCalledTimes(1)
    await fixture.emit({ ...idle, phase: 'downloading', version: '1.3.0',
      progress: { percent: 43, transferred: 43_000, total: 100_000, bytesPerSecond: 1_000 } })
    const progress = container.querySelector('[role="progressbar"][aria-label="更新下载进度"]')
    expect(progress).not.toBeNull()
    expect(progress!.getAttribute('aria-valuenow')).toBe('43')
    expect(button('重启并更新')).toBeUndefined()
    expect(button('稍后')).toBeUndefined()
    await fixture.emit({ ...idle, phase: 'downloaded', version: '1.3.0' })
    expect(container.textContent).toContain('1.3.0')
    expect(button('重启并更新')).toBeDefined()
    expect(button('稍后')).toBeDefined()
    expect(fixture.bridge.install).not.toHaveBeenCalled()
  })

  it('renders release notes as text and installs only after an explicit click', async () => {
    const notes = '<img src="https://example.invalid/update.png" onerror="window.badUpdate=true">\n修复下载问题'
    const fixture = bridgeFixture({ ...idle, phase: 'downloaded', version: '1.3.1', releaseNotes: notes })
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    await render(<ApplicationUpdateSettings version="1.2.3" />)
    expect(container.textContent).toContain('<img src="https://example.invalid/update.png" onerror="window.badUpdate=true">')
    expect(container.textContent).toContain('修复下载问题')
    expect(container.querySelector('img, iframe, script')).toBeNull()
    expect(fixture.bridge.install).not.toHaveBeenCalled()
    await fixture.emit({ ...idle, phase: 'downloaded', version: '1.3.1', releaseNotes: notes })
    expect(fixture.bridge.install).not.toHaveBeenCalled()
    await click('重启并更新')
    expect(fixture.bridge.install).toHaveBeenCalledTimes(1)
    expect(confirm).not.toHaveBeenCalled()
  })

  it('shares native status with the notice and postpones both views without hiding the settings install action', async () => {
    const fixture = bridgeFixture({ ...idle, phase: 'downloaded', version: '9.93.0' })
    await render(<><ApplicationUpdateSettings version="1.2.3" /><ApplicationUpdateReadyNotice onOpenSettings={vi.fn()} /></>)
    expect(fixture.bridge.get).toHaveBeenCalledTimes(1)
    expect(fixture.bridge.subscribe).toHaveBeenCalledTimes(1)
    expect(button('查看更新')).toBeDefined()
    const settings = container.querySelector('section[aria-label="软件更新设置"]')!
    const postpone = [...settings.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent?.trim() === '稍后')
    expect(postpone).toBeDefined()
    await act(async () => { postpone!.click() })
    expect(button('查看更新')).toBeUndefined()
    expect(button('重启并更新')).toBeDefined()
    expect(fixture.bridge.install).not.toHaveBeenCalled()
  })

  it('opens one native install confirmation at a time and allows another attempt after cancellation', async () => {
    const downloaded: LingUpdateState = { ...idle, phase: 'downloaded', version: '1.3.2' }
    const fixture = bridgeFixture(downloaded)
    const confirmation = deferred<LingUpdateState>()
    fixture.bridge.install.mockImplementationOnce(() => confirmation.promise)
    await render(<ApplicationUpdateSettings version="1.2.3" />)
    await click('重启并更新')
    await click('重启并更新')
    expect(fixture.bridge.install).toHaveBeenCalledTimes(1)
    await act(async () => { confirmation.resolve(downloaded) })
    expect(button('重启并更新')?.disabled).toBe(false)
    await click('重启并更新')
    expect(fixture.bridge.install).toHaveBeenCalledTimes(2)
  })

  it('keeps a failed check retryable', async () => {
    const fixture = bridgeFixture()
    fixture.bridge.check.mockImplementationOnce(async () => {
      await fixture.emit({ ...idle, phase: 'checking' })
      throw new Error('更新服务暂不可用')
    }).mockResolvedValueOnce(idle)
    await render(<ApplicationUpdateSettings version="1.2.3" />)
    await click('检查更新')
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('检查更新失败，请重试。')
    expect(button('检查更新')?.disabled).toBe(false)
    await click('检查更新')
    expect(fixture.bridge.check).toHaveBeenCalledTimes(2)
    expect(fixture.bridge.install).not.toHaveBeenCalled()
  })

  it('keeps a newer subscription event when the initial state request completes later', async () => {
    const initial = deferred<LingUpdateState>()
    const fixture = bridgeFixture()
    fixture.bridge.get.mockImplementationOnce(() => initial.promise)
    await render(<ApplicationUpdateSettings version="1.2.3" />)
    await fixture.emit({ ...idle, phase: 'downloaded', version: '1.4.0' })
    expect(button('重启并更新')).toBeDefined()
    await act(async () => { initial.resolve(idle) })
    expect(container.textContent).toContain('1.4.0')
    expect(button('重启并更新')).toBeDefined()
    expect(fixture.bridge.install).not.toHaveBeenCalled()
  })
})

describe('downloaded update notice', () => {
  it('appears only after download, opens settings on request and never steals focus or installs', async () => {
    const fixture = bridgeFixture()
    const onOpenSettings = vi.fn()
    const input = document.createElement('input')
    document.body.append(input)
    input.focus()
    await render(<ApplicationUpdateReadyNotice onOpenSettings={onOpenSettings} />)
    expect(button('查看更新')).toBeUndefined()
    await fixture.emit({ ...idle, phase: 'downloading', version: '9.91.0' })
    expect(button('查看更新')).toBeUndefined()
    await fixture.emit({ ...idle, phase: 'downloaded', version: '9.91.0' })
    expect(button('查看更新')).toBeDefined()
    expect(document.activeElement).toBe(input)
    expect(fixture.bridge.install).not.toHaveBeenCalled()
    await click('查看更新')
    expect(onOpenSettings).toHaveBeenCalledTimes(1)
    expect(fixture.bridge.install).not.toHaveBeenCalled()
  })

  it('keeps a postponed version dismissed across remounts and announces a later downloaded version', async () => {
    const fixture = bridgeFixture({ ...idle, phase: 'downloaded', version: '9.92.0' })
    const onOpenSettings = vi.fn()
    await render(<ApplicationUpdateReadyNotice onOpenSettings={onOpenSettings} />)
    expect(button('查看更新')).toBeDefined()
    await click('稍后')
    expect(button('查看更新')).toBeUndefined()
    await render(null)
    await render(<ApplicationUpdateReadyNotice onOpenSettings={onOpenSettings} />)
    expect(button('查看更新')).toBeUndefined()
    await fixture.emit({ ...idle, phase: 'downloaded', version: '9.92.1' })
    expect(button('查看更新')).toBeDefined()
    expect(container.textContent).toContain('9.92.1')
    expect(fixture.bridge.install).not.toHaveBeenCalled()
  })
})
