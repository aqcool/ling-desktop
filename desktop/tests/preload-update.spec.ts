// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import type { LingUpdateBridge } from 'ling-desktop/runtime'
import { IPC } from '../src/ipc.ts'

const mocks = vi.hoisted(() => ({
  exposed: new Map<string, unknown>(),
  listeners: new Map<string, (...args: unknown[]) => void>(),
  invoke: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: (key: string, value: unknown) => mocks.exposed.set(key, value) },
  ipcRenderer: {
    invoke: mocks.invoke,
    on: (event: string, listener: (...args: unknown[]) => void) => mocks.listeners.set(event, listener),
    removeListener: vi.fn(),
  },
}))
afterEach(() => { vi.unstubAllGlobals(); mocks.invoke.mockClear() })

it('checks and freezes before final acknowledgement, then restores editing on cancellation', async () => {
  vi.stubGlobal('location', { protocol: 'dsh-app:', hostname: 'app' })
  await import('../src/preload-app.ts')
  const bridge = mocks.exposed.get('__LING_UPDATE__') as LingUpdateBridge
  let dirty = true
  const stop = bridge.beforeInstall!(() => dirty ? '请先保存文件' : undefined)
  const request = mocks.listeners.get(IPC.updatePrepare)!
  request({}, 'dirty', true)
  expect(mocks.invoke).toHaveBeenLastCalledWith(IPC.updatePrepared, 'dirty', '请先保存文件')
  expect(document.body.inert).not.toBe(true)
  dirty = false
  request({}, 'first-check', false)
  expect(document.body.inert).not.toBe(true)
  request({}, 'final-check', true)
  expect(mocks.invoke).toHaveBeenLastCalledWith(IPC.updatePrepared, 'final-check', undefined)
  expect(document.body.inert).toBe(true)
  const key = new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true })
  window.dispatchEvent(key)
  expect(key.defaultPrevented).toBe(true)
  mocks.listeners.get(IPC.updateUnlock)!({})
  expect(document.body.inert).not.toBe(true)
  const restored = new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true })
  window.dispatchEvent(restored)
  expect(restored.defaultPrevented).toBe(false)
  stop()
})

it('never exposes update privileges to remote browser pages', async () => {
  vi.resetModules()
  mocks.exposed.clear()
  vi.stubGlobal('location', { protocol: 'https:', hostname: 'example.com' })
  await import('../src/preload-app.ts')
  expect(mocks.exposed.has('__LING_UPDATE__')).toBe(false)
})
