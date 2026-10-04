import { homedir, tmpdir } from 'node:os'
import * as cordis from '@deepseek-ai/cordis'
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import TypertGatewayService from '@deepseek-ai/dsh-api-gateway'
import TerminalController from '@deepseek-ai/dsh-api-terminal-controller'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { describe, expect, it, vi } from 'vitest'
import { LingWorkspaceTerminalsController } from '../src/host/workspace-terminal-controller.ts'
import { workspaceTerminalRemote } from '../src/client/workspace-terminal-projection.ts'
import { LING_WORKSPACE_TERMINAL_REMOTE, WORKSPACE_TERMINAL_DESCRIPTORS } from '../src/workspace-terminal-contract.ts'
import { LING_AUTHORIZATION_HOST, LING_AUTHORIZATION_REMOTE } from '../src/authorization-contract.ts'

describe('conversation-independent terminals', () => {
  it.skipIf(process.platform === 'win32')('mounts alongside authorization and runs a real PTY through the published browser Remote and Host Gateway without an Agent', async () => {
    const host = new Context()
    const client = new Context()
    const cwd = await mkdtemp(join(tmpdir(), 'ling-terminal-'))
    const abort = new AbortController()
    try {
      await host.plugin(TypertRegistry)
      await host.plugin(TypertGatewayService)
      host.typert.register(LING_AUTHORIZATION_HOST)
      host.provide('workspaceRegistry', { get: () => ({ path: cwd }) } as never)
      await host.plugin(LocalSubprocessRuntime)
      host.provide('sandboxPolicy', { workspaceRoot: cwd } as never)
      await host.plugin(TerminalController, { ...TerminalController.Config({} as never), shell: { path: '/bin/bash', name: 'bash', args: ['--noprofile', '--norc', '-i'] }, unattendedTimeoutMs: 0 })
      await host.plugin(LingWorkspaceTerminalsController)
      await client.plugin(TypertRegistry)
      client.provide('connection', {
        rpc: {
          call: async (_base: string, endpoint: string, payload: { args: Record<string, unknown> }) => {
            const [namespace, method] = endpoint.split('/')
            return { ok: true, value: await host.typertGateway.invoke({ namespace: namespace!, method: method!, args: payload.args }) }
          },
          open: async function* (_base: string, endpoint: string, payload: { args: Record<string, unknown> }, signal: AbortSignal) {
            const [namespace, method] = endpoint.split('/')
            yield* await host.typertGateway.stream({ namespace: namespace!, method: method!, args: payload.args, signal })
          },
        },
        registerGenerationSource: () => () => {}, start: () => ({ stop() {} }),
      } as never)
      const require = createRequire(import.meta.url)
      const source = await readFile(require.resolve('@deepseek-ai/dsh-api-gateway/client'), 'utf8')
      let browser: { apply(ctx: Context): void; inject: string[] } | undefined
      new Function('window', source)({ __ModuleLoader__: { load: ({ factory }: { factory(require: (id: string) => unknown): unknown }) => {
        browser = factory(() => cordis) as typeof browser
      } } })
      await client.plugin(browser!)
      await client.remote.$mount(LING_AUTHORIZATION_REMOTE)
      const mounted = client.remote.$mount(LING_WORKSPACE_TERMINAL_REMOTE)
      const remote = workspaceTerminalRemote(client, mounted)
      const owner = brandString<SessionId>('ling-workspace:ws')
      const id = 'ling-test-terminal' as never
      const attachment = 'test-writer' as never
      expect(await remote.list(owner)).toEqual({ ok: true, value: [] })
      expect(await remote.create(owner, { id, cols: 80, rows: 24 })).toMatchObject({ ok: true, value: { cwd, state: 'running' } })
      let output = ''
      let attached = false
      const follow = (async () => {
        for await (const frame of remote.follow(owner, id, attachment, abort.signal)) {
          if (frame.type === 'snapshot') { attached = true; output += frame.screen }
          if (frame.type === 'output') output += frame.data
        }
      })().catch(error => { if (!abort.signal.aborted) throw error })
      await expect.poll(() => attached).toBe(true)
      expect(await remote.write(owner, id, attachment, "printf 'LING-%s\\n' TERMINAL-OK\r")).toMatchObject({ ok: true })
      await expect.poll(() => output).toContain('LING-TERMINAL-OK')
      const closed = await remote.close(owner, id)
      if (!closed.ok) throw closed.error
      expect(closed).toMatchObject({ ok: true })
      abort.abort()
      await follow
      expect(await remote.list(owner)).toEqual({ ok: true, value: [] })
    } finally { abort.abort(); await client.fiber.dispose(); await host.fiber.dispose(); await rm(cwd, { recursive: true, force: true }) }
  }, 15_000)
  function host() {
    const terminalController = { create: vi.fn(async () => ({})), list: vi.fn(() => []),
      environment: vi.fn(owner => ({ cwd: owner.session.header.cwd })) }
    const ctx = { terminalController, workspaceRegistry: { get: vi.fn(id => id === 'ws' ? { path: '/work/project' } : undefined) } }
    const service = Object.create(LingWorkspaceTerminalsController.prototype) as LingWorkspaceTerminalsController
    Object.assign(service, { ctx })
    return { service, ctx, terminalController }
  }

  it('opens in the registered workspace without resolving or creating an Agent', async () => {
    const { service, ctx, terminalController } = host()
    const signal = new AbortController().signal
    const request = { id: 'term' as never, cols: 80, rows: 24 }
    await service.create('ws', request, signal)
    const [owner] = terminalController.create.mock.calls[0] as unknown as [{ id: string; ctx: unknown; session: { header: { cwd: string } } }]
    expect(owner.session.header.cwd).toBe('/work/project')
    expect(owner.id).toBe('ling-workspace-terminal:ws')
    expect(owner.ctx).toBe(ctx)
    service.list('ws')
    expect(terminalController.list).toHaveBeenCalledWith(owner.id)
  })

  it('uses the user home with no workspace and rejects stale workspace identities', () => {
    const { service, terminalController } = host()
    expect(service.environment('', new AbortController().signal)).toEqual({ cwd: homedir() })
    expect(() => service.list('missing')).toThrow('工作区已不存在')
    expect(terminalController.list).not.toHaveBeenCalled()
  })

  it('never asks the Gateway to load an Agent for workspace operations, including streams', () => {
    expect(WORKSPACE_TERMINAL_DESCRIPTORS).toHaveLength(10)
    for (const descriptor of WORKSPACE_TERMINAL_DESCRIPTORS) {
      expect(descriptor.scope).toBeUndefined()
      expect(descriptor.parameters[0]).toMatchObject({ source: 'json', wire: 'workspaceId' })
      expect(descriptor.parameters.some(parameter => parameter.source === 'lookup')).toBe(false)
    }
    expect(WORKSPACE_TERMINAL_DESCRIPTORS.filter(item => item.mode === 'stream').map(item => item.method)).toEqual(['follow', 'retain'])
  })

  it('waits for the workspace namespace and routes existing task cleanup to its original owner', async () => {
    const mounted = Promise.withResolvers<void>()
    const draft = { list: vi.fn(async () => ({ ok: true, value: [] })), close: vi.fn(async () => ({ ok: true, value: undefined })) }
    const task = { close: vi.fn(async () => ({ ok: true, value: undefined })) }
    const ctx = { remote: { terminal: task }, get: vi.fn(() => draft) } as unknown as Context
    const remote = workspaceTerminalRemote(ctx, mounted.promise)
    const pending = remote.list(brandString<SessionId>('ling-workspace:ws'))
    expect(draft.list).not.toHaveBeenCalled()
    mounted.resolve()
    await pending
    expect(draft.list).toHaveBeenCalledWith('ws')
    await remote.close(brandString<SessionId>('saved-task'), 'term' as never)
    expect(task.close).toHaveBeenCalledWith('saved-task', 'term')
    expect(draft.close).not.toHaveBeenCalled()
  })

  it('preserves stream frames and cancellation when attaching without a conversation', async () => {
    const frame = { type: 'retained', id: 'pty' }
    const retain = vi.fn(async function* () { yield frame })
    const ctx = { remote: { terminal: {} }, get: () => ({ retain }) } as unknown as Context
    const remote = workspaceTerminalRemote(ctx, Promise.resolve())
    const signal = new AbortController().signal
    const values = []
    for await (const value of remote.retain(brandString<SessionId>('ling-workspace:'), 'pty' as never, signal)) values.push(value)
    expect(values).toEqual([frame])
    expect(retain).toHaveBeenCalledWith('', 'pty', signal)
  })
})
