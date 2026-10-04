import { describe, expect, it, vi } from 'vitest'
import { createDshTerminalProjection } from '../src/client/terminal-projection.ts'

type Projection = ReturnType<typeof createDshTerminalProjection>
type Remote = Parameters<typeof createDshTerminalProjection>[0]

function fakeRemote(result: unknown): Remote {
  return { terminal: { list: async () => result } } as unknown as Remote
}

describe('terminal projection', () => {
  it('projects session terminals from the terminal remote', async () => {
    const projection = createDshTerminalProjection(fakeRemote({
      ok: true,
      value: [
        {
          id: 'term-1',
          title: 'shell 1',
          shell: { path: '/bin/zsh', name: 'zsh', args: [] },
          cwd: '/tmp/ws',
          cols: 80,
          rows: 24,
          state: 'running',
          exitCode: null,
        },
        {
          id: 'term-2',
          title: 'shell 2',
          shell: { path: '/bin/sh', name: '', args: [] },
          cwd: '/tmp/ws',
          cols: 80,
          rows: 24,
          state: 'exited',
          exitCode: 2,
        },
        {
          id: 'term-3',
          title: 'shell 3',
          shell: { path: '/bin/sh', name: 'sh', args: [] },
          cwd: '/tmp/ws',
          cols: 80,
          rows: 24,
          state: 'failed',
          exitCode: null,
          error: 'spawn failed',
        },
      ],
    }))
    const result: Awaited<ReturnType<Projection['list']>> = await projection.list('session-1')
    expect(result).toEqual({
      ok: true,
      value: [
        { terminalId: 'term-1', title: 'shell 1', shell: 'zsh', cwd: '/tmp/ws', state: 'running' },
        { terminalId: 'term-2', title: 'shell 2', shell: '/bin/sh', cwd: '/tmp/ws', state: 'exited', exitCode: 2 },
        { terminalId: 'term-3', title: 'shell 3', shell: 'sh', cwd: '/tmp/ws', state: 'failed', error: 'spawn failed' },
      ],
    })
  })

  it('maps remote failures to read rejections', async () => {
    const projection = createDshTerminalProjection(fakeRemote({
      ok: false,
      error: { code: 'not-found', message: 'missing session' },
    }))
    expect(await projection.list('session-1')).toEqual({
      ok: false,
      reason: 'task-not-found',
      message: 'missing session',
      retryable: false,
    })
  })

  it('reports thrown transport failures as retryable', async () => {
    const projection = createDshTerminalProjection({
      terminal: {
        list: async () => {
          throw new Error('offline')
        },
      },
    } as unknown as Remote)
    expect(await projection.list('session-1')).toEqual({
      ok: false,
      reason: 'runtime-unavailable',
      message: '终端列表暂时不可用。',
      retryable: true,
    })
  })

  it('creates a session terminal and projects the open identity', async () => {
    const calls: unknown[] = []
    const projection = createDshTerminalProjection({
      terminal: {
        create: async (sessionId: unknown, request: unknown) => {
          calls.push({ sessionId, request })
          return {
            ok: true,
            value: {
              id: (request as { id: string }).id,
              title: 'shell 1',
              shell: { path: '/bin/zsh', name: 'zsh', args: [] },
              cwd: '/tmp/ws',
              cols: 80,
              rows: 24,
              state: 'running',
              exitCode: null,
            },
          }
        },
      },
    } as unknown as Remote)
    const result = await projection.create('session-1')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.state).toBe('running')
      expect(result.value.shell).toBe('zsh')
    }
    expect(calls).toHaveLength(1)
  })
})

describe('interactive terminal service', () => {
  function fixture() {
    const terminals = new Map<string, any>()
    const models = new Map<string, any>()
    let next = 0
    const info = (id: string) => ({ id, title: 'zsh', shell: { name: 'zsh', path: '/bin/zsh', args: [] }, cwd: '/tmp/workspace', cols: 80, rows: 24, state: 'running', exitCode: null })
    const remote = { terminal: {
      rename: vi.fn(async (_session: string, id: string, title: string) => { terminals.set(id, { ...terminals.get(id), title }); return { ok: true, value: undefined } }),
      list: vi.fn(async () => ({ ok: true, value: [...terminals.values()] })),
      create: vi.fn(async () => { const terminal = info(`pty-${++next}`); terminals.set(terminal.id, terminal); return { ok: true, value: terminal } }),
    } }
    const service = {
      retainTabs: vi.fn(),
      close: vi.fn(),
      view: vi.fn((_session: string, _key: string, _content: string, id: string) => {
        if (models.has(id)) return models.get(id)
        const listeners = new Set<() => void>()
        let state: any = { phase: 'connected', writable: true, info: terminals.get(id), environment: { maxCols: 300, maxRows: 200, scrollback: 3000 } }
        const model = {
          state: { getSnapshot: () => state, subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener) } },
          publish: (patch: any) => { state = { ...state, ...patch }; for (const listener of listeners) listener() },
          mount: vi.fn(() => vi.fn()), write: vi.fn(), resize: vi.fn(), acknowledge: vi.fn(), connect: vi.fn(), refresh: vi.fn(),
          close: vi.fn(async () => { terminals.delete(id) }),
        }
        models.set(id, model)
        return model
      }),
    }
    const projection = createDshTerminalProjection(remote as unknown as Remote, service as never)
    return { projection, models, service, remote }
  }

  it('opens independent bottom and side PTYs, deduplicates opening, and retains both when hidden', async () => {
    const { projection, remote, service, models } = fixture()
    const bottom = projection.service!.panel('session', 'bottom')
    const side = projection.service!.panel('session', 'side')
    await Promise.all([bottom.load(), bottom.load()])
    await side.load()
    expect(remote.terminal.create).toHaveBeenCalledTimes(2)
    expect(bottom.getSnapshot().terminals.map(item => item.terminalId)).toEqual(['pty-1'])
    expect(side.getSnapshot().terminals.map(item => item.terminalId)).toEqual(['pty-2'])
    expect(service.retainTabs).toHaveBeenLastCalledWith(expect.arrayContaining([
      expect.objectContaining({ tabId: 'ling-terminal:pty-1' }), expect.objectContaining({ tabId: 'ling-terminal:pty-2' }),
    ]))
    const detach = bottom.view('pty-1').mount()
    detach()
    expect(models.get('pty-1').close).not.toHaveBeenCalled()
    expect(projection.service!.panel('session', 'bottom')).toBe(bottom)
    await bottom.load()
    expect(remote.terminal.create).toHaveBeenCalledTimes(2)
  })

  it('projects snapshots and ordered output acknowledgements without losing raw control input', async () => {
    const { projection, models } = fixture()
    const panel = projection.service!.panel('session', 'bottom')
    await panel.load()
    const model = models.get('pty-1')
    const view = panel.view('pty-1')
    const initial = view.getSnapshot()
    expect(view.getSnapshot()).toBe(initial)
    const changed = vi.fn()
    const unsubscribe = view.subscribe(changed)
    model.publish({ render: { revision: 1, frame: { type: 'snapshot', screen: '\u001b[31mready', info: model.state.getSnapshot().info } } })
    expect(view.getSnapshot().render).toEqual({ revision: 1, reset: true, data: '\u001b[31mready', cols: 80, rows: 24 })
    model.publish({ render: { revision: 2, frame: { type: 'output', data: 'output\r\n' } } })
    expect(view.getSnapshot().render).toEqual({ revision: 2, reset: false, data: 'output\r\n' })
    view.acknowledge(2)
    view.write('\u0003')
    view.resize(120, 35)
    view.reconnect()
    expect(model.acknowledge).toHaveBeenCalledWith(2)
    expect(model.write).toHaveBeenCalledWith('\u0003')
    expect(model.resize).toHaveBeenCalledWith(120, 35)
    expect(model.connect).toHaveBeenCalledOnce()
    expect(changed).toHaveBeenCalledTimes(2)
    unsubscribe()
  })

  it('keeps a failed close retryable and releases only the closed PTY after success', async () => {
    const { projection, models, service } = fixture()
    const panel = projection.service!.panel('session', 'bottom')
    await panel.load()
    await panel.create()
    models.get('pty-1').close.mockRejectedValueOnce(new Error('connection lost'))
    await panel.close('pty-1')
    expect(panel.getSnapshot().error).toBe('connection lost')
    expect(panel.getSnapshot().terminals).toHaveLength(2)
    expect(service.close).not.toHaveBeenCalled()
    await panel.close('pty-1')
    expect(panel.getSnapshot().terminals.map(item => item.terminalId)).toEqual(['pty-2'])
    expect(service.retainTabs).toHaveBeenLastCalledWith([expect.objectContaining({ tabId: 'ling-terminal:pty-2' })])
  })

  it('renames the host PTY and its tab without recreating the shell', async () => {
    const { projection, remote, models } = fixture()
    const panel = projection.service!.panel('session', 'bottom')
    await panel.load()
    const view = panel.view('pty-1')
    expect(await panel.rename('pty-1', '  开发服务  ')).toEqual({ ok: true, value: undefined })
    expect(remote.terminal.rename).toHaveBeenCalledWith('session', 'pty-1', '开发服务')
    expect(panel.getSnapshot().terminals[0]?.title).toBe('开发服务')
    expect((await projection.list('session'))).toMatchObject({ ok: true, value: [{ terminalId: 'pty-1', title: '开发服务' }] })
    expect(panel.view('pty-1')).toBe(view)
    expect(remote.terminal.create).toHaveBeenCalledTimes(1)
    expect(models.get('pty-1').close).not.toHaveBeenCalled()
  })

  it('keeps the old title on rename failure and rejects invalid names', async () => {
    const { projection, remote } = fixture()
    const panel = projection.service!.panel('session', 'side')
    await panel.load()
    expect(await panel.rename('pty-1', ' ')).toMatchObject({ ok: false, reason: 'invalid-command' })
    expect(await panel.rename('pty-1', 'x'.repeat(121))).toMatchObject({ ok: false, reason: 'invalid-command' })
    expect(remote.terminal.rename).not.toHaveBeenCalled()
    remote.terminal.rename.mockResolvedValueOnce({ ok: false, error: { code: 'connection-lost', message: '连接已断开' } } as never)
    expect(await panel.rename('pty-1', 'server')).toMatchObject({ ok: false, message: '连接已断开' })
    expect(panel.getSnapshot().terminals[0]?.title).toBe('zsh')
    expect(await panel.rename('pty-1', 'server')).toMatchObject({ ok: true })
  })

  it('shows the host creation error and retries without duplicate PTYs', async () => {
    const { projection, remote } = fixture()
    remote.terminal.create.mockResolvedValueOnce({ ok: false, error: { code: 'terminal/unavailable', message: 'PTY unavailable' } } as never)
    const panel = projection.service!.panel('session', 'bottom')
    await panel.load()
    expect(panel.getSnapshot()).toMatchObject({ loading: false, error: 'PTY unavailable', terminals: [] })
    await panel.load()
    expect(panel.getSnapshot().terminals).toHaveLength(1)
    expect(panel.getSnapshot().error).toBeUndefined()
  })
})
