// @vitest-environment jsdom
import { act, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { EditorView } from '@codemirror/view'
import { EditorSelection } from '@codemirror/state'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LingServerService } from '../src/runtime/servers.js'
import { ServerFileBrowser } from '../src/ui/ServerFileBrowser.js'

type Props = ComponentProps<typeof ServerFileBrowser>
const roots = new Set<Root>()
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [] })
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => new DOMRect() })
  window.localStorage.clear()
})
afterEach(async () => {
  await act(async () => { for (const root of roots) root.unmount() })
  roots.clear(); document.body.replaceChildren(); vi.unstubAllGlobals()
})
function fixture() {
  const fileManager = vi.fn<LingServerService['fileManager']>(async (_server, request) => {
    if (request.type === 'jobs') return { ok: true, value: { type: 'jobs', jobs: [] } }
    if (request.type === 'list') return { ok: true, value: { type: 'directory', directory: { path: request.path === '.' ? '/home/tester' : request.path, truncated: false, entries: [
      { name: 'data.json', path: '/home/tester/data.json', kind: 'file' },
      { name: '.hidden', path: '/home/tester/.hidden', kind: 'file' },
      { name: 'folder', path: '/home/tester/folder', kind: 'directory' },
    ] } } }
    if (request.type === 'read') return { ok: true, value: { type: 'document', document: { path: request.path, kind: 'code', text: 'original\nsecond', mediaType: 'text/plain', version: 'a'.repeat(64) } } }
    if (request.type === 'save') return { ok: false, reason: 'runtime-unavailable', message: '远端文件已变化，未覆盖。', retryable: true }
    return { ok: true, value: { type: 'ok' } }
  })
  const bindTask = vi.fn(); const filesList = vi.fn()
  const service = { fileManager, bindTask, filesList } as unknown as LingServerService
  const onAddContext = vi.fn<NonNullable<Props['onAddContext']>>()
  return { props: { service, serverId: 'server-fixture', workspaceLabel: '测试服务器', onAddContext } satisfies Props, fileManager, bindTask, filesList, onAddContext }
}
async function mount(props: Props) {
  const container = document.createElement('div'); document.body.append(container)
  const root = createRoot(container); roots.add(root)
  await act(async () => { root.render(<ServerFileBrowser {...props} />) })
  return { container, render: async (next: Props) => { await act(async () => { root.render(<ServerFileBrowser {...next} />) }) } }
}
async function click(label: string) {
  const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find(node => node.getAttribute('aria-label') === label)
  expect(button, label).toBeDefined(); await act(async () => { button!.click() })
}
async function menu(label: string) {
  const item = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"], [role="menuitemcheckbox"]')].find(node => node.textContent?.trim() === label)
  expect(item, label).toBeDefined(); await act(async () => { item!.click() })
}
async function input(element: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
async function submit(form: HTMLFormElement) { await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) }) }

describe('remote file browser', () => {
  it('browses without a task, filters hidden entries, navigates independently of later Agent cwd changes', async () => {
    const state = fixture(); const { container, render } = await mount(state.props)
    const location = container.querySelector<HTMLInputElement>('[aria-label="远端目录路径"]')!
    expect(location.value).toBe('/home/tester')
    expect(container.textContent).toContain('.hidden')
    await click('远程文件管理'); await menu('显示隐藏文件')
    expect(container.textContent).not.toContain('.hidden')
    await input(location, '/tmp'); await submit(container.querySelector('form')!)
    expect(location.value).toBe('/tmp')
    await render({ ...state.props, initialPath: '/agent-new-cwd' })
    expect(location.value).toBe('/tmp')
    expect(state.bindTask).not.toHaveBeenCalled(); expect(state.filesList).not.toHaveBeenCalled()
    expect(state.fileManager.mock.calls.every(([id]) => id === state.props.serverId)).toBe(true)
  })
  it('creates and renames through the existing dialogs and enables directory actions without context attachments', async () => {
    const state = fixture(); const { container } = await mount({ ...state.props, onAddContext: undefined })
    await click('远程文件管理'); await menu('新建文件')
    await input(document.querySelector('[role="dialog"] input')!, 'new.txt')
    await submit(document.querySelector('[role="dialog"] form')!)
    expect(state.fileManager).toHaveBeenCalledWith(state.props.serverId, { type: 'create', path: '/home/tester/new.txt', directory: false }, undefined)
    await click('folder 文件操作'); await menu('重命名或移动')
    await input(document.querySelector('[role="dialog"] input')!, '/home/tester/moved')
    await submit(document.querySelector('[role="dialog"] form')!)
    expect(state.fileManager).toHaveBeenCalledWith(state.props.serverId, { type: 'rename', path: '/home/tester/folder', destination: '/home/tester/moved' }, undefined)
    await click('data.json 文件操作'); await menu('删除')
    const deletion = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(button => button.textContent === '删除')!
    await act(async () => { deletion.click() })
    expect(state.fileManager).toHaveBeenCalledWith(state.props.serverId, { type: 'delete', path: '/home/tester/data.json', recursive: false }, undefined)
    expect(container.textContent).not.toContain('文件操作失败')
  })
  it('preserves a conflicting edit and attaches selected draft code with the correct remote identity', async () => {
    const state = fixture(); const { container } = await mount(state.props)
    await click('打开文件 data.json')
    const view = EditorView.findFromDOM(container.querySelector('.cm-content')!)!
    await act(async () => { view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'draft' }, selection: EditorSelection.single(0, 5), userEvent: 'input' }) })
    await click('保存文件')
    expect(state.fileManager).toHaveBeenCalledWith(state.props.serverId, { type: 'save', path: '/home/tester/data.json', text: 'draft', version: 'a'.repeat(64) }, expect.any(AbortSignal))
    expect(view.state.sliceDoc()).toBe('draft'); expect(container.textContent).toContain('远端文件已变化')
    await click('添加选中代码到对话')
    expect(state.onAddContext).toHaveBeenCalledWith({ kind: 'selection', path: '/home/tester/data.json', text: 'draft', startLine: 1, endLine: 1, server: { id: state.props.serverId, label: '测试服务器' } })
    await click('data.json 文件操作')
    const rename = [...document.querySelectorAll('[role="menuitem"]')].find(item => item.textContent === '重命名或移动')!
    expect((rename as HTMLButtonElement).disabled).toBe(true)
  })
  it('ignores late navigation results after a newer directory request succeeds', async () => {
    const state = fixture(); const original = state.fileManager.getMockImplementation()!
    let finish!: (value: Awaited<ReturnType<LingServerService['fileManager']>>) => void
    let slowSignal: AbortSignal | undefined
    state.fileManager.mockImplementation(async (id, request, signal) => {
      if (request.type === 'list' && request.path === '/slow') { slowSignal = signal; return new Promise(resolve => { finish = resolve }) }
      return original(id, request, signal)
    })
    const { container } = await mount(state.props)
    const location = container.querySelector<HTMLInputElement>('[aria-label="远端目录路径"]')!
    await input(location, '/slow'); await submit(container.querySelector('form')!)
    await input(location, '/fast'); await submit(container.querySelector('form')!)
    expect(slowSignal?.aborted).toBe(true)
    await act(async () => { finish({ ok: true, value: { type: 'directory', directory: { path: '/slow', entries: [], truncated: false } } }) })
    expect(location.value).toBe('/fast')
  })
})
