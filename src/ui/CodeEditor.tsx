import { useLayoutEffect, useRef } from 'react'
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { bracketMatching, foldGutter, foldKeymap, HighlightStyle, indentOnInput, indentUnit, LanguageDescription, syntaxHighlighting } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search'
import { Compartment, EditorState, type Extension } from '@codemirror/state'
import { drawSelection, dropCursor, EditorView, highlightActiveLine, highlightActiveLineGutter, highlightSpecialChars, keymap, lineNumbers } from '@codemirror/view'
import { tags } from '@lezer/highlight'
import { tw } from './tailwind.js'

export interface CodeEditorSelection {
  readonly text: string
  readonly startLine: number
  readonly endLine: number
}

export interface CodeEditorProps {
  readonly value: string
  readonly path: string
  readonly onChange?: (value: string) => void
  readonly readOnly?: boolean
  readonly wrap?: boolean
  readonly onSelectionChange?: (selection: CodeEditorSelection | null) => void
  readonly onSave?: () => void
  readonly onAddSelection?: (selection: CodeEditorSelection) => void
  readonly onContextMenu?: (selection: CodeEditorSelection, x: number, y: number) => void
}

/** Ranges are normalized by CodeMirror; exclude the next line when selection ends at its start. */
export function codeEditorSelection(state: EditorState): CodeEditorSelection | null {
  const { from, to, empty } = state.selection.main
  if (empty) return null
  const text = state.sliceDoc(from, to)
  if (!text.trim()) return null
  return { text, startLine: state.doc.lineAt(from).number, endLine: state.doc.lineAt(to - 1).number }
}

function languageForPath(path: string): LanguageDescription | null {
  const filename = path.split(/[\\/]/u).at(-1) ?? path
  return LanguageDescription.matchFilename(languages, filename)
}

export function codeLanguageLabel(path: string): string { return languageForPath(path)?.name ?? '纯文本' }

const highlighting = HighlightStyle.define([
  { tag: [tags.keyword, tags.modifier, tags.operatorKeyword, tags.tagName], color: 'var(--info)' },
  { tag: [tags.string, tags.regexp, tags.special(tags.string)], color: 'var(--success)' },
  { tag: [tags.number, tags.bool, tags.null, tags.attributeName], color: 'var(--warning)' },
  { tag: [tags.typeName, tags.className, tags.namespace], color: 'var(--focus)' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: 'var(--link)' },
  { tag: tags.comment, color: 'var(--text-tertiary)', fontStyle: 'italic' },
  { tag: tags.invalid, color: 'var(--danger)', textDecoration: 'underline' },
])

// CodeMirror owns its generated stylesheet; every color and font follows the same LING tokens.
const editorTheme = EditorView.theme({
  '&': { height: '100%', backgroundColor: 'var(--surface)', color: 'var(--foreground)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--font-code)', fontSize: 'var(--font-size-compact)', lineHeight: '1.6', overflow: 'auto' },
  '.cm-content': { minHeight: '100%', padding: '8px 0', caretColor: 'var(--foreground)' },
  '.cm-line': { padding: '0 16px 0 8px' },
  '.cm-gutters': { backgroundColor: 'var(--surface)', color: 'var(--text-tertiary)', borderRight: '1px solid var(--separator)' },
  '.cm-lineNumbers .cm-gutterElement': { minWidth: '3em', padding: '0 8px', fontSize: 'var(--font-size-xs)' },
  '.cm-foldGutter .cm-gutterElement': { padding: '0 3px', cursor: 'pointer' },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'color-mix(in srgb, var(--surface-selected) 40%, transparent)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--foreground)' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, .cm-content ::selection': { backgroundColor: 'color-mix(in srgb, var(--focus) 25%, transparent)' },
  '.cm-selectionMatch': { backgroundColor: 'color-mix(in srgb, var(--focus) 14%, transparent)' },
  '.cm-matchingBracket': { backgroundColor: 'var(--surface-selected)', color: 'var(--foreground)', outline: '1px solid var(--panel-border)' },
  '.cm-foldPlaceholder': { border: '1px solid var(--panel-border)', backgroundColor: 'var(--surface-secondary)', color: 'var(--text-secondary)', padding: '0 4px' },
  '.cm-panels': { backgroundColor: 'var(--surface-secondary)', color: 'var(--foreground)', fontFamily: 'var(--font-ui)', fontSize: 'var(--font-size-xs)' },
  '.cm-panels-top': { borderBottom: '1px solid var(--separator)' },
  '.cm-panel.cm-search': { padding: '6px 8px' },
  '.cm-searchMatch': { backgroundColor: 'var(--warning-subtle)', outline: '1px solid var(--warning)' },
  '.cm-searchMatch-selected': { backgroundColor: 'var(--surface-selected)' },
  '.cm-textfield': { border: '1px solid var(--panel-border)', backgroundColor: 'var(--field-background)', color: 'var(--foreground)', borderRadius: 'var(--corner-sm)' },
  '.cm-button': { border: '1px solid var(--panel-border)', background: 'var(--surface)', color: 'var(--foreground)', borderRadius: 'var(--corner-sm)', fontFamily: 'var(--font-ui)' },
  '.cm-tooltip': { border: '1px solid var(--panel-border)', backgroundColor: 'var(--surface-secondary)', color: 'var(--foreground)' },
})

/** A single CodeMirror view owns the document; callback changes never recreate it mid-edit. */
export function CodeEditor(props: CodeEditorProps) {
  const host = useRef<HTMLDivElement>(null)
  const current = useRef(props)
  current.current = props
  const instance = useRef<{ view: EditorView; createState: (value: string) => EditorState; editable: Compartment; wrapping: Compartment } | null>(null)
  const readOnly = props.readOnly === true || !props.onChange

  useLayoutEffect(() => {
    if (!host.current) return
    const language = new Compartment(), editable = new Compartment(), wrapping = new Compartment()
    const description = languageForPath(current.current.path)
    const editability = (): Extension => {
      const readonly = current.current.readOnly === true || !current.current.onChange
      return [EditorState.readOnly.of(readonly), EditorView.editable.of(!readonly), EditorView.contentAttributes.of({
        'aria-label': readonly ? `预览 ${current.current.path}` : `编辑 ${current.current.path}`,
        'aria-readonly': String(readonly), tabindex: '0', spellcheck: 'false', autocapitalize: 'off', autocorrect: 'off',
      })]
    }
    const extensions: Extension[] = [
      editorTheme, syntaxHighlighting(highlighting),
      EditorState.phrases.of({
        Find: '查找', Replace: '替换', next: '下一个', previous: '上一个', all: '全部',
        'match case': '区分大小写', regexp: '正则表达式', 'by word': '全词匹配',
        replace: '替换', 'replace all': '全部替换', close: '关闭',
        'Go to line': '跳转到行', go: '跳转', 'current match': '当前匹配', 'on line': '所在行',
        'replaced match on line $': '第 $ 行已替换', 'replaced $ matches': '已替换 $ 处匹配',
      }),
      lineNumbers(), highlightSpecialChars(), history(), drawSelection(), dropCursor(),
      indentOnInput(), bracketMatching(), closeBrackets(), foldGutter(), highlightActiveLine(), highlightActiveLineGutter(),
      search({ top: true }), highlightSelectionMatches(),
      indentUnit.of(current.current.value.match(/^([ \t]+)\S/m)?.[1]?.slice(0, 8) ?? (/\.py$/i.test(current.current.path) ? '    ' : '  ')),
      keymap.of([
        { key: 'Mod-s', preventDefault: true, run: view => { if (view.state.readOnly || !current.current.onSave) return false; current.current.onSave(); return true } },
        { key: 'Mod-Enter', run: view => { const selected = codeEditorSelection(view.state); if (!selected || !current.current.onAddSelection) return false; current.current.onAddSelection(selected); return true } },
        ...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, ...foldKeymap, indentWithTab,
      ]),
      EditorView.updateListener.of(update => {
        if (update.docChanged && !update.state.readOnly) current.current.onChange?.(update.state.sliceDoc())
        if (update.docChanged || update.selectionSet) current.current.onSelectionChange?.(codeEditorSelection(update.state))
      }),
      EditorView.domEventHandlers({ contextmenu(event, view) {
        const selected = codeEditorSelection(view.state)
        if (!selected || !current.current.onContextMenu) return false
        event.preventDefault()
        event.stopPropagation()
        current.current.onContextMenu(selected, event.clientX, event.clientY)
        return true
      } }),
    ]
    const createState = (value: string) => EditorState.create({ doc: value, extensions: [
      extensions, editable.of(editability()), language.of(description?.support ?? []),
      wrapping.of(current.current.wrap ? EditorView.lineWrapping : []),
      // Preserve Windows file line endings through edits and saves.
      EditorState.lineSeparator.of(value.includes('\r\n') && !/(?<!\r)\n/u.test(value) ? '\r\n' : '\n'),
    ] })
    const view = new EditorView({ state: createState(current.current.value), parent: host.current })
    instance.current = { view, createState, editable, wrapping }
    current.current.onSelectionChange?.(null)
    let disposed = false
    if (description && !description.support) void description.load().then(support => {
      if (!disposed) view.dispatch({ effects: language.reconfigure(support) })
    }).catch(() => { /* Plain text remains editable if a language chunk cannot load. */ })
    return () => { disposed = true; instance.current = null; view.destroy() }
  }, [props.path])

  useLayoutEffect(() => {
    const editor = instance.current
    if (!editor || editor.view.state.sliceDoc() === props.value) return
    editor.view.setState(editor.createState(props.value))
    current.current.onSelectionChange?.(null)
  }, [props.value])

  useLayoutEffect(() => {
    const editor = instance.current
    if (!editor) return
    editor.view.dispatch({ effects: editor.editable.reconfigure([
      EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly), EditorView.contentAttributes.of({
        'aria-label': readOnly ? `预览 ${props.path}` : `编辑 ${props.path}`,
        'aria-readonly': String(readOnly), tabindex: '0', spellcheck: 'false', autocapitalize: 'off', autocorrect: 'off',
      }),
    ]) })
  }, [readOnly, props.path])

  useLayoutEffect(() => {
    const editor = instance.current
    if (editor) editor.view.dispatch({ effects: editor.wrapping.reconfigure(props.wrap ? EditorView.lineWrapping : []) })
  }, [props.wrap])

  return <div ref={host} className={tw('code-editor h-full min-h-0 min-w-0 flex-1 overflow-hidden')} />
}
