import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Spinner } from '@heroui/react/spinner'
import type {
  LingReadResult,
  LingWorkspaceDirectory,
  LingWorkspaceDocument,
  LingWorkspaceEntry,
} from '../runtime/contract.js'
import {
  parseStoredDocumentPaths,
  serializeDocumentPaths,
  workspaceDocumentStorageKey,
} from '../session-state.js'
import { Icon } from './Icon.js'
import { FileIcon } from './FileIcon.js'
import { Markdown } from './Markdown.js'
import { CodeEditor, type CodeEditorSelection } from './CodeEditor.js'
import { Menu, MenuItem } from './Menu.js'
import type { WorkspaceContextReference } from './attachments.js'
import { tw } from './tailwind.js'

interface FileBrowserProps {
  readonly loadDirectory: (
    taskId: string,
    path: string,
    signal: AbortSignal,
  ) => Promise<LingReadResult<LingWorkspaceDirectory>>
  readonly loadDocument: (
    taskId: string,
    path: string,
    signal: AbortSignal,
  ) => Promise<LingReadResult<LingWorkspaceDocument>>
  readonly taskId: string
  /** File buffers follow the source directory even when a task changes remote bindings. */
  readonly stateScope?: string
  readonly workspaceLabel?: string
  readonly onAddContext?: (reference: WorkspaceContextReference) => void
  readonly saveDocument?: (taskId: string, path: string, text: string, version: string, signal: AbortSignal) => Promise<LingReadResult<{ readonly version: string }>>
}

export function parentPath(path: string): string {
  const index = path.lastIndexOf('/')
  return index === -1 ? '' : path.slice(0, index)
}

export function sizeLabel(bytes: number | undefined): string {
  if (bytes === undefined) return ''
  if (bytes < 1024) return `${String(bytes)} B`
  if (bytes < 1024 * 1024) return `${String(Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function ordered(entries: readonly LingWorkspaceEntry[]): readonly LingWorkspaceEntry[] {
  return [...entries].sort((left, right) => {
    if (left.kind === 'directory' && right.kind !== 'directory') return -1
    if (right.kind === 'directory' && left.kind !== 'directory') return 1
    return left.name.localeCompare(right.name)
  })
}

export function DocumentBody({ document }: { readonly document: LingWorkspaceDocument }) {
  const truncation = document.truncated
    ? <p className={tw("file-browser__state flex [min-height:2.4rem] items-center gap-2 m-0 py-1.5 px-1.5 [color:var(--text-secondary)] text-xs")}>文件较大，此处只读取了前 {String(document.lines ?? 0)} 行。</p>
    : null
  if (document.kind === 'image') {
    return (
      <>
        {truncation}
        <img
          alt={document.path}
          className={tw("document-preview__image block [max-width:100%] mt-2 [border:1px_solid_var(--panel-border)] rounded-xl [background:var(--surface)]")}
          src={`data:${document.mediaType};base64,${document.data ?? ''}`}
        />
      </>
    )
  }
  if (document.kind === 'pdf') {
    return (
      <>
        {document.converted ? <p className={tw("file-browser__state flex [min-height:2.4rem] items-center gap-2 m-0 py-1.5 px-1.5 [color:var(--text-secondary)] text-xs")}>Office 文档已转换为 PDF 预览。</p> : null}
        {document.missingFonts !== undefined && document.missingFonts.length > 0 ? (
          <p className={tw("file-browser__state flex [min-height:2.4rem] items-center gap-2 m-0 py-1.5 px-1.5 [color:var(--text-secondary)] text-xs")}>转换时缺少字体：{document.missingFonts.join('、')}</p>
        ) : null}
        <iframe
          className={tw("document-preview__pdf block w-full [height:min(34rem,_calc(100vh_-_18rem))] mt-2 [border:1px_solid_var(--panel-border)] rounded-xl [background:var(--surface)]")}
          src={`data:application/pdf;base64,${document.data ?? ''}`}
          title={document.path}
        />
      </>
    )
  }
  if (document.kind === 'unsupported') {
    return (
      <p className={tw("file-browser__state flex [min-height:2.4rem] items-center gap-2 m-0 py-1.5 px-1.5 [color:var(--text-secondary)] text-xs")}>
        此文件类型暂不支持预览。{document.bytes === undefined ? '' : `大小 ${sizeLabel(document.bytes)}。`}
      </p>
    )
  }
  const text = document.text ?? ''
  if (document.kind === 'markdown') {
    return (
      <>
        {truncation}
        <div className={tw("document-preview__markdown py-4 px-5 overflow-auto [overflow-wrap:anywhere]")}><Markdown source={text} /></div>
      </>
    )
  }
  return (
    <>
      {truncation}
      <div className={tw('min-h-[18rem] h-full')}><CodeEditor path={document.path} value={text} readOnly /></div>
    </>
  )
}

function FileTreeEntry({ entry, depth, loadDirectory, onSelect, onAddContext, revision, selectedPath, taskId }: {
  readonly entry: LingWorkspaceEntry
  readonly depth: number
  readonly loadDirectory: FileBrowserProps['loadDirectory']
  readonly onSelect: (path: string) => void
  readonly onAddContext?: (reference: WorkspaceContextReference) => void
  readonly revision: number
  readonly selectedPath?: string
  readonly taskId: string
}) {
  const [expanded, setExpanded] = useState(false)
  const [directory, setDirectory] = useState<LingWorkspaceDirectory>()
  const [message, setMessage] = useState<string>()
  const [loading, setLoading] = useState(false)
  const [contextRequest, setContextRequest] = useState<{ x: number; y: number; nonce: number }>()
  const isDirectory = entry.kind === 'directory'

  useEffect(() => {
    if (!expanded || !isDirectory) return
    const abort = new AbortController()
    setLoading(true)
    setMessage(undefined)
    void loadDirectory(taskId, entry.path, abort.signal).then(result => {
      if (abort.signal.aborted) return
      if (result.ok) setDirectory(result.value)
      else { setDirectory(undefined); setMessage(result.message) }
      setLoading(false)
    }).catch(() => {
      if (abort.signal.aborted) return
      setDirectory(undefined)
      setMessage('无法读取目录内容。')
      setLoading(false)
    })
    return () => { abort.abort() }
  }, [entry.path, expanded, isDirectory, loadDirectory, revision, taskId])

  return (
    <li className={tw("workspace-files__tree-item min-w-0")}>
      <div className={tw('group flex min-w-0 items-center rounded-md hover:bg-[var(--surface-hover)]', selectedPath === entry.path && 'bg-[var(--surface-selected)]')} onContextMenu={event => { event.preventDefault(); setContextRequest({ x: event.clientX, y: event.clientY, nonce: Date.now() }) }}>
      <button
        aria-expanded={isDirectory ? expanded : undefined}
        aria-label={`${isDirectory ? expanded ? '折叠目录' : '展开目录' : '打开文件'} ${entry.name}`}
        className={tw("workspace-files__entry flex h-control-sm flex-1 min-w-0 items-center gap-1.5 rounded-md border-0 bg-transparent py-0 pr-1 pl-[calc(0.25rem+var(--tree-depth)*0.8rem)] text-left text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:outline-0 focus-visible:bg-[var(--surface-hover)] focus-visible:outline-0", selectedPath === entry.path && "workspace-files__entry--selected bg-[var(--surface-selected)] text-[var(--foreground)]")}
        onClick={() => { if (isDirectory) setExpanded(current => !current); else onSelect(entry.path) }}
        onKeyDown={event => {
          if (!onAddContext || (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10'))) return
          event.preventDefault()
          const bounds = event.currentTarget.getBoundingClientRect()
          setContextRequest({ x: bounds.left, y: bounds.bottom, nonce: Date.now() })
        }}
        style={{ '--tree-depth': String(depth) } as CSSProperties}
        title={entry.path}
        type="button"
      >
        <span className={tw("workspace-files__chevron grid size-4 shrink-0 place-items-center")}>{isDirectory ? <Icon name={expanded ? 'chevronDown' : 'chevronRight'} size={13} /> : null}</span>
        <FileIcon className={tw("flex-none")} path={entry.path} directory={isDirectory} expanded={expanded} size={16} />
        <span className={tw("workspace-files__entry-name min-w-0 overflow-hidden text-xs text-ellipsis whitespace-nowrap")}>{entry.name}</span>
      </button>
      {onAddContext && entry.kind !== 'other' ? <Menu contextRequest={contextRequest} triggerAriaLabel={`${entry.name} 文件操作`} triggerClassName={tw('size-control-xs rounded-md opacity-0 group-hover:opacity-100 focus:opacity-100 aria-expanded:opacity-100')} triggerLabel={<Icon name="more" size={14} />}>
        <MenuItem icon="plus" onPress={() => { onAddContext({ kind: isDirectory ? 'directory' : 'file', path: entry.path }) }}>添加到对话</MenuItem>
        <MenuItem icon="copy" onPress={() => { void navigator.clipboard.writeText(entry.path) }}>复制相对路径</MenuItem>
      </Menu> : null}
      </div>
      {expanded ? (
        <ul className={tw("workspace-files__tree m-0 p-0 [list-style:none]")} role="group">
          {loading ? <li className={tw("workspace-files__tree-state py-1.5 px-2.5 [color:var(--text-tertiary)] text-xs")}>正在读取…</li> : null}
          {message ? <li className={tw("workspace-files__tree-state py-1.5 px-2.5 [color:var(--text-tertiary)] text-xs workspace-files__tree-state--error [color:var(--danger)]")}>{message}</li> : null}
          {!loading && directory?.entries.length === 0 ? <li className={tw("workspace-files__tree-state py-1.5 px-2.5 [color:var(--text-tertiary)] text-xs")}>空目录</li> : null}
          {!loading ? ordered(directory?.entries ?? []).map(child => (
            <FileTreeEntry depth={depth + 1} entry={child} key={child.path} loadDirectory={loadDirectory} onSelect={onSelect} onAddContext={onAddContext} revision={revision} selectedPath={selectedPath} taskId={taskId} />
          )) : null}
        </ul>
      ) : null}
    </li>
  )
}

// Keep unsaved buffers when the workbench changes tabs. Never persist source text in settings.
const unsavedBuffers = new Map<string, Map<string, { document: LingWorkspaceDocument; text: string }>>()
const toolbarButton = 'inline-grid size-control-sm shrink-0 place-items-center rounded-md border-0 bg-transparent p-0 text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] focus-visible:outline-2 focus-visible:outline-[var(--focus)] disabled:opacity-40'

export function FileBrowser({ loadDirectory, loadDocument, saveDocument, onAddContext, taskId, stateScope, workspaceLabel }: FileBrowserProps) {
  const scope = stateScope ?? taskId
  const [revision, setRevision] = useState(0)
  const [documentRevision, setDocumentRevision] = useState(0)
  const [directory, setDirectory] = useState<LingWorkspaceDirectory>()
  const [directoryLoading, setDirectoryLoading] = useState(true)
  const [directoryMessage, setDirectoryMessage] = useState<string>()
  const [query, setQuery] = useState('')
  const [treeWidth, setTreeWidth] = useState(34)
  const [treeVisible, setTreeVisible] = useState(true)
  const bodyRef = useRef<HTMLDivElement>(null)
  const [openedFile, setOpenedFile] = useState<string>()
  const openedFileRef = useRef(openedFile)
  openedFileRef.current = openedFile
  const [document, setDocument] = useState<LingWorkspaceDocument>()
  const [documentLoading, setDocumentLoading] = useState(false)
  const [documentMessage, setDocumentMessage] = useState<string>()
  const [documentsRestored, setDocumentsRestored] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const [selection, setSelection] = useState<CodeEditorSelection | null>(null)
  const [codeContextRequest, setCodeContextRequest] = useState<{ x: number; y: number; nonce: number }>()
  const [markdownPreview, setMarkdownPreview] = useState(false)
  const [wrap, setWrap] = useState(false)
  const dirty = document?.text !== undefined && draft !== document.text
  const editable = Boolean(saveDocument && document?.version && !document.truncated && document.text !== undefined)
  const buffers = () => {
    let cache = unsavedBuffers.get(scope)
    if (!cache) { cache = new Map(); unsavedBuffers.set(scope, cache) }
    return cache
  }

  useEffect(() => {
    setOpenedFile(parseStoredDocumentPaths(window.localStorage.getItem(workspaceDocumentStorageKey))[scope])
    setDocumentsRestored(true)
  }, [scope])
  useEffect(() => {
    if (!documentsRestored) return
    const next = { ...parseStoredDocumentPaths(window.localStorage.getItem(workspaceDocumentStorageKey)) }
    if (openedFile === undefined) delete next[scope]
    else next[scope] = openedFile
    window.localStorage.setItem(workspaceDocumentStorageKey, serializeDocumentPaths(next))
  }, [documentsRestored, openedFile, scope])
  useEffect(() => {
    const abort = new AbortController()
    setDirectoryLoading(true)
    setDirectoryMessage(undefined)
    void loadDirectory(taskId, '', abort.signal).then(result => {
      if (abort.signal.aborted) return
      if (result.ok) setDirectory(result.value)
      else { setDirectory(undefined); setDirectoryMessage(result.message) }
      setDirectoryLoading(false)
    }).catch(() => {
      if (!abort.signal.aborted) { setDirectoryMessage('无法读取目录内容。'); setDirectoryLoading(false) }
    })
    return () => { abort.abort() }
  }, [loadDirectory, revision, taskId])
  useEffect(() => {
    setSelection(null)
    setDocumentMessage(undefined)
    setMarkdownPreview(false)
    setDocument(undefined)
    if (openedFile === undefined) { setDocumentLoading(false); return }
    const cached = unsavedBuffers.get(scope)?.get(openedFile)
    if (cached) { setDocument(cached.document); setDraft(cached.text); setDocumentLoading(false); return }
    const abort = new AbortController()
    setDocumentLoading(true)
    void loadDocument(taskId, openedFile, abort.signal).then(result => {
      if (abort.signal.aborted) return
      if (result.ok) { setDocument(result.value); setDraft(result.value.text ?? '') }
      else setDocumentMessage(result.message)
      setDocumentLoading(false)
    }).catch(() => {
      if (!abort.signal.aborted) { setDocumentMessage('无法读取文件内容。'); setDocumentLoading(false) }
    })
    return () => { abort.abort() }
  }, [loadDocument, openedFile, documentRevision, scope, taskId])

  const change = (text: string) => {
    setDraft(text)
    if (!document || !openedFile) return
    if (text === document.text) buffers().delete(openedFile)
    else buffers().set(openedFile, { document, text })
  }
  const save = async () => {
    if (!editable || !saveDocument || !document?.version || !openedFile || !dirty || savingRef.current) return
    const path = openedFile
    const source = document
    const text = draft
    savingRef.current = true
    setSaving(true)
    setDocumentMessage(undefined)
    try {
      const result = await saveDocument(taskId, path, text, source.version!, new AbortController().signal)
      if (!result.ok) { if (openedFileRef.current === path) setDocumentMessage(result.message); return }
      const saved = { ...source, text, version: result.value.version, lines: text.split('\n').length }
      const latest = buffers().get(path)
      if (latest && latest.text !== text) buffers().set(path, { document: saved, text: latest.text })
      else buffers().delete(path)
      if (openedFileRef.current === path) setDocument(saved)
    } catch { if (openedFileRef.current === path) setDocumentMessage('文件保存失败，修改仍保留在编辑器中。') }
    finally { savingRef.current = false; setSaving(false) }
  }
  const addSelection = (range: CodeEditorSelection) => {
    if (openedFile) onAddContext?.({ kind: 'selection', path: openedFile, ...range })
  }

  return <div className={tw('workspace-files flex min-w-0 min-h-0 flex-1 flex-col')}>
    <div className={tw('workspace-files__header flex h-10 shrink-0 items-center gap-1 border-b border-[var(--separator)] px-3 text-xs text-[var(--text-secondary)]')}>
      <span className={tw('shrink-0 max-w-[30%] truncate')} title={workspaceLabel}>{workspaceLabel ?? '工作区'}</span>
      {openedFile ? <><Icon name="chevronRight" size={12} /><FileIcon path={openedFile} size={15} /><span className={tw('min-w-0 flex-1 truncate text-[var(--foreground)]')} title={openedFile}>{openedFile}</span>{dirty ? <span className={tw('size-1.5 shrink-0 rounded-full bg-[var(--text-secondary)]')} role="status" aria-label="有未保存的修改" title="有未保存的修改" /> : null}</> : <span className={tw('flex-1')} />}
      {selection && onAddContext ? <button aria-label="添加选中代码到对话" title="添加选中代码到对话 (⌘/Ctrl+Enter)" className={tw(toolbarButton, 'flex w-auto gap-1 px-2 text-caption')} onMouseDown={event => { event.preventDefault() }} onClick={() => { addSelection(selection) }} type="button"><Icon name="plus" size={14} />添加到对话</button> : null}
      {editable && dirty ? <button aria-label="保存文件" title="保存文件 (⌘/Ctrl+S)" disabled={saving} className={tw(toolbarButton)} onClick={() => { void save() }} type="button">{saving ? <Spinner size="sm" /> : <Icon name="save" size={15} />}</button> : null}
      <Menu contextRequest={codeContextRequest} triggerAriaLabel="更多文件操作" triggerClassName={tw(toolbarButton)} triggerLabel={<Icon name="more" size={16} />}>
        {selection && onAddContext ? <MenuItem icon="plus" onPress={() => { addSelection(selection) }}>添加选中代码到对话</MenuItem> : null}
        {openedFile && onAddContext ? <MenuItem icon="plus" onPress={() => { onAddContext({ kind: 'file', path: openedFile }) }}>添加文件到对话</MenuItem> : null}
        {openedFile ? <MenuItem icon="copy" onPress={() => { void navigator.clipboard.writeText(openedFile) }}>复制相对路径</MenuItem> : null}
        {document?.text !== undefined ? <><MenuItem checked={wrap} onPress={() => { setWrap(current => !current) }}>自动换行</MenuItem><MenuItem disabled={dirty || saving} icon="refresh" onPress={() => { setDocumentRevision(current => current + 1) }}>重新读取文件</MenuItem></> : null}
        {dirty ? <MenuItem onPress={() => { change(document?.text ?? ''); setDocumentMessage(undefined) }}>还原未保存的修改</MenuItem> : null}
        <MenuItem icon="refresh" onPress={() => { setRevision(current => current + 1); if (!dirty) setDocumentRevision(current => current + 1) }}>刷新文件树</MenuItem>
      </Menu>
      {document?.kind === 'markdown' ? <button aria-label={markdownPreview ? '查看 Markdown 源码' : '预览 Markdown'} aria-pressed={markdownPreview} className={tw(toolbarButton)} onClick={() => { setMarkdownPreview(current => !current) }} title={markdownPreview ? '源码' : '预览'} type="button"><Icon name={markdownPreview ? 'code' : 'eye'} size={16} /></button> : null}
      <button aria-label={treeVisible ? '收起文件树' : '展开文件树'} aria-pressed={treeVisible} className={tw(toolbarButton, treeVisible && 'bg-[var(--surface-hover)]')} onClick={() => { setTreeVisible(current => !current) }} type="button"><Icon name="folder" size={16} /></button>
      {openedFile ? <button aria-label="关闭文件预览" className={tw(toolbarButton)} onClick={() => { setOpenedFile(undefined) }} type="button"><Icon name="close" size={14} /></button> : null}
    </div>
    <div className={tw('workspace-files__body grid min-h-0 flex-1', treeVisible ? '[grid-template-columns:minmax(0,_1fr)_1px_minmax(0,_var(--file-tree-width))]' : 'grid-cols-1')} ref={bodyRef} style={{ '--file-tree-width': `${treeWidth}%` } as CSSProperties}>
      <section aria-label="工作区编辑器" className={tw('workspace-files__preview flex min-w-0 min-h-0 flex-col overflow-hidden')}>
        {openedFile === undefined ? <div className={tw('workspace-files__empty flex h-full flex-col items-center justify-center gap-2 p-4 text-center text-[var(--text-tertiary)]')}><Icon name="file" size={30} /><strong className={tw('text-sm font-medium text-[var(--text-secondary)]')}>选择一个文件</strong><span className={tw('text-xs')}>从右侧文件树打开文件。</span></div> : <>
          {documentMessage ? <div className={tw('flex shrink-0 items-center gap-2 px-3 py-2 text-xs text-[var(--danger)]')} role="alert"><span className={tw('min-w-0 flex-1 break-words')}>{documentMessage}</span>{!document ? <button className={tw('shrink-0 rounded px-2 py-1 text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]')} onClick={() => { setDocumentRevision(current => current + 1) }} type="button">重试</button> : null}</div> : null}
          {documentLoading ? <p className={tw('flex items-center gap-2 px-4 py-3 text-xs text-[var(--text-tertiary)]')}><Spinner size="sm" />正在读取文件</p> : null}
          {!documentLoading && document ? document.text !== undefined && !markdownPreview ? <>
            {document.truncated ? <p className={tw('m-0 shrink-0 px-3 py-2 text-xs text-[var(--text-tertiary)]')}>文件较大，只预览前 {document.lines ?? 0} 行，无法编辑。</p> : null}
            <CodeEditor path={openedFile} value={draft} readOnly={!editable} onChange={editable ? change : undefined} onSelectionChange={setSelection} onSave={() => { void save() }} onAddSelection={onAddContext ? addSelection : undefined} onContextMenu={onAddContext ? (range, x, y) => { setSelection(range); setCodeContextRequest({ x, y, nonce: Date.now() }) } : undefined} wrap={wrap} />
          </> : <div className={tw('workspace-files__document min-h-0 flex-1 overflow-auto', document.kind !== 'markdown' && 'p-3')}><DocumentBody document={document.text === undefined ? document : { ...document, text: draft }} /></div> : null}
        </>}
      </section>
      {treeVisible ? <><div aria-label="调整编辑器与文件树宽度" aria-orientation="vertical" aria-valuemin={22} aria-valuemax={60} aria-valuenow={Math.round(treeWidth)} className={tw('workspace-files__divider relative z-1 bg-[var(--separator)] cursor-col-resize touch-none after:absolute after:inset-y-0 after:-inset-x-1 after:content-[""] focus-visible:outline-2 focus-visible:outline-[var(--focus)]')} onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId) }} onPointerMove={event => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
        const bounds = bodyRef.current?.getBoundingClientRect()
        if (bounds) setTreeWidth(Math.max(22, Math.min(60, (bounds.right - event.clientX) / bounds.width * 100)))
      }} role="separator" tabIndex={0} onKeyDown={event => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
        event.preventDefault(); setTreeWidth(current => Math.max(22, Math.min(60, current + (event.key === 'ArrowLeft' ? 2 : -2))))
      }} />
      <section aria-label="文件树" className={tw('workspace-files__sidebar flex min-w-0 min-h-0 flex-col overflow-hidden')}>
        <div className={tw('workspace-files__search m-2 flex h-control-sm shrink-0 items-center gap-1.5 rounded-md border border-[var(--panel-border)] px-2 text-[var(--text-tertiary)] focus-within:border-[var(--focus)]')}><Icon name="search" size={15} /><input className={tw('w-full min-w-0 border-0 bg-transparent text-xs text-[var(--foreground)] outline-0 placeholder:text-[var(--text-tertiary)]')} aria-label="筛选文件" onChange={event => { setQuery(event.target.value) }} placeholder="筛选文件…" type="search" value={query} /></div>
        <div className={tw('workspace-files__tree-scroll min-h-0 flex-1 overflow-auto px-1 pb-2')}>
          {directoryLoading ? <p className={tw('flex items-center gap-2 px-2 py-2 text-xs text-[var(--text-tertiary)]')}><Spinner size="sm" />正在读取目录</p> : null}
          {!directoryLoading && directoryMessage ? <p className={tw('px-2 text-xs text-[var(--danger)]')}>{directoryMessage}</p> : null}
          {!directoryLoading && directory?.entries.length === 0 ? <p className={tw('px-2 text-xs text-[var(--text-tertiary)]')}>此目录没有内容。</p> : null}
          {!directoryLoading && directory ? <ul className={tw('workspace-files__tree m-0 p-0 list-none')} role="tree">
            {ordered(directory.entries).filter(entry => entry.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())).map(entry => <FileTreeEntry depth={0} entry={entry} key={entry.path} loadDirectory={loadDirectory} onSelect={setOpenedFile} onAddContext={onAddContext} revision={revision} selectedPath={openedFile} taskId={taskId} />)}
            {directory.truncated ? <li className={tw('px-2 py-1.5 text-xs text-[var(--text-tertiary)]')}>目录内容过多，只列出部分条目。</li> : null}
          </ul> : null}
        </div>
      </section></> : null}
    </div>
  </div>
}
