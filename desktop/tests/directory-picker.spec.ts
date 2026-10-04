import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDshDirectoryPicker } from '../src/client/directory-picker.js'

const answer = <Value>(value: Value) => ({ ok: true as const, value })

function withGlobalPicker(picker: { pick(): Promise<string | null> } | undefined): void {
  Object.defineProperty(globalThis, '__DSH_DIRECTORY_PICKER__', {
    configurable: true,
    value: picker,
  })
}

afterEach(() => {
  withGlobalPicker(undefined)
})

describe('DSH directory picker projection', () => {
  it('prefers the Electron desktop picker and treats null as a cancelled pick', async () => {
    const pick = vi.fn(async () => null)
    const wirePick = vi.fn()
    withGlobalPicker({ pick })
    const projection = createDshDirectoryPicker({ directoryPicker: { pick: wirePick } } as never)

    await expect(projection.pick()).resolves.toEqual({ ok: true, value: undefined })
    expect(pick).toHaveBeenCalledTimes(1)
    expect(wirePick).not.toHaveBeenCalled()
  })

  it('returns the desktop-picked path', async () => {
    withGlobalPicker({ pick: async () => '/tmp/picked' })
    const projection = createDshDirectoryPicker({ directoryPicker: { pick: vi.fn() } } as never)

    await expect(projection.pick()).resolves.toEqual({ ok: true, value: '/tmp/picked' })
  })

  it('fails without impersonating a cancellation when the desktop picker throws', async () => {
    withGlobalPicker({ pick: async () => { throw new Error('dialog failed') } })
    const projection = createDshDirectoryPicker({ directoryPicker: { pick: vi.fn() } } as never)

    const result = await projection.pick()
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('runtime-unavailable')
  })

  it('falls back to the remote wire picker outside Electron', async () => {
    const projection = createDshDirectoryPicker({
      directoryPicker: { pick: vi.fn(async () => answer('/tmp/wire-picked')) },
    } as never)

    await expect(projection.pick()).resolves.toEqual({ ok: true, value: '/tmp/wire-picked' })
  })

  it('maps remote wire failures to read failures', async () => {
    const projection = createDshDirectoryPicker({
      directoryPicker: {
        pick: vi.fn(async () => ({ ok: false as const, error: { code: 'directory-picker/unavailable', message: '宿主未提供目录选择能力。' } })),
      },
    } as never)

    await expect(projection.pick()).resolves.toEqual({
      ok: false,
      reason: 'runtime-unavailable',
      message: '宿主未提供目录选择能力。',
      retryable: true,
    })
  })

  it('reports unavailable when the remote namespace call throws', async () => {
    const projection = createDshDirectoryPicker({
      directoryPicker: {
        pick: vi.fn(async () => { throw new TypeError('missing namespace') }),
      },
    } as never)

    const result = await projection.pick()
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('runtime-unavailable')
  })
})
