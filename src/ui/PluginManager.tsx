import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react'
import { CompactButton as Button } from './SettingsControls.js'
import { CompactInput as Input } from './SettingsControls.js'
import { Modal } from '@heroui/react/modal'
import { CompactSwitch } from './SettingsControls.js'
import { Spinner } from '@heroui/react/spinner'
import type { LingManagedPlugin, LingPluginChange, LingPluginManager, LingPluginOverview, LingReadResult } from '../runtime/contract.js'
import { Icon } from './Icon.js'
import { PluginSettings, pluginSettings } from './PluginSettings.js'
import { tw } from './tailwind.js'

const hiddenBundles = new Set(['ling-desktop-host', ...['base', 'web-app', 'headless', 'sdk-app', 'acp-app', 'sdk-minimal'].map(name => `@deepseek-ai/dsh-${name}`)])
const officialCopy: Record<string, { title: string; description: string }> = {
  '@deepseek-ai/dsh-experimental-agent-team-profile': { title: '智能体团队', description: '启用智能体团队协作与团队工具。' },
  '@deepseek-ai/dsh-experimental-agent-team-web-profile': { title: '智能体团队 Web 界面', description: '在浏览器中查看团队成员、任务看板和成员会话。' },
  '@deepseek-ai/dsh-experimental-auto-review': { title: '自动审查', description: '自动审查待审批的操作。' },
}
const display = (bundle: LingManagedPlugin) => officialCopy[bundle.name] ?? { title: bundle.name.replace('@deepseek-ai/dsh-', ''), description: bundle.description ?? '' }
const reasonText = (reason?: string) => reason === 'management-required' ? '当前部署不允许修改此插件' : reason === 'unaddressable' ? '此插件条目不可单独修改' : reason
const phaseText: Record<string, string> = { pending: '等待中', loading: '加载中', active: '运行中', failed: '失败', unloading: '卸载中' }
export function pluginChangeMessage(result: LingPluginChange): string {
  if (result.application === 'failed') return result.error?.diagnostic || result.error?.code || '操作失败，请查看日志。'
  if (result.application === 'restart-required') return '已保存，重启后生效。'
  if (result.application === 'overridden') return '配置已保存，但被其他配置覆盖。'
  if (result.application === 'cancelled') return '安装已取消。'
  return '已完成。'
}

function Toggle({ label, selected, disabled, onChange, reason }: { label: string; selected: boolean; disabled?: boolean; reason?: string; onChange: (value: boolean) => void }) {
  return <CompactSwitch label={label} title={reasonText(reason)} selected={selected} disabled={disabled || !!reason} onChange={onChange} />
}

export function PluginManager({ service }: { service: LingPluginManager }) {
  const [data, setData] = useState<LingPluginOverview>()
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState<string>()
  const [view, setView] = useState<{ type: 'bundle' | 'config'; id: string }>()
  const [filter, setFilter] = useState('')
  const [busy, setBusy] = useState<string>()
  const busyRef = useRef(false)
  const [remove, setRemove] = useState<LingManagedPlugin>()
  const [installOpen, setInstallOpen] = useState(false)
  const [spec, setSpec] = useState('')
  const [phase, setPhase] = useState<'idle' | 'checking' | 'installing' | 'applying' | 'cancelling' | 'done' | 'failed'>('idle')
  const [logs, setLogs] = useState('')
  const [installError, setInstallError] = useState<string>()
  const [outcome, setOutcome] = useState<LingPluginChange>()
  const requestId = useRef<string | undefined>(undefined)
  const inspectAbort = useRef<AbortController | undefined>(undefined)
  const readVersion = useRef(0)
  const mounted = useRef(true)
  const installing = ['installing', 'applying', 'cancelling'].includes(phase)
  const refresh = useCallback(async (clearNotice = false) => {
    const version = ++readVersion.current
    setLoading(true)
    if (clearNotice) setMessage(undefined)
    const result = await service.read()
    if (version !== readVersion.current || !mounted.current) return
    if (result.ok) { setData(result.value) } else setMessage(result.message)
    setLoading(false)
  }, [service])
  useEffect(() => {
    mounted.current = true
    void refresh()
    const off = service.subscribe(event => {
      if (event.type === 'changed') { void refresh(); return }
      if (event.requestId !== requestId.current) return
      if (event.type === 'progress') setPhase(event.phase)
      else setLogs(current => (current + event.text).slice(-200_000))
    })
    return () => { mounted.current = false; readVersion.current++; inspectAbort.current?.abort(); off() }
  }, [refresh, service])
  const action = async (id: string, call: () => Promise<LingReadResult<LingPluginChange>>) => {
    if (busyRef.current) return false
    busyRef.current = true; setBusy(id); setMessage(undefined)
    try {
      const result = await call()
      if (!result.ok) { setMessage(result.message); return false }
      await refresh(); setMessage(pluginChangeMessage(result.value))
      return result.value.application === 'applied' || result.value.application === 'restart-required'
    } catch { setMessage('操作失败，请重试。'); return false } finally { busyRef.current = false; setBusy(undefined) }
  }
  const install = async (approvedBuilds?: string[]) => {
    if (requestId.current || phase === 'checking' || !spec.trim()) return
    inspectAbort.current?.abort()
    const controller = new AbortController(); inspectAbort.current = controller
    setPhase('checking'); setInstallError(undefined); setLogs(''); setOutcome(undefined)
    const inspection = await service.inspect(spec.trim(), controller.signal)
    if (controller.signal.aborted || !mounted.current) return
    if (!inspection.ok || inspection.value.status === 'refused') {
      setPhase('failed'); setInstallError(!inspection.ok ? inspection.message : inspection.value.status === 'refused' ? inspection.value.reason : undefined); return
    }
    const id = crypto.randomUUID(); requestId.current = id; setPhase('installing')
    const result = await service.install(spec.trim(), id, approvedBuilds)
    if (!mounted.current || requestId.current !== id) return
    requestId.current = undefined
    if (!result.ok) { setPhase('failed'); setInstallError(result.message); return }
    setOutcome(result.value)
    if (result.value.packageResult) setLogs(current => current || result.value.packageResult!.output)
    setPhase(result.value.application === 'failed' ? 'failed' : result.value.application === 'cancelled' ? 'idle' : 'done')
    if (result.value.application !== 'applied') setInstallError(pluginChangeMessage(result.value))
    await refresh()
  }
  const cancelInstall = async () => {
    const id = requestId.current
    if (!id) { inspectAbort.current?.abort(); setInstallOpen(false); return }
    setPhase('cancelling')
    const result = await service.cancel(id)
    if (requestId.current !== id) return
    if (!result.ok) { setInstallError(result.message); setPhase('installing') }
    else if (result.value.status !== 'cancelled') { setInstallError('安装已进入应用阶段，等待完成后即可关闭。'); setPhase('applying') }
  }
  const bundles = data?.bundles.filter(bundle => !hiddenBundles.has(bundle.name)) ?? []
  const official = bundles.filter(bundle => bundle.optional)
  const installed = bundles.filter(bundle => !bundle.optional && bundle.installed)
  const configs = pluginSettings.filter(config => data?.namespaces.some(ns => (config.namespaces as readonly string[]).includes(ns.ns)))
  const currentBundle = view?.type === 'bundle' ? bundles.find(bundle => bundle.name === view.id) : undefined
  const currentConfig = view?.type === 'config' ? configs.find(config => config.id === view.id) : undefined
  const title = currentBundle ? display(currentBundle).title : currentConfig?.title ?? '插件'
  const description = currentBundle ? display(currentBundle).description : currentConfig?.description ?? '添加和管理插件'
  const bundleRow = (bundle: LingManagedPlugin) => <li key={bundle.name} className={tw('flex min-h-16 items-center gap-3 py-2')}>
    <Button variant="ghost" onPress={() => { setView({ type: 'bundle', id: bundle.name }); setMessage(undefined); setFilter('') }} className={tw('h-auto min-w-0 flex-1 justify-start gap-3 rounded-lg p-0 text-left hover:bg-transparent')}>
      <span className={tw("grid size-control-lg shrink-0 place-items-center rounded-lg border border-[var(--panel-border)] text-muted")}><Icon name="plugin" size={18} /></span>
      <span className={tw('grid min-w-0 gap-0.5')}><span className={tw("flex items-center gap-2 text-compact font-medium")}><span className={tw('truncate')}>{display(bundle).title}</span>{officialCopy[bundle.name] ? <span className={tw("rounded-md bg-[var(--surface-tertiary)] px-1.5 py-0.5 text-micro leading-3 font-normal text-[var(--text-secondary)]")}>Beta</span> : null}</span><span className={tw('truncate text-xs leading-5 font-normal text-muted')}>{display(bundle).description}</span></span>
    </Button>
    <Toggle label={`启用${display(bundle).title}`} selected={bundle.enabled} disabled={!!busy || loading || !!bundle.error} reason={bundle.readOnlyReason} onChange={enabled => { void action(bundle.name, () => service.setBundleEnabled(bundle.name, enabled)) }} />
  </li>
  return <section aria-label="插件管理" className={tw('flex w-full min-w-0 max-w-3xl flex-col gap-5 pb-8')}>
    <header className={tw('flex items-start justify-between gap-4')}>
      <div className={tw('min-w-0')}>{view ? <Button variant="ghost" size="sm" onPress={() => { setView(undefined); setMessage(undefined) }} className={tw('mb-4 -ml-2 gap-1 text-muted')}><Icon name="arrowLeft" size={14} />返回插件</Button> : null}<h1 className={tw('m-0 text-xl font-semibold')}>{title}</h1><p className={tw('mt-1.5 mb-0 text-xs text-muted')}>{description}</p></div>
      {!view ? <div className={tw('flex shrink-0 items-center gap-2')}><Button isIconOnly size="sm" variant="ghost" aria-label="刷新插件" isDisabled={loading} onPress={() => { void refresh(true) }}><Icon name="refresh" size={18} /></Button><Button size="sm" variant="primary" isDisabled={!!data?.managementError || !data} onPress={() => { setSpec(''); setPhase('idle'); setOutcome(undefined); setLogs(''); setInstallError(undefined); setInstallOpen(true) }} className={tw("h-control min-h-control gap-1.5 rounded-lg px-3 text-xs")}><Icon name="plus" size={16} />添加插件</Button></div> : null}
    </header>
    {loading && !data ? <Spinner aria-label="正在读取插件" size="sm" /> : null}
    {message ? <p role="status" className={tw('m-0 text-sm text-muted')}>{message}</p> : null}
    {data?.managementError ? <p role="alert" className={tw('m-0 text-sm text-danger')}>{data.managementError}</p> : null}
    {currentConfig && data ? <PluginSettings key={currentConfig.id} config={currentConfig} namespaces={data.namespaces} writable={data.writable} service={service} onSaved={() => { void refresh() }} /> : currentBundle ? <>
      <div className={tw('flex items-center justify-between gap-4 text-sm')}><span className={tw('min-w-0 break-all text-muted')}>{currentBundle.name}{currentBundle.version ? ` · ${currentBundle.version}` : ''}</span><Toggle label={`启用${title}`} selected={currentBundle.enabled} disabled={!!busy || loading || !!currentBundle.error} reason={currentBundle.readOnlyReason} onChange={enabled => { void action(currentBundle.name, () => service.setBundleEnabled(currentBundle.name, enabled)) }} /></div>
      {currentBundle.error ? <p role="alert" className={tw('text-sm text-danger')}>{currentBundle.error.diagnostic ?? currentBundle.error.code}</p> : null}
      <h2 className={tw('m-0 text-sm font-medium')}>插件组件 <span className={tw('ml-2 text-muted')}>{currentBundle.rows.length}</span></h2>
      {currentBundle.rows.length > 10 ? <Input aria-label="筛选插件组件" placeholder="筛选组件…" value={filter} onChange={(event: ChangeEvent<HTMLInputElement>) => setFilter(event.target.value)} /> : null}
      <ul className={tw('m-0 grid list-none gap-4 p-0')}>{currentBundle.rows.filter(row => `${row.rowId} ${row.moduleName}`.toLowerCase().includes(filter.toLowerCase())).map(row => <li key={row.rowId} className={tw('flex items-center gap-3')}><Icon name="plugin" size={18} /><div className={tw('min-w-0 flex-1')}><div className={tw('truncate text-sm')}>{row.rowId}</div><div className={tw('truncate text-xs text-muted')}>{row.moduleName}</div></div><span className={tw('text-xs text-muted', row.phase === 'failed' && 'text-danger')}>{row.enabled ? phaseText[row.phase ?? ''] ?? '未运行' : '已停用'}</span>{currentBundle.enabled ? <Toggle label={`启用组件 ${row.rowId}`} selected={row.enabled} disabled={!!busy || !row.entryId || loading} reason={row.readOnlyReason} onChange={enabled => { if (row.entryId) void action(row.entryId, () => service.setPluginEnabled(row.entryId!, enabled)) }} /> : null}</li>)}</ul>
      {currentBundle.removable ? <Button size="sm" variant="danger" isDisabled={!!busy} onPress={() => setRemove(currentBundle)} className={tw('mt-3 self-start gap-2')}><Icon name="trash" size={16} />卸载插件</Button> : null}
    </> : !view ? <>
      <div><h2 className={tw('mb-2 text-xs font-medium text-muted')}>官方 <span className={tw('ml-2 font-normal text-muted')}>{official.length + configs.length}</span></h2><ul className={tw('m-0 list-none p-0')}>
        {official.map(bundleRow)}
        {configs.map(config => <li key={config.id}><Button variant="ghost" onPress={() => { setView({ type: 'config', id: config.id }); setMessage(undefined) }} className={tw('h-auto min-h-16 w-full justify-start gap-3 rounded-lg px-0 py-2 text-left hover:bg-transparent')}><span className={tw("grid size-control-lg shrink-0 place-items-center rounded-lg border border-[var(--panel-border)] text-muted")}><Icon name="plugin" size={18} /></span><span className={tw('grid min-w-0 gap-0.5')}><span className={tw("text-compact font-medium")}>{config.title}</span><span className={tw('text-xs leading-5 font-normal text-muted')}>{config.description}</span></span></Button></li>)}
      </ul></div>
      {installed.length ? <div><h2 className={tw('mb-2 text-xs font-medium text-muted')}>已安装 <span className={tw('ml-2 font-normal text-muted')}>{installed.length}</span></h2><ul className={tw('m-0 list-none p-0')}>{installed.map(bundleRow)}</ul></div> : null}
    </> : <p className={tw('text-sm text-muted')}>此插件已不在当前运行时中。</p>}
    <Modal.Backdrop isOpen={!!remove} onOpenChange={(open: boolean) => { if (!open && !busy) setRemove(undefined) }} isDismissable={!busy}><Modal.Container size="sm"><Modal.Dialog className={tw('gap-4 rounded-2xl p-5')}><Modal.Header><Modal.Heading className={tw('text-base font-semibold')}>卸载插件</Modal.Heading></Modal.Header><Modal.Body><p className={tw('text-sm')}>卸载 {remove ? display(remove).title : ''}？相关组件将停止运行。</p>{message ? <p role="alert" className={tw('text-sm text-danger')}>{message}</p> : null}</Modal.Body><Modal.Footer className={tw('gap-2')}><Button size="sm" variant="ghost" isDisabled={!!busy} onPress={() => setRemove(undefined)}>取消</Button><Button size="sm" variant="danger" isPending={!!busy} onPress={() => { if (remove) void action(remove.name, () => service.remove(remove.name)).then(ok => { if (ok) { setRemove(undefined); setView(undefined) } }) }}>卸载</Button></Modal.Footer></Modal.Dialog></Modal.Container></Modal.Backdrop>
    <Modal.Backdrop isOpen={installOpen} isDismissable={!installing} onOpenChange={(open: boolean) => { if (!open && !installing) { inspectAbort.current?.abort(); setInstallOpen(false) } }}><Modal.Container size="sm"><Modal.Dialog className={tw('gap-4 rounded-2xl p-5')}><Modal.Header><Modal.Heading className={tw('text-base font-semibold')}>添加插件</Modal.Heading></Modal.Header><Modal.Body className={tw('flex flex-col gap-4')}>
      <Input className={tw("h-control min-h-control rounded-lg text-xs")} aria-label="插件包或路径" placeholder="npm 包名、本地路径或 Git 地址" value={spec} disabled={installing || phase === 'checking' || phase === 'done'} onChange={(event: ChangeEvent<HTMLInputElement>) => setSpec(event.target.value)} />
      {installing || phase === 'checking' ? <p role="status" className={tw('flex items-center gap-2 text-sm text-muted')}><Spinner size="sm" />{phase === 'checking' ? '检查插件…' : phase === 'applying' ? '应用插件…' : phase === 'cancelling' ? '正在取消…' : '正在安装…'}</p> : null}
      {phase === 'done' ? <p role="status" className={tw('text-sm')}>安装完成，可启用插件。</p> : null}
      {message ? <p role="status" className={tw('text-sm')}>{message}</p> : null}
      {installError ? <p role="alert" className={tw('text-sm text-danger')}>{installError}</p> : null}
      {logs ? <details><summary className={tw('cursor-pointer text-sm text-muted')}>安装日志</summary><pre className={tw('max-h-64 overflow-auto rounded-xl bg-[var(--surface-secondary)] p-3 text-xs whitespace-pre-wrap break-all')}>{logs.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')}</pre>{outcome?.packageResult?.truncated ? <p className={tw('text-xs text-muted')}>完整日志：{outcome.packageResult.logPath}</p> : null}</details> : null}
      {outcome?.pendingBuilds?.length ? <div className={tw('grid gap-2 text-sm')}><p className={tw('m-0')}>以下包需要执行安装脚本：</p><ul className={tw('m-0 pl-5')}>{outcome.pendingBuilds.map(name => <li key={name}>{name}</li>)}</ul><Button size="sm" variant="secondary" onPress={() => { void install(outcome.pendingBuilds) }}>允许这些脚本并重试</Button></div> : null}
    </Modal.Body><Modal.Footer className={tw('gap-2')}>
      <Button size="sm" variant="ghost" isDisabled={phase === 'applying' || phase === 'cancelling' || !!busy} onPress={() => { void cancelInstall() }}>{installing ? '取消安装' : '关闭'}</Button>
      {phase === 'done' && outcome?.bundle ? <Button size="sm" variant="primary" isPending={!!busy} onPress={() => { void action(outcome.bundle!, () => service.setBundleEnabled(outcome.bundle!, true)).then(ok => { if (ok) setInstallOpen(false) }) }}>启用插件</Button> : !installing && phase !== 'done' ? <Button size="sm" variant="primary" isDisabled={!spec.trim()} isPending={phase === 'checking'} onPress={() => { void install() }}>{phase === 'failed' ? '重试安装' : '安装'}</Button> : null}
    </Modal.Footer></Modal.Dialog></Modal.Container></Modal.Backdrop>
  </section>
}
