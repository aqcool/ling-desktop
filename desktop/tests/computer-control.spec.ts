import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { captureFrontWindow, frontWindow } from '../src/host/computer-control-controller.ts'
import { SnapshotShortcut } from '../src/snapshot-shortcut.ts'
import { COMPUTER_USE_PREFIX as prefix } from '../src/computer-use-policy.ts'

const window = (window_id: number, z_index: number) => ({ pid: 42, window_id, z_index, app_name: 'Editor', title: 'File' })
describe('foreground snapshots', () => {
  it('selects the highest visible z-index and refuses ambiguous or incomplete targets', () => {
    expect(frontWindow({ structuredContent: { windows: [window(1, 1), { ...window(2, 9), on_current_space: false }, window(3, 4)] } }).window_id).toBe(3)
    expect(frontWindow({ content: [{ type: 'text', text: JSON.stringify([window(1, 1)]) }] }).window_id).toBe(1)
    expect(() => frontWindow({ structuredContent: [window(1, 4), window(2, 4)] })).toThrow('前台窗口')
    expect(() => frontWindow({ structuredContent: [{ pid: 42, title: 'No target' }] })).toThrow('前台窗口')
  })
  it('captures the exact foreground target with bounded images and accessibility text through ordinary tools', async () => {
    const execute = vi.fn().mockResolvedValueOnce({ isError: false, value: { structuredContent: [window(7, 3)] } })
      .mockResolvedValueOnce({ isError: false, value: { structuredContent: { tree_markdown: '# File' }, content: [{ type: 'image', mimeType: 'image/png', data: 'aGVsbG8=' }] } })
    const snapshot = await captureFrontWindow({ tools: { execute } } as unknown as Context)
    expect(execute.mock.calls.map(([request]) => [request.name, request.arguments])).toEqual([
      [prefix + 'list_windows', { on_screen_only: true }], [prefix + 'get_window_state', { pid: 42, window_id: 7, max_image_dimension: 1600 }],
    ])
    expect(execute.mock.calls.every(([request]) => !request.agent && !request.arguments.screenshot_out_file)).toBe(true)
    expect(snapshot).toMatchObject({ title: 'Editor · File', text: '# File', images: [{ mediaType: 'image/png', data: 'aGVsbG8=' }] })
  })
  it('does not capture after a lease/permission denial and rejects missing screenshots', async () => {
    const execute = vi.fn().mockResolvedValueOnce({ isError: true, content: [{ type: 'text', text: '另一个会话正在操作电脑' }] })
    await expect(captureFrontWindow({ tools: { execute } } as unknown as Context)).rejects.toThrow('另一个会话')
    expect(execute).toHaveBeenCalledOnce()
    execute.mockResolvedValueOnce({ isError: false, value: { structuredContent: [window(7, 3)] } })
      .mockResolvedValueOnce({ isError: false, value: { content: [{ type: 'text', text: 'No screenshot' }] } })
    await expect(captureFrontWindow({ tools: { execute } } as unknown as Context)).rejects.toThrow('屏幕录制权限')
  })
})
describe('global snapshot shortcut ownership', () => {
  it('keeps the working shortcut on conflict, validates keys and unregisters only the current owner', () => {
    const callbacks = new Map<string, () => void>()
    const register = vi.fn((key: string, callback: () => void) => { if (key.endsWith('+X')) return false; callbacks.set(key, callback); return true })
    const unregister = vi.fn((key: string) => { callbacks.delete(key) })
    const shortcut = new SnapshotShortcut({ register, unregister })
    const first = vi.fn(); const next = vi.fn()
    shortcut.set(1, 'CommandOrControl+Shift+S', first)
    expect(() => shortcut.set(1, 'CommandOrControl+Shift+X', first)).toThrow('占用')
    callbacks.get('CommandOrControl+Shift+S')!(); expect(first).toHaveBeenCalledOnce()
    expect(() => shortcut.set(1, 'CommandOrControl+Q', first)).toThrow('无效')
    shortcut.set(2, 'CommandOrControl+Shift+S', next)
    shortcut.clearOwner(1); callbacks.get('CommandOrControl+Shift+S')!()
    expect(next).toHaveBeenCalledOnce(); expect(unregister).not.toHaveBeenCalled()
    shortcut.set(2, '', next); expect(callbacks.size).toBe(0)
    shortcut.dispose(); expect(unregister).toHaveBeenCalledOnce()
  })
})
