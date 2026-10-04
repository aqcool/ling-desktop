import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { applicationIconStyles, ApplicationIconController, FileApplicationIconStore, applyNativeApplicationIcon, parseApplicationIconStyle, type ApplicationIconStyle, type ApplicationIconStore } from '../src/application-icon.ts'

const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))) })
async function fixture() {
  const home = await mkdtemp(join(tmpdir(), 'ling-application-icon-'))
  directories.push(home)
  const file = join(home, 'application-icon.json')
  return { home, file, store: new FileApplicationIconStore(file) }
}

describe('native application icon preference', () => {
  it('restores the last successful native choice on the next launch', async () => {
    const { home, file, store } = await fixture()
    const apply = vi.fn()
    const controller = new ApplicationIconController(store, apply)
    expect(await controller.restore()).toEqual({ style: 'fold-indigo', styles: [...applicationIconStyles] })
    expect(await controller.set('relay-light')).toEqual({ style: 'relay-light', styles: [...applicationIconStyles] })
    expect(apply.mock.calls).toEqual([['fold-indigo'], ['relay-light']])
    const nextApply = vi.fn()
    const relaunched = new ApplicationIconController(new FileApplicationIconStore(file), nextApply)
    expect((await relaunched.restore()).style).toBe('relay-light')
    expect(nextApply.mock.calls).toEqual([['fold-indigo'], ['relay-light']])
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ version: 1, style: 'relay-light' })
    expect(await readdir(home)).toEqual(['application-icon.json'])
  })

  it.each([['default', 'fold-indigo'], ['dark', 'relay-dark'], ['gradient', 'relay-light']] as const)('migrates the retired %s preference', async (old, current) => {
    const { file, store } = await fixture()
    await writeFile(file, JSON.stringify({ version: 1, style: old }))
    expect(await store.read()).toBe(current)
    expect(JSON.parse(await readFile(file, 'utf8')).style).toBe(current)
    expect(() => parseApplicationIconStyle(old)).toThrow('不支持的应用图标')
  })

  it('ships a native PNG resource for every supported icon', async () => {
    for (const style of applicationIconStyles) {
      const bytes = await readFile(new URL(`../assets/application-icons/${style}.png`, import.meta.url))
      expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
      expect(bytes.readUInt32BE(16)).toBe(bytes.readUInt32BE(20))
      expect(bytes.readUInt32BE(16)).toBeGreaterThanOrEqual(512)
    }
  })

  it.each(['fold-coral', 'fold-indigo', 'relay-dark', 'relay-light'] as const)('persists and restores the approved %s icon', async style => {
    const { file, store } = await fixture()
    const controller = new ApplicationIconController(store, vi.fn())
    await controller.restore()
    await controller.set(style)
    const apply = vi.fn()
    const restored = new ApplicationIconController(new FileApplicationIconStore(file), apply)
    expect((await restored.restore()).style).toBe(style)
    expect(apply).toHaveBeenLastCalledWith(style)
  })

  it('rejects arbitrary paths and objects before changing native surfaces or storage', async () => {
    const store: ApplicationIconStore = { read: async () => 'fold-indigo', write: vi.fn(async () => {}) }
    const apply = vi.fn()
    const controller = new ApplicationIconController(store, apply)
    await controller.restore()
    apply.mockClear()
    for (const value of ['/Applications/Other.app', '../other.png', '', null, { style: 'relay-dark', path: '/tmp/image.png' }, 'DARK']) {
      expect(() => controller.set(value)).toThrow('不支持的应用图标')
    }
    expect(apply).not.toHaveBeenCalled()
    expect(store.write).not.toHaveBeenCalled()
    expect(parseApplicationIconStyle('relay-dark')).toBe('relay-dark')
  })

  it('keeps the confirmed selection and rolls back native surfaces after a save failure', async () => {
    const store: ApplicationIconStore = { read: async () => 'relay-dark', write: vi.fn(async () => { throw new Error('Read-only home') }) }
    const apply = vi.fn()
    const controller = new ApplicationIconController(store, apply)
    await controller.restore()
    apply.mockClear()
    await expect(controller.set('relay-light')).rejects.toThrow('未能保存，已恢复原图标')
    expect(apply.mock.calls).toEqual([['relay-light'], ['relay-dark']])
    expect(controller.snapshot().style).toBe('relay-dark')
  })

  it('does not persist a native failure and permits a later successful retry', async () => {
    const write = vi.fn(async () => {})
    const store: ApplicationIconStore = { read: async () => 'fold-indigo', write }
    let fail = true
    const apply = vi.fn((style: ApplicationIconStyle) => { if (style === 'relay-dark' && fail) throw new Error('Dock unavailable') })
    const controller = new ApplicationIconController(store, apply)
    await controller.restore()
    apply.mockClear()
    await expect(controller.set('relay-dark')).rejects.toThrow('系统无法更新应用图标')
    expect(apply.mock.calls).toEqual([['relay-dark'], ['fold-indigo']])
    expect(write).not.toHaveBeenCalled()
    expect(controller.snapshot().style).toBe('fold-indigo')
    fail = false
    expect((await controller.set('relay-dark')).style).toBe('relay-dark')
    expect(write).toHaveBeenCalledWith('relay-dark')
  })

  it('serializes changes from different windows until each preference is durable', async () => {
    const calls: string[] = []
    let finishFirst: (() => void) | undefined
    const store: ApplicationIconStore = {
      read: async () => 'fold-indigo',
      write: async style => {
        calls.push(`save:${style}`)
        if (style === 'relay-dark') await new Promise<void>(resolve => { finishFirst = resolve })
      },
    }
    const controller = new ApplicationIconController(store, style => { calls.push(`apply:${style}`) })
    await controller.restore()
    calls.length = 0
    const first = controller.set('relay-dark')
    const second = controller.set('relay-light')
    await Promise.resolve()
    expect(calls).toEqual(['apply:relay-dark', 'save:relay-dark'])
    expect(controller.snapshot().style).toBe('fold-indigo')
    finishFirst!()
    expect((await first).style).toBe('relay-dark')
    expect((await second).style).toBe('relay-light')
    expect(calls).toEqual(['apply:relay-dark', 'save:relay-dark', 'apply:relay-light', 'save:relay-light'])
  })

  it('can repair a damaged stored preference by choosing the fold-indigo icon', async () => {
    const { file, store } = await fixture()
    await writeFile(file, '{"version":1,"style":"/tmp/arbitrary.png"}')
    const apply = vi.fn()
    const controller = new ApplicationIconController(store, apply)
    await expect(controller.restore()).rejects.toThrow('偏好无法读取')
    expect(controller.snapshot().style).toBe('fold-indigo')
    expect(apply).toHaveBeenCalledWith('fold-indigo')
    await controller.set('fold-indigo')
    expect(await new FileApplicationIconStore(file).read()).toBe('fold-indigo')
  })
})

describe('native application icon surfaces', () => {
  it('updates the macOS Dock icon', () => {
    const image = { name: 'relay-light' }
    const dock = { setIcon: vi.fn() }
    const window = { isDestroyed: () => false, setIcon: vi.fn() }
    applyNativeApplicationIcon('darwin', image, { dock, windows: [window] })
    expect(dock.setIcon).toHaveBeenCalledWith(image)
    expect(window.setIcon).not.toHaveBeenCalled()
    expect(() => applyNativeApplicationIcon('darwin', image, { windows: [] })).toThrow('程序坞不可用')
  })

  it.each(['win32', 'linux'] as const)('updates all live windows on %s', platform => {
    const image = { name: 'relay-dark' }
    const live = { isDestroyed: () => false, setIcon: vi.fn() }
    const closed = { isDestroyed: () => true, setIcon: vi.fn() }
    const dock = { setIcon: vi.fn() }
    applyNativeApplicationIcon(platform, image, { dock, windows: [live, closed] })
    expect(live.setIcon).toHaveBeenCalledWith(image)
    expect(closed.setIcon).not.toHaveBeenCalled()
    expect(dock.setIcon).not.toHaveBeenCalled()
  })
})
