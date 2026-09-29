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
import { Markdown } from './Markdown.js'
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
  readonly workspaceLabel?: string
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
    ? <p className={tw("file-browser__state flex [min-height:2.4rem] items-center [gap:0.45rem] m-0 [padding:0.4rem_0.35rem] [color:#6b6b6b] [font-size:0.75rem]")}>文件较大，此处只读取了前 {String(document.lines ?? 0)} 行。</p>
    : null
  if (document.kind === 'image') {
    return (
      <>
        {truncation}
        <img
          alt={document.path}
          className={tw("document-preview__image block [max-width:100%] [margin-top:0.55rem] [border:1px_solid_#e9e9e9] [border-radius:0.7rem] [background:#fbfbfb] dark:[border-color:#2e2e33] dark:[background:#1d1d20]")}
          src={`data:${document.mediaType};base64,${document.data ?? ''}`}
        />
      </>
    )
  }
  if (document.kind === 'pdf') {
    return (
      <>
        {document.converted ? <p className={tw("file-browser__state flex [min-height:2.4rem] items-center [gap:0.45rem] m-0 [padding:0.4rem_0.35rem] [color:#6b6b6b] [font-size:0.75rem]")}>Office 文档已转换为 PDF 预览。</p> : null}
        {document.missingFonts !== undefined && document.missingFonts.length > 0 ? (
          <p className={tw("file-browser__state flex [min-height:2.4rem] items-center [gap:0.45rem] m-0 [padding:0.4rem_0.35rem] [color:#6b6b6b] [font-size:0.75rem]")}>转换时缺少字体：{document.missingFonts.join('、')}</p>
        ) : null}
        <iframe
          className={tw("document-preview__pdf block w-full [height:min(34rem,_calc(100vh_-_18rem))] [margin-top:0.55rem] [border:1px_solid_#e9e9e9] [border-radius:0.7rem] [background:#fbfbfb] dark:[border-color:#2e2e33] dark:[background:#1d1d20]")}
          src={`data:application/pdf;base64,${document.data ?? ''}`}
          title={document.path}
        />
      </>
    )
  }
  if (document.kind === 'unsupported') {
    return (
      <p className={tw("file-browser__state flex [min-height:2.4rem] items-center [gap:0.45rem] m-0 [padding:0.4rem_0.35rem] [color:#6b6b6b] [font-size:0.75rem]")}>
        此文件类型暂不支持预览。{document.bytes === undefined ? '' : `大小 ${sizeLabel(document.bytes)}。`}
      </p>
    )
  }
  const text = document.text ?? ''
  if (document.kind === 'markdown') {
    return (
      <>
        {truncation}
        <div className={tw("document-preview__markdown [margin-top:0.55rem] [padding:0.6rem_0.75rem] overflow-auto [border:1px_solid_#e9e9e9] [border-radius:0.7rem] [background:#fbfbfb] [overflow-wrap:anywhere] dark:[border-color:#2e2e33] dark:[background:#1d1d20]")}><Markdown source={text} /></div>
      </>
    )
  }
  return (
    <>
      {truncation}
      <pre className={tw("file-browser__content [max-height:min(28rem,_calc(100vh_-_18rem))] [margin:0.55rem_0_0] overflow-auto [border:1px_solid_#e9e9e9] [border-radius:0.7rem] [background:#fbfbfb]")}>{text.split('\n').map((line, index) => (
        <span className={tw("file-browser__line grid min-w-max grid-cols-[2.7rem_minmax(0,1fr)]")} key={`${line}-${String(index)}`}>
          <i className={tw("select-none border-r border-[#eeeeee] px-1.5 py-px text-right font-mono text-[0.63rem] leading-[1.55] not-italic text-[#a8a8a8]")}>{String(index + 1)}</i>
          <code className={tw("px-2 py-px font-mono text-[0.67rem] leading-[1.55] whitespace-pre text-[#666]")}>{line}</code>
        </span>
      ))}</pre>
    </>
  )
}

function FileTreeEntry({ entry, depth, loadDirectory, onSelect, revision, selectedPath, taskId }: {
  readonly entry: LingWorkspaceEntry
  readonly depth: number
  readonly loadDirectory: FileBrowserProps['loadDirectory']
  readonly onSelect: (path: string) => void
  readonly revision: number
  readonly selectedPath?: string
  readonly taskId: string
}) {
  const [expanded, setExpanded] = useState(false)
  const [directory, setDirectory] = useState<LingWorkspaceDirectory>()
  const [message, setMessage] = useState<string>()
  const [loading, setLoading] = useState(false)
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
      <button
        aria-expanded={isDirectory ? expanded : undefined}
        aria-label={`${isDirectory ? expanded ? '折叠目录' : '展开目录' : '打开文件'} ${entry.name}`}
        className={tw("workspace-files__entry flex h-7 w-full min-w-0 items-center gap-1.5 rounded-md border-0 bg-transparent py-0 pr-[calc(0.25rem+var(--tree-depth)*0.8rem)] pl-[calc(0.25rem+var(--tree-depth)*0.8rem)] text-left text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:outline-0 focus-visible:bg-[var(--surface-hover)] focus-visible:outline-0", selectedPath === entry.path && "workspace-files__entry--selected bg-[var(--surface-selected)] text-[var(--foreground)]")}
        onClick={() => { if (isDirectory) setExpanded(current => !current); else onSelect(entry.path) }}
        style={{ '--tree-depth': String(depth) } as CSSProperties}
        title={entry.path}
        type="button"
      >
        <span className={tw("workspace-files__chevron grid size-4 shrink-0 place-items-center")}>{isDirectory ? <Icon name={expanded ? 'chevronDown' : 'chevronRight'} size={13} /> : null}</span>
        <Icon className={tw("flex-none")} name={isDirectory ? expanded ? 'folderOpen' : 'folder' : 'file'} size={16} />
        <span className={tw("workspace-files__entry-name min-w-0 overflow-hidden [font-size:0.78rem] text-ellipsis whitespace-nowrap")}>{entry.name}</span>
      </button>
      {expanded ? (
        <ul className={tw("workspace-files__tree m-0 p-0 [list-style:none]")} role="group">
          {loading ? <li className={tw("workspace-files__tree-state [padding:0.35rem_0.6rem] [color:var(--text-tertiary)] [font-size:0.73rem]")}>正在读取…</li> : null}
          {message ? <li className={tw("workspace-files__tree-state [padding:0.35rem_0.6rem] [color:var(--text-tertiary)] [font-size:0.73rem] workspace-files__tree-state--error [color:#b04c43]")}>{message}</li> : null}
          {!loading && directory?.entries.length === 0 ? <li className={tw("workspace-files__tree-state [padding:0.35rem_0.6rem] [color:var(--text-tertiary)] [font-size:0.73rem]")}>空目录</li> : null}
          {!loading ? ordered(directory?.entries ?? []).map(child => (
            <FileTreeEntry depth={depth + 1} entry={child} key={child.path} loadDirectory={loadDirectory} onSelect={onSelect} revision={revision} selectedPath={selectedPath} taskId={taskId} />
          )) : null}
        </ul>
      ) : null}
    </li>
  )
}

export function FileBrowser({ loadDirectory, loadDocument, saveDocument, taskId, workspaceLabel }: FileBrowserProps) {
  const [revision, setRevision] = useState(0)
  const [directory, setDirectory] = useState<LingWorkspaceDirectory>()
  const [directoryLoading, setDirectoryLoading] = useState(true)
  const [directoryMessage, setDirectoryMessage] = useState<string>()
  const [query, setQuery] = useState('')
  const [treeWidth, setTreeWidth] = useState(36)
  const bodyRef = useRef<HTMLDivElement>(null)
  const [openedFile, setOpenedFile] = useState<string>()
  const [document, setDocument] = useState<LingWorkspaceDocument>()
  const [documentLoading, setDocumentLoading] = useState(false)
  const [documentMessage, setDocumentMessage] = useState<string>()
  const [documentsRestored, setDocumentsRestored] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setOpenedFile(parseStoredDocumentPaths(window.localStorage.getItem(workspaceDocumentStorageKey))[taskId])
    setDocumentsRestored(true)
  }, [taskId])

  useEffect(() => {
    if (!documentsRestored) return
    const paths = parseStoredDocumentPaths(window.localStorage.getItem(workspaceDocumentStorageKey))
    const next = { ...paths }
    if (openedFile === undefined) delete next[taskId]
    else next[taskId] = openedFile
    window.localStorage.setItem(workspaceDocumentStorageKey, serializeDocumentPaths(next))
  }, [documentsRestored, openedFile, taskId])

  useEffect(() => {
    const abort = new AbortController()
    setDirectoryLoading(true)
    setDirectoryMessage(undefined)
    void loadDirectory(taskId, '', abort.signal).then(result => {
      if (abort.signal.aborted) return
      if (result.ok) setDirectory(result.value)
      else {
        setDirectory(undefined)
        setDirectoryMessage(result.message)
      }
      setDirectoryLoading(false)
    }).catch(() => {
      if (abort.signal.aborted) return
      setDirectory(undefined)
      setDirectoryMessage('无法读取目录内容。')
      setDirectoryLoading(false)
    })
    return () => { abort.abort() }
  }, [loadDirectory, revision, taskId])

  useEffect(() => {
    if (openedFile === undefined) {
      setDocument(undefined)
      setDocumentLoading(false)
      setDocumentMessage(undefined)
      return
    }
    const abort = new AbortController()
    setDocument(undefined)
    setEditing(false)
    setDocumentLoading(true)
    setDocumentMessage(undefined)
    void loadDocument(taskId, openedFile, abort.signal).then(result => {
      if (abort.signal.aborted) return
      if (result.ok) setDocument(result.value)
      else setDocumentMessage(result.message)
      setDocumentLoading(false)
    }).catch(() => {
      if (abort.signal.aborted) return
      setDocumentMessage('无法读取文件内容。')
      setDocumentLoading(false)
    })
    return () => { abort.abort() }
  }, [loadDocument, openedFile, revision, taskId])

  const save = async () => {
    if (!saveDocument || !document?.version || !openedFile || saving) return
    setSaving(true)
    setDocumentMessage(undefined)
    const abort = new AbortController()
    try {
      const result = await saveDocument(taskId, openedFile, draft, document.version, abort.signal)
      if (!result.ok) { setDocumentMessage(result.message); return }
      setDocument({ ...document, text: draft, version: result.value.version, lines: draft.split('\n').length })
      setEditing(false)
      setRevision(current => current + 1)
    } catch { setDocumentMessage('文件保存失败。') }
    finally { setSaving(false) }
  }

  return (
    <div className={tw("workspace-files flex min-w-0 min-h-0 flex-1 flex-col")}>
      <div className={tw("workspace-files__header flex h-10 flex-none items-center justify-between gap-1.5 border-b border-[var(--separator)] px-3 font-mono text-[0.78rem] text-[var(--text-secondary)]")}>
        <span className={tw("overflow-hidden text-ellipsis whitespace-nowrap")} title={workspaceLabel}>{workspaceLabel ?? '工作区'}</span>
        <button aria-label="重新读取工作区文件" className={tw("icon-button inline-grid size-7 shrink-0 place-items-center rounded-md border-0 bg-transparent p-0 text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)]")} onClick={() => { setRevision(current => current + 1) }} title="刷新文件" type="button"><Icon name="refresh" size={16} /></button>
      </div>
      <div className={tw("workspace-files__body grid min-h-0 flex-1 [grid-template-columns:minmax(0,_1fr)_1px_minmax(0,_var(--file-tree-width))]")} ref={bodyRef} style={{ '--file-tree-width': `${String(treeWidth)}%` } as CSSProperties}>
        <section aria-label="文件预览" className={tw("workspace-files__preview flex min-w-0 min-h-0 flex-col overflow-hidden")}>
          {openedFile === undefined ? (
            <div className={tw("workspace-files__empty flex h-full min-w-0 flex-col items-center justify-center gap-2 p-4 text-center text-[var(--text-tertiary)]")}><Icon className={tw("mb-1.5 text-[var(--text-tertiary)] opacity-55")} name="file" size={31} /><strong className={tw("text-sm font-semibold text-[var(--text-secondary)]")}>选择一个文件</strong></div>
          ) : (
            <>
              <div className={tw("workspace-files__preview-heading flex h-9 shrink-0 items-center gap-1.5 px-3 text-[0.78rem] text-[var(--text-secondary)]")} title={openedFile}><Icon name="file" size={15} /><span className={tw("min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap")}>{openedFile}</span>
                {editing ? <><button type="button" disabled={saving} className={tw('rounded px-2 py-1 text-xs hover:bg-[var(--surface-hover)]')} onClick={() => { setEditing(false); setDocumentMessage(undefined) }}>取消</button><button type="button" disabled={saving || draft === document?.text} className={tw('rounded px-2 py-1 text-xs font-medium hover:bg-[var(--surface-hover)]')} onClick={() => { void save() }}>保存</button></>
                  : saveDocument && document?.version && !document.truncated && document.text !== undefined ? <button type="button" className={tw('rounded px-2 py-1 text-xs hover:bg-[var(--surface-hover)]')} onClick={() => { setDraft(document.text ?? ''); setEditing(true) }}>编辑</button> : null}
                <button aria-label="关闭文件预览" className={tw("icon-button inline-grid size-7 shrink-0 place-items-center rounded-md border-0 bg-transparent p-0 text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)]")} onClick={() => { setOpenedFile(undefined) }} type="button"><Icon name="close" size={14} /></button></div>
              <div className={tw("workspace-files__document min-h-0 flex-1 overflow-auto p-3")}>
                {documentLoading ? <p className={tw("file-browser__state flex [min-height:2.4rem] items-center [gap:0.45rem] m-0 [padding:0.4rem_0.35rem] [color:#6b6b6b] [font-size:0.75rem]")}><Spinner size="sm" /> 正在读取文件</p> : null}
                {!documentLoading && documentMessage ? <p className={tw("file-browser__state flex [min-height:2.4rem] items-center [gap:0.45rem] m-0 [padding:0.4rem_0.35rem] [color:#6b6b6b] [font-size:0.75rem] file-browser__state--error [color:#b04c43]")}>{documentMessage}</p> : null}
                {!documentLoading && document ? editing ? <textarea aria-label="编辑远端文件" autoCapitalize="off" autoCorrect="off" spellCheck={false} value={draft} onChange={event => setDraft(event.target.value)} className={tw('h-full min-h-[18rem] w-full resize-none rounded-md border border-[var(--panel-border)] bg-[var(--surface)] p-3 font-mono text-xs leading-5 text-[var(--foreground)] outline-none focus:border-[var(--focus)]')} /> : <DocumentBody document={document} /> : null}
              </div>
            </>
          )}
        </section>
        <div aria-label="调整编辑器与文件树宽度" aria-orientation="vertical" aria-valuemin={28} aria-valuemax={60} aria-valuenow={Math.round(treeWidth)} className={tw("workspace-files__divider relative [z-index:1] [background:var(--separator)] cursor-col-resize [touch-action:none] after:absolute after:[inset:0_-5px] after:[content:''] focus-visible:[outline:2px_solid_var(--focus)] focus-visible:[outline-offset:-2px]")} onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId) }} onPointerMove={event => {
          if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
          const bounds = bodyRef.current?.getBoundingClientRect()
          if (!bounds) return
          setTreeWidth(Math.max(28, Math.min(60, (bounds.right - event.clientX) / bounds.width * 100)))
        }} role="separator" tabIndex={0} onKeyDown={event => {
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
          event.preventDefault()
          setTreeWidth(current => Math.max(28, Math.min(60, current + (event.key === 'ArrowLeft' ? 2 : -2))))
        }} />
        <section aria-label="文件树" className={tw("workspace-files__sidebar flex min-w-0 min-h-0 flex-col overflow-hidden")}>
          <div className={tw("workspace-files__search mx-2 mt-2 mb-2 flex h-7 flex-none items-center gap-1.5 rounded-lg border border-[var(--panel-border)] px-2 text-[var(--text-tertiary)] focus-within:border-[var(--focus)]")}><Icon name="search" size={15} /><input className={tw("w-full min-w-0 border-0 bg-transparent text-[0.77rem] text-[var(--foreground)] outline-0 placeholder:text-[var(--text-tertiary)]")} aria-label="筛选文件" onChange={event => { setQuery(event.target.value) }} placeholder="筛选文件…" type="search" value={query} /></div>
          <div className={tw("workspace-files__tree-scroll min-h-0 flex-1 overflow-auto [padding:0.1rem_0.3rem_0.6rem]")}>
            {directoryLoading ? <p className={tw("file-browser__state flex [min-height:2.4rem] items-center [gap:0.45rem] m-0 [padding:0.4rem_0.35rem] [color:#6b6b6b] [font-size:0.75rem]")}><Spinner size="sm" /> 正在读取目录</p> : null}
            {!directoryLoading && directoryMessage ? <p className={tw("file-browser__state flex [min-height:2.4rem] items-center [gap:0.45rem] m-0 [padding:0.4rem_0.35rem] [color:#6b6b6b] [font-size:0.75rem] file-browser__state--error [color:#b04c43]")}>{directoryMessage}</p> : null}
            {!directoryLoading && directory?.entries.length === 0 ? <p className={tw("file-browser__state flex [min-height:2.4rem] items-center [gap:0.45rem] m-0 [padding:0.4rem_0.35rem] [color:#6b6b6b] [font-size:0.75rem]")}>此目录没有内容。</p> : null}
            {!directoryLoading && directory ? (
              <ul className={tw("workspace-files__tree m-0 p-0 [list-style:none]")} role="tree">
                {ordered(directory.entries).filter(entry => entry.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())).map(entry => (
                  <FileTreeEntry depth={0} entry={entry} key={entry.path} loadDirectory={loadDirectory} onSelect={setOpenedFile} revision={revision} selectedPath={openedFile} taskId={taskId} />
                ))}
                {directory.truncated ? <li className={tw("workspace-files__tree-state [padding:0.35rem_0.6rem] [color:var(--text-tertiary)] [font-size:0.73rem]")}>目录内容过多，只列出部分条目。</li> : null}
              </ul>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  )
}
