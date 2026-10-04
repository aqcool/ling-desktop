// @vitest-environment jsdom
import { act, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { EditorSelection } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LingReadResult, LingWorkspaceDirectory, LingWorkspaceDocument } from '../src/runtime/contract.js'
import { FileBrowser } from '../src/ui/FileBrowser.js'

type Props = ComponentProps<typeof FileBrowser>
const roots = new Set<Root>()
let sequence = 0
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [] })
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => new DOMRect() })
  window.localStorage.clear()
})
afterEach(async () => {
  await act(async () => { for (const root of roots) root.unmount() })
  roots.clear()
  document.body.replaceChildren()
  vi.unstubAllGlobals()
})

function fixture(overrides: Partial<Props> = {}) {
  const directory: LingWorkspaceDirectory = { path: '', truncated: false, entries: [
    { kind: 'directory', name: 'src', path: 'src' },
    { kind: 'file', name: 'first.ts', path: 'first.ts' },
    { kind: 'file', name: 'second.txt', path: 'second.txt' },
    { kind: 'file', name: 'README.md', path: 'README.md' },
  ] }
  const documents: Record<string, LingWorkspaceDocument> = {
    'first.ts': { path: 'first.ts', kind: 'code', mediaType: 'text/plain', text: 'first\nsecond\nthird', version: 'first-v1', lines: 3 },
    'second.txt': { path: 'second.txt', kind: 'text', mediaType: 'text/plain', text: 'another file', version: 'second-v1', lines: 1 },
    'README.md': { path: 'README.md', kind: 'markdown', mediaType: 'text/markdown', text: '# Original\n\nOriginal paragraph.', version: 'markdown-v1', lines: 3 },
  }
  const loadDirectory = vi.fn<Props['loadDirectory']>(async (_taskId, path) => ({ ok: true, value: path === '' ? directory : { path, entries: [], truncated: false } }))
  const loadDocument = vi.fn<Props['loadDocument']>(async (_taskId, path) => ({ ok: true, value: documents[path]! }))
  const saveDocument = vi.fn<NonNullable<Props['saveDocument']>>(async (_taskId, _path, _text, version) => ({ ok: true, value: { version: `${version}-saved` } }))
  const onAddContext = vi.fn<NonNullable<Props['onAddContext']>>()
  const props: Props = { taskId: `workspace-editor-test-${String(++sequence)}`, workspaceLabel: 'LING',
    loadDirectory, loadDocument, saveDocument, onAddContext, ...overrides }
  return { props, directory, documents, loadDirectory, loadDocument, saveDocument, onAddContext }
}

async function mount(props: Props) {
  const container = document.createElement('div')
  container.style.height = '640px'
  document.body.append(container)
  const root = createRoot(container)
  roots.add(root)
  await act(async () => { root.render(<FileBrowser {...props} />) })
  return { container, unmount: async () => {
    await act(async () => { root.unmount() })
    roots.delete(root)
    container.remove()
  } }
}

function button(container: ParentNode, label: string): HTMLButtonElement {
  const match = [...container.querySelectorAll<HTMLButtonElement>('button')].find(node => node.getAttribute('aria-label') === label)
  expect(match, `button ${label}`).toBeDefined()
  return match!
}
async function click(container: ParentNode, label: string) { await act(async () => { button(container, label).click() }) }
async function clickMenuItem(label: string) {
  const item = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(node => node.textContent?.trim() === label)
  expect(item, `menu item ${label}`).toBeDefined()
  await act(async () => { item!.click() })
}
function editor(container: ParentNode): EditorView {
  const content = container.querySelector<HTMLElement>('.cm-content')
  expect(content).not.toBeNull()
  const view = EditorView.findFromDOM(content!)
  expect(view).not.toBeNull()
  return view!
}
async function replace(view: EditorView, text: string) {
  await act(async () => { view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, userEvent: 'input' }) })
}
function deferred<Value>() {
  let resolve!: (value: Value) => void
  const promise = new Promise<Value>(finish => { resolve = finish })
  return { promise, resolve }
}

describe('workspace file editor integration', () => {
  it('loads the directory and selected file asynchronously into the full-height editable CodeMirror surface', async () => {
    const state = fixture()
    const directory = deferred<LingReadResult<LingWorkspaceDirectory>>()
    const document = deferred<LingReadResult<LingWorkspaceDocument>>()
    const loadDirectory = vi.fn<Props['loadDirectory']>(() => directory.promise)
    const loadDocument = vi.fn<Props['loadDocument']>(() => document.promise)
    const { container } = await mount({ ...state.props, loadDirectory, loadDocument })
    expect(container.textContent).toContain('正在读取目录')
    expect(loadDirectory).toHaveBeenCalledWith(state.props.taskId, '', expect.any(AbortSignal))
    await act(async () => { directory.resolve({ ok: true, value: state.directory }) })
    await click(container, '打开文件 first.ts')
    expect(container.textContent).toContain('正在读取文件')
    expect(loadDocument).toHaveBeenCalledWith(state.props.taskId, 'first.ts', expect.any(AbortSignal))
    await act(async () => { document.resolve({ ok: true, value: state.documents['first.ts']! }) })
    const view = editor(container)
    expect(view.state.sliceDoc()).toBe('first\nsecond\nthird')
    expect(view.state.readOnly).toBe(false)
    expect(view.contentDOM.getAttribute('aria-label')).toBe('编辑 first.ts')
    expect(container.querySelector('.code-editor')?.parentElement?.getAttribute('aria-label')).toBe('工作区编辑器')
    expect(getComputedStyle(view.dom).height).toBe('100%')
  })

  it('adds directory and file context from their menus without opening or recursively reading them', async () => {
    const state = fixture()
    const { container } = await mount(state.props)
    const directoryRow = button(container, '展开目录 src').parentElement!
    await act(async () => { directoryRow.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 60 })) })
    await clickMenuItem('添加到对话')
    expect(state.onAddContext).toHaveBeenLastCalledWith({ kind: 'directory', path: 'src' })
    await click(container, 'first.ts 文件操作')
    await clickMenuItem('添加到对话')
    expect(state.onAddContext).toHaveBeenLastCalledWith({ kind: 'file', path: 'first.ts' })
    expect(state.onAddContext).toHaveBeenCalledTimes(2)
    expect(state.loadDocument).not.toHaveBeenCalled()
    expect(state.loadDirectory).toHaveBeenCalledTimes(1)
  })

  it('passes the exact unsaved selection and original line range from CodeMirror to conversation context', async () => {
    const state = fixture()
    const { container } = await mount(state.props)
    await click(container, '打开文件 first.ts')
    const view = editor(container)
    await replace(view, 'first\nsecond changed\nthird')
    await act(async () => { view.dispatch({ selection: EditorSelection.single(view.state.doc.line(3).from, view.state.doc.line(2).from) }) })
    await click(container, '添加选中代码到对话')
    expect(state.onAddContext).toHaveBeenCalledWith({ kind: 'selection', path: 'first.ts', text: 'second changed\n', startLine: 2, endLine: 2 })
    expect(container.querySelector('[aria-label="有未保存的修改"]')).not.toBeNull()
    expect(view.state.sliceDoc()).toBe('first\nsecond changed\nthird')
    expect(state.saveDocument).not.toHaveBeenCalled()
  })

  it('saves with the loaded version, preserves newer in-flight edits, and uses the returned version for the next save', async () => {
    const state = fixture()
    const firstSave = deferred<LingReadResult<{ version: string }>>()
    state.saveDocument.mockImplementationOnce(() => firstSave.promise)
    state.saveDocument.mockResolvedValueOnce({ ok: true, value: { version: 'first-v3' } })
    const { container } = await mount(state.props)
    await click(container, '打开文件 first.ts')
    const view = editor(container)
    await replace(view, 'changed for first save')
    await click(container, '保存文件')
    expect(state.saveDocument).toHaveBeenNthCalledWith(1, state.props.taskId, 'first.ts', 'changed for first save', 'first-v1', expect.any(AbortSignal))
    expect(button(container, '保存文件').disabled).toBe(true)
    await replace(view, 'newer unsaved edit')
    await act(async () => { firstSave.resolve({ ok: true, value: { version: 'first-v2' } }) })
    expect(view.state.sliceDoc()).toBe('newer unsaved edit')
    expect(container.querySelector('[aria-label="有未保存的修改"]')).not.toBeNull()
    await click(container, '保存文件')
    expect(state.saveDocument).toHaveBeenNthCalledWith(2, state.props.taskId, 'first.ts', 'newer unsaved edit', 'first-v2', expect.any(AbortSignal))
    expect(container.querySelector('[aria-label="有未保存的修改"]')).toBeNull()
    expect(view.state.sliceDoc()).toBe('newer unsaved edit')
  })

  it('keeps edited text and the original expected version after transport failure and a file conflict', async () => {
    const state = fixture()
    state.saveDocument.mockRejectedValueOnce(new Error('transport disconnected'))
    state.saveDocument.mockResolvedValueOnce({ ok: false, reason: 'document-conflict', message: '原文件已变更，请先处理冲突。', retryable: false })
    const { container } = await mount(state.props)
    await click(container, '打开文件 first.ts')
    const view = editor(container)
    await replace(view, 'keep these unsaved changes')
    await click(container, '保存文件')
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('文件保存失败')
    expect(view.state.sliceDoc()).toBe('keep these unsaved changes')
    await click(container, '保存文件')
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('原文件已变更')
    expect(view.state.sliceDoc()).toBe('keep these unsaved changes')
    expect(container.querySelector('[aria-label="有未保存的修改"]')).not.toBeNull()
    expect(state.saveDocument).toHaveBeenNthCalledWith(2, state.props.taskId, 'first.ts', 'keep these unsaved changes', 'first-v1', expect.any(AbortSignal))
  })

  it('retains unsaved buffers across file switches and a workbench tab unmount/remount for the same task', async () => {
    const state = fixture()
    const firstMount = await mount(state.props)
    await click(firstMount.container, '打开文件 first.ts')
    await replace(editor(firstMount.container), 'unsaved first file')
    await click(firstMount.container, '打开文件 second.txt')
    expect(editor(firstMount.container).state.sliceDoc()).toBe('another file')
    await replace(editor(firstMount.container), 'unsaved second file')
    await click(firstMount.container, '打开文件 first.ts')
    expect(editor(firstMount.container).state.sliceDoc()).toBe('unsaved first file')
    await firstMount.unmount()
    const remounted = await mount(state.props)
    expect(editor(remounted.container).state.sliceDoc()).toBe('unsaved first file')
    await click(remounted.container, '打开文件 second.txt')
    expect(editor(remounted.container).state.sliceDoc()).toBe('unsaved second file')
    expect(state.loadDocument.mock.calls.map(call => call[1])).toEqual(['first.ts', 'second.txt'])
    expect(state.saveDocument).not.toHaveBeenCalled()
  })

  it('previews the current Markdown draft and returns to its unchanged unsaved source', async () => {
    const state = fixture()
    const { container } = await mount(state.props)
    await click(container, '打开文件 README.md')
    await replace(editor(container), '# Draft preview\n\nUnsaved paragraph.')
    await click(container, '预览 Markdown')
    expect(container.querySelector('.cm-content')).toBeNull()
    expect(container.querySelector('h1')?.textContent).toBe('Draft preview')
    expect(container.textContent).toContain('Unsaved paragraph.')
    await click(container, '查看 Markdown 源码')
    expect(editor(container).state.sliceDoc()).toBe('# Draft preview\n\nUnsaved paragraph.')
    expect(container.querySelector('[aria-label="有未保存的修改"]')).not.toBeNull()
    expect(state.saveDocument).not.toHaveBeenCalled()
  })

  it('isolates unsaved buffers and restored paths when one remote task changes its source directory', async () => {
    const state = fixture()
    const first = await mount({ ...state.props, stateScope: `${state.props.taskId}:/project-a` })
    await click(first.container, '打开文件 first.ts')
    await replace(editor(first.container), 'project A unsaved code')
    await first.unmount()

    const second = await mount({ ...state.props, stateScope: `${state.props.taskId}:/project-b` })
    expect(second.container.querySelector('.cm-content')).toBeNull()
    await click(second.container, '打开文件 first.ts')
    expect(editor(second.container).state.sliceDoc()).toBe('first\nsecond\nthird')
    expect(second.container.querySelector('[aria-label="有未保存的修改"]')).toBeNull()
    await second.unmount()

    const restored = await mount({ ...state.props, stateScope: `${state.props.taskId}:/project-a` })
    expect(editor(restored.container).state.sliceDoc()).toBe('project A unsaved code')
    expect(state.loadDocument.mock.calls.every(call => call[0] === state.props.taskId)).toBe(true)
    expect(state.saveDocument).not.toHaveBeenCalled()
  })
})
