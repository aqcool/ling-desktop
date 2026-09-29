import type { Context } from '@deepseek-ai/cordis'
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { apply, createLingSession, inject } from '../src/client/index.ts'

describe('LING renderer client entry', () => {
  it('preserves the agent preset on the wire and refreshes the session catalog', async () => {
    const create = vi.fn(async () => ({ ok: true, value: { sessionId: 'selected-agent-session' } }))
    const refresh = vi.fn(async () => {})
    const remote = { session: { create } } as unknown as Pick<Context['remote'], 'session'>
    await expect(createLingSession(remote, { refresh }, { workspaceId: 'workspace-1', agentPreset: 'minimal' })).resolves.toBe('selected-agent-session')
    expect(create).toHaveBeenCalledWith({ workspaceId: 'workspace-1', agentPreset: 'minimal' })
    expect(refresh).toHaveBeenCalledOnce()
    expect(create.mock.invocationCallOrder[0]).toBeLessThan(refresh.mock.invocationCallOrder[0]!)
  })

  it('builds the Chromium plugin without Node-only runtime imports', () => {
    const bundle = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
    expect(bundle).not.toMatch(/\brequire\(["'](?:node:|process["']|path["']|url["'])/)
  })

  it('waits for the DSH facades and occupies the root slot', () => {
    const effect = vi.fn()
    const register = vi.fn()
    const ctx = {
      effect,
      slots: { register },
      sessions: {},
      workspaces: {},
      fileUpload: {},
      uiConversation: {},
      uiSession: { sessionStatus: {} },
      remote: {},
      connection: { state: {}, reconnect: vi.fn() },
    } as unknown as Context

    apply(ctx)

    expect(inject).toEqual([
      'sessions',
      'workspaces',
      'connection',
      'fileUpload',
      'uiConversation',
      'uiSession',
      'remote',
      'remote.settings',
      'remote.llm',
      'remote.session',
      'remote.credentials',
      'remote.directoryPicker',
      'remote.commands',
      'remote.permissionPresets',
      'remote.goals',
      'remote.workspaceFiles',
      'remote.officeToPdf',
      'remote.skills',
      'remote.agentPresets',
      'remote.pluginInventory',
      'remote.pluginManager',
      'remote.terminal',
      'webTerminals',
      'remote.subagents',
      'slots',
    ])
    expect(effect).toHaveBeenCalledWith(expect.any(Function), 'LING renderer stylesheet')
    expect(register).toHaveBeenCalledWith({ name: 'root', priority: -1 }, expect.any(Function))
  })
})
