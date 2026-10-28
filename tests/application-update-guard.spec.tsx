// @vitest-environment jsdom
import { act, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/App.js'
import type { LingUpdateBridge, LingUpdateState } from '../src/runtime/application-update.js'
import { createOfflineRuntimeAdapter } from '../src/runtime/offline-adapter.js'
import { draftStorageKey, parseStoredDrafts } from '../src/session-state.js'
import type { LingShell } from '../src/ui/LingShell.js'
import { useWorkbench } from '../src/ui/shell/useWorkbench.js'

type ShellProps = ComponentProps<typeof LingShell>
const shell = vi.hoisted(() => ({ props: undefined as ShellProps | undefined }))
vi.mock('../src/ui/LingShell.js', () => ({ LingShell: (props: ShellProps) => { shell.props = props; return null } }))
let root: Root
let container: HTMLDivElement
let guards: Set<() => string | undefined>
const props = () => shell.props!
const inspect = () => [...guards].map(check => check()).find(Boolean)

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
  localStorage.clear()
  guards = new Set()
  const state: LingUpdateState = { currentVersion: '1.0.0', channel: 'stable', phase: 'downloaded', version: '1.1.0' }
  window.__LING_UPDATE__ = {
    get: async () => state, check: async () => state, setChannel: async () => state, install: async () => state,
    subscribe: () => () => {}, beforeInstall(check) { guards.add(check); return () => { guards.delete(check) } },
  } satisfies LingUpdateBridge
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
})
afterEach(async () => {
  await act(async () => { root.unmount() })
  document.body.replaceChildren(); delete window.__LING_UPDATE__; shell.props = undefined
  vi.restoreAllMocks(); vi.unstubAllGlobals()
})

async function mountApp() {
  const runtime = { ...createOfflineRuntimeAdapter(), async getSnapshot() {
    return { connection: { phase: 'ready' as const }, workspaces: [{ workspaceId: 'a', label: 'A' }, { workspaceId: 'b', label: 'B' }], tasks: [], pendingInteractions: [], backgroundJobs: {}, subagents: {} }
  } }
  await act(async () => { root.render(<App runtime={runtime} />) })
}

describe('renderer update handoff guards', () => {
  it('synchronously stores main draft text and server selections before allowing a restart', async () => {
    await mountApp()
    await act(async () => { props().onPromptChange('Keep this draft'); await props().onSelectTaskServers(['server-a']) })
    localStorage.removeItem(draftStorageKey)
    expect(inspect()).toBeUndefined()
    expect(parseStoredDrafts(localStorage.getItem(draftStorageKey))['new-task']).toMatchObject({ text: 'Keep this draft', serverIds: ['server-a'] })
  })

  it('blocks unpersisted attachments without clearing the draft or its references', async () => {
    await mountApp()
    await act(async () => { props().onPromptChange('Keep this draft'); props().onAddQuote('important quotation', 'quotation') })
    const before = props().attachments
    expect(inspect()).toContain('未发送的附件或引用')
    expect(props().attachments).toEqual(before)
    expect(props().prompt).toBe('Keep this draft')
    await act(async () => { props().onRemoveAttachment(before[0]!.id) })
    expect(inspect()).toBeUndefined()
  })

  it('blocks an attachment read before its browser-owned bytes have reached the draft', async () => {
    await mountApp()
    const bytes = Promise.withResolvers<ArrayBuffer>()
    const file = new File(['hello'], 'draft.txt', { type: 'text/plain' })
    Object.defineProperty(file, 'arrayBuffer', { value: () => bytes.promise })
    await act(async () => { props().onAddFiles([file]) })
    expect(inspect()).toContain('附件正在读取')
    await act(async () => { bytes.resolve(new TextEncoder().encode('hello').buffer) })
    expect(inspect()).toContain('未发送的附件或引用')
  })

  it('blocks a new task whose chosen local execution target would be lost', async () => {
    await mountApp()
    await act(async () => { props().onPromptChange('Run in workspace B'); props().onNewTaskInWorkspace('b') })
    expect(inspect()).toContain('运行位置或预设尚未保存')
    expect(props().newTaskWorkspaceId).toBe('b')
    expect(props().prompt).toBe('Run in workspace B')
  })

  it('refuses restart when the synchronous draft storage write fails', async () => {
    await mountApp()
    await act(async () => { props().onPromptChange('Do not lose this') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
    expect(inspect()).toContain('草稿未能保存')
    expect(props().prompt).toBe('Do not lose this')
  })

  it('checks side-task drafts even when another workbench tab is active', async () => {
    let workbench!: ReturnType<typeof useWorkbench>
    function Harness() {
      workbench = useWorkbench({ props: { browserOpen: true, screen: 'workspace', prompt: '', onSubmit: vi.fn(), onBrowserToggle: vi.fn() }, workspaceLabel: 'Project' })
      return null
    }
    await act(async () => { root.render(<Harness />) })
    await act(async () => { workbench.openWorkbenchTab('side-task', { prompt: 'Unsent side message', attachments: [] }) })
    const sideId = workbench.activeWorkbenchTabId!
    await act(async () => { workbench.openWorkbenchTab('browser') })
    expect(inspect()).toContain('侧边任务有未发送的草稿')
    await act(async () => { workbench.closeWorkbenchTab(sideId) })
    expect(inspect()).toBeUndefined()
  })
})
