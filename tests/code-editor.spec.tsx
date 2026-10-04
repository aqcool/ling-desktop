// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { undo, undoDepth } from '@codemirror/commands'
import { syntaxTree } from '@codemirror/language'
import { searchPanelOpen } from '@codemirror/search'
import { EditorSelection, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CodeEditor, codeEditorSelection, codeLanguageLabel, type CodeEditorProps } from '../src/ui/CodeEditor.js'

let root: Root | undefined
let container: HTMLDivElement
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  // jsdom provides a real editable DOM, but no layout engine for CodeMirror's scheduled measurements.
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [] })
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => new DOMRect() })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root?.unmount())
  container.remove()
  root = undefined
  vi.unstubAllGlobals()
})

function render(props: CodeEditorProps): EditorView {
  act(() => root!.render(<CodeEditor {...props} />))
  const view = EditorView.findFromDOM(container.querySelector<HTMLElement>('.cm-content')!)
  expect(view).not.toBeNull()
  return view!
}
function key(view: EditorView, key: string, keyCode: number, ctrlKey = false): void {
  act(() => { view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key, keyCode, ctrlKey, bubbles: true, cancelable: true })) })
}

describe('CodeMirror editor integration', () => {
  it('edits a real document, indents with Tab, undoes changes, saves and opens search', () => {
    const onChange = vi.fn(), onSave = vi.fn()
    const view = render({ path: 'unknown.txt', value: 'first\nsecond', onChange, onSave })
    act(() => { view.dispatch({ changes: { from: 0, to: 5, insert: 'updated' }, userEvent: 'input' }) })
    expect(onChange).toHaveBeenLastCalledWith('updated\nsecond')
    expect(view.contentDOM.textContent).toContain('updated')
    act(() => { undo(view) })
    expect(onChange).toHaveBeenLastCalledWith('first\nsecond')
    act(() => { view.dispatch({ selection: { anchor: 0 } }) })
    key(view, 'Tab', 9)
    expect(view.state.sliceDoc()).toBe('  first\nsecond')
    key(view, 's', 83, true)
    expect(onSave).toHaveBeenCalledOnce()
    key(view, 'f', 70, true)
    expect(searchPanelOpen(view.state)).toBe(true)
    expect(container.querySelector('.cm-search input[name="search"]')?.getAttribute('placeholder')).toBe('查找')
    expect(container.querySelector('.cm-search input[name="replace"]')?.getAttribute('aria-label')).toBe('替换')
    expect(container.querySelector('.cm-search button[name="next"]')?.textContent).toBe('下一个')
    expect(container.querySelector('.cm-search button[name="close"]')?.getAttribute('aria-label')).toBe('关闭')
  })

  it('retains the code selection after clicking outside and uses current callbacks for Mod-Enter', () => {
    const onSelectionChange = vi.fn(), before = vi.fn(), latest = vi.fn(), onChange = vi.fn()
    const props = { path: 'snippet.txt', value: 'first\nsecond\nthird', onChange, onSelectionChange, onAddSelection: before }
    const view = render(props)
    act(() => { view.dispatch({ selection: EditorSelection.single(13, 6) }) })
    expect(onSelectionChange).toHaveBeenLastCalledWith({ text: 'second\n', startLine: 2, endLine: 2 })
    const button = document.createElement('button'); document.body.append(button)
    act(() => { button.focus() })
    expect(codeEditorSelection(view.state)).toEqual({ text: 'second\n', startLine: 2, endLine: 2 })
    expect(render({ ...props, onAddSelection: latest })).toBe(view)
    key(view, 'Enter', 13, true)
    expect(before).not.toHaveBeenCalled()
    expect(latest).toHaveBeenCalledWith({ text: 'second\n', startLine: 2, endLine: 2 })
    act(() => { view.dispatch({ selection: { anchor: 0 } }) })
    expect(onSelectionChange).toHaveBeenLastCalledWith(null)
    key(view, 'Enter', 13, true)
    expect(latest).toHaveBeenCalledOnce()
    button.remove()
  })

  it('resets selection and undo history when switching to another document', () => {
    const onChange = vi.fn(), onSelectionChange = vi.fn(), onAddSelection = vi.fn()
    const first = render({ path: 'first.txt', value: 'old code', onChange, onSelectionChange, onAddSelection })
    act(() => { first.dispatch({ changes: { from: 0, insert: 'changed ' }, selection: { anchor: 0, head: 8 }, userEvent: 'input' }) })
    expect(undoDepth(first.state)).toBe(1)
    const next = render({ path: 'second.txt', value: 'new code', onChange, onSelectionChange, onAddSelection })
    expect(next).not.toBe(first)
    expect(first.dom.isConnected).toBe(false)
    expect(next.state.sliceDoc()).toBe('new code')
    expect(undoDepth(next.state)).toBe(0)
    expect(onSelectionChange).toHaveBeenLastCalledWith(null)
    key(next, 'Enter', 13, true)
    expect(onAddSelection).not.toHaveBeenCalled()
  })

  it('changes line wrapping without losing history or selection', () => {
    const onChange = vi.fn()
    const props = { path: 'wrap.txt', value: 'line one\nline two', onChange }
    const view = render(props)
    act(() => { view.dispatch({ changes: { from: 0, insert: 'new ' }, selection: { anchor: 0, head: 4 }, userEvent: 'input' }) })
    const edited = view.state.sliceDoc()
    expect(view.contentDOM.classList.contains('cm-lineWrapping')).toBe(false)
    expect(render({ ...props, value: edited, wrap: true })).toBe(view)
    expect(view.contentDOM.classList.contains('cm-lineWrapping')).toBe(true)
    expect(undoDepth(view.state)).toBe(1)
    expect(codeEditorSelection(view.state)).toEqual({ text: 'new ', startLine: 1, endLine: 1 })
    render({ ...props, value: edited, wrap: false })
    expect(view.contentDOM.classList.contains('cm-lineWrapping')).toBe(false)
    expect(undoDepth(view.state)).toBe(1)
  })

  it('requests the shared context menu with the selected code and native coordinates', () => {
    const onContextMenu = vi.fn()
    const view = render({ path: 'menu.txt', value: 'first\nsecond\nthird', onContextMenu })
    act(() => { view.dispatch({ selection: { anchor: 6, head: 13 } }) })
    const event = new MouseEvent('contextmenu', { clientX: 42, clientY: 71, bubbles: true, cancelable: true })
    act(() => { view.contentDOM.dispatchEvent(event) })
    expect(event.defaultPrevented).toBe(true)
    expect(onContextMenu).toHaveBeenCalledWith({ text: 'second\n', startLine: 2, endLine: 2 }, 42, 71)
    expect(codeEditorSelection(view.state)).toEqual({ text: 'second\n', startLine: 2, endLine: 2 })
    act(() => { view.dispatch({ selection: { anchor: 0 } }) })
    const empty = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    act(() => { view.contentDOM.dispatchEvent(empty) })
    expect(empty.defaultPrevented).toBe(false)
    expect(onContextMenu).toHaveBeenCalledOnce()
  })

  it('reflects external replacements without reporting them as edits or reviving editability', () => {
    const onChange = vi.fn(), onSave = vi.fn(), onSelectionChange = vi.fn()
    const view = render({ path: 'remote.txt', value: 'original', onChange, onSave, onSelectionChange })
    act(() => { view.dispatch({ selection: { anchor: 0, head: 8 } }) })
    expect(render({ path: 'remote.txt', value: 'reloaded', onChange, onSave, onSelectionChange, readOnly: true })).toBe(view)
    expect(view.state.readOnly).toBe(true)
    expect(view.contentDOM.getAttribute('contenteditable')).toBe('false')
    expect(view.state.sliceDoc()).toBe('reloaded')
    expect(codeEditorSelection(view.state)).toBeNull()
    expect(onChange).not.toHaveBeenCalled()
    key(view, 's', 83, true)
    expect(onSave).not.toHaveBeenCalled()
    render({ path: 'remote.txt', value: 'latest', onChange, onSave, readOnly: true })
    expect(view.state.readOnly).toBe(true)
    expect(undoDepth(view.state)).toBe(0)
    render({ path: 'remote.txt', value: 'latest', onChange, onSave })
    expect(view.state.readOnly).toBe(false)
    expect(view.contentDOM.getAttribute('contenteditable')).toBe('true')
  })

  it('keeps Windows line endings when editing and selecting code', () => {
    const onChange = vi.fn()
    const view = render({ path: 'windows.txt', value: 'first\r\nsecond\r\n', onChange })
    act(() => { view.dispatch({ changes: { from: 0, insert: 'new ' } }) })
    expect(onChange).toHaveBeenLastCalledWith('new first\r\nsecond\r\n')
    act(() => { view.dispatch({ selection: { anchor: 10, head: 17 } }) })
    expect(codeEditorSelection(view.state)).toEqual({ text: 'second\r\n', startLine: 2, endLine: 2 })
  })

  it('loads TypeScript parsing lazily and identifies common language filenames', async () => {
    const view = render({ path: 'src/App.tsx', value: 'const total: number = 1', onChange: vi.fn() })
    await vi.waitFor(() => expect(syntaxTree(view.state).toString()).toContain('TypeAnnotation'))
    expect(codeLanguageLabel('C:\\project\\main.py')).toBe('Python')
    expect(codeLanguageLabel('main.go')).toBe('Go')
    expect(codeLanguageLabel('main.rs')).toBe('Rust')
    expect(codeLanguageLabel('data.json')).toBe('JSON')
    expect(codeLanguageLabel('site.css')).toBe('CSS')
    expect(codeLanguageLabel('index.html')).toBe('HTML')
    expect(codeLanguageLabel('unknown.filetype')).toBe('纯文本')
  })

  it('returns no snippet for empty or whitespace-only selections', () => {
    expect(codeEditorSelection(EditorState.create({ doc: 'code' }))).toBeNull()
    expect(codeEditorSelection(EditorState.create({ doc: ' \n ', selection: { anchor: 0, head: 3 } }))).toBeNull()
  })
})
