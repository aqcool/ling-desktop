import { useCallback, useEffect, useRef, useState } from 'react'
import type { LingPluginManager, LingPluginOverview } from '../runtime/contract.js'
import { CompactButton, CompactSelect, CompactSwitch, SettingsGroup, SettingsHeader, SettingsRow } from './SettingsControls.js'
import { pluginChangeMessage } from './PluginManager.js'
import { tw } from './tailwind.js'

export function ComputerControlSettings({ service }: { service?: LingPluginManager }) {
  const [overview, setOverview] = useState<LingPluginOverview>()
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
      const result = await service.read()
      if (!mounted.current || version !== reading.current) return false
      setOverview(result.ok ? result.value : undefined)
      setMessage(result.ok ? undefined : result.message)
      return result.ok
    } catch {
      if (mounted.current && version === reading.current) { setOverview(undefined); setMessage('无法读取电脑操控状态，请重试。') }
      return false
    } finally { if (mounted.current && version === reading.current) setLoading(false) }
  }, [service])
  useEffect(() => {
    mounted.current = true
    void refresh()
    const off = service?.subscribe(event => { if (event.type === 'changed') void refresh() })
    return () => { mounted.current = false; reading.current++; off?.() }
  }, [service, refresh])
  const entry = overview?.bundles.find(bundle => bundle.name === 'ling-desktop-host')?.rows.find(row => row.moduleName === 'ling-desktop-host/computer-use')
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
  const phase = loading ? '读取中…' : !entry ? '当前运行环境不可用' : !entry.enabled ? '已关闭'
    : ({ active: '运行中', failed: '启动失败', pending: '等待中', loading: '加载中', unloading: '关闭中' } as Record<string, string>)[entry.phase ?? ''] ?? '未运行'
  return <section aria-label="电脑操控" className={tw('w-full min-w-0 max-w-3xl pb-8')}>
    <SettingsHeader title="电脑操控" description="管理本机 Agent 可使用的浏览器与桌面操控能力。">
      <CompactButton variant="ghost" isDisabled={loading || busy || !service} onPress={() => { void refresh() }}>刷新</CompactButton>
    </SettingsHeader>
    <SettingsGroup title="浏览器">
      <SettingsRow title="浏览器连接" description="允许本机任务操控已连接的浏览器。此设置尚未接入。">
        <CompactSwitch label="浏览器连接" selected={false} disabled />
      </SettingsRow>
    </SettingsGroup>
    <SettingsGroup title="应用快照">
      <SettingsRow title="全局快捷键" description="截取前台窗口及其可访问性内容。快捷键设置尚未接入。">
        <CompactSelect label="全局快捷键" value="未设置" options={[{ value: '未设置', label: '未设置' }]} disabled onChange={() => {}} />
      </SettingsRow>
    </SettingsGroup>
    <SettingsGroup title="电脑操控">
      <SettingsRow title="启用电脑操控" description="查看本机应用、截图与操作窗口，遵循当前会话权限。">
        <span role="status" className={tw('text-xs text-muted')}>{phase}</span>
        <CompactSwitch label="启用电脑操控" selected={entry?.enabled ?? false} disabled={loading || busy || !entry?.entryId || !!reason} title={reason} onChange={enabled => { void setEnabled(enabled) }} />
      </SettingsRow>
    </SettingsGroup>
    {entry?.enabled ? <p className={tw('text-xs leading-5 text-muted')}>macOS 首次使用需在系统设置中授予辅助功能与屏幕录制权限。</p> : null}
    {message || reason ? <p role="alert" className={tw('text-xs leading-5 text-danger')}>{message ?? reason}</p> : null}
    <SettingsGroup title="录制与回放">
      <SettingsRow title="启用录制与回放" description="录制演示流程并保存以供复用。此设置尚未接入。">
        <CompactSwitch label="启用录制与回放" selected={false} disabled />
      </SettingsRow>
    </SettingsGroup>
  </section>
}
