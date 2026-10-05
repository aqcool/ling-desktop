// @vitest-environment jsdom
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LingCommandResult, LingRuntimeAdapter } from '../src/runtime/contract.js'
import { createOfflineRuntimeAdapter } from '../src/runtime/offline-adapter.js'
import { WorkspaceEditDialog, type WorkspaceDraft } from '../src/ui/WorkspaceCreateDialog.js'
import { useTaskSidebar } from '../src/ui/shell/useTaskSidebar.js'

const roots = new Set<Root>()
const appearanceKey = 'ling.workspace-appearance.v1'
const draft: WorkspaceDraft = { path: '/private/tmp/ling-workspace-settings', name: 'Test project', marker: 'folder', color: '' }
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.stubGlobal('CSS', { escape: (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, character => `\\${character}`) })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
  window.localStorage.clear()
})
afterEach(async () => {
  await act(async () => { for (const root of roots) root.unmount() })
  roots.clear()
  document.body.replaceChildren()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
async function mount(element: ReactNode) {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  roots.add(root)
  await act(async () => { root.render(element) })
  return { container, unmount: async () => { await act(async () => { root.unmount() }); roots.delete(root); container.remove() } }
}
async function click(label: string) {
  const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find(node => node.getAttribute('aria-label') === label || node.textContent?.trim() === label)
  expect(button, label).toBeDefined()
  await act(async () => { button!.click() })
}
async function setName(value: string) {
  const input = document.querySelector<HTMLInputElement>('.workspace-create-dialog__name input')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
function sidebarFixture() {
  return {
    tasks: [], workspaces: [{ workspaceId: 'canonical-id', label: draft.name, locationLabel: draft.path }],
    onCreateWorkspace: vi.fn<Parameters<typeof useTaskSidebar>[0]['onCreateWorkspace']>().mockResolvedValue({ accepted: true, requestId: 'create', output: { workspaceId: 'canonical-id' } }),
    onRenameWorkspace: vi.fn<Parameters<typeof useTaskSidebar>[0]['onRenameWorkspace']>().mockResolvedValue({ accepted: true, requestId: 'rename' }),
    onRenameTask: vi.fn<Parameters<typeof useTaskSidebar>[0]['onRenameTask']>(),
    onDeleteWorkspace: vi.fn<Parameters<typeof useTaskSidebar>[0]['onDeleteWorkspace']>(),
  }
}

describe('workspace settings', () => {
  it('opens the full editor from the real app and saves the name, icon and color without altering the directory', async () => {
    const { App } = await import('../src/App.js')
    let title = draft.name
    const dispatch = vi.fn<LingRuntimeAdapter['dispatch']>(async command => {
      if (command.type === 'workspace.rename') title = command.title
      return { accepted: true, requestId: 'edit' }
    })
    const runtime: LingRuntimeAdapter = {
      ...createOfflineRuntimeAdapter(), dispatch,
      async getSnapshot() {
        return { connection: { phase: 'ready' }, workspaces: [{ workspaceId: 'canonical-id', label: title, locationLabel: draft.path }],
          tasks: [], pendingInteractions: [], backgroundJobs: {}, subagents: {} }
      },
    }
    const view = await mount(<App runtime={runtime} />)
    await click('工作区 Test project 更多操作')
    const edit = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(node => node.textContent?.trim() === '编辑')!
    expect(edit).toBeDefined()
    await act(async () => { edit.click() })
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('编辑工作区')
    const path = document.querySelector<HTMLInputElement>('input[aria-label="项目目录"]')!
    expect(path.value).toBe(draft.path)
    expect(path.readOnly).toBe(true)
    expect(document.querySelector('[aria-label="图标 folder"]')?.getAttribute('aria-pressed')).toBe('true')
    expect(document.querySelector('[aria-label="颜色 跟随主题"]')?.getAttribute('aria-pressed')).toBe('true')
    await setName('Renamed project')
    await click('图标 rocket')
    await click('颜色 #50705a')
    await click('保存')
    expect(dispatch.mock.calls.map(([command]) => command)).toEqual([{ type: 'workspace.rename', requestId: expect.any(String), workspaceId: 'canonical-id', title: 'Renamed project' }])
    expect(view.container.querySelector('.sidebar-project__name')?.textContent).toBe('Renamed project')
    expect(view.container.querySelector<HTMLElement>('.sidebar-project__icon')?.style.color).toBe('rgb(80, 112, 90)')
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    await click('工作区 Renamed project 更多操作')
    await act(async () => { [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(node => node.textContent?.trim() === '编辑')!.click() })
    expect(document.querySelector('[aria-label="图标 rocket"]')?.getAttribute('aria-pressed')).toBe('true')
    expect(document.querySelector<HTMLInputElement>('.workspace-create-dialog__name input')?.value).toBe('Renamed project')
    await click('图标 cat')
    await click('取消')
    expect(JSON.parse(window.localStorage.getItem(appearanceKey)!)).toEqual({ 'canonical-id': { marker: 'rocket', color: '#50705a' } })
  })

  it('stores new appearance by the Host identity even when the picker path is canonicalized', async () => {
    const props = sidebarFixture()
    let state!: ReturnType<typeof useTaskSidebar>
    function Harness() { state = useTaskSidebar(props); return null }
    const first = await mount(<Harness />)
    await act(async () => { await state.createWorkspace({ ...draft, path: '/tmp/ling-workspace-settings', marker: 'cat', color: '#50705a' }) })
    await first.unmount()
    await mount(<Harness />)
    await act(async () => { state.setEditingWorkspaceId('canonical-id') })
    expect(state.editingWorkspace).toEqual({ ...draft, workspaceId: 'canonical-id', marker: 'cat', color: '#50705a' })
    expect(state.workspaceAppearance['/tmp/ling-workspace-settings']).toBeUndefined()
  })

  it('reads existing path-based appearance, saves icon-only edits locally and rejects path changes', async () => {
    window.localStorage.setItem(appearanceKey, JSON.stringify({ [draft.path]: { marker: 'pacman', color: '#c96343' } }))
    const props = sidebarFixture()
    let state!: ReturnType<typeof useTaskSidebar>
    function Harness() { state = useTaskSidebar(props); return null }
    await mount(<Harness />)
    await act(async () => { state.setEditingWorkspaceId('canonical-id') })
    expect(state.editingWorkspace?.marker).toBe('pacman')
    await act(async () => { expect((await state.saveWorkspace('canonical-id', { ...draft, marker: 'rocket' })).accepted).toBe(true) })
    expect(props.onRenameWorkspace).not.toHaveBeenCalled()
    expect(state.editingWorkspace?.marker).toBe('rocket')
    await act(async () => { expect((await state.saveWorkspace('canonical-id', { ...draft, path: '/elsewhere', name: 'Other' })).accepted).toBe(false) })
    expect(props.onRenameWorkspace).not.toHaveBeenCalled()
    expect(props.onCreateWorkspace).not.toHaveBeenCalled()
    expect(props.onDeleteWorkspace).not.toHaveBeenCalled()
    expect(state.editingWorkspace?.path).toBe(draft.path)
  })

  it('leaves appearance unchanged when the Host rejects a rename', async () => {
    const props = sidebarFixture()
    props.onRenameWorkspace.mockResolvedValue({ accepted: false, requestId: 'rename', reason: 'invalid-command', message: '名称重复。', retryable: false })
    let state!: ReturnType<typeof useTaskSidebar>
    function Harness() { state = useTaskSidebar(props); return null }
    await mount(<Harness />)
    await act(async () => {
      const result = await state.saveWorkspace('canonical-id', { ...draft, name: 'Duplicate', marker: 'rocket', color: '#50705a' })
      expect(result.accepted).toBe(false)
    })
    expect(props.onRenameWorkspace).toHaveBeenCalledWith('canonical-id', 'Duplicate')
    expect(state.workspaceAppearance).toEqual({})
  })

  it('keeps the draft and error on failure and prevents dismissal or edits while saving', async () => {
    let finish!: (result: LingCommandResult) => void
    const pending = new Promise<LingCommandResult>(resolve => { finish = resolve })
    const onConfirm = vi.fn().mockReturnValueOnce(pending).mockResolvedValue({ accepted: true, requestId: 'retry' })
    const onCancel = vi.fn()
    await mount(<WorkspaceEditDialog initial={draft} onCancel={onCancel} onConfirm={onConfirm} />)
    await setName('Edited')
    await click('图标 rocket')
    await click('保存')
    expect(document.querySelector<HTMLInputElement>('.workspace-create-dialog__name input')?.disabled).toBe(true)
    expect(document.querySelector<HTMLButtonElement>('[aria-label="图标 cat"]')?.disabled).toBe(true)
    await click('取消')
    await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    expect(onCancel).not.toHaveBeenCalled()
    await act(async () => { finish({ accepted: false, requestId: 'save', reason: 'runtime-unavailable', message: '连接已断开。', retryable: true }) })
    expect(document.querySelector('[role="status"]')?.textContent).toBe('连接已断开。')
    expect(document.querySelector<HTMLInputElement>('.workspace-create-dialog__name input')?.value).toBe('Edited')
    await click('保存')
    expect(onConfirm).toHaveBeenLastCalledWith({ ...draft, name: 'Edited', marker: 'rocket' })
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})
