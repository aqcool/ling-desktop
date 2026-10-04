// @vitest-environment jsdom
import { act, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { App } from '../src/App.js'
import type { LingRuntimeAdapter, LingRuntimeCommand, LingTaskSummary } from '../src/runtime/contract.js'
import { createOfflineRuntimeAdapter } from '../src/runtime/offline-adapter.js'
import type { LingShell } from '../src/ui/LingShell.js'
import { workspaceContextScope } from '../src/ui/attachments.js'

type ShellProps = ComponentProps<typeof LingShell>
const harness = vi.hoisted(() => ({ props: undefined as ShellProps | undefined }))
// Keep the real App state, runtime hook and callbacks; replace only the large presentation tree.
vi.mock('../src/ui/LingShell.js', () => ({ LingShell: (props: ShellProps) => { harness.props = props; return null } }))

let root: Root | undefined
const props = () => harness.props!
const contexts = () => props().attachments.filter(item => item.context)
const local = (workspaceId?: string) => workspaceContextScope({ workspaceId })
const remote = (serverId: string, cwd?: string) => workspaceContextScope({ serverId, cwd })
const task: LingTaskSummary = { taskId: 'remote-task', title: 'Remote task', status: 'completed', archived: false, updatedAt: '2026-10-05', workspaceId: 'workspace-a' }

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
  localStorage.clear()
})
afterEach(async () => {
  if (root) await act(async () => { root!.unmount() })
  root = undefined
  harness.props = undefined
  document.body.replaceChildren()
  vi.unstubAllGlobals()
})

async function mount(tasks: readonly LingTaskSummary[] = [], retryable = false) {
  const dispatch = vi.fn(async (command: LingRuntimeCommand) => ({ accepted: false, requestId: command.requestId, reason: 'runtime-unavailable' as const, message: 'test', retryable }))
  const runtime: LingRuntimeAdapter = { ...createOfflineRuntimeAdapter(), dispatch, async getSnapshot() {
    return { connection: { phase: 'ready' }, workspaces: [{ workspaceId: 'workspace-a', label: 'A' }, { workspaceId: 'workspace-b', label: 'B' }], tasks, pendingInteractions: [], backgroundJobs: {}, subagents: {} }
  } }
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => { root!.render(<App runtime={runtime} />) })
  return dispatch
}

async function addUpload() {
  const data = new TextEncoder().encode('ordinary upload')
  const file = new File([data], 'notes.txt', { type: 'text/plain' })
  // jsdom File lacks arrayBuffer; the real upload conversion still runs.
  Object.defineProperty(file, 'arrayBuffer', { value: async () => data.buffer })
  await act(async () => { props().onAddFiles([file]) })
}

it('clears references at every new-task workspace/development switch while preserving body, uploads and reply quotes', async () => {
  await mount()
  await act(async () => { props().onPromptChange('Keep the drafted instructions') })
  await addUpload()
  await act(async () => { props().onAddQuote('reply text', 'reply preview') })
  await act(async () => {
    props().onAddWorkspaceContext?.({ kind: 'file', path: 'src/main.ts' }, local('workspace-a'))
    props().onAddWorkspaceContext?.({ kind: 'directory', path: 'src/components' }, local('workspace-a'))
    props().onAddWorkspaceContext?.({ kind: 'selection', path: 'src/main.ts', text: 'old draft code', startLine: 1 }, local('workspace-a'))
  })
  expect(contexts()).toHaveLength(3)
  const retained = props().attachments.filter(item => !item.context)
  const switches: readonly [() => void, string][] = [
    [() => props().onNewTaskInWorkspace('workspace-b'), local('workspace-b')],
    [() => props().onNewTaskWithoutWorkspace(), local()],
    [() => props().onNewTaskOnServer?.('server-a'), remote('server-a')],
    [() => props().onNewTaskOnServer?.('server-b'), remote('server-b')],
    [() => props().onNewTask(), local('workspace-a')],
  ]
  for (const [switchScope, scope] of switches) {
    await act(async () => { switchScope() })
    expect(props().prompt).toBe('Keep the drafted instructions')
    expect(props().attachments).toEqual(retained)
    await act(async () => { props().onAddWorkspaceContext?.({ kind: 'file', path: 'src/main.ts' }, scope) })
    expect(contexts()).toHaveLength(1)
  }
  // Operations access leaves the file workspace in place.
  const reference = contexts()[0]
  await act(async () => { await props().onSelectOperationsServer?.('operations-server') })
  expect(contexts()).toEqual([reference])
  await act(async () => { props().onNewTaskInWorkspace('workspace-a') })
  expect(contexts()).toEqual([reference])
})

it('retains a newly added same-path reference when a workspace switch and addition precede effect synchronization', async () => {
  await mount()
  await act(async () => { props().onAddWorkspaceContext?.({ kind: 'selection', path: 'src/main.ts', text: 'scope A', startLine: 1 }, local('workspace-a')) })
  await act(async () => {
    const current = props()
    current.onNewTaskInWorkspace('workspace-b')
    current.onAddWorkspaceContext?.({ kind: 'selection', path: 'src/main.ts', text: 'scope B', startLine: 1 }, local('workspace-b'))
  })
  expect(contexts()).toHaveLength(1)
  expect(contexts()[0]?.context?.text).toBe('scope B')
  const id = contexts()[0]!.id
  await act(async () => { props().onWorkspaceContextScopeChange?.(local('workspace-b')) })
  expect(contexts()[0]!.id).toBe(id)
})

it('clears selected-task references on server or development-directory changes and preserves the current scoped draft', async () => {
  await mount([task])
  await act(async () => { props().onSelectTask(task.taskId) })
  await act(async () => { props().onPromptChange('Task draft') })
  await addUpload()
  await act(async () => {
    props().onWorkspaceContextScopeChange?.(remote('server-a', '/project-a'))
    props().onAddWorkspaceContext?.({ kind: 'file', path: 'src/main.ts' }, remote('server-a', '/project-a'))
  })
  await act(async () => { props().onWorkspaceContextScopeChange?.(remote('server-a', '/project-b')) })
  expect(contexts()).toHaveLength(0)
  expect(props().prompt).toBe('Task draft')
  expect(props().attachments.map(item => item.name)).toEqual(['notes.txt'])
  await act(async () => {
    props().onAddWorkspaceContext?.({ kind: 'file', path: 'src/main.ts' }, remote('server-a', '/project-b'))
    props().onWorkspaceContextScopeChange?.(remote('server-a', '/project-b'))
  })
  expect(contexts()).toHaveLength(1)
  await act(async () => { props().onWorkspaceContextScopeChange?.(remote('server-b', '/project-b')) })
  expect(contexts()).toHaveLength(0)
  expect(props().attachments.map(item => item.name)).toEqual(['notes.txt'])
})

it('sends the selected workspace and its current context payload without prior-workspace selected text', async () => {
  const dispatch = await mount()
  await act(async () => { props().onPromptChange('Review this selection') })
  await act(async () => { props().onAddWorkspaceContext?.({ kind: 'selection', path: 'src/main.ts', text: 'PRIVATE_SCOPE_A', startLine: 1 }, local('workspace-a')) })
  await act(async () => { props().onNewTaskInWorkspace('workspace-b') })
  await act(async () => { props().onAddWorkspaceContext?.({ kind: 'selection', path: 'src/main.ts', text: 'CURRENT_SCOPE_B', startLine: 4, endLine: 4 }, local('workspace-b')) })
  await act(async () => { props().onSubmit() })
  const command = dispatch.mock.calls.at(-1)?.[0]
  expect(command?.type).toBe('task.create')
  if (command?.type !== 'task.create') throw new Error('Missing create request')
  expect(command.workspaceId).toBe('workspace-b')
  expect(command.prompt).toBe('Review this selection')
  expect(command.attachments).toHaveLength(1)
  const payload = new TextDecoder().decode(command.attachments![0]!.data as Uint8Array)
  expect(payload).toContain('CURRENT_SCOPE_B')
  expect(payload).toContain('原始行范围：4')
  expect(payload).not.toContain('PRIVATE_SCOPE_A')
})

it.each([false, true])('invalidates a failed send and its retry payload after the development directory changes (context: %s)', async withContext => {
  const dispatch = await mount([task], true)
  await act(async () => { props().onSelectTask(task.taskId) })
  await act(async () => { props().onWorkspaceContextScopeChange?.(remote('server-a', '/project-a')) })
  await act(async () => { props().onPromptChange('Keep this draft') })
  if (withContext) await act(async () => {
    props().onAddWorkspaceContext?.({ kind: 'selection', path: 'src/main.ts', text: 'OLD_FAILED_CONTEXT', startLine: 1 }, remote('server-a', '/project-a'))
  })
  await act(async () => { props().onSubmit() })
  expect(dispatch).toHaveBeenCalledTimes(1)
  expect(props().onNoticeRetry).toBeDefined()
  await act(async () => { props().onWorkspaceContextScopeChange?.(remote('server-a', '/project-b')) })
  expect(props().onNoticeRetry).toBeUndefined()
  if (withContext) await act(async () => {
    props().onAddWorkspaceContext?.({ kind: 'selection', path: 'src/main.ts', text: 'CURRENT_CONTEXT', startLine: 2 }, remote('server-a', '/project-b'))
  })
  await act(async () => { props().onSubmit() })
  expect(dispatch).toHaveBeenCalledTimes(2)
  const command = dispatch.mock.calls[1]?.[0]
  expect(command).toMatchObject({ type: 'task.send-message', taskId: task.taskId, text: 'Keep this draft' })
  if (withContext && command?.type === 'task.send-message') {
    expect(command.attachments).toHaveLength(1)
    const payload = new TextDecoder().decode(command.attachments![0]!.data as Uint8Array)
    expect(payload).toContain('CURRENT_CONTEXT')
    expect(payload).not.toContain('OLD_FAILED_CONTEXT')
  }
  expect(dispatch.mock.calls[1]?.[0].requestId).not.toBe(dispatch.mock.calls[0]?.[0].requestId)
})
