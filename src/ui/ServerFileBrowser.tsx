import { useCallback, useEffect, useRef, useState } from 'react'
import { Modal } from '@heroui/react/modal'
import type { LingReadResult, LingRemoteFileJob, LingRemoteFileRequest, LingWorkspaceDirectory, LingWorkspaceDocument, LingWorkspaceEntry } from '../runtime/contract.js'
import type { LingServerService } from '../runtime/servers.js'
import { FileBrowser, sizeLabel } from './FileBrowser.js'
import { Icon } from './Icon.js'
import { Menu, MenuItem, MenuSeparator } from './Menu.js'
import { PromptDialog } from './PromptDialog.js'
import { CompactButton } from './SettingsControls.js'
import type { WorkspaceContextReference } from './attachments.js'
import { tw } from './tailwind.js'

const parent = (path: string) => path.slice(0, path.lastIndexOf('/')) || '/'
const join = (directory: string, name: string) => `${directory.replace(/\/$/u, '')}/${name}`
const button = 'grid size-control-sm shrink-0 place-items-center rounded-md text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] disabled:opacity-40'
type FilePrompt = { type: 'file' | 'directory' | 'rename' | 'extract'; path: string; value?: string }
function wrong<Value>(): LingReadResult<Value> {
  return { ok: false, reason: 'runtime-unavailable', message: '服务器返回了无效文件结果。', retryable: true }
}

export function ServerFileBrowser({ service, serverId, initialPath = '.', workspaceLabel, onAddContext }: {
  readonly service: LingServerService
  readonly serverId: string
  readonly initialPath?: string
  readonly workspaceLabel: string
  readonly onAddContext?: (reference: WorkspaceContextReference) => void
}) {
  const [root, setRoot] = useState<string>()
  const [location, setLocation] = useState('')
  const [message, setMessage] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [revision, setRevision] = useState(0)
  const [mutation, setMutation] = useState<{ source: string; destination?: string; nonce: number }>()
  const [showHidden, setShowHidden] = useState(true)
  const [prompt, setPrompt] = useState<FilePrompt>()
  const [deleting, setDeleting] = useState<LingWorkspaceEntry>()
  const [jobs, setJobs] = useState<readonly LingRemoteFileJob[]>([])
  const [dismissed, setDismissed] = useState<readonly string[]>([])
  const previousJobs = useRef(new Map<string, string>())
  const mounted = useRef(true)
  const navigation = useRef<AbortController | undefined>(undefined)
  const startingPath = useRef(initialPath)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; navigation.current?.abort() } }, [])
  const request = useCallback((action: LingRemoteFileRequest, signal?: AbortSignal) => service.fileManager(serverId, action, signal), [service, serverId])
  const navigate = useCallback(async (path: string) => {
    navigation.current?.abort()
    const abort = new AbortController(); navigation.current = abort
    setBusy(true); setMessage(undefined)
    try {
      const result = await request({ type: 'list', path }, abort.signal)
      if (abort.signal.aborted || !mounted.current) return
      if (result.ok && result.value.type === 'directory') { setRoot(result.value.directory.path); setLocation(result.value.directory.path); setRevision(value => value + 1) }
      else setMessage(result.ok ? '无法读取目录。' : result.message)
    } catch { if (!abort.signal.aborted && mounted.current) setMessage('无法读取远端目录，请重试。') }
    finally { if (!abort.signal.aborted && mounted.current) setBusy(false) }
  }, [request])
  useEffect(() => { void navigate(startingPath.current); return () => { navigation.current?.abort() } }, [navigate])
  useEffect(() => {
    const abort = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try {
        const result = await request({ type: 'jobs' }, abort.signal)
        if (abort.signal.aborted) return
        if (result.ok && result.value.type === 'jobs') {
          const next = result.value.jobs
          const ended = next.filter(job => previousJobs.current.get(job.id) === 'running' && job.status !== 'running')
          if (ended.length) setRevision(value => value + 1)
          for (const job of ended) if (job.operation === 'delete' && job.status === 'completed') setMutation({ source: job.path, nonce: Date.now() })
          previousJobs.current = new Map(next.map(job => [job.id, job.status])); setJobs(next)
        }
      } catch { /* File operations surface their own errors; polling can retry after reconnection. */ }
      finally { if (!abort.signal.aborted) timer = setTimeout(() => { void poll() }, 1000) }
    }
    void poll()
    return () => { abort.abort(); clearTimeout(timer) }
  }, [request])
  const perform = async (action: LingRemoteFileRequest): Promise<{ accepted: boolean; message?: string }> => {
    setMessage(undefined)
    try {
      const result = await request(action)
      if (!mounted.current) return { accepted: false }
      if (!result.ok) { setMessage(result.message); return { accepted: false, message: result.message } }
      if (result.value.type === 'job') {
        const job = result.value.job; previousJobs.current.set(job.id, job.status)
        setJobs(value => [...value.filter(item => item.id !== job.id), job])
      } else {
        if (action.type === 'rename') setMutation({ source: action.path, destination: action.destination, nonce: Date.now() })
        setRevision(value => value + 1)
      }
      return { accepted: true }
    } catch { setMessage('文件操作失败，请重试。'); return { accepted: false, message: '文件操作失败，请重试。' } }
  }
  const list = useCallback(async (_id: string, path: string, signal: AbortSignal): Promise<LingReadResult<LingWorkspaceDirectory>> => {
    const result = await request({ type: 'list', path }, signal)
    return !result.ok ? result : result.value.type === 'directory' ? { ok: true, value: result.value.directory } : wrong()
  }, [request])
  const read = useCallback(async (_id: string, path: string, signal: AbortSignal): Promise<LingReadResult<LingWorkspaceDocument>> => {
    const result = await request({ type: 'read', path }, signal)
    return !result.ok ? result : result.value.type === 'document' ? { ok: true, value: result.value.document } : wrong()
  }, [request])
  const save = useCallback(async (_id: string, path: string, text: string, version: string, signal: AbortSignal): Promise<LingReadResult<{ version: string }>> => {
    const result = await request({ type: 'save', path, text, version }, signal)
    return !result.ok ? result : result.value.type === 'saved' ? { ok: true, value: { version: result.value.version } } : wrong()
  }, [request])
  const actions = (entry: LingWorkspaceEntry, unsaved: boolean) => <>
    <MenuSeparator />
    {entry.kind === 'directory' ? <MenuItem icon="folder" onPress={() => { void navigate(entry.path) }}>进入目录</MenuItem> : null}
    <MenuItem icon="download" disabled={entry.kind === 'other'} onPress={() => { void perform({ type: 'download', path: entry.path }) }}>下载</MenuItem>
    <MenuItem icon="edit" disabled={unsaved} onPress={() => { setPrompt({ type: 'rename', path: entry.path, value: entry.path }) }}>重命名或移动</MenuItem>
    {entry.kind === 'directory' ? <><MenuItem icon="file" onPress={() => { setPrompt({ type: 'file', path: entry.path }) }}>新建文件</MenuItem><MenuItem icon="folderPlus" onPress={() => { setPrompt({ type: 'directory', path: entry.path }) }}>新建目录</MenuItem></> : null}
    {entry.kind === 'file' && /\.(zip|tar|tar\.gz|tgz)$/iu.test(entry.path) ? <MenuItem icon="folder" onPress={() => { setPrompt({ type: 'extract', path: entry.path, value: entry.path.replace(/\.(zip|tar\.gz|tar|tgz)$/iu, '') }) }}>解压到新目录</MenuItem> : null}
    <MenuItem icon="trash" danger disabled={unsaved} onPress={() => { setDeleting(entry) }}>删除</MenuItem>
  </>
  const visibleJobs = jobs.filter(job => !dismissed.includes(job.id)).slice(-4)
  return <div className={tw('flex min-h-0 min-w-0 flex-1 flex-col')}>
    <form aria-label="远程目录导航" className={tw('flex h-10 shrink-0 items-center gap-1 border-b border-[var(--separator)] px-2')} onSubmit={event => { event.preventDefault(); void navigate(location.startsWith('/') ? location : root ? join(root, location) : location) }}>
      <button type="button" aria-label="上级目录" title="上级目录" className={tw(button)} disabled={!root || root === '/' || busy} onClick={() => { if (root) void navigate(parent(root)) }}><Icon name="back" size={15} /></button>
      <input aria-label="远端目录路径" className={tw('h-control-sm min-w-0 flex-1 rounded-md border border-[var(--panel-border)] bg-transparent px-2 text-xs outline-0 focus:border-[var(--focus)]')} value={location} onChange={event => { setLocation(event.target.value) }} placeholder="服务器目录" />
      <button aria-label="前往目录" type="submit" className={tw(button)} disabled={busy || !location.trim()}><Icon name="forward" size={15} /></button>
      <button aria-label="刷新远程文件" type="button" className={tw(button)} disabled={busy} onClick={() => { void navigate(root ?? initialPath) }}><Icon name="refresh" size={15} /></button>
      <Menu triggerAriaLabel="远程文件管理" triggerLabel={<Icon name="plus" size={16} />} triggerClassName={tw(button)}>
        <MenuItem icon="file" disabled={!root} onPress={() => { if (root) setPrompt({ type: 'file', path: root }) }}>新建文件</MenuItem>
        <MenuItem icon="folderPlus" disabled={!root} onPress={() => { if (root) setPrompt({ type: 'directory', path: root }) }}>新建目录</MenuItem>
        <MenuSeparator />
        <MenuItem icon="file" disabled={!root} onPress={() => { if (root) void perform({ type: 'upload', path: root, directory: false }) }}>上传文件</MenuItem>
        <MenuItem icon="folder" disabled={!root} onPress={() => { if (root) void perform({ type: 'upload', path: root, directory: true }) }}>上传目录</MenuItem>
        <MenuSeparator /><MenuItem checked={showHidden} onPress={() => { setShowHidden(value => !value) }}>显示隐藏文件</MenuItem>
      </Menu>
    </form>
    {message ? <div role="alert" className={tw('flex shrink-0 items-center gap-2 px-3 py-2 text-xs text-[var(--danger)]')}><span className={tw('min-w-0 flex-1 break-words')}>{message}</span><button aria-label="关闭文件提示" className={tw(button)} onClick={() => { setMessage(undefined) }}><Icon name="close" size={14} /></button></div> : null}
    {root ? <FileBrowser absolutePaths mutation={mutation} stateScope={`sftp:${serverId}`} taskId={`sftp:${serverId}`} workspaceLabel={workspaceLabel} rootPath={root} refreshToken={revision} showHidden={showHidden} entryActions={actions} loadDirectory={list} loadDocument={read} saveDocument={save} onAddContext={onAddContext ? reference => { onAddContext({ ...reference, server: { id: serverId, label: workspaceLabel } }) } : undefined} /> : <div className={tw('grid min-h-0 flex-1 place-items-center text-xs text-[var(--text-tertiary)]')}>{busy ? '正在连接 SFTP…' : <button onClick={() => { void navigate(initialPath) }}>重试连接</button>}</div>}
    {visibleJobs.length ? <div aria-label="文件传输任务" className={tw('shrink-0 border-t border-[var(--separator)] px-3 py-1.5')}>
      {visibleJobs.map(job => <div key={job.id} className={tw('flex min-w-0 items-center gap-2 py-1 text-xs')}>
        <Icon name={job.operation === 'download' ? 'download' : job.operation === 'delete' ? 'trash' : 'folder'} size={14} />
        <span className={tw('min-w-0 flex-1 truncate text-[var(--text-secondary)]')} title={job.error ?? job.path}>{job.path.split('/').at(-1)} · {job.phase}{job.error ? `：${job.error}` : ''}</span>
        {job.status === 'running' ? <><span className={tw('shrink-0 text-[var(--text-tertiary)]')}>{sizeLabel(job.bytes)}{job.total ? ` / ${sizeLabel(job.total)}` : ''}</span><button className={tw(button)} aria-label={`取消 ${job.path}`} onClick={() => { void perform({ type: 'cancel', jobId: job.id }) }}><Icon name="close" size={14} /></button></> : <button className={tw(button)} aria-label={`收起 ${job.path} 结果`} onClick={() => { setDismissed(value => [...value, job.id]) }}><Icon name="close" size={14} /></button>}
      </div>)}
    </div> : null}
    {prompt ? <PromptDialog key={`${prompt.type}:${prompt.path}`} open title={prompt.type === 'rename' ? '重命名或移动' : prompt.type === 'extract' ? '解压到新目录' : prompt.type === 'directory' ? '新建目录' : '新建文件'} label={prompt.type === 'rename' || prompt.type === 'extract' ? '完整目标路径' : '名称'} description={prompt.type === 'extract' ? '解压到新目录，不覆盖现有内容。支持 ZIP、TAR、TAR.GZ；压缩包上限 256 MB，解压后上限 512 MB。' : undefined} initialValue={prompt.value} onCancel={() => { setPrompt(undefined) }} onConfirm={async value => {
      if (prompt.type === 'rename' || prompt.type === 'extract') return perform({ type: prompt.type, path: prompt.path, destination: value })
      if (!value || /[\/\\\0\r\n]/u.test(value) || value === '.' || value === '..') return { accepted: false, message: '请输入单个文件或目录名称。' }
      return perform({ type: 'create', path: join(prompt.path, value), directory: prompt.type === 'directory' })
    }} /> : null}
    {deleting ? <Modal.Backdrop isOpen isDismissable={!busy} onOpenChange={(open: boolean) => { if (!open && !busy) setDeleting(undefined) }}><Modal.Container size="sm"><Modal.Dialog>
      <Modal.Header><Modal.Heading>删除{deleting.kind === 'directory' ? '目录' : '文件'}？</Modal.Heading></Modal.Header>
      <Modal.Body><p className={tw('break-all text-sm')}>{deleting.path}</p><p className={tw('text-xs text-[var(--text-secondary)]')}>{deleting.kind === 'directory' ? '会递归删除目录内容，已删除的内容无法恢复。取消只停止后续删除。' : '删除后无法恢复。'}</p></Modal.Body>
      <Modal.Footer><CompactButton variant="ghost" isDisabled={busy} onPress={() => { setDeleting(undefined) }}>取消</CompactButton><CompactButton variant="danger" isPending={busy} onPress={() => { setBusy(true); void perform({ type: 'delete', path: deleting.path, recursive: deleting.kind === 'directory' }).then(result => { setBusy(false); if (result.accepted) setDeleting(undefined) }) }}>删除</CompactButton></Modal.Footer>
    </Modal.Dialog></Modal.Container></Modal.Backdrop> : null}
  </div>
}
