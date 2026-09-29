import { CompactSelect, CompactSwitch, SettingsHeader } from './SettingsControls.js'
import { useEffect, useRef, useState } from 'react'
import { CompactButton as Button } from './SettingsControls.js'
import { CompactInput as Input } from './SettingsControls.js'
import { Label } from '@heroui/react/label'
import { Popover } from '@heroui/react/popover'
import { Menu, MenuItem } from './Menu.js'
import { Modal } from '@heroui/react/modal'
import { TextArea } from '@heroui/react/textarea'
import { TextField } from '@heroui/react/textfield'
import type { LingCommandResult, LingGitFile, LingGitRequest, LingGitResult, LingGitSnapshot, LingReadResult } from '../runtime/contract.js'
import { Icon } from './Icon.js'
import { tw } from './tailwind.js'

type AddWorkspace = (path: string) => Promise<LingCommandResult>
export type GitRequest = (workspaceId: string, request: LingGitRequest) => Promise<LingReadResult<LingGitResult>>
interface GitPreferences { branchPrefix: string; defaultRemote: string; showUntracked: boolean }
const preferenceKey = 'ling.git.preferences'
function readPreferences(): GitPreferences {
  try {
    const value = JSON.parse(localStorage.getItem(preferenceKey) ?? '{}') as Partial<GitPreferences>
    return { branchPrefix: typeof value.branchPrefix === 'string' ? value.branchPrefix : '', defaultRemote: typeof value.defaultRemote === 'string' ? value.defaultRemote : 'origin', showUntracked: value.showUntracked !== false }
  } catch { return { branchPrefix: '', defaultRemote: 'origin', showUntracked: true } }
}

export function GitSettings() {
  const [value, setValue] = useState(readPreferences)
  const [error, setError] = useState('')
  const save = (patch: Partial<GitPreferences>) => {
    const next = { ...value, ...patch }
    try { localStorage.setItem(preferenceKey, JSON.stringify(next)); setValue(next); setError('') }
    catch { setError('无法保存 Git 设置。') }
  }
  return <section aria-label="Git 设置" className={tw('mx-auto w-full max-w-3xl')}>
    <SettingsHeader title="Git" />
    <div className={tw('rounded-xl border border-[var(--panel-border)] bg-[var(--surface)] px-4')}>
      <div className={tw('flex min-h-16 items-center justify-between gap-5 py-3 max-[700px]:flex-wrap')}>
        <div><h2 className={tw('m-0 text-[13px] font-medium')}>分支前缀</h2><p className={tw('mb-0 mt-1 text-xs text-[var(--text-tertiary)]')}>新建分支和 Worktree 时预填的前缀。</p></div>
        <TextField aria-label="新分支前缀" className={tw('w-44 shrink-0')} onChange={(branchPrefix: string) => save({ branchPrefix })} value={value.branchPrefix}><Input className={tw('h-8 min-h-8 rounded-md border border-[var(--panel-border)] bg-[var(--surface)] text-xs shadow-none')} placeholder="例如 feature/" /></TextField>
      </div>
      <div className={tw('flex min-h-16 items-center justify-between gap-5 py-3 max-[700px]:flex-wrap')}>
        <div><h2 className={tw('m-0 text-[13px] font-medium')}>默认推送远程</h2><p className={tw('mb-0 mt-1 text-xs text-[var(--text-tertiary)]')}>首次推送时优先选择；已关联上游的分支沿用原配置。</p></div>
        <TextField aria-label="默认推送远程" className={tw('w-44 shrink-0')} onChange={(defaultRemote: string) => save({ defaultRemote })} value={value.defaultRemote}><Input className={tw('h-8 min-h-8 rounded-md border border-[var(--panel-border)] bg-[var(--surface)] text-xs shadow-none')} placeholder="origin" /></TextField>
      </div>
      <div className={tw('flex min-h-16 items-center justify-between gap-5 py-3')}>
        <div><h2 className={tw('m-0 text-[13px] font-medium')}>显示未跟踪文件</h2><p className={tw('mb-0 mt-1 text-xs text-[var(--text-tertiary)]')}>在审阅中显示尚未加入 Git 的文件。</p></div>
        <CompactSwitch label="显示未跟踪文件" selected={value.showUntracked} onChange={showUntracked => save({ showUntracked })} />
      </div>
    </div>
    {error ? <p role="alert" className={tw('text-sm text-[var(--danger)]')}>{error}</p> : null}
  </section>
}

type Selection = { path: string; staged: boolean }
type Dialog = 'branch' | 'worktree' | 'push' | 'remove' | null
const smallButton = 'h-7 min-w-7 gap-1 rounded-md px-2 text-xs'

export function gitDiffRows(diff: string) {
  const lines = diff.split('\n')
  const hasHunks = lines.some(line => /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.test(line))
  let oldLine = 0
  let newLine = 0
  let inHunk = false
  return lines.flatMap((line, index): { text: string; kind: 'added' | 'deleted' | 'context' | 'note'; old?: number; next?: number }[] => {
    if (index === lines.length - 1 && !line) return []
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
    if (hunk) { oldLine = Number(hunk[1]); newLine = Number(hunk[2]); inHunk = true; return [{ text: line, kind: 'note' }] }
    if (!hasHunks && index === 0 && line.startsWith('新增文件：')) { newLine = 1; inHunk = true; return [] }
    if (!inHunk) return hasHunks ? [] : [{ text: line, kind: 'note' }]
    if (line.startsWith('+')) return [{ text: line.slice(1), kind: 'added', next: newLine++ }]
    if (line.startsWith('-')) return [{ text: line.slice(1), kind: 'deleted', old: oldLine++ }]
    if (line.startsWith(' ')) return [{ text: line.slice(1), kind: 'context', old: oldLine++, next: newLine++ }]
    return [{ text: line, kind: 'note' }]
  })
}

function GitDiff({ diff }: { diff: string }) {
  return <div className={tw('min-w-full w-max')}>{gitDiffRows(diff).map((line, index) => <div className={tw('flex min-h-5 font-mono text-xs leading-5', line.kind === 'added' ? 'bg-[color-mix(in_oklch,var(--success)_8%,transparent)]' : line.kind === 'deleted' ? 'bg-[color-mix(in_oklch,var(--danger)_8%,transparent)]' : line.kind === 'note' ? 'bg-[var(--surface-secondary)] text-[var(--text-tertiary)]' : 'text-[var(--text-secondary)]')} key={index}>
    {line.kind === 'note' ? <span className={tw('whitespace-pre px-3 py-1 text-[11px]')}>{line.text}</span> : <><span aria-hidden="true" className={tw('flex w-17 shrink-0 select-none justify-end gap-2 px-2 text-[10px] tabular-nums text-[var(--text-tertiary)]')}><span className={tw('w-5 text-right')}>{line.old}</span><span className={tw('w-5 text-right')}>{line.next}</span></span><span className={tw('w-4 shrink-0 select-none', line.kind === 'added' ? 'text-[var(--success)]' : 'text-[var(--danger)]')}>{line.kind === 'added' ? '+' : line.kind === 'deleted' ? '−' : ''}</span><span className={tw('whitespace-pre pr-4 text-[var(--foreground)]')}>{line.text || '\u00a0'}</span></>}
  </div>)}</div>
}

export function GitPanel({ workspaceId, request, view = 'review', onChanged, onBusyChange, onAddWorkspace, onSelectWorkspace, onCommit, onReview, onTaskReview }: {
  workspaceId: string; request: GitRequest; onAddWorkspace?: AddWorkspace; onSelectWorkspace?: AddWorkspace; view?: 'review' | 'worktrees' | 'commit'; onCommit?: () => void; onReview?: () => void; onTaskReview?: () => void; onChanged?: (branch: string | null) => void; onBusyChange?: (busy: boolean) => void
}) {
  const [state, setState] = useState<LingGitSnapshot>()
  const [scope, setScope] = useState<'all' | 'unstaged' | 'staged'>('all')
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [selection, setSelection] = useState<Selection>()
  const [diff, setDiff] = useState('')
  const [diffLoading, setDiffLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [dialog, setDialog] = useState<Dialog>(null)
  const [branch, setBranch] = useState('')
  const [newBranch, setNewBranch] = useState(true)
  const [directory, setDirectory] = useState('')
  const [remote, setRemote] = useState('')
  const [removePath, setRemovePath] = useState('')
  const [preferences] = useState(readPreferences)
  const pending = useRef(false)
  const mounted = useRef(true)
  const revision = useRef(0)
  const diffRevision = useRef(0)

  const execute = async (action: LingGitRequest) => {
    if (pending.current) return false
    const mutation = action.type !== 'inspect'
    const version = ++revision.current
    pending.current = true
    if (mutation) { setBusy(true); onBusyChange?.(true); setNotice('') }
    setError('')
    ++diffRevision.current; setSelection(undefined); setDiff(''); setDiffLoading(false)
    try {
      const result = await request(workspaceId, action)
      if (!mounted.current || version !== revision.current) return false
      if (!result.ok) { setError(result.message); return false }
      setState(result.value.snapshot)
      onChanged?.(result.value.snapshot.detached ? `${result.value.snapshot.branch} (detached)` : result.value.snapshot.branch)
      if (result.value.message) setNotice(result.value.message)
      if (mutation) { window.dispatchEvent(new CustomEvent('ling:git-changed', { detail: workspaceId })); ++diffRevision.current; setSelection(undefined); setDiff(''); setDiffLoading(false) }
      return true
    } catch (reason) {
      if (mounted.current) setError(reason instanceof Error ? reason.message : 'Git 操作失败。')
      return false
    } finally {
      pending.current = false
      if (mounted.current && mutation) { setBusy(false); onBusyChange?.(false) }
    }
  }
  useEffect(() => {
    mounted.current = true
    void execute({ type: 'inspect' })
    const refresh = () => { if (!pending.current) void execute({ type: 'inspect' }) }
    const changed = (event: Event) => { if ((event as CustomEvent<string>).detail === workspaceId) refresh() }
    window.addEventListener('ling:git-changed', changed)
    window.addEventListener('focus', refresh)
    return () => { mounted.current = false; ++revision.current; ++diffRevision.current; window.removeEventListener('focus', refresh); window.removeEventListener('ling:git-changed', changed) }
  }, [workspaceId, request])

  const showDiff = async (next: Selection) => {
    if (pending.current) return
    const version = ++diffRevision.current
    setSelection(next); setDiff(''); setDiffLoading(true); setError('')
    try {
      const result = await request(workspaceId, { type: 'diff', ...next })
      if (!mounted.current || version !== diffRevision.current) return
      if (result.ok) setDiff(result.value.diff ?? '')
      else setError(result.message)
    } catch { if (mounted.current && version === diffRevision.current) setError('无法读取差异。') }
    finally { if (mounted.current && version === diffRevision.current) setDiffLoading(false) }
  }
  const addWorkspace = async (path: string, select = false) => {
    const callback = select ? onSelectWorkspace : onAddWorkspace
    if (!callback || pending.current) return
    pending.current = true; setBusy(true); onBusyChange?.(true); setError('')
    try {
      const result = await callback(path)
      if (!mounted.current) return
      if (result.accepted) setNotice(select ? '已切换工作区' : '已添加到侧栏工作区')
      else setError(result.message)
    } catch { if (mounted.current) setError('无法添加工作区。') }
    finally { pending.current = false; if (mounted.current) { setBusy(false); onBusyChange?.(false) } }
  }
  const finish = async (action: LingGitRequest) => {
    if (!await execute(action)) return
    setDialog(null)
    if (action.type === 'worktree-add' && onSelectWorkspace) await addWorkspace(action.path, true)
  }
  const staged = state?.files.filter(file => file.index !== ' ' && file.index !== '?' && !file.conflict) ?? []
  const unstaged = state?.files.filter(file => file.worktree !== ' ' && !file.conflict && (preferences.showUntracked || file.index !== '?')) ?? []
  const conflicts = state?.files.filter(file => file.conflict) ?? []
  const openBranch = (worktree: boolean) => { setNewBranch(true); setBranch(preferences.branchPrefix); setDirectory(''); setError(''); setDialog(worktree ? 'worktree' : 'branch') }
  const matches = (file: LingGitFile) => file.path.toLocaleLowerCase().includes(query.toLocaleLowerCase())
  const fileRow = (file: LingGitFile, staged: boolean) => <div className={tw('group flex min-w-0 items-center gap-1 rounded-md px-1 hover:bg-[var(--surface-hover)]', selection?.path === file.path && selection.staged === staged && 'bg-[var(--surface-tertiary)]')} key={file.path}>
    <button className={tw('flex h-8 min-w-0 flex-1 items-center gap-2 border-0 bg-transparent px-1 text-left text-xs')} onClick={() => { void showDiff({ path: file.path, staged }) }} title={file.originalPath ? `${file.originalPath} → ${file.path}` : file.path} type="button"><span className={tw('w-3 shrink-0 font-mono font-semibold', file.conflict ? 'text-[var(--danger)]' : 'text-[var(--success)]')}>{file.conflict ? '!' : file.index === '?' ? 'U' : staged ? file.index : file.worktree}</span><span className={tw('truncate')}>{file.path}</span></button>
    <Button aria-label={`${staged ? '取消暂存' : '暂存'} ${file.path}`} className={tw('size-6 min-w-6 p-0 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100')} isDisabled={busy} onPress={() => { void execute({ type: staged ? 'unstage' : 'stage', paths: [file.path] }) }} size="sm" variant="ghost"><Icon name={staged ? 'minus' : 'plus'} size={14} /></Button>
  </div>

  return <section aria-label="Git 工作区" className={tw('flex min-h-0 min-w-0 flex-1 flex-col gap-3 text-[var(--foreground)] [container:git/inline-size]')}>
    {view === 'review' ? <div className={tw('flex h-9 shrink-0 items-center gap-1 px-3')}>
      <Menu align="start" triggerAriaLabel="选择改动来源" triggerClassName="h-7 gap-1.5 rounded-md px-2 text-xs" triggerLabel={<>{scope === 'all' ? '未提交' : scope === 'staged' ? '已暂存' : '未暂存'}<Icon name="chevronDown" size={12} /></>}>
        {onTaskReview ? <MenuItem onPress={onTaskReview}>最近一轮</MenuItem> : null}
        <MenuItem onPress={() => setScope('all')}>未提交</MenuItem><MenuItem onPress={() => setScope('unstaged')}>未暂存</MenuItem><MenuItem onPress={() => setScope('staged')}>已暂存</MenuItem>
      </Menu>
      <span className={tw('min-w-0 flex-1 truncate text-xs text-[var(--text-tertiary)] @max-[22rem]/git:invisible')} title={state?.branch ?? ''}>{state?.branch}</span>
      <Button aria-label="刷新 Git 状态" className={tw(smallButton)} isDisabled={busy} onPress={() => { void execute({ type: 'inspect' }) }} size="sm" variant="ghost"><Icon name="refresh" size={14} /></Button>
      <Menu triggerAriaLabel="Git 操作" triggerClassName="size-7 min-w-7 rounded-md p-0" triggerLabel={<Icon name="more" size={15} />}>
        <MenuItem disabled={busy || !state?.remotes.length} icon="refresh" onPress={() => { void execute({ type: 'fetch' }) }}>获取远程更新</MenuItem>
        <MenuItem disabled={busy || !state?.upstream} icon="download" onPress={() => { void execute({ type: 'pull' }) }}>拉取</MenuItem>
      </Menu>
      <Button className={tw(smallButton)} isDisabled={!state?.repository || busy} onPress={onCommit} size="sm" variant="secondary"><Icon name="gitCommit" size={14} />提交或推送</Button>
    </div> : view === 'commit' ? <div className={tw('flex items-center justify-between gap-3')}>
      <span className={tw('text-[13px] text-[var(--text-secondary)]')}>分支</span>
      <button className={tw('flex h-8 max-w-64 items-center gap-2 rounded-md border border-[var(--panel-border)] bg-[var(--surface)] px-2.5 text-xs')} disabled={!state?.repository || busy} onClick={() => openBranch(false)} title="切换或创建分支" type="button"><Icon name="branch" size={14} /><span className={tw('truncate')}>{state?.branch ?? '加载中'}</span><Icon name="chevronDown" size={12} /></button>
    </div> : null}
    {error ? <p role="alert" className={tw('m-0 max-h-28 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-[var(--surface-secondary)] p-3 text-xs text-[var(--danger)]')}>{error}</p> : null}
    {notice || busy ? <p role="status" className={tw('m-0 px-3 text-xs text-[var(--text-secondary)]')}>{busy ? '正在执行 Git 操作…' : notice}</p> : null}
    {!state ? <p className={tw('py-8 text-center text-sm text-[var(--text-tertiary)]')}>{error ? '无法加载 Git 状态' : '正在读取仓库…'}</p> : !state.repository ? <p className={tw('py-8 text-center text-sm text-[var(--text-tertiary)]')}>当前工作区不是 Git 仓库</p> : view === 'commit' ? <>
      <div className={tw('flex items-center justify-between py-2 text-[13px]')}><span>已暂存 {staged.length} 个文件</span><Button className={tw(smallButton)} isDisabled={busy} onPress={onReview} size="sm" variant="ghost">审阅更改<Icon name="external" size={12} /></Button></div>
      {staged.length ? <div className={tw('max-h-24 overflow-auto rounded-lg bg-[var(--surface-secondary)] px-3 py-2')}>{staged.map(file => <div className={tw('truncate py-0.5 text-xs text-[var(--text-secondary)]')} key={file.path} title={file.path}>{file.path}</div>)}</div> : <p className={tw('m-0 text-xs text-[var(--text-tertiary)]')}>尚无已暂存更改</p>}
      <TextField aria-label="提交说明" isDisabled={busy} onChange={setMessage} value={message}><TextArea className={tw('min-h-24 resize-none rounded-lg border border-[var(--panel-border)] bg-[var(--surface)] text-[13px] shadow-none')} placeholder="输入提交信息…" /></TextField>
      {conflicts.length ? <p className={tw('m-0 text-xs text-[var(--danger)]')}>请先解决 {conflicts.length} 个冲突</p> : null}
      <div className={tw('mt-2 flex justify-end gap-2')}>
        <Button className={tw('h-8 rounded-lg px-3 text-[13px]')} isDisabled={busy || !state.remotes.length || state.unborn || state.detached} onPress={() => { setRemote(state.remotes.includes(preferences.defaultRemote) ? preferences.defaultRemote : state.remotes[0] ?? ''); setDialog('push') }} size="sm" variant="secondary">推送{state.upstream && state.ahead ? ` · ${state.ahead}` : ''}</Button>
        <Button className={tw('h-8 rounded-lg px-4 text-[13px]')} isDisabled={busy || !staged.length || !!conflicts.length || !message.trim()} onPress={() => { void execute({ type: 'commit', message }).then(ok => { if (ok) setMessage('') }) }} size="sm"><Icon name="gitCommit" size={14} />提交</Button>
      </div>
    </> : view === 'review' ? <div className={tw('grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_11rem] overflow-hidden @max-[26rem]/git:grid-cols-1 @max-[26rem]/git:grid-rows-[auto_minmax(0,1fr)]')}>
      <div className={tw('flex min-h-0 min-w-0 flex-col @max-[26rem]/git:row-start-2')}>
        {selection ? <div className={tw('flex h-8 shrink-0 items-center gap-2 px-4 text-xs text-[var(--text-secondary)]')}><Icon name="file" size={13} /><span className={tw('truncate')} title={selection.path}>{selection.path}</span></div> : null}
        <div aria-label="Git 差异" className={tw('min-h-0 flex-1 overflow-auto py-2 font-mono text-xs leading-5')}>
          {selection ? diffLoading ? '正在读取差异…' : <GitDiff diff={diff} /> : <div className={tw('flex h-full min-h-36 flex-col items-center justify-center gap-3 text-[var(--text-tertiary)]')}><Icon name="review" size={28} /><span className={tw('font-sans text-xs')}>{state.files.length ? '选择文件查看差异' : '没有未提交的更改'}</span></div>}
        </div>
      </div>
      <div className={tw('flex min-h-0 min-w-0 flex-col gap-2 border-l border-[var(--panel-border)] px-2 @max-[26rem]/git:max-h-44 @max-[26rem]/git:border-l-0')}>
        <TextField aria-label="筛选更改文件" onChange={setQuery} value={query}><Input className={tw('h-7 min-h-7 rounded-md border border-[var(--panel-border)] bg-[var(--surface)] px-2 text-xs shadow-none')} placeholder="筛选文件…" /></TextField>
        <div className={tw('min-h-0 flex-1 overflow-auto pb-3')}>
          {conflicts.length ? <><h3 className={tw('my-2 text-xs font-medium text-[var(--danger)]')}>冲突 · {conflicts.length}</h3>{conflicts.filter(matches).map(file => fileRow(file, false))}</> : null}
          {[{ title: '已暂存', files: staged, staged: true }, { title: '未暂存', files: unstaged, staged: false }].filter(group => scope === 'all' || (scope === 'staged') === group.staged).map(group => <div key={group.title}>
            <div className={tw('mb-1 mt-2 flex h-6 items-center justify-between gap-1')}><h3 className={tw('m-0 text-xs font-normal text-[var(--text-tertiary)]')}>{group.title} · {group.files.length}</h3><Button aria-label={group.staged ? '全部取消暂存' : '全部暂存'} className={tw('size-6 min-w-6 rounded-md p-0')} isDisabled={busy || !group.files.length} onPress={() => { void execute({ type: group.staged ? 'unstage' : 'stage', paths: group.files.map(file => file.path) }) }} size="sm" variant="ghost"><Icon name={group.staged ? 'minus' : 'plus'} size={13} /></Button></div>{group.files.filter(matches).map(file => fileRow(file, group.staged))}
          </div>)}
        </div>
      </div>
    </div> : <div className={tw('min-h-0 flex-1')}>
      <div className={tw('mb-3 flex items-center justify-between')}><h2 className={tw('m-0 text-[13px] font-normal text-[var(--text-tertiary)]')}>工作树 · {state.worktrees.length}</h2><div className={tw('flex gap-1')}><Button aria-label="刷新 Git 状态" className={tw(smallButton)} isDisabled={busy} onPress={() => { void execute({ type: 'inspect' }) }} size="sm" variant="ghost"><Icon name="refresh" size={14} /></Button><Button className={tw(smallButton)} isDisabled={busy || state.unborn} onPress={() => openBranch(true)} size="sm" variant="secondary"><Icon name="plus" size={14} />新建 Worktree</Button></div></div>
      <div className={tw('rounded-xl border border-[var(--panel-border)] px-4')}>
        {state.worktrees.map(tree => <div className={tw('group flex min-h-16 items-center gap-3 border-b border-dashed border-[var(--panel-border)] py-4 last:border-b-0')} key={tree.path}>
          <Icon className={tw('shrink-0 text-[var(--text-secondary)]')} name="branch" size={16} /><div className={tw('min-w-0 flex-1')}><div className={tw('flex flex-wrap items-center gap-2 text-sm')}><strong className={tw('truncate font-medium')}>{tree.branch ?? tree.head.slice(0, 8)}</strong><span className={tw('text-xs text-[var(--text-tertiary)]')}>{tree.main ? '主工作区' : tree.path === state.root ? '当前工作区' : tree.locked ? '已锁定' : tree.prunable ? '目录不可用' : ''}</span></div><p className={tw('mb-0 mt-1 truncate text-xs text-[var(--text-tertiary)]')} title={tree.path}>{tree.path}</p></div>
          {onSelectWorkspace ? <Button className={tw(smallButton)} isDisabled={busy || tree.prunable || tree.path === state.root} onPress={() => { void addWorkspace(tree.path, true) }} size="sm" variant="secondary">{tree.path === state.root ? '当前目录' : '使用此目录'}</Button> : null}
          {onAddWorkspace ? <Button className={tw(smallButton, 'text-[var(--text-secondary)]')} isDisabled={busy || tree.prunable} onPress={() => { void addWorkspace(tree.path) }} size="sm" variant="ghost">添加到侧栏</Button> : null}
          <Button aria-label={`打开 ${tree.path}`} className={tw(smallButton, 'text-[var(--text-secondary)]')} isDisabled={busy || tree.prunable} onPress={() => { void execute({ type: 'worktree-open', path: tree.path }) }} size="sm" variant="ghost"><Icon name="folderOpen" size={14} /></Button>
          <Button aria-label={`移除 ${tree.path}`} className={tw(smallButton)} isDisabled={busy || tree.main || tree.path === state.root || tree.locked || tree.prunable} onPress={() => { setRemovePath(tree.path); setDialog('remove') }} size="sm" variant="ghost"><Icon name="trash" size={14} /></Button>
        </div>)}
      </div>
    </div>}
    <Modal.Backdrop isOpen={dialog !== null} onOpenChange={(open: boolean) => { if (!open && !busy) setDialog(null) }}><Modal.Container size="sm"><Modal.Dialog className={tw("gap-4 rounded-2xl p-5")}>
      {!busy ? <Modal.CloseTrigger /> : null}<Modal.Header><Modal.Heading className={tw("text-base font-semibold")}>{dialog === 'branch' ? '切换或创建分支' : dialog === 'worktree' ? '新建 Worktree' : dialog === 'push' ? '推送提交' : '移除 Worktree'}</Modal.Heading></Modal.Header>
      <Modal.Body className={tw('gap-4')}>
        {dialog === 'branch' || dialog === 'worktree' ? <>
          <div className={tw('flex gap-2')}><Button className={tw(smallButton)} isDisabled={busy} onPress={() => { setNewBranch(true); setBranch(preferences.branchPrefix) }} size="sm" variant={newBranch ? 'secondary' : 'ghost'}>新分支</Button><Button className={tw(smallButton)} isDisabled={busy || !state?.branches.length} onPress={() => { setNewBranch(false); setBranch(state?.branches[0] ?? '') }} size="sm" variant={!newBranch ? 'secondary' : 'ghost'}>已有分支</Button></div>
          {newBranch ? <TextField autoFocus isDisabled={busy} onChange={setBranch} value={branch}><Label>分支名称</Label><Input placeholder="feature/my-change" /></TextField> : <div className={tw('grid gap-2 text-xs')}>分支<CompactSelect label="分支" className={tw('w-full')} disabled={busy} onChange={setBranch} value={branch} options={(state?.branches ?? []).map(name => ({ value: name, label: name }))} /></div>}
          {dialog === 'worktree' ? <TextField isDisabled={busy} onChange={setDirectory} value={directory}><Label>新工作树目录</Label><Input placeholder="输入工作区之外的完整路径" /></TextField> : null}
        </> : dialog === 'push' ? <><p className={tw('m-0 text-sm')}>{state?.branch} → {state?.upstream ?? `${remote}/${state?.branch}`}</p><p className={tw('m-0 text-xs text-[var(--text-secondary)]')}>{state?.upstream ? `${state.ahead} 个本地领先提交` : '首次推送会关联上游分支。'}</p>{!state?.upstream ? <div className={tw('grid gap-2 text-xs')}>远程<CompactSelect label="远程" className={tw('w-full')} disabled={busy} onChange={setRemote} value={remote} options={(state?.remotes ?? []).map(name => ({ value: name, label: name }))} /></div> : null}</> : <><p className={tw('m-0 break-all text-sm')}>{removePath}</p><p className={tw('m-0 text-xs text-[var(--text-secondary)]')}>删除工作树目录并保留分支。有未提交文件时，Git 会阻止移除。</p></>}
        {error ? <p role="alert" className={tw('m-0 max-h-32 overflow-auto whitespace-pre-wrap break-words text-xs text-[var(--danger)]')}>{error}</p> : null}
      </Modal.Body><Modal.Footer className={tw("gap-2")}><Button isDisabled={busy} onPress={() => setDialog(null)} variant="ghost">取消</Button><Button isDisabled={busy || ((dialog === 'branch' || dialog === 'worktree') && !branch.trim()) || (dialog === 'worktree' && !directory.trim())} onPress={() => {
        if (dialog === 'branch') void finish({ type: newBranch ? 'create-branch' : 'switch', branch })
        if (dialog === 'worktree') void finish({ type: 'worktree-add', path: directory, branch, newBranch })
        if (dialog === 'push') void finish({ type: 'push', remote })
        if (dialog === 'remove') void finish({ type: 'worktree-remove', path: removePath })
      }} variant={dialog === 'remove' ? 'danger' : 'primary'}>{busy ? '执行中…' : dialog === 'push' ? '推送' : dialog === 'remove' ? '移除' : dialog === 'branch' && !newBranch ? '切换' : '创建'}</Button></Modal.Footer>
    </Modal.Dialog></Modal.Container></Modal.Backdrop>
  </section>
}

export function GitDialog({ workspaceId, request, onClose, onChanged, onAddWorkspace, onReview }: { workspaceId: string; request: GitRequest; onAddWorkspace?: AddWorkspace; onReview: () => void; onClose: () => void; onChanged: (branch: string | null) => void }) {
  const [busy, setBusy] = useState(false)
  return <Modal.Backdrop isOpen onOpenChange={(open: boolean) => { if (!open && !busy) onClose() }}><Modal.Container size="sm"><Modal.Dialog className={tw('w-[min(27rem,94vw)] max-w-none')}>
    {!busy ? <Modal.CloseTrigger /> : null}<Modal.Header><Modal.Heading className={tw("text-base font-semibold")}>提交或推送</Modal.Heading></Modal.Header><Modal.Body className={tw('flex min-h-0 flex-1 flex-col overflow-auto')}><GitPanel view="commit" onReview={() => { onClose(); onReview() }} onAddWorkspace={onAddWorkspace} onBusyChange={setBusy} onChanged={onChanged} request={request} workspaceId={workspaceId} /></Modal.Body>
  </Modal.Dialog></Modal.Container></Modal.Backdrop>
}

export function GitBranchMenu({ workspaceId, branch, request, onChanged, onReview, onCommit, onWorktrees }: {
  workspaceId: string; branch: string | null; request: GitRequest; onChanged: (branch: string | null) => void; onReview: () => void; onCommit: () => void; onWorktrees: () => void
}) {
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<LingGitSnapshot>()
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const pending = useRef(false)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => {
    if (!open) return
    let cancelled = false
    setState(undefined); setQuery(''); setCreating(false); setError('')
    void request(workspaceId, { type: 'inspect' }).then(result => {
      if (cancelled) return
      if (result.ok) setState(result.value.snapshot)
      else setError(result.message)
    }).catch(() => { if (!cancelled) setError('无法读取分支。') })
    return () => { cancelled = true }
  }, [open, workspaceId, request])
  const switchBranch = async (action: 'switch' | 'create-branch', branch: string) => {
    if (pending.current) return
    pending.current = true; setBusy(true); setError('')
    try {
      const result = await request(workspaceId, { type: action, branch })
      if (!mounted.current) return
      if (!result.ok) { setError(result.message); return }
      onChanged(result.value.snapshot.branch)
      window.dispatchEvent(new CustomEvent('ling:git-changed', { detail: workspaceId }))
      setOpen(false)
    } catch (reason) { if (mounted.current) setError(reason instanceof Error ? reason.message : '无法切换分支。') }
    finally { pending.current = false; if (mounted.current) setBusy(false) }
  }
  const navigate = (callback: () => void) => { setOpen(false); callback() }
  const row = 'flex h-8 w-full min-w-0 items-center justify-start gap-2 rounded-md px-2 text-xs font-normal text-[var(--text-secondary)]'
  return <Popover isOpen={open} onOpenChange={(value: boolean) => { if (!busy) setOpen(value) }}>
    <Button aria-label={`当前分支：${branch ?? '未初始化'}`} className={tw('h-6 min-w-0 max-w-[35%] shrink gap-1.5 rounded-md px-0.5 text-xs text-[var(--text-secondary)]')} size="sm" variant="ghost"><Icon name="branch" size={14} /><span className={tw('truncate font-semibold text-[var(--foreground)]')}>{branch ?? 'Git'}</span><Icon name="chevronDown" size={11} /></Button>
    <Popover.Content className={tw('w-64 max-w-[calc(100vw-1.5rem)] rounded-xl border border-[var(--panel-border)] bg-[var(--surface)] p-1.5 shadow-[0_8px_28px_rgb(0_0_0_/_0.12)]')} offset={8} placement="top start">
      <Popover.Dialog aria-label="分支与更改" className={tw('p-0')}>
        {creating ? <form className={tw('grid gap-2 p-1')} onSubmit={event => { event.preventDefault(); if (name.trim()) void switchBranch('create-branch', name.trim()) }}>
          <TextField autoFocus aria-label="新分支名称" isDisabled={busy} onChange={setName} value={name}><Input className={tw('h-8 min-h-8 rounded-md border border-[var(--panel-border)] bg-[var(--surface)] px-2 text-xs shadow-none')} placeholder="分支名称" /></TextField>
          <div className={tw('flex justify-end gap-1')}><Button className={tw(smallButton)} isDisabled={busy} onPress={() => setCreating(false)} size="sm" variant="ghost">取消</Button><Button className={tw(smallButton)} isDisabled={busy || !name.trim()} size="sm" type="submit">创建并切换</Button></div>
        </form> : <>
          <TextField aria-label="搜索分支" onChange={setQuery} value={query}><Input className={tw('h-8 min-h-8 rounded-md border-0 bg-[var(--surface-secondary)] px-2 text-xs shadow-none')} placeholder="搜索分支…" /></TextField>
          <div className={tw('max-h-48 overflow-auto py-1')}>
            {state?.branches.filter(value => value.toLocaleLowerCase().includes(query.toLocaleLowerCase())).map(value => <Button aria-label={`切换到 ${value}`} className={tw(row, value === state.branch && 'bg-[var(--surface-secondary)] text-[var(--foreground)]')} aria-pressed={value === state.branch} isDisabled={busy} key={value} onPress={() => { if (value !== state.branch) void switchBranch('switch', value) }} size="sm" variant="ghost"><Icon name="branch" size={14} /><span className={tw('min-w-0 flex-1 truncate text-left')}>{value}</span>{value === state.branch ? <Icon name="check" size={13} /> : null}</Button>)}
            {!state && !error ? <p className={tw('px-2 text-xs text-[var(--text-tertiary)]')}>正在读取分支…</p> : state && !state.branches.length ? <p className={tw('px-2 text-xs text-[var(--text-tertiary)]')}>{state.repository ? '首次提交后可创建分支' : '当前工作区不是 Git 仓库'}</p> : null}
          </div>
          <Button className={tw(row)} isDisabled={busy || !state?.repository || state.unborn} onPress={() => { setName(readPreferences().branchPrefix); setCreating(true) }} size="sm" variant="ghost"><Icon name="plus" size={14} />新建分支</Button>
        </>}
        {busy ? <p role="status" className={tw('px-2 text-xs text-[var(--text-tertiary)]')}>正在切换分支…</p> : null}
        {error ? <p role="alert" className={tw('max-h-28 overflow-auto whitespace-pre-wrap break-words px-2 text-xs text-[var(--danger)]')}>{error}</p> : null}
        <div className={tw('mt-1 border-t border-[var(--panel-border)] pt-1')}>
          <Button className={tw(row)} isDisabled={busy} onPress={() => navigate(onReview)} size="sm" variant="ghost"><Icon name="review" size={14} />审阅更改</Button>
          <Button className={tw(row)} isDisabled={busy} onPress={() => navigate(onCommit)} size="sm" variant="ghost"><Icon name="gitCommit" size={14} />提交或推送</Button>
          <Button className={tw(row)} isDisabled={busy} onPress={() => navigate(onWorktrees)} size="sm" variant="ghost"><Icon name="branch" size={14} />管理 Worktrees</Button>
        </div>
      </Popover.Dialog>
    </Popover.Content>
  </Popover>
}
