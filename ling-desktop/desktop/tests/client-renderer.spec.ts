import type { Context } from '@deepseek-ai/cordis'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
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

  it('registers the bundled session and LING factories once without local CJS chunks', () => {
    const bundle = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
    expect(bundle).not.toMatch(/\brequire\(["']\.[./]/u)
    const registrations = new Map<string, unknown>()
    runInNewContext(bundle, { window: { __ModuleLoader__: { load: (registration: { id: string }) => {
      if (registrations.has(registration.id)) throw new Error(`Duplicate client factory: ${registration.id}`)
      registrations.set(registration.id, registration)
    } } } }, { filename: 'ling-desktop-host/client.js' })
    expect([...registrations.keys()]).toEqual(['@deepseek-ai/dsh-api-session-controller', 'ling-desktop-host'])
    expect(bundle.match(/EditorState\s*=\s*class EditorState\b/gu)).toHaveLength(1)
    expect(bundle.match(/Compartment\s*=\s*class Compartment\b/gu)).toHaveLength(1)
  })

  it('materializes the browser bundle and composes its lazy languages with the same CodeMirror state', async () => {
    const { JSDOM } = createRequire(import.meta.url)('jsdom')
    const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { runScripts: 'outside-only', url: 'http://localhost' })
    // xterm probes canvas during import; no terminal or editor is mounted here.
    dom.window.HTMLCanvasElement.prototype.getContext = () => null
    type Probe = {
      EditorState: { create(options: { doc: string; extensions: unknown[] }): { doc: { toString(): string } } }
      languages: { name: string; load(): Promise<unknown> }[]
      history(): unknown
      syntaxHighlighting(style: unknown): unknown
      highlighting: unknown
      syntaxTree(state: unknown): { toString(): string }
    }
    type Registration = { id: string; factory(require: (specifier: string) => unknown): { __editorProbe: Probe; apply: unknown } }
    const registrations = new Map<string, Registration>()
    dom.window.__ModuleLoader__ = { load: (registration: Registration) => registrations.set(registration.id, registration) }
    try {
      const bundle = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
      // Inspect private bundled exports inside the existing factory, without a
      // production diagnostic export or importing another CodeMirror instance.
      const marker = '\t\treturn module.exports;'
      const position = bundle.lastIndexOf(marker)
      expect(position).toBeGreaterThan(0)
      dom.window.eval(bundle.slice(0, position) + '\t\tmodule.exports.__editorProbe = { EditorState, languages, history, syntaxHighlighting, highlighting, syntaxTree };\n' + bundle.slice(position))
      const exported = registrations.get('ling-desktop-host')!.factory(specifier => {
        if (specifier === '@deepseek-ai/dsh-api-session-controller/client') return { inject: [], apply() {} }
        throw new Error(`Unexpected bundled dependency: ${specifier}`)
      })
      expect(exported.apply).toBeTypeOf('function')
      const probe = exported.__editorProbe
      for (const [name, source, expectedNode] of [
        ['TypeScript', 'const value: number = 1', 'TypeAnnotation'],
        ['Python', 'value = 1', 'AssignStatement'],
        ['Rust', 'let value = 1;', 'LetDeclaration'],
      ]) {
        const support = await probe.languages.find(language => language.name === name)!.load()
        const state = probe.EditorState.create({ doc: source!, extensions: [probe.history(), probe.syntaxHighlighting(probe.highlighting), support] })
        expect(state.doc.toString()).toBe(source)
        expect(probe.syntaxTree(state).toString()).toContain(expectedNode)
      }
    } finally { dom.window.close() }
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
      uiConversation: { events: { register: vi.fn() } },
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
