// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LingServerService } from '../src/runtime/servers.js'
import { ServerTerminalScreen } from '../src/ui/ServerTerminalPanel.js'
import { TargetTerminalPanel } from '../src/ui/TargetTerminalPanel.js'

const instances = vi.hoisted(() => [] as { input?: (data: string) => void; write: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> }[])
vi.mock('@xterm/xterm', () => ({ Terminal: class {
  cols = 80; rows = 24; options = {}; textarea = document.createElement('textarea')
  input?: (data: string) => void
  write = vi.fn((_text: string, callback?: () => void) => callback?.())
  dispose = vi.fn()
  constructor() { instances.push(this) }
  loadAddon() {}
  open(node: HTMLElement) { node.append(this.textarea) }
  onData(input: (data: string) => void) { this.input = input; return { dispose() {} } }
  focus() {}
  reset() {}
} }))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit() {} } }))

let root: Root | undefined
let container: HTMLDivElement
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('ResizeObserver', class { constructor(private callback: () => void) {} observe() { this.callback() } unobserve() {} disconnect() {} })
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(600)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(300)
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
})
afterEach(async () => { await act(async () => root?.unmount()); instances.length = 0; document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('a server terminal view always uses its captured owner', () => {
  it('routes polling, input and resize to that owner, then detaches without closing either PTY when selecting another tab', async () => {
    const terminalPoll = vi.fn(async (_owner: string, terminalId: string, _offset: number, _signal?: AbortSignal) => ({ ok: true as const, value: { terminalId, offset: 0, data: '', closed: true } }))
    const terminalWrite = vi.fn(async () => ({ ok: true as const, value: { ok: true } }))
    const terminalResize = vi.fn(async () => ({ ok: true as const, value: { ok: true } }))
    const terminalClose = vi.fn()
    const service = { terminalPoll, terminalWrite, terminalResize, terminalClose } as unknown as LingServerService
    const show = async (ownerId: string, terminalId: string) => act(async () => { root!.render(<ServerTerminalScreen key={terminalId} service={service} ownerId={ownerId} terminalId={terminalId} />) })
    await show('owner-a', 'pty-a')
    await act(async () => instances[0]!.input?.('echo A\r'))
    expect(terminalPoll).toHaveBeenCalledWith('owner-a', 'pty-a', 0, expect.any(AbortSignal))
    expect(terminalWrite).toHaveBeenCalledWith('owner-a', 'pty-a', 'echo A\r', expect.any(AbortSignal))
    expect(terminalResize).toHaveBeenCalledWith('owner-a', 'pty-a', 80, 24, expect.any(AbortSignal))
    const oldSignal = terminalPoll.mock.calls[0]![3]!
    await show('owner-b', 'pty-b')
    expect(oldSignal.aborted).toBe(true)
    expect(instances[0]!.dispose).toHaveBeenCalledTimes(1)
    await act(async () => instances[1]!.input?.('echo B\r'))
    expect(terminalWrite).toHaveBeenLastCalledWith('owner-b', 'pty-b', 'echo B\r', expect.any(AbortSignal))
    expect(terminalClose).not.toHaveBeenCalled()
  })
  it('aborts a hidden view and discards late output instead of writing it into a different terminal', async () => {
    let finish!: (value: unknown) => void
    const terminalPoll = vi.fn(() => new Promise(resolve => { finish = resolve }))
    const terminalClose = vi.fn()
    const service = { terminalPoll, terminalClose, terminalResize: vi.fn(async () => ({ ok: true, value: { ok: true } })) } as unknown as LingServerService
    await act(async () => root!.render(<ServerTerminalScreen service={service} ownerId="owner-a" terminalId="pty-a" />))
    await act(async () => { root!.unmount(); root = undefined })
    await act(async () => finish({ ok: true, value: { terminalId: 'pty-a', offset: 5, data: btoa('stale'), closed: true } }))
    expect(instances[0]!.write).not.toHaveBeenCalled()
    expect(terminalClose).not.toHaveBeenCalled()
  })
  it('closes the tab immediately without showing late polling or cleanup cancellation errors', async () => {
    let finishPoll!: (value: unknown) => void
    let cancelClose!: (error: Error) => void
    const terminalPoll = vi.fn(() => new Promise(resolve => { finishPoll = resolve }))
    const terminalClose = vi.fn(() => new Promise((_resolve, reject) => { cancelClose = reject }))
    const service = {
      terminalScope: async () => ({ ok: true, value: { ownerId: 'owner-a' } }),
      terminalList: async () => ({ ok: true, value: ['pty-a'] }),
      terminalPoll, terminalClose,
      terminalResize: async () => ({ ok: true, value: { ok: true } }),
    } as unknown as LingServerService
    await act(async () => {
      root!.render(<TargetTerminalPanel serverService={service} taskId="task-a"
        servers={[{ id: 'a', name: '服务器 A', alias: 'a', environment: 'development' }]} serverIds={['a']}
        placement="side" initialTarget={{ kind: 'server', serverId: 'a' }} />)
    })
    expect(container.querySelector('[aria-label="远端终端输入"]')).not.toBeNull()
    await act(async () => { container.querySelector<HTMLButtonElement>('[aria-label="关闭终端 服务器 A · 终端 1"]')!.click() })
    expect(container.querySelector('[role="tab"]')).toBeNull()
    expect(container.querySelector('[aria-label="远端终端输入"]')).toBeNull()
    expect(instances[0]!.dispose).toHaveBeenCalledTimes(1)
    const cancellation = 'SSH operation cancelled; a completed remote mutation is not rolled back'
    await act(async () => {
      finishPoll({ ok: true, value: { terminalId: 'pty-a', offset: 0, data: '', closed: true, error: cancellation } })
      cancelClose(new Error(cancellation))
    })
    expect(container.querySelector('[role="alert"]')).toBeNull()
    expect(container.textContent).not.toContain(cancellation)
    expect(terminalClose).toHaveBeenCalledExactlyOnceWith('owner-a', 'pty-a')
  })
  it('still reports a real connection failure on a terminal the user has not closed', async () => {
    const service = {
      terminalPoll: async () => ({ ok: true, value: { terminalId: 'pty-a', offset: 0, data: '', closed: true, error: '远端终端连接已中断。' } }),
      terminalResize: async () => ({ ok: true, value: { ok: true } }),
    } as unknown as LingServerService
    await act(async () => root!.render(<ServerTerminalScreen service={service} ownerId="owner-a" terminalId="pty-a" />))
    expect(container.querySelector('[role="status"]')?.textContent).toBe('远端终端连接已中断。')
  })
})
