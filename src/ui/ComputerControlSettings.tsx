import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { computerControlNamespace, snapshotShortcuts, type LingComputerCapabilities, type LingComputerControlService, type LingPluginManager, type LingPluginOverview } from '../runtime/contract.js'
import { CompactButton, CompactSelect, CompactSwitch } from './SettingsControls.js'
import { pluginChangeMessage } from './PluginManager.js'
import { tw } from './tailwind.js'
import { computerPreferences, enabledSnapshotShortcut, nativeComputerEntry, nativeSnapshotBridge } from './computer-snapshot.js'
import { ComputerSnapshotPreview } from './ComputerSnapshotPreview.js'
import { Icon } from './Icon.js'

function ControlGroup({ title, children }: { title: string; children: ReactNode }) {
  return <section className={tw('mt-6')}>
    <h2 className={tw('mb-2 mt-0 px-4 text-xs font-normal text-[var(--text-tertiary)]')}>{title}</h2>
    <div className={tw('grid gap-2')}>{children}</div>
  </section>
}
function ControlCard({ title, description, leading, children }: { title: string; description: ReactNode; leading?: ReactNode; children: ReactNode }) {
  return <div className={tw('flex min-h-16 items-center gap-3 rounded-xl border border-[var(--panel-border)] bg-[var(--surface)] px-4 py-2.5 max-[700px]:flex-wrap')}>
    {leading}
    <div className={tw('min-w-0 flex-1')}>
      <h3 className={tw('m-0 text-compact font-medium text-[var(--foreground)]')}>{title}</h3>
      <p className={tw('mb-0 mt-1 text-xs leading-5 text-[var(--text-secondary)]')}>{description}</p>
    </div>
    <div className={tw('flex shrink-0 items-center gap-3 max-[700px]:ml-auto')}>{children}</div>
  </div>
}

export function ComputerControlSettings({ service, computer }: { service?: LingPluginManager; computer?: LingComputerControlService }) {
  const [overview, setOverview] = useState<LingPluginOverview>()
  const [capabilities, setCapabilities] = useState<LingComputerCapabilities>()
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string>()
  const mounted = useRef(true)
  const reading = useRef(0)
  const changing = useRef(false)
  const refresh = useCallback(async () => {
    if (!service) { setLoading(false); return false }
    const version = ++reading.current
    setLoading(true)
    try {
      const [result, capability] = await Promise.all([service.read(), computer?.capabilities().catch(() => undefined)])
      if (!mounted.current || version !== reading.current) return false
      setOverview(result.ok ? result.value : undefined)
      setCapabilities(capability?.ok ? capability.value : undefined)
      setMessage(!result.ok ? result.message : capability && !capability.ok ? capability.message : undefined)
      return result.ok
    } catch {
      if (mounted.current && version === reading.current) { setOverview(undefined); setMessage('无法读取电脑操控状态，请重试。') }
      return false
    } finally { if (mounted.current && version === reading.current) setLoading(false) }
  }, [service, computer])
  useEffect(() => {
    mounted.current = true
    void refresh()
    const off = service?.subscribe(event => { if (event.type === 'changed') void refresh() })
    return () => { mounted.current = false; reading.current++; off?.() }
  }, [service, refresh])
  const entry = nativeComputerEntry(overview)
  const namespace = overview?.namespaces.find(ns => ns.ns === computerControlNamespace)
  const preferences = computerPreferences(overview)
  const controlsDisabled = loading || busy || !entry?.enabled || entry.phase !== 'active' || !namespace || !overview?.writable
  const reason = overview?.managementError ?? (entry?.readOnlyReason === 'management-required' ? '当前部署不允许修改此插件' : entry?.readOnlyReason === 'unaddressable' ? '此插件条目不可单独修改' : entry?.readOnlyReason)
  const setEnabled = async (enabled: boolean) => {
    if (!service || !entry?.entryId || loading || changing.current || reason) return
    changing.current = true; setBusy(true); setMessage(undefined)
    try {
      const result = await service.setPluginEnabled(entry.entryId, enabled)
      if (!mounted.current) return
      if (!result.ok) { setMessage(result.message); return }
      if (await refresh() && result.value.application !== 'applied') setMessage(pluginChangeMessage(result.value))
    } catch { if (mounted.current) setMessage('操作失败，请重试。') }
    finally { changing.current = false; if (mounted.current) setBusy(false) }
  }
  const save = async (edits: { browserEnabled?: boolean; recordingEnabled?: boolean; snapshotShortcut?: string }) => {
    if (!service || !namespace || controlsDisabled || changing.current) return
    changing.current = true; setBusy(true); setMessage(undefined)
    const bridge = nativeSnapshotBridge()
    const previous = overview ? enabledSnapshotShortcut(overview) : ''
    let shortcutChanged = false
    try {
      if (edits.snapshotShortcut !== undefined) {
        if (!bridge) throw new Error('全局快捷键需要新版桌面客户端。')
        const registered = await bridge.setShortcut(edits.snapshotShortcut)
        if (!registered.ok) throw new Error(registered.message)
        shortcutChanged = true
      }
      const result = await service.save(computerControlNamespace, edits, namespace.revision)
      if (!result.ok) throw new Error(result.message)
      shortcutChanged = false
      if (mounted.current) await refresh()
    } catch (error) {
      if (shortcutChanged) await bridge?.setShortcut(previous).catch(() => {})
      if (mounted.current) setMessage(error instanceof Error ? error.message : '设置保存失败，请重试。')
    } finally { changing.current = false; if (mounted.current) setBusy(false) }
  }
  const phase = loading ? '读取中…' : !entry ? '当前运行环境不可用' : !entry.enabled ? '已关闭'
    : ({ active: '运行中', failed: '启动失败', pending: '等待中', loading: '加载中', unloading: '关闭中' } as Record<string, string>)[entry.phase ?? ''] ?? '未运行'
  return <section aria-label="电脑操控" className={tw('w-full min-w-0 pb-4')}>
    <header className={tw('flex items-start justify-between gap-4 px-4')}>
      <div className={tw('min-w-0')}>
        <h1 className={tw('m-0 text-xl font-semibold tracking-tight text-[var(--foreground)]')}>电脑操控</h1>
        <p className={tw('mb-0 mt-2 text-xs leading-5 text-[var(--text-secondary)]')}>管理本机 Agent 可使用的电脑操控能力，包括应用快照与浏览器连接。</p>
      </div>
      <CompactButton aria-label="刷新电脑操控状态" title="刷新状态" variant="ghost" isIconOnly isDisabled={loading || busy || !service} onPress={() => { void refresh() }}><Icon name="refresh" size={16} /></CompactButton>
    </header>
    <ControlGroup title="浏览器">
      <ControlCard title="浏览器连接" description="开启后，本机任务可以连接与操控浏览器，遵循当前会话权限。" leading={<span className={tw('grid size-9 shrink-0 place-items-center rounded-xl border border-[var(--panel-border)] bg-[var(--surface-secondary)] text-[var(--text-secondary)]')}><Icon name="globe" size={20} /></span>}>
        <CompactSwitch label="浏览器连接" selected={preferences.browserEnabled} disabled={controlsDisabled || !capabilities?.browser} onChange={browserEnabled => { void save({ browserEnabled }) }} />
      </ControlCard>
    </ControlGroup>
    <ControlGroup title="应用快照">
      <ComputerSnapshotPreview shortcut={preferences.snapshotShortcut} />
      <ControlCard title="全局快捷键" description="按下快捷键，将前台窗口截图和可访问性内容加入输入框。">
        <CompactSelect label="全局快捷键" className={tw('w-36')} value={preferences.snapshotShortcut || 'none'} options={snapshotShortcuts.map(value => ({ value: value || 'none', label: value ? value.replace('CommandOrControl', typeof navigator !== 'undefined' && /Mac/.test(navigator.platform) ? '⌘' : 'Ctrl').replace('Shift', '⇧').replaceAll('+', ' + ') : '未设置' }))} disabled={controlsDisabled || !capabilities?.snapshot || !nativeSnapshotBridge()} onChange={value => { void save({ snapshotShortcut: value === 'none' ? '' : value }) }} />
      </ControlCard>
    </ControlGroup>
    <ControlGroup title="电脑操控">
      <ControlCard title="启用电脑操控" description="允许 Agent 查看与操作本机桌面应用，遵循当前会话权限。">
        <span role="status" className={tw('text-xs text-[var(--text-tertiary)]')}>{phase}</span>
        <CompactSwitch label="启用电脑操控" selected={entry?.enabled ?? false} disabled={loading || busy || !entry?.entryId || !!reason} title={reason} onChange={enabled => { void setEnabled(enabled) }} />
      </ControlCard>
      {entry?.enabled ? <p className={tw('m-0 px-4 text-xs leading-5 text-[var(--text-tertiary)]')}>macOS 首次使用需在系统设置中授予辅助功能与屏幕录制权限。</p> : null}
    </ControlGroup>
    <ControlGroup title="录制与回放">
      <ControlCard title="启用录制与回放" description="允许 Agent 录制与回放操作轨迹。关闭后不再开始新录制与回放，已有录制仍可停止。">
        <CompactSwitch label="启用录制与回放" selected={preferences.recordingEnabled} disabled={controlsDisabled || !capabilities?.recording} onChange={recordingEnabled => { void save({ recordingEnabled }) }} />
      </ControlCard>
    </ControlGroup>
    {message || reason ? <p role="alert" className={tw('mt-5 px-4 text-xs leading-5 text-danger')}>{message ?? reason}</p> : null}
  </section>
}
