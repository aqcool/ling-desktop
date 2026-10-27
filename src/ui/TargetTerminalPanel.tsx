import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Button } from '@heroui/react/button'
import { Dropdown } from '@heroui/react/dropdown'
import { Label } from '@heroui/react/label'
import type { LingReadResult, LingTerminalPanel, LingTerminalService } from '../runtime/contract.js'
import type { LingServer, LingServerService, LingServerTerminalScope, LingTerminalTarget } from '../runtime/servers.js'
import { terminalMode, updateAppearance, useAppearance } from '../theme.js'
import { Icon } from './Icon.js'
import { ServerTerminalScreen } from './ServerTerminalPanel.js'
import { TerminalBody, TerminalNameEditor } from './TerminalPanel.js'
import { initializeServerTerminals, resolveServerTerminalScope } from './server-terminal-initialization.js'
import { tw } from './tailwind.js'

interface TargetContext {
  readonly taskId?: string
  readonly workspaceId?: string
  readonly servers: readonly LingServer[]
  readonly serverIds: readonly string[]
}
interface LocalOwner {
  readonly kind: 'local'
  readonly key: string
  readonly panel: LingTerminalPanel
  readonly workspaceId?: string
}
interface ServerOwner {
  readonly kind: 'server'
  readonly key: string
  readonly ownerId: string
  readonly serverId: string
}
export interface TargetTerminalTab {
  readonly id: string
  readonly terminalId: string
  readonly target: LingTerminalTarget
  readonly targetLabel: string
  readonly title: string
  readonly cwd?: string
  readonly owner: LocalOwner | ServerOwner
}
interface TargetTerminalState {
  readonly tabs: readonly TargetTerminalTab[]
  readonly selectedId?: string
  readonly pending: number
  readonly error?: string
}
interface LocalEntry extends LocalOwner { readonly targetLabel: string }
interface ServerEntry {
  readonly kind: 'server'
  readonly key: string
  readonly request: LingServerTerminalScope
  readonly targetLabel: string
  ownerId?: string
}
type TargetEntry = LocalEntry | ServerEntry

/** Captured owners outlive React views; changing task or menu selection never rebinds a shell. */
export class TargetTerminalModel {
  private state: TargetTerminalState = { tabs: [], pending: 0 }
  private readonly listeners = new Set<() => void>()
  private readonly entries = new Map<string, TargetEntry>()
  private readonly pending = new Map<string, Promise<string | undefined>>()
  private readonly closing = new Map<string, Promise<void>>()
  private readonly dismissed = new Set<string>()
  private readonly recent = new Map<string, string>()
  private readonly requests = new WeakSet<LingTerminalTarget>()
  private intent = 0
  constructor(readonly localService: LingTerminalService | undefined, readonly serverService: LingServerService | undefined, readonly placement: 'side' | 'bottom') {}
  getSnapshot = (): TargetTerminalState => this.state
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private publish(patch: Partial<TargetTerminalState>) {
    const next = { ...this.state, ...patch }
    if (!next.tabs.some(tab => tab.id === next.selectedId)) next.selectedId = next.tabs.at(-1)?.id
    this.state = next
    for (const listener of this.listeners) listener()
  }
  select(id: string) {
    const tab = this.state.tabs.find(item => item.id === id)
    if (!tab) return
    this.intent++
    this.recent.set(tab.owner.key, id)
    this.publish({ selectedId: id })
  }
  private preferred(key: string) {
    const tabs = this.state.tabs.filter(tab => tab.owner.key === key)
    return tabs.find(tab => tab.id === this.recent.get(key))?.id ?? tabs.at(-1)?.id
  }
  private syncLocal(entry: LocalEntry) {
    const terminals = entry.panel.getSnapshot().terminals
    const current = new Map(terminals.map(terminal => [terminal.terminalId, terminal]))
    const seen = new Set<string>()
    const project = (terminal: typeof terminals[number]): TargetTerminalTab => ({
      id: JSON.stringify([entry.key, terminal.terminalId]), terminalId: terminal.terminalId,
      target: { kind: 'local' }, targetLabel: entry.targetLabel, title: terminal.title || terminal.shell,
      cwd: terminal.cwd, owner: entry,
    })
    const tabs = this.state.tabs.flatMap(tab => {
      if (tab.owner.key !== entry.key) return [tab]
      const terminal = current.get(tab.terminalId)
      if (!terminal) return []
      seen.add(terminal.terminalId)
      return [project(terminal)]
    })
    for (const terminal of terminals) {
      const tab = project(terminal)
      if (!seen.has(terminal.terminalId) && !this.dismissed.has(tab.id)) tabs.push(tab)
    }
    this.publish({ tabs })
  }
  private entry(context: TargetContext, target: LingTerminalTarget): TargetEntry {
    const key = target.kind === 'local' ? JSON.stringify(['local', context.workspaceId ?? null]) : JSON.stringify(['server', context.taskId ?? null, target.serverId])
    if (target.kind === 'server' && !context.serverIds.includes(target.serverId)) throw new Error('此服务器未关联到当前会话。')
    const existing = this.entries.get(key)
    if (existing) return existing
    if (target.kind === 'local') {
      const panel = this.localService?.workspacePanel?.(context.workspaceId, this.placement)
      if (!panel) throw new Error('本地终端服务暂不可用。')
      const entry: LocalEntry = { kind: 'local', key, panel, workspaceId: context.workspaceId, targetLabel: '本地' }
      this.entries.set(key, entry)
      panel.subscribe(() => this.syncLocal(entry))
      this.syncLocal(entry)
      return entry
    }
    if (!this.serverService) throw new Error('服务器终端服务暂不可用。')
    const server = context.servers.find(server => server.id === target.serverId)
    if (!server) throw new Error('服务器已不存在，请重新选择。')
    const entry: ServerEntry = { kind: 'server', key, targetLabel: server.name || server.alias,
      request: { ...(context.taskId ? { taskId: context.taskId } : {}), serverId: target.serverId, placement: this.placement } }
    this.entries.set(key, entry)
    return entry
  }
  private async open(entry: TargetEntry, create: boolean): Promise<string | undefined> {
    if (entry.kind === 'local') {
      const before = new Set(entry.panel.getSnapshot().terminals.map(terminal => terminal.terminalId))
      if (create) await entry.panel.create()
      await entry.panel.load()
      if (!create && !entry.panel.getSnapshot().terminals.length && !entry.panel.getSnapshot().error) await entry.panel.create()
      const snapshot = entry.panel.getSnapshot()
      this.syncLocal(entry)
      if (snapshot.error) throw new Error(snapshot.error)
      const added = snapshot.terminals.filter(terminal => !before.has(terminal.terminalId)).at(-1)
      return added ? JSON.stringify([entry.key, added.terminalId]) : this.preferred(entry.key)
    }
    const service = this.serverService!
    if (!entry.ownerId) {
      const scope = await resolveServerTerminalScope(service, entry.request)
      if (!scope.ok) throw new Error(scope.message)
      entry.ownerId = scope.value.ownerId
    }
    const ownerId = entry.ownerId
    const listed = create ? await service.terminalList(ownerId) : await initializeServerTerminals(service, ownerId)
    if (!listed.ok) throw new Error(listed.message)
    let ids = listed.value.filter(id => !this.dismissed.has(JSON.stringify([entry.key, id])))
    if (create) {
      const opened = await service.terminalOpen(ownerId, 80, 24)
      if (!opened.ok) throw new Error(opened.message)
      ids.push(opened.value.terminalId)
    }
    ids = [...new Set(ids)].filter(id => !this.dismissed.has(JSON.stringify([entry.key, id])))
    const previous = new Set(this.state.tabs.filter(tab => tab.owner.key === entry.key).map(tab => tab.terminalId))
    const tabs = this.state.tabs.filter(tab => tab.owner.key !== entry.key || ids.includes(tab.terminalId))
    for (const [index, id] of ids.entries()) if (!previous.has(id)) tabs.push({
      id: JSON.stringify([entry.key, id]), terminalId: id, target: { kind: 'server', serverId: entry.request.serverId },
      targetLabel: entry.targetLabel, title: `终端 ${index + 1}`,
      owner: { kind: 'server', key: entry.key, ownerId, serverId: entry.request.serverId },
    })
    this.publish({ tabs })
    const added = ids.filter(id => !previous.has(id)).at(-1)
    return added ? JSON.stringify([entry.key, added]) : this.preferred(entry.key)
  }
  async ensure(context: TargetContext, target: LingTerminalTarget, create = false): Promise<void> {
    const intent = ++this.intent
    let entry: TargetEntry
    try { entry = this.entry(context, target) }
    catch (error) { this.publish({ error: error instanceof Error ? error.message : '无法打开终端。' }); return }
    let pending = this.pending.get(entry.key)
    if (!pending) {
      this.publish({ pending: this.state.pending + 1, error: undefined })
      pending = this.open(entry, create).catch(error => {
        this.publish({ error: error instanceof Error ? error.message : '无法打开终端。' })
        return undefined
      }).finally(() => {
        this.pending.delete(entry.key)
        this.publish({ pending: this.state.pending - 1 })
      })
      this.pending.set(entry.key, pending)
    }
    const id = await pending
    if (id && intent === this.intent) this.select(id)
  }
  request(context: TargetContext, target: LingTerminalTarget): Promise<void> {
    if (this.requests.has(target)) return Promise.resolve()
    this.requests.add(target)
    return this.ensure(context, target)
  }
  close(id: string): Promise<void> {
    const existing = this.closing.get(id)
    if (existing) return existing
    const tab = this.state.tabs.find(tab => tab.id === id)
    if (!tab) return Promise.resolve()
    const pending = this.pending.get(tab.owner.key)
    this.dismissed.add(id)
    this.intent++
    this.publish({ tabs: this.state.tabs.filter(item => item.id !== id), error: undefined })
    const request = (async () => {
      await pending
      if (tab.owner.kind === 'local') {
        await tab.owner.panel.close(tab.terminalId)
      } else {
        await this.serverService!.terminalClose(tab.owner.ownerId, tab.terminalId)
      }
    })().catch(() => { /* Closing dismisses the tab even when its disconnected PTY cannot be cleaned up. */ }).finally(() => { this.closing.delete(id) })
    this.closing.set(id, request)
    return request
  }
  async rename(id: string, title: string): Promise<LingReadResult<void>> {
    const tab = this.state.tabs.find(tab => tab.id === id)
    if (!tab || tab.owner.kind !== 'local') return { ok: false, reason: 'invalid-command', message: '此终端不支持重命名。', retryable: false }
    const result = await tab.owner.panel.rename(tab.terminalId, title)
    if (!result.ok) this.publish({ error: result.message })
    return result
  }
}

const retainedModels = new WeakMap<object, TargetTerminalModel[]>()
export function retainedTargetTerminals(local: LingTerminalService | undefined, server: LingServerService | undefined, placement: 'side' | 'bottom') {
  const key = local ?? server
  if (!key) return new TargetTerminalModel(local, server, placement)
  const models = retainedModels.get(key) ?? []
  let model = models.find(model => model.localService === local && model.serverService === server && model.placement === placement)
  if (!model) { model = new TargetTerminalModel(local, server, placement); retainedModels.set(key, [...models, model]) }
  return model
}

export function TargetTerminalPanel({ localService, serverService, taskId, workspaceId, servers, serverIds, placement, initialTarget, onClose }: {
  readonly localService?: LingTerminalService
  readonly serverService?: LingServerService
  readonly taskId?: string
  readonly workspaceId?: string
  readonly servers: readonly LingServer[]
  readonly serverIds: readonly string[]
  readonly placement: 'side' | 'bottom'
  readonly initialTarget?: LingTerminalTarget
  readonly onClose?: () => void
}) {
  const model = useMemo(() => retainedTargetTerminals(localService, serverService, placement), [localService, serverService, placement])
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot)
  const [editing, setEditing] = useState<string>()
  const tablist = useRef<HTMLDivElement>(null)
  const newButton = useRef<HTMLButtonElement>(null)
  const panelId = useId()
  const context = { taskId, workspaceId, servers, serverIds }
  const latestContext = useRef(context)
  latestContext.current = context
  useEffect(() => {
    if (initialTarget) void model.request(latestContext.current, initialTarget)
    else if (!model.getSnapshot().tabs.length) void model.ensure(latestContext.current, { kind: 'local' })
  }, [model, initialTarget])
  const appearance = useAppearance()
  const mode = terminalMode(appearance, appearance.resolved)
  const dark = mode === 'dark'
  const selected = state.tabs.find(tab => tab.id === state.selectedId)
  const available = servers.filter(server => serverIds.includes(server.id))
  const label = (tab: TargetTerminalTab) => `${tab.target.kind === 'local' ? '本地' : servers.find(server => server.id === (tab.target.kind === 'server' ? tab.target.serverId : ''))?.name || tab.targetLabel} · ${tab.title}`
  const controls = 'size-control-sm min-w-7 shrink-0 rounded-md p-0 text-current opacity-65 hover:opacity-100'
  return <section aria-label={placement === 'bottom' ? '底部终端' : '侧面终端'} data-theme={mode} data-palette={appearance.palette} className={tw('flex min-h-0 min-w-0 flex-1 flex-col bg-[var(--terminal-background)] text-[var(--terminal-foreground)]')}>
    <div className={tw('flex h-control-lg shrink-0 items-center gap-1 px-2')}>
      <div ref={tablist} role="tablist" aria-label="终端列表" className={tw('flex min-w-0 flex-1 gap-1 overflow-x-auto [scrollbar-width:none]')}>
        {state.tabs.map((tab, index) => <div key={tab.id} className={tw('group flex h-control-sm shrink-0 items-center rounded-md', selected?.id === tab.id && 'bg-[var(--surface-selected)]')}>
          {editing === tab.id ? <TerminalNameEditor title={tab.title} onSave={title => model.rename(tab.id, title)} onDone={restore => {
            setEditing(undefined)
            if (restore) requestAnimationFrame(() => tablist.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[index]?.focus())
          }} /> : <button type="button" role="tab" id={`${panelId}:tab:${index}`} aria-controls={`${panelId}:body`} aria-selected={selected?.id === tab.id} aria-label={label(tab)} tabIndex={selected?.id === tab.id ? 0 : -1}
            title={`${label(tab)}${tab.cwd ? `\n${tab.cwd}` : ''}${tab.owner.kind === 'local' ? '\n双击重命名' : ''}`}
            className={tw('inline-flex h-control-sm max-w-64 items-center gap-1.5 rounded-md border-0 bg-transparent px-2 text-xs text-current outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]')}
            onClick={() => model.select(tab.id)} onDoubleClick={() => { if (tab.owner.kind === 'local') setEditing(tab.id) }} onKeyDown={event => {
              if (event.key === 'F2' && tab.owner.kind === 'local') { event.preventDefault(); setEditing(tab.id); return }
              const next = event.key === 'ArrowRight' ? (index + 1) % state.tabs.length : event.key === 'ArrowLeft' ? (index + state.tabs.length - 1) % state.tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? state.tabs.length - 1 : undefined
              if (next === undefined) return
              event.preventDefault(); model.select(state.tabs[next]!.id); tablist.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus()
            }}><Icon name={tab.target.kind === 'local' ? 'terminal' : 'globe'} size={14} /><span className={tw('min-w-0 truncate')}>{label(tab)}</span></button>}
          <Button isIconOnly aria-label={`关闭终端 ${label(tab)}`} variant="ghost" className={tw('mr-0.5 size-5 min-w-5 rounded p-0 text-current opacity-50 hover:opacity-100')} onPress={() => { void model.close(tab.id); requestAnimationFrame(() => {
            const next = tablist.current?.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]')
            if (next) next.focus(); else newButton.current?.focus()
          }) }}><Icon name="close" size={12} /></Button>
        </div>)}
      </div>
      <Dropdown>
        <Button ref={newButton} isIconOnly aria-label="新建终端" title="新建终端" variant="ghost" className={tw(controls)} isDisabled={state.pending > 0}><Icon name="plus" size={16} /></Button>
        <Dropdown.Popover placement="bottom end" className={tw('min-w-48 rounded-xl border border-[var(--panel-border)] bg-[var(--surface)] p-1 shadow-[var(--overlay-shadow)]')}>
          <Dropdown.Menu aria-label="新建终端目标" disabledKeys={[...(!localService?.workspacePanel ? ['local'] : []), ...(!serverService ? available.map(server => `server:${server.id}`) : [])]} onAction={(key: string | number) => {
            const id = String(key)
            void model.ensure(latestContext.current, id === 'local' ? { kind: 'local' } : { kind: 'server', serverId: id.slice(7) }, true)
          }}>
            <Dropdown.Item id="local" textValue="本地终端"><Icon name="desktop" size={15} /><Label>本地终端</Label></Dropdown.Item>
            {available.map(server => <Dropdown.Item key={server.id} id={`server:${server.id}`} textValue={server.name}><Icon name="globe" size={15} /><Label>{server.name}</Label></Dropdown.Item>)}
          </Dropdown.Menu>
        </Dropdown.Popover>
      </Dropdown>
      <Button isIconOnly aria-label={dark ? '切换为浅色终端' : '切换为深色终端'} variant="ghost" className={tw(controls)} onPress={() => updateAppearance({ terminal: 'manual', terminalDark: !dark })}><Icon name={dark ? 'sun' : 'moon'} size={16} /></Button>
      {onClose && <Button isIconOnly aria-label="关闭终端面板" variant="ghost" className={tw(controls)} onPress={onClose}><Icon name="close" size={16} /></Button>}
    </div>
    {state.error && <p role="alert" className={tw('m-0 px-3 py-1 text-xs text-[var(--danger)]')}>{state.error}</p>}
    <div id={`${panelId}:body`} role="tabpanel" aria-labelledby={selected ? `${panelId}:tab:${state.tabs.indexOf(selected)}` : undefined} className={tw('flex min-h-0 min-w-0 flex-1 flex-col')}>
    {selected?.owner.kind === 'local' ? <TerminalBody key={selected.id} model={selected.owner.panel.view(selected.terminalId)} />
      : selected?.owner.kind === 'server' && serverService ? <ServerTerminalScreen key={selected.id} service={serverService} ownerId={selected.owner.ownerId} terminalId={selected.terminalId} />
      : <p role="status" className={tw('px-3 text-xs text-[var(--text-tertiary)]')}>{state.pending ? '正在连接终端…' : '选择 + 新建本地或服务器终端'}</p>}
    </div>
  </section>
}
