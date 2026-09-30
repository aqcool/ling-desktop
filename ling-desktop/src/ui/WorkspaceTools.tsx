import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Button } from '@heroui/react/button'
import { Input } from '@heroui/react/input'
import { Label } from '@heroui/react/label'
import { Modal } from '@heroui/react/modal'
import { TextField } from '@heroui/react/textfield'
import type { LingReadResult, LingWorkspaceToolRequest, LingWorkspaceTools } from '../runtime/contract.js'
import { Icon, type IconName } from './Icon.js'
import { Menu, MenuItem, MenuSeparator } from './Menu.js'
import { tw } from './tailwind.js'

export type WorkspaceToolsRequest = (workspaceId: string, request: LingWorkspaceToolRequest) => Promise<LingReadResult<LingWorkspaceTools>>

export function useWorkspaceTools(workspaceId: string | undefined, request?: WorkspaceToolsRequest) {
  const [state, setState] = useState<{ workspaceId: string; value: LingWorkspaceTools }>()
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const revision = useRef(0)
  const pending = useRef(false)
  const currentWorkspace = useRef(workspaceId)
  currentWorkspace.current = workspaceId
  const execute = async (action: LingWorkspaceToolRequest) => {
    if (!workspaceId || !request || (pending.current && action.type === 'inspect')) return false
    const version = ++revision.current
    const mutation = action.type !== 'inspect'
    if (mutation) { pending.current = true; setBusy(true); setError(undefined) }
    try {
      const result = await request(workspaceId, action)
      if (currentWorkspace.current !== workspaceId || revision.current !== version) return false
      if (result.ok) { setState({ workspaceId, value: result.value }); return true }
      if (mutation) setError(result.message)
      return false
    } catch {
      if (mutation && currentWorkspace.current === workspaceId) setError('操作失败，请重试。')
      return false
    } finally { if (mutation) { pending.current = false; setBusy(false) } }
  }
  useEffect(() => {
    setError(undefined)
    let disposed = false
    let timer: number
    const refresh = async () => {
      if (document.visibilityState !== 'hidden') await execute({ type: 'inspect' })
      if (!disposed) timer = window.setTimeout(() => { void refresh() }, 1500)
    }
    void refresh()
    return () => { disposed = true; ++revision.current; window.clearTimeout(timer) }
  }, [workspaceId, request])
  return { snapshot: state && state.workspaceId === workspaceId ? state.value : undefined, error, busy, execute }
}

const actionIcons = ['play', 'terminalSquare', 'code', 'branch', 'review', 'package', 'shield', 'book'] as const
interface SavedAction { id: string; name: string; command: string; icon: IconName }
interface SavedTools { applications?: string; selected?: string; actions: SavedAction[] }
function readSaved(key: string): SavedTools {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? '{}') as SavedTools
    return { applications: parsed.applications, selected: parsed.selected, actions: Array.isArray(parsed.actions) ? parsed.actions.filter(action => typeof action.id === 'string' && typeof action.name === 'string' && typeof action.command === 'string').map(action => ({ ...action, icon: actionIcons.includes(action.icon as typeof actionIcons[number]) ? action.icon : 'play' as IconName })).slice(0, 20) : [] }
  } catch { return { actions: [] } }
}

export function WorkspaceToolsToolbar({ workspaceId, tools, onRun }: {
  workspaceId: string; tools: ReturnType<typeof useWorkspaceTools>; onRun: () => void
}) {
  const storageKey = `ling.workspace-tools.${workspaceId}`
  const [saved, setSaved] = useState(() => readSaved(storageKey))
  const [editor, setEditor] = useState<SavedAction>()
  const [editing, setEditing] = useState(false)
  const [managing, setManaging] = useState(false)
  const [error, setError] = useState<string>()
  const applications = tools.snapshot?.applications ?? []
  const application = applications.find(item => item.id === saved.applications) ?? applications[0]
  const primary = saved.actions.find(action => action.id === saved.selected) ?? saved.actions[0]
  const save = (next: SavedTools) => {
    try { localStorage.setItem(storageKey, JSON.stringify(next)); setSaved(next); setError(undefined); return true }
    catch { setError('无法保存工作区操作。'); return false }
  }
  const edit = (action?: SavedAction) => {
    setEditor(action ?? { id: crypto.randomUUID(), name: '', command: '', icon: 'play' })
    setEditing(true); setError(undefined)
  }
  const run = async (action: SavedAction) => {
    if (tools.busy) return
    if (await tools.execute({ type: 'run', name: action.name, command: action.command })) {
      save({ ...saved, selected: action.id }); onRun()
    }
  }
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!editor?.name.trim() || !editor.command.trim()) { setError('请输入名称和命令。'); return }
    const action = { ...editor, name: editor.name.trim(), command: editor.command.trim() }
    const actions = saved.actions.some(item => item.id === action.id) ? saved.actions.map(item => item.id === action.id ? action : item) : [...saved.actions, action]
    if (save({ ...saved, actions })) setEditing(false)
  }
  const split = "flex h-6.5 shrink-0 items-center rounded-lg border border-[var(--panel-border)] bg-[var(--surface)] shadow-[var(--overlay-shadow)]"
  const actionButton = "inline-flex h-full min-w-0 items-center justify-center gap-1.5 rounded-l-lg border-0 bg-transparent px-2 text-compact font-medium text-[var(--foreground)] hover:bg-[var(--surface-hover)] disabled:opacity-45"
  const trigger = "h-control-xs w-6 min-w-0 rounded-l-none rounded-r-lg p-0 text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"
  const applicationIcon = (app: typeof application) => app?.icon ? <img alt="" className={tw('size-4 shrink-0 object-contain')} src={app.icon} /> : <Icon name="folderOpen" size={16} />
  return <>
    <div className={tw('relative flex shrink-0 items-center gap-2 [-webkit-app-region:no-drag]')}>
      {application ? <div aria-label="打开工作区" className={tw(split)}>
        <button aria-label={`用 ${application.name} 打开工作区`} className={tw(actionButton, 'w-8 px-1.5')} disabled={tools.busy} onClick={() => { void tools.execute({ type: 'open', applicationId: application.id }) }} title={`用 ${application.name} 打开工作区`} type="button">{applicationIcon(application)}</button>
        <span className={tw('h-3.5 w-px bg-[var(--panel-border)]')} />
        <Menu align="end" triggerAriaLabel="选择打开应用" triggerClassName={trigger} triggerLabel={<Icon name="chevronDown" size={12} />} listClassName="min-w-40 p-1">
          {applications.map(item => <button aria-checked={item.id === application.id} className={tw("flex h-control-lg w-full items-center gap-2 rounded-md border-0 bg-transparent px-2 text-left text-compact hover:bg-[var(--surface-hover)] focus-visible:bg-[var(--surface-hover)]")} key={item.id} onClick={() => { save({ ...saved, applications: item.id }); void tools.execute({ type: 'open', applicationId: item.id }) }} role="menuitemradio" type="button">
            {applicationIcon(item)}<span className={tw('flex-1')}>{item.name}</span>{item.id === application.id ? <Icon name="check" size={14} /> : null}
          </button>)}
        </Menu>
      </div> : null}
      {primary ? <div aria-label="工作区命令" className={tw(split)}>
        <button aria-label={`运行 ${primary.name}`} className={tw(actionButton, 'max-w-36 pr-1.5')} disabled={tools.busy} onClick={() => { void run(primary) }} title={primary.command} type="button"><Icon name={primary.icon} size={14} /><span className={tw('truncate')}>{primary.name}</span></button>
        <span className={tw('h-3.5 w-px bg-[var(--panel-border)]')} />
        <Menu triggerAriaLabel="工作区命令菜单" triggerClassName={trigger} triggerLabel={<Icon name="chevronDown" size={12} />}>
          {saved.actions.map(action => <MenuItem disabled={tools.busy} icon={action.icon} key={action.id} onPress={() => { void run(action) }}>{action.name}</MenuItem>)}
          <MenuSeparator />
          <MenuItem icon="settings" onPress={() => { setManaging(true) }}>管理 Action</MenuItem>
          <MenuItem disabled={saved.actions.length >= 20} icon="plus" onPress={() => { edit() }}>添加 Action</MenuItem>
        </Menu>
      </div> : <button aria-label="添加工作区命令" className={tw('grid size-6.5 place-items-center rounded-md border-0 bg-transparent text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]')} onClick={() => { edit() }} title="添加 Action" type="button"><Icon name="bolt" size={16} /></button>}
      {tools.error || (!editing && error) ? <div className={tw('absolute top-full right-0 z-30 mt-2 w-64 rounded-lg border border-[var(--panel-border)] bg-[var(--surface)] p-3 text-xs text-[var(--danger)] shadow-lg')} role="alert">{tools.error ?? error}</div> : null}
    </div>
    <Modal.Backdrop isOpen={editing} onOpenChange={setEditing}>
      <Modal.Container size="sm"><Modal.Dialog><Modal.CloseTrigger /><Modal.Header><Modal.Heading>{saved.actions.some(item => item.id === editor?.id) ? '编辑 Action' : '添加 Action'}</Modal.Heading></Modal.Header>
        <form onSubmit={submit}><Modal.Body className={tw('gap-4')}>
          <TextField autoFocus isRequired maxLength={120} onChange={(name: string) => { if (editor) setEditor({ ...editor, name }) }} value={editor?.name ?? ''}><Label>名称</Label><Input placeholder="开发模式启动" /></TextField>
          <div><span className={tw('mb-2 block text-sm')}>图标</span><div aria-label="命令图标" className={tw('flex gap-1')} role="group">{actionIcons.map(icon => <button aria-label={icon} aria-pressed={editor?.icon === icon} className={tw("grid size-control place-items-center rounded-md border border-transparent bg-transparent text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] aria-pressed:border-[var(--panel-border)] aria-pressed:bg-[var(--surface-tertiary)] aria-pressed:text-[var(--foreground)]")} key={icon} onClick={() => { if (editor) setEditor({ ...editor, icon }) }} type="button"><Icon name={icon} size={16} /></button>)}</div></div>
          <TextField isRequired onChange={(command: string) => { if (editor) setEditor({ ...editor, command }) }} value={editor?.command ?? ''}><Label>命令</Label><Input className={tw('font-mono text-sm')} placeholder="npm run dev" /></TextField>
          {error ? <p className={tw('m-0 text-xs text-[var(--danger)]')} role="alert">{error}</p> : null}
        </Modal.Body><Modal.Footer>
          {saved.actions.some(item => item.id === editor?.id) ? <Button className={tw('mr-auto')} onPress={() => { if (save({ ...saved, actions: saved.actions.filter(item => item.id !== editor?.id) })) setEditing(false) }} variant="danger">删除</Button> : null}
          <Button onPress={() => { setEditing(false) }} variant="ghost">取消</Button><Button type="submit">保存</Button>
        </Modal.Footer></form>
      </Modal.Dialog></Modal.Container>
    </Modal.Backdrop>
    <Modal.Backdrop isOpen={managing} onOpenChange={setManaging}><Modal.Container size="sm"><Modal.Dialog><Modal.CloseTrigger /><Modal.Header><Modal.Heading>管理 Action</Modal.Heading></Modal.Header><Modal.Body>{saved.actions.map(action => <button className={tw('flex w-full items-center gap-2 rounded-lg border-0 bg-transparent p-2 text-left hover:bg-[var(--surface-hover)]')} key={action.id} onClick={() => { setManaging(false); edit(action) }} type="button"><Icon name={action.icon} size={16} /><span className={tw('min-w-0 flex-1 truncate')}>{action.name}</span><Icon name="edit" size={14} /></button>)}</Modal.Body></Modal.Dialog></Modal.Container></Modal.Backdrop>
  </>
}

export function WorkspaceActionOutput({ tools, onClose, onShowTerminals }: { tools: ReturnType<typeof useWorkspaceTools>; onClose: () => void; onShowTerminals: () => void }) {
  const runs = tools.snapshot?.runs ?? []
  const [selected, setSelected] = useState<string>()
  const lastId = runs.at(-1)?.id
  useEffect(() => { setSelected(lastId) }, [lastId])
  const run = runs.find(item => item.id === selected) ?? runs.at(-1)
  const output = useRef<HTMLPreElement>(null)
  const follow = useRef(true)
  useEffect(() => { if (output.current && follow.current) output.current.scrollTop = output.current.scrollHeight }, [run?.output])
  return <section aria-label="工作区命令输出" className={tw('flex min-h-0 flex-1 flex-col')}>
    <div className={tw("flex h-control-lg shrink-0 items-center gap-1 px-2")}>
      <div aria-label="命令终端" className={tw('flex min-w-0 flex-1 gap-1 overflow-x-auto [scrollbar-width:none]')} role="tablist">{runs.map(item => <button aria-selected={run?.id === item.id} className={tw("flex h-control-sm max-w-44 shrink-0 items-center gap-1.5 rounded-md border-0 bg-transparent px-2 text-xs text-[var(--text-secondary)] aria-selected:bg-[var(--surface-tertiary)] aria-selected:text-[var(--foreground)]")} key={item.id} onClick={() => { follow.current = true; setSelected(item.id) }} role="tab" type="button"><Icon name="terminal" size={13} /><span className={tw('truncate')}>{item.name}</span></button>)}</div>
      {run?.running ? <button aria-label="停止命令" className={tw("grid size-control-sm place-items-center rounded-md border-0 bg-transparent hover:bg-[var(--surface-hover)]")} onClick={() => { void tools.execute({ type: 'stop', runId: run.id }) }} type="button"><Icon name="stop" size={14} /></button> : run ? <span className={tw('px-2 text-xs text-[var(--text-tertiary)]')}>{run.exitCode === 0 ? '已完成' : `已退出 ${run.exitCode ?? ''}`}</span> : null}
      <button aria-label="查看终端" className={tw("grid size-control-sm place-items-center rounded-md border-0 bg-transparent hover:bg-[var(--surface-hover)]")} onClick={onShowTerminals} type="button"><Icon name="terminalSquare" size={14} /></button>
      <button aria-label="关闭终端面板" className={tw("grid size-control-sm place-items-center rounded-md border-0 bg-transparent hover:bg-[var(--surface-hover)]")} onClick={onClose} type="button"><Icon name="close" size={16} /></button>
    </div>
    <pre className={tw("m-0 min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-all px-4 py-2 font-mono text-compact leading-5")} onScroll={event => { const node = event.currentTarget; follow.current = node.scrollHeight - node.scrollTop - node.clientHeight < 40 }} ref={output}>{run ? `$ ${run.command}\n${run.output.replace(/\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\))/gu, '')}` : ''}</pre>
  </section>
}
