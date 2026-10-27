import { describe, expect, it, vi } from 'vitest'
import type { LingReadResult, LingTaskTerminal, LingTerminalPanel, LingTerminalPanelState, LingTerminalService } from '../src/runtime/contract.js'
import type { LingServer, LingServerService, LingServerTerminalScope } from '../src/runtime/servers.js'
import { TargetTerminalModel, retainedTargetTerminals } from '../src/ui/TargetTerminalPanel.js'

const servers: readonly LingServer[] = [
  { id: 'a', name: '服务器 A', alias: 'a', environment: 'development' },
  { id: 'b', name: '服务器 B', alias: 'b', environment: 'staging' },
  { id: 'c', name: '未关联服务器', alias: 'c', environment: 'production' },
]
const context = { taskId: 'task-a', workspaceId: 'local-project', servers, serverIds: ['a', 'b'] }

function localFixture() {
  const panels = new Map<string, LingTerminalPanel>()
  const workspacePanel = vi.fn((workspaceId: string | undefined, placement: 'side' | 'bottom') => {
    const key = `${workspaceId ?? 'home'}:${placement}`
    const existing = panels.get(key)
    if (existing) return existing
    let state: LingTerminalPanelState = { terminals: [], loading: false }
    let initialized = false
    let count = 0
    const listeners = new Set<() => void>()
    const update = (terminals: readonly LingTaskTerminal[]) => { state = { terminals, loading: false }; for (const listener of listeners) listener() }
    const panel: LingTerminalPanel = {
      getSnapshot: () => state,
      subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener) } },
      load: vi.fn(async () => { if (!initialized && !state.terminals.length) await panel.create(); initialized = true }),
      create: vi.fn(async () => update([...state.terminals, { terminalId: `${key}:${++count}`, title: `Shell ${count}`, shell: 'zsh', cwd: workspaceId ? `/local/${workspaceId}` : '/home/user', state: 'running' }])),
      close: vi.fn(async id => update(state.terminals.filter(terminal => terminal.terminalId !== id))),
      rename: vi.fn(async (id, title) => { update(state.terminals.map(terminal => terminal.terminalId === id ? { ...terminal, title } : terminal)); return { ok: true as const, value: undefined } }),
      view: vi.fn(() => { throw new Error('The model must not mount a terminal view') }),
    }
    panels.set(key, panel)
    return panel
  })
  const service = { workspacePanel, panel: vi.fn(() => { throw new Error('Task cwd must never initialize a local terminal') }) } satisfies LingTerminalService
  return { service, workspacePanel, panels }
}
function serverFixture() {
  const terminals = new Map<string, readonly string[]>()
  const terminalScope = vi.fn(async (request: LingServerTerminalScope) => ({ ok: true as const, value: { ownerId: `owner:${request.taskId ?? 'draft'}:${request.serverId}:${request.placement}` } }))
  let count = 0
  const terminalList = vi.fn(async (owner: string): Promise<LingReadResult<readonly string[]>> => ({ ok: true, value: terminals.get(owner) ?? [] }))
  const terminalOpen = vi.fn(async (owner: string, _cols: number, _rows: number) => {
    const terminalId = `pty-${++count}`
    terminals.set(owner, [...(terminals.get(owner) ?? []), terminalId])
    return { ok: true as const, value: { terminalId } }
  })
  const terminalClose = vi.fn(async (owner: string, id: string): Promise<LingReadResult<{ readonly ok: true }>> => {
    terminals.set(owner, (terminals.get(owner) ?? []).filter(terminal => terminal !== id))
    return { ok: true, value: { ok: true } }
  })
  const service = { terminalScope, terminalList, terminalOpen, terminalClose } as unknown as LingServerService
  return { service, terminalScope, terminalList, terminalOpen, terminalClose, terminals }
}

describe('terminal tabs with captured local and server owners', () => {
  it('keeps local, server A and server B in one panel and routes each PTY through its own owner', async () => {
    const local = localFixture(), remote = serverFixture()
    const model = new TargetTerminalModel(local.service, remote.service, 'side')
    await model.ensure(context, { kind: 'local' })
    await model.ensure(context, { kind: 'server', serverId: 'a' })
    await model.ensure(context, { kind: 'server', serverId: 'b' })
    expect(model.getSnapshot().tabs.map(tab => tab.targetLabel)).toEqual(['本地', '服务器 A', '服务器 B'])
    expect(local.workspacePanel).toHaveBeenCalledWith('local-project', 'side')
    expect(local.service.panel).not.toHaveBeenCalled()
    expect(remote.terminalScope.mock.calls).toEqual([
      [{ taskId: 'task-a', serverId: 'a', placement: 'side' }],
      [{ taskId: 'task-a', serverId: 'b', placement: 'side' }],
    ])
    expect(remote.terminalOpen.mock.calls.map(call => call[0])).toEqual(['owner:task-a:a:side', 'owner:task-a:b:side'])
    expect(model.getSnapshot().tabs.find(tab => tab.id === model.getSnapshot().selectedId)?.target).toEqual({ kind: 'server', serverId: 'b' })
  })
  it('reuses a target on repeated open requests while an explicit new action allocates exactly one shell', async () => {
    const local = localFixture(), remote = serverFixture()
    const model = new TargetTerminalModel(local.service, remote.service, 'side')
    await Promise.all([model.ensure(context, { kind: 'server', serverId: 'a' }), model.ensure(context, { kind: 'server', serverId: 'a' })])
    expect(remote.terminalScope).toHaveBeenCalledTimes(1)
    expect(remote.terminalOpen).toHaveBeenCalledTimes(1)
    await model.ensure(context, { kind: 'server', serverId: 'a' })
    expect(remote.terminalOpen).toHaveBeenCalledTimes(1)
    await model.ensure(context, { kind: 'server', serverId: 'a' }, true)
    expect(remote.terminalOpen).toHaveBeenCalledTimes(2)
    await model.ensure(context, { kind: 'local' }, true)
    expect(local.panels.get('local-project:side')?.create).toHaveBeenCalledTimes(1)
    expect(model.getSnapshot().tabs).toHaveLength(3)
  })
  it('retains owner identities when another task opens the same server and closes only the explicitly chosen tab', async () => {
    const remote = serverFixture(), model = new TargetTerminalModel(undefined, remote.service, 'bottom')
    await model.ensure(context, { kind: 'server', serverId: 'a' })
    const first = model.getSnapshot().tabs[0]!
    await model.ensure({ ...context, taskId: 'task-b' }, { kind: 'server', serverId: 'a' })
    expect(model.getSnapshot().tabs).toHaveLength(2)
    await model.close(first.id)
    expect(remote.terminalClose).toHaveBeenCalledExactlyOnceWith('owner:task-a:a:bottom', first.terminalId)
    expect(model.getSnapshot().tabs[0]?.owner).toMatchObject({ ownerId: 'owner:task-b:a:bottom' })
    expect(remote.terminalOpen).toHaveBeenCalledTimes(2)
  })
  it('uses the local home provider for a remote task without a local workspace and leaves prior local shells intact', async () => {
    const local = localFixture(), model = new TargetTerminalModel(local.service, undefined, 'side')
    await model.ensure(context, { kind: 'local' })
    const first = model.getSnapshot().tabs[0]!
    await model.ensure({ ...context, taskId: 'remote-task', workspaceId: undefined }, { kind: 'local' })
    expect(local.workspacePanel.mock.calls).toEqual([['local-project', 'side'], [undefined, 'side']])
    expect(local.service.panel).not.toHaveBeenCalled()
    expect(model.getSnapshot().tabs.map(tab => tab.cwd)).toEqual(['/local/local-project', '/home/user'])
    await model.close(first.id)
    expect(local.panels.get('local-project:side')?.close).toHaveBeenCalledExactlyOnceWith(first.terminalId)
    expect(local.panels.get('home:side')?.close).not.toHaveBeenCalled()
  })
  it('recovers selected tabs after a view unmount without ending PTYs and keeps placements separate', async () => {
    const local = localFixture(), remote = serverFixture()
    const model = retainedTargetTerminals(local.service, remote.service, 'side')
    await model.ensure(context, { kind: 'server', serverId: 'a' })
    const selected = model.getSnapshot().selectedId
    const unsubscribe = model.subscribe(() => {})
    unsubscribe()
    const restored = retainedTargetTerminals(local.service, remote.service, 'side')
    expect(restored).toBe(model)
    expect(restored.getSnapshot().selectedId).toBe(selected)
    expect(remote.terminalClose).not.toHaveBeenCalled()
    expect(retainedTargetTerminals(local.service, remote.service, 'bottom')).not.toBe(model)
  })
  it('consumes an external request once across collapse, task switch and reopen, while new requests still focus its target', async () => {
    const remote = serverFixture(), model = retainedTargetTerminals(undefined, remote.service, 'side')
    const target = { kind: 'server', serverId: 'a' } as const
    await model.request(context, target)
    const first = model.getSnapshot().selectedId
    await model.request({ ...context, taskId: 'task-b', serverIds: ['b'] }, target)
    expect(remote.terminalScope).toHaveBeenCalledExactlyOnceWith({ taskId: 'task-a', serverId: 'a', placement: 'side' })
    expect(remote.terminalOpen).toHaveBeenCalledTimes(1)
    expect(model.getSnapshot().selectedId).toBe(first)
    expect(model.getSnapshot().error).toBeUndefined()
    await model.request(context, { kind: 'server', serverId: 'a' })
    expect(remote.terminalOpen).toHaveBeenCalledTimes(1)
    expect(model.getSnapshot().selectedId).toBe(first)
    expect(remote.terminalList).toHaveBeenCalledTimes(2)
  })
  it('keeps existing tabs on failures, retries a failed target, and rejects unassociated targets before allocation', async () => {
    const remote = serverFixture(), model = new TargetTerminalModel(undefined, remote.service, 'side')
    await model.ensure(context, { kind: 'server', serverId: 'a' })
    remote.terminalList.mockResolvedValueOnce({ ok: false, reason: 'runtime-unavailable', message: 'B is offline', retryable: true })
    await model.ensure(context, { kind: 'server', serverId: 'b' })
    expect(model.getSnapshot()).toMatchObject({ error: 'B is offline', pending: 0 })
    expect(model.getSnapshot().tabs).toHaveLength(1)
    await model.ensure(context, { kind: 'server', serverId: 'b' })
    expect(model.getSnapshot().tabs).toHaveLength(2)
    expect(model.getSnapshot().error).toBeUndefined()
    await model.ensure(context, { kind: 'server', serverId: 'c' })
    expect(model.getSnapshot().error).toContain('未关联')
    expect(remote.terminalScope).toHaveBeenCalledTimes(2)
  })
  it('immediately dismisses a tab while close is pending and ignores cleanup cancellation', async () => {
    const remote = serverFixture(), model = new TargetTerminalModel(undefined, remote.service, 'side')
    await model.ensure(context, { kind: 'server', serverId: 'a' })
    let cancel!: (error: Error) => void
    remote.terminalClose.mockImplementationOnce(() => new Promise((_resolve, reject) => { cancel = reject }))
    const tab = model.getSnapshot().tabs[0]!
    const closing = model.close(tab.id)
    expect(model.getSnapshot().tabs).toHaveLength(0)
    expect(model.getSnapshot().selectedId).toBeUndefined()
    expect(model.getSnapshot().error).toBeUndefined()
    const duplicate = model.close(tab.id)
    await Promise.resolve()
    expect(remote.terminalClose).toHaveBeenCalledTimes(1)
    cancel(new Error('SSH operation cancelled; a completed remote mutation is not rolled back'))
    await Promise.all([closing, duplicate])
    expect(model.getSnapshot().tabs).toHaveLength(0)
    expect(model.getSnapshot().error).toBeUndefined()
    // A delayed server list must not bring the dismissed terminal back.
    await model.ensure(context, { kind: 'server', serverId: 'a' })
    expect(model.getSnapshot().tabs).toHaveLength(0)
    await model.ensure(context, { kind: 'server', serverId: 'a' }, true)
    expect(model.getSnapshot().tabs.map(tab => tab.terminalId)).toEqual(['pty-2'])
  })
  it('does not show a failed close response above a remaining terminal', async () => {
    const remote = serverFixture(), model = new TargetTerminalModel(undefined, remote.service, 'side')
    await model.ensure(context, { kind: 'server', serverId: 'a' })
    await model.ensure(context, { kind: 'server', serverId: 'b' })
    const [first, second] = model.getSnapshot().tabs
    remote.terminalClose.mockResolvedValueOnce({ ok: false, reason: 'runtime-unavailable', message: 'SSH operation cancelled; a completed remote mutation is not rolled back', retryable: true })
    await model.close(second!.id)
    expect(model.getSnapshot().tabs).toEqual([first])
    expect(model.getSnapshot().selectedId).toBe(first!.id)
    expect(model.getSnapshot().error).toBeUndefined()
  })
  it('does not resurrect a tab from a list request that finishes after closing it', async () => {
    const remote = serverFixture(), model = new TargetTerminalModel(undefined, remote.service, 'side')
    await model.ensure(context, { kind: 'server', serverId: 'a' })
    const tab = model.getSnapshot().tabs[0]!
    let finish!: () => void
    remote.terminalList.mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve({ ok: true, value: [tab.terminalId] }) }))
    const loading = model.ensure(context, { kind: 'server', serverId: 'a' })
    const closing = model.close(tab.id)
    expect(model.getSnapshot().tabs).toHaveLength(0)
    finish()
    await Promise.all([loading, closing])
    expect(model.getSnapshot().tabs).toHaveLength(0)
    expect(remote.terminalOpen).toHaveBeenCalledTimes(1)
    expect(remote.terminalClose).toHaveBeenCalledExactlyOnceWith('owner:task-a:a:side', tab.terminalId)
  })
  it('keeps a locally dismissed tab hidden when cleanup fails and the local provider refreshes', async () => {
    const local = localFixture(), model = new TargetTerminalModel(local.service, undefined, 'side')
    await model.ensure(context, { kind: 'local' })
    const panel = local.panels.get('local-project:side')!
    vi.mocked(panel.close).mockRejectedValueOnce(new Error('terminal already disconnected'))
    await model.close(model.getSnapshot().tabs[0]!.id)
    await panel.create()
    expect(model.getSnapshot().tabs.map(tab => tab.terminalId)).toEqual(['local-project:side:2'])
    expect(model.getSnapshot().error).toBeUndefined()
  })
  it('preserves explicit tab selection when an earlier target connection finishes later', async () => {
    const local = localFixture(), remote = serverFixture(), model = new TargetTerminalModel(local.service, remote.service, 'side')
    await model.ensure(context, { kind: 'local' })
    const localId = model.getSnapshot().selectedId!
    let finish!: () => void
    remote.terminalScope.mockImplementationOnce(async request => {
      await new Promise<void>(resolve => { finish = resolve })
      return { ok: true, value: { ownerId: `owner:${request.serverId}` } }
    })
    const opening = model.ensure(context, { kind: 'server', serverId: 'a' })
    model.select(localId)
    finish()
    await opening
    expect(model.getSnapshot().tabs).toHaveLength(2)
    expect(model.getSnapshot().selectedId).toBe(localId)
  })
})
