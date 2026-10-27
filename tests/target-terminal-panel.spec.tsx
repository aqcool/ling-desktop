// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LingTaskTerminal, LingTerminalPanel, LingTerminalPanelState, LingTerminalService, LingTerminalView } from '../src/runtime/contract.js'
import type { LingServer, LingServerService, LingServerTerminalScope, LingTerminalTarget } from '../src/runtime/servers.js'
import { TargetTerminalPanel } from '../src/ui/TargetTerminalPanel.js'

vi.mock('../src/ui/TerminalPanel.js', () => ({
  TerminalBody: ({ model }: { model: { owner: string } }) => <div data-local-owner={model.owner}>Local shell</div>,
  TerminalNameEditor: () => <input aria-label="终端名称" />,
}))
vi.mock('../src/ui/ServerTerminalPanel.js', () => ({
  ServerTerminalScreen: ({ ownerId, terminalId }: { ownerId: string; terminalId: string }) => <div data-server-owner={ownerId} data-terminal-id={terminalId}>Server shell</div>,
}))

const servers: readonly LingServer[] = [
  { id: 'a', name: '服务器 A', alias: 'a', environment: 'development' },
  { id: 'b', name: '服务器 B', alias: 'b', environment: 'staging' },
  { id: 'c', name: '未关联服务器', alias: 'c', environment: 'production' },
]
let root: Root | undefined
let container: HTMLDivElement
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
  vi.stubGlobal('CSS', { escape: (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, character => `\\${character}`) })
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
})
afterEach(async () => { await act(async () => root?.unmount()); document.body.replaceChildren(); vi.unstubAllGlobals() })

function fixture() {
  const panels = new Map<string, LingTerminalPanel>()
  const workspacePanel = vi.fn((workspaceId: string | undefined, placement: 'side' | 'bottom') => {
    const owner = `${workspaceId ?? 'home'}:${placement}`
    const saved = panels.get(owner)
    if (saved) return saved
    let state: LingTerminalPanelState = { terminals: [], loading: false }
    let count = 0
    let initialized = false
    const listeners = new Set<() => void>()
    const update = (terminals: readonly LingTaskTerminal[]) => { state = { terminals, loading: false }; for (const listener of listeners) listener() }
    const view = { owner } as unknown as LingTerminalView
    const panel: LingTerminalPanel = {
      getSnapshot: () => state,
      subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener) } },
      load: vi.fn(async () => { if (!initialized && !state.terminals.length) await panel.create(); initialized = true }),
      create: vi.fn(async () => update([...state.terminals, { terminalId: `local-${owner}-${++count}`, title: `Shell ${count}`, shell: 'zsh', cwd: `/local/${workspaceId ?? 'home'}`, state: 'running' }])),
      close: vi.fn(async id => update(state.terminals.filter(terminal => terminal.terminalId !== id))),
      rename: vi.fn(async () => ({ ok: true as const, value: undefined })), view: () => view,
    }
    panels.set(owner, panel)
    return panel
  })
  const local = { workspacePanel, panel: vi.fn(() => { throw new Error('Do not use a task cwd for a local shell') }) } satisfies LingTerminalService
  const ids = new Map<string, string[]>()
  let count = 0
  const terminalScope = vi.fn(async (request: LingServerTerminalScope) => ({ ok: true as const, value: { ownerId: `${request.taskId ?? 'draft'}:${request.serverId}:${request.placement}` } }))
  const terminalList = vi.fn(async (owner: string) => ({ ok: true as const, value: ids.get(owner) ?? [] }))
  const terminalOpen = vi.fn(async (owner: string) => { const terminalId = `remote-${++count}`; ids.set(owner, [...(ids.get(owner) ?? []), terminalId]); return { ok: true as const, value: { terminalId } } })
  const terminalClose = vi.fn(async (owner: string, id: string) => { ids.set(owner, (ids.get(owner) ?? []).filter(item => item !== id)); return { ok: true as const, value: { ok: true } } })
  const remote = { terminalScope, terminalList, terminalOpen, terminalClose } as unknown as LingServerService
  return { local, remote, workspacePanel, panels, terminalScope, terminalOpen, terminalClose }
}
const flush = async () => { await new Promise<void>(done => setTimeout(done, 0)) }
const click = async (label: string) => {
  const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find(button => button.getAttribute('aria-label') === label)
  expect(button, label).toBeDefined()
  await act(async () => { button!.click(); await flush() })
}
const selectedLabel = () => container.querySelector('[role="tab"][aria-selected="true"]')?.getAttribute('aria-label')

describe('one terminal panel with local and associated-server tabs', () => {
  it('responds to later external target requests by opening or focusing the target without replacing other tabs', async () => {
    const f = fixture()
    const show = async (initialTarget: LingTerminalTarget) => act(async () => { root!.render(<TargetTerminalPanel localService={f.local} serverService={f.remote} taskId="task" workspaceId="project" servers={servers} serverIds={['a', 'b']} placement="side" initialTarget={initialTarget} />); await flush() })
    await show({ kind: 'local' })
    await show({ kind: 'server', serverId: 'a' })
    await show({ kind: 'server', serverId: 'b' })
    expect(container.querySelectorAll('[role="tab"]')).toHaveLength(3)
    expect(selectedLabel()).toBe('服务器 B · 终端 1')
    await show({ kind: 'server', serverId: 'a' })
    expect(selectedLabel()).toBe('服务器 A · 终端 1')
    expect(f.terminalOpen).toHaveBeenCalledTimes(2)
    expect(container.querySelector('[data-server-owner]')?.getAttribute('data-server-owner')).toBe('task:a:side')
    expect(f.local.panel).not.toHaveBeenCalled()
  })
  it('does not consume the same old request in a new task context after collapse and reopen', async () => {
    const f = fixture(), initialTarget = { kind: 'server', serverId: 'a' } as const
    const show = async (taskId: string, serverIds: string[]) => act(async () => { root!.render(<TargetTerminalPanel localService={f.local} serverService={f.remote} taskId={taskId} servers={servers} serverIds={serverIds} placement="side" initialTarget={initialTarget} />); await flush() })
    await show('task-a', ['a', 'b'])
    await act(async () => root!.unmount())
    root = createRoot(container)
    await show('task-b', ['b'])
    expect(f.terminalScope).toHaveBeenCalledExactlyOnceWith({ taskId: 'task-a', serverId: 'a', placement: 'side' })
    expect(f.terminalOpen).toHaveBeenCalledTimes(1)
    expect(f.terminalClose).not.toHaveBeenCalled()
    expect(container.querySelector('[role="alert"]')).toBeNull()
    expect(container.querySelector('[data-server-owner]')?.getAttribute('data-server-owner')).toBe('task-a:a:side')
    await click('关闭终端 服务器 A · 终端 1')
    expect(f.terminalClose).toHaveBeenCalledExactlyOnceWith('task-a:a:side', 'remote-1')
  })
  it('offers local plus associated servers in the new menu, preserves shells on panel close, and ends only an explicitly closed tab', async () => {
    const f = fixture(), onClose = vi.fn()
    const show = async () => act(async () => { root!.render(<TargetTerminalPanel localService={f.local} serverService={f.remote} taskId="remote-task" servers={servers} serverIds={['a', 'b']} placement="bottom" onClose={onClose} />); await flush() })
    await show()
    expect(f.workspacePanel).toHaveBeenCalledWith(undefined, 'bottom')
    await click('新建终端')
    const menu = document.querySelector('[role="menu"]')!
    expect(menu.textContent).toContain('本地终端')
    expect(menu.textContent).toContain('服务器 A')
    expect(menu.textContent).toContain('服务器 B')
    expect(menu.textContent).not.toContain('未关联服务器')
    const item = [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(item => item.textContent?.includes('服务器 B'))!
    await act(async () => { item.click(); await flush() })
    expect(f.terminalOpen).toHaveBeenCalledExactlyOnceWith('remote-task:b:bottom', 80, 24)
    expect(container.querySelectorAll('[role="tab"]')).toHaveLength(2)
    await click('关闭终端面板')
    expect(onClose).toHaveBeenCalledTimes(1)
    await act(async () => root!.unmount())
    expect(f.terminalClose).not.toHaveBeenCalled()
    expect(f.panels.get('home:bottom')?.close).not.toHaveBeenCalled()
    root = createRoot(container)
    await show()
    expect(selectedLabel()).toBe('服务器 B · 终端 1')
    expect(f.terminalOpen).toHaveBeenCalledTimes(1)
    await click('关闭终端 服务器 B · 终端 1')
    expect(f.terminalClose).toHaveBeenCalledExactlyOnceWith('remote-task:b:bottom', 'remote-1')
    expect(container.querySelectorAll('[role="tab"]')).toHaveLength(1)
    expect(selectedLabel()).toBe('本地 · Shell 1')
  })
})
