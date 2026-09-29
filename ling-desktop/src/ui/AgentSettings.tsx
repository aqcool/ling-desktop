import { useCallback, useEffect, useRef, useState } from 'react'
import { Accordion } from '@heroui/react/accordion'
import { CompactButton as Button } from './SettingsControls.js'
import { Card } from '@heroui/react/card'
import { CompactInput as Input } from './SettingsControls.js'
import { Label } from '@heroui/react/label'
import { Modal } from '@heroui/react/modal'
import { CompactSelect, CompactSwitch } from './SettingsControls.js'
import { TextField } from '@heroui/react/textfield'
import type { LingAgentPreset, LingExtensionSettingsService, LingPluginInventory, LingPresetPlugin, LingPresetSettings, LingReadResult } from '../runtime/contract.js'
import { Icon } from './Icon.js'
import { tw } from './tailwind.js'

function useSettingsRead<T>(read: (() => Promise<LingReadResult<T>>) | undefined) {
  const [data, setData] = useState<T>()
  const [error, setError] = useState<string>()
  const [loading, setLoading] = useState(true)
  const generation = useRef(0)
  const refresh = useCallback(async () => {
    const request = ++generation.current
    setLoading(true)
    setError(undefined)
    try {
      const result = await read?.()
      if (request !== generation.current) return
      if (result?.ok) setData(result.value)
      else { setData(undefined); setError(result?.message ?? '当前运行时未提供此设置。') }
    } catch { if (request === generation.current) { setData(undefined); setError('读取失败，请重试。') } }
    finally { if (request === generation.current) setLoading(false) }
  }, [read])
  useEffect(() => {
    void refresh()
    const focus = () => { void refresh() }
    window.addEventListener('focus', focus)
    return () => { generation.current++; window.removeEventListener('focus', focus) }
  }, [refresh])
  return { data, error, loading, refresh }
}

function SettingsHeader({ title, loading, refresh, openConfig }: { title: string; loading: boolean; refresh: () => void; openConfig?: () => void }) {
  return <header className={tw('flex flex-wrap items-center justify-between gap-3')}>
    <h1 className={tw('m-0 text-xl font-semibold')}>{title}</h1>
    <div className={tw('flex items-center gap-1')}>
      {openConfig ? <Button size="sm" variant="secondary" className={tw('h-8 rounded-lg text-xs')} onPress={openConfig}>打开配置文件</Button> : null}
      <Button isIconOnly size="sm" variant="ghost" aria-label={`刷新${title}`} isDisabled={loading} onPress={refresh}><Icon name="refresh" size={16} /></Button>
    </div>
  </header>
}

export function AgentPresetSettings({ service, onChanged, onCreate }: {
  service?: LingExtensionSettingsService
  onChanged: (settings: LingPresetSettings) => Promise<void>
  onCreate: (id: string) => void
}) {
  const { data, error, loading, refresh } = useSettingsRead(service?.presets)
  const [busy, setBusy] = useState(false)
  const locked = useRef(false)
  const [message, setMessage] = useState<string>()
  const [copy, setCopy] = useState<LingAgentPreset>()
  const [copyId, setCopyId] = useState('')
  const [copyName, setCopyName] = useState('')
  const [remove, setRemove] = useState<LingAgentPreset>()
  const [document, setDocument] = useState<{ content: string; name?: string }>()
  const [location, setLocation] = useState<string>()
  const act = async (operation: () => Promise<LingReadResult<unknown>>, changed = false): Promise<boolean> => {
    if (locked.current) return false
    locked.current = true; setBusy(true); setMessage(undefined)
    try {
      const result = await operation()
      if (!result.ok) { setMessage(result.message); return false }
      if (changed && service) {
        const current = await service.presets()
        try {
          if (current.ok) await onChanged(current.value)
          else setMessage(current.message)
        } finally { await refresh() }
      }
      return true
    } catch { setMessage('操作未完成，请重试。'); return false }
    finally { locked.current = false; setBusy(false) }
  }
  const openDirectory = (id: string) => act(async () => {
    const result = await service!.openDirectory(id)
    if (result.ok && !result.value.opened) setLocation(result.value.path)
    return result
  })
  const validId = /^[a-z0-9][a-z0-9-]*$/.test(copyId) && !data?.presets.some(preset => preset.id === copyId)
  const card = (preset: LingAgentPreset) => <Card key={preset.id} className={tw('min-w-0 gap-0 rounded-xl border border-[var(--panel-border)] bg-surface p-4 shadow-none', preset.isDefault && 'bg-surface-secondary')}>
    <Card.Header className={tw('gap-2 p-0')}>
      <div className={tw('flex flex-wrap items-center gap-2')}>
        <Card.Title className={tw('text-[13px] font-semibold')}>{preset.label}</Card.Title>
        <span className={tw('rounded-md bg-surface-secondary px-1.5 py-0.5 text-[10px] text-muted')}>{preset.trust === 'system' ? '内置' : '自定义'}</span>
        {preset.isDefault ? <span className={tw('ml-auto rounded-md bg-foreground px-2 py-0.5 text-[10px] text-background')}>新任务默认</span> : null}
      </div>
      <Card.Description className={tw('min-h-10 text-xs leading-5')}>{preset.description}</Card.Description>
    </Card.Header>
    <Card.Content className={tw('px-0 py-3')}>
      {preset.unavailableReason ? <p className={tw('mb-2 break-words text-xs text-danger')}>{preset.unavailableReason}</p> : null}
      <code className={tw('break-all text-xs text-muted')}>{preset.id}</code>
    </Card.Content>
    <Card.Footer className={tw('mt-auto flex flex-wrap items-center justify-end gap-1 p-0')}>
      {!preset.isDefault ? <Button size="sm" variant="ghost" className={tw('mr-auto h-7 px-2 text-xs')} isDisabled={busy || !data?.writable || !data.modeSelectionEnabled || !!preset.unavailableReason} onPress={() => { void act(() => service!.update({ default: preset.id }), true) }}>设为默认</Button> : null}
      <Button isIconOnly size="sm" variant="ghost" aria-label={`查看${preset.label}配置`} title={`查看${preset.label}配置`} isDisabled={busy} onPress={() => { void act(async () => { const result = await service!.read(preset.id); if (result.ok) setDocument({ ...result.value, name: preset.label }); return result }) }}><Icon name="file" size={16} /></Button>
      <Button isIconOnly size="sm" variant="ghost" aria-label={`复制${preset.label}`} title={`复制${preset.label}`} isDisabled={busy || !data?.authorable} onPress={() => { setCopy(preset); setCopyId(''); setCopyName(''); setMessage(undefined) }}><Icon name="copy" size={16} /></Button>
      {preset.trust === 'user' ? <>
        <Button isIconOnly size="sm" variant="ghost" aria-label={`打开${preset.label}目录`} title={`打开${preset.label}目录`} isDisabled={busy} onPress={() => { void openDirectory(preset.id) }}><Icon name="folder" size={16} /></Button>
        <Button isIconOnly size="sm" variant="ghost" aria-label={`删除${preset.label}`} title={`删除${preset.label}`} isDisabled={busy || !data?.authorable} onPress={() => { setRemove(preset); setMessage(undefined) }}><Icon name="trash" size={16} /></Button>
      </> : null}
    </Card.Footer>
  </Card>
  return <section className={tw('flex w-full min-w-0 max-w-3xl flex-col gap-6')} aria-label="智能体预设设置">
    <SettingsHeader title="智能体预设" loading={loading || busy} refresh={() => { void refresh() }} openConfig={data?.hasDocument ? () => { void act(() => service!.openConfig()) } : undefined} />
    {(error || message) && !copy && !remove ? <p role="alert" className={tw('m-0 text-xs text-danger')}>{error ?? message}</p> : null}
    {loading && !data ? <p role="status" className={tw('text-sm text-muted')}>正在读取预设…</p> : null}
    {data ? <>
      <div className={tw('flex items-center justify-between gap-4 rounded-xl border border-[var(--panel-border)] p-4')}>
        <div><h2 className={tw('m-0 text-[13px] font-medium')}>允许切换智能体</h2><p className={tw('mb-0 mt-1 text-xs text-muted')}>仅影响新任务，已有会话保留原预设。</p></div>
        <CompactSwitch label="允许切换智能体" selected={data.modeSelectionEnabled} disabled={busy || !data.writable} onChange={enabled => { void act(() => service!.update({ modeSelectionEnabled: enabled }), true) }} />
      </div>
      {(['system', 'user'] as const).map(trust => <section key={trust} className={tw('space-y-3')}>
        <h2 className={tw('m-0 text-xs font-medium text-muted')}>{trust === 'system' ? '内置' : '自定义'}</h2>
        <div className={tw('grid grid-cols-1 gap-3 min-[1100px]:grid-cols-2')}>{data.presets.filter(preset => preset.trust === trust).map(card)}</div>
        {trust === 'user' && data.authorable ? <Button variant="secondary" className={tw('h-10 w-full rounded-xl text-xs')} isDisabled={busy || !data.modeSelectionEnabled || !data.presets.some(preset => preset.id === 'cordis' && !preset.unavailableReason)} onPress={() => onCreate('cordis')}><Icon name="plus" size={16} />使用创造模式创建预设</Button> : null}
        {trust === 'user' && !data.presets.some(preset => preset.trust === 'user') ? <p className={tw('text-xs text-muted')}>暂无自定义预设，可从内置预设复制。</p> : null}
      </section>)}
    </> : null}
    <Modal.Backdrop isOpen={!!copy} isDismissable={!busy} onOpenChange={(open: boolean) => { if (!open && !busy) setCopy(undefined) }}>
      <Modal.Container size="sm"><Modal.Dialog className={tw("gap-4 rounded-2xl p-5")}><Modal.Header><Modal.Heading className={tw("text-base font-semibold")}>复制预设</Modal.Heading><p className={tw('text-xs text-muted')}>基于{copy?.label}创建自定义预设。</p></Modal.Header><Modal.Body className={tw('space-y-4')}>
        <TextField value={copyId} onChange={setCopyId} isDisabled={busy} isRequired><Label>标识</Label><Input autoFocus placeholder="my-agent" /><span className={tw('text-xs text-muted')}>使用小写字母、数字和连字符，不可与已有预设重复。</span></TextField>
        <TextField value={copyName} onChange={setCopyName} isDisabled={busy}><Label>名称</Label><Input placeholder="我的智能体" /></TextField>
        {message ? <p role="alert" className={tw('text-xs text-danger')}>{message}</p> : null}
      </Modal.Body><Modal.Footer className={tw("gap-2")}><Button variant="ghost" isDisabled={busy} onPress={() => setCopy(undefined)}>取消</Button><Button isPending={busy} isDisabled={!validId || busy} onPress={() => { void (async () => { if (copy && await act(() => service!.copy(copy.id, copyId, copyName.trim() || undefined), true)) { setCopy(undefined); await openDirectory(copyId) } })() }}>创建</Button></Modal.Footer></Modal.Dialog></Modal.Container>
    </Modal.Backdrop>
    <Modal.Backdrop isOpen={!!remove} isDismissable={!busy} onOpenChange={(open: boolean) => { if (!open && !busy) setRemove(undefined) }}><Modal.Container size="sm"><Modal.Dialog className={tw("gap-4 rounded-2xl p-5")}><Modal.Header><Modal.Heading className={tw("text-base font-semibold")}>删除“{remove?.label}”？</Modal.Heading></Modal.Header><Modal.Body><p className={tw('text-sm text-muted')}>将删除此自定义预设文件。已运行会话保持不变。</p>{message ? <p role="alert" className={tw('text-xs text-danger')}>{message}</p> : null}</Modal.Body><Modal.Footer className={tw("gap-2")}><Button variant="ghost" isDisabled={busy} onPress={() => setRemove(undefined)}>取消</Button><Button variant="danger" isPending={busy} onPress={() => { void (async () => { if (remove && await act(() => service!.delete(remove.id), true)) setRemove(undefined) })() }}>删除</Button></Modal.Footer></Modal.Dialog></Modal.Container></Modal.Backdrop>
    <Modal.Backdrop isOpen={!!document} onOpenChange={(open: boolean) => { if (!open) setDocument(undefined) }}><Modal.Container size="lg"><Modal.Dialog className={tw("gap-4 rounded-2xl p-5")}><Modal.CloseTrigger /><Modal.Header><Modal.Heading className={tw("text-base font-semibold")}>{document?.name} · 配置</Modal.Heading></Modal.Header><Modal.Body><pre className={tw('max-h-[60vh] overflow-auto rounded-lg bg-surface-secondary p-4 text-xs leading-5')}>{document?.content}</pre></Modal.Body></Modal.Dialog></Modal.Container></Modal.Backdrop>
    <Modal.Backdrop isOpen={!!location} onOpenChange={(open: boolean) => { if (!open) setLocation(undefined) }}><Modal.Container size="sm"><Modal.Dialog className={tw("gap-4 rounded-2xl p-5")}><Modal.CloseTrigger /><Modal.Header><Modal.Heading className={tw("text-base font-semibold")}>预设目录</Modal.Heading></Modal.Header><Modal.Body><p className={tw('select-all break-all font-mono text-xs')}>{location}</p></Modal.Body></Modal.Dialog></Modal.Container></Modal.Backdrop>
  </section>
}

const phaseNames: Record<string, string> = { pending: '等待加载', loading: '加载中', active: '运行中', failed: '加载失败', unloading: '卸载中' }
function PluginGrid({ rows, source, inventory }: { rows: readonly LingPresetPlugin[]; source?: string; inventory: LingPluginInventory }) {
  return <Accordion hideSeparator className={tw('grid grid-cols-1 items-start gap-2 min-[1100px]:grid-cols-2')}>
    {rows.map((row, index) => {
      const providers = source ? [] : inventory.presets.filter(preset => preset.plugins.some(plugin => plugin.moduleName === row.moduleName && plugin.enabled === true)).map(preset => preset.label)
      const status = row.enabled === 'conditional' ? '条件启用' : row.enabled ? '已启用' : providers.length ? '由预设提供' : '已停用'
      return <Accordion.Item key={`${row.id}:${index}`} id={`${row.id}:${index}`} className={tw('min-w-0 rounded-xl border border-solid border-[var(--panel-border)] bg-surface px-3')}>
        <Accordion.Trigger className={tw('min-h-16 w-full gap-2 px-0 py-3 text-left')}>
          <span className={tw('min-w-0 flex-1')}><span className={tw('block truncate text-[13px] font-medium')}>{row.moduleName.replace(/^@deepseek-ai\/dsh-/, '')}</span><span className={tw('mt-1 block truncate font-mono text-[11px] text-muted')}>{row.id ?? '无标识'}</span></span>
          <span className={tw('shrink-0 rounded-md px-1.5 py-0.5 text-[10px]', row.phase === 'failed' ? 'bg-danger/10 text-danger' : row.enabled === true ? 'bg-success/10 text-success' : 'bg-surface-secondary text-muted')}>{row.phase === 'failed' ? '加载失败' : status}</span><Accordion.Indicator className={tw('size-3 shrink-0 text-muted')} />
        </Accordion.Trigger>
        <Accordion.Panel><Accordion.Body className={tw('space-y-2 px-0 pt-0 pb-3 text-xs text-muted')}>
          <dl className={tw('m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-2')}>
            <dt>模块</dt><dd className={tw('m-0 break-all')}>{row.moduleName}</dd>
            <dt>配置</dt><dd className={tw('m-0')}>{status}</dd>
            <dt>运行</dt><dd className={tw('m-0')}>{row.phase ? phaseNames[row.phase] ?? row.phase : '未运行'}</dd>
            <dt>来源</dt><dd className={tw('m-0 break-words')}>{source ?? (providers.length ? providers.join('、') : '全局部署')}</dd>
            {row.condition ? <><dt>停用条件</dt><dd className={tw('m-0 break-all font-mono')}>{row.condition}</dd></> : null}
          </dl>
        </Accordion.Body></Accordion.Panel>
      </Accordion.Item>
    })}
  </Accordion>
}

export function BuiltinPluginSettings({ service }: { service?: LingExtensionSettingsService }) {
  const { data, error, loading, refresh } = useSettingsRead(service?.inventory)
  const [query, setQuery] = useState('')
  const [chosen, setChosen] = useState<string>()
  const [message, setMessage] = useState<string>()
  const [hasDocument, setHasDocument] = useState(false)
  useEffect(() => { let active = true; void service?.presets().then(result => { if (active) setHasDocument(result.ok && result.value.hasDocument) }).catch(() => {}); return () => { active = false } }, [service])
  const selected = data?.presets.find(preset => preset.id === chosen) ?? data?.presets.find(preset => preset.isDefault) ?? data?.presets[0]
  const matches = (row: LingPresetPlugin) => `${row.moduleName} ${row.id ?? ''}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
  const rows = selected?.plugins.filter(matches) ?? []
  const global = data?.entries.filter(matches) ?? []
  const otherMatches = query.trim() ? data?.presets.filter(preset => preset !== selected && preset.plugins.some(matches)) ?? [] : []
  return <section className={tw('flex w-full min-w-0 max-w-3xl flex-col gap-5')} aria-label="内置插件设置">
    <SettingsHeader title="内置插件" loading={loading} refresh={() => { void refresh() }} openConfig={hasDocument ? () => { void service!.openConfig().then(result => setMessage(result.ok ? undefined : result.message)).catch(() => setMessage('无法打开配置文件。')) } : undefined} />
    {error || message ? <p role="alert" className={tw('m-0 text-xs text-danger')}>{error ?? message}</p> : null}
    <TextField aria-label="搜索插件" value={query} onChange={setQuery}><div className={tw('relative')}><Icon name="search" size={16} className={tw('pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-muted')} /><Input placeholder="搜索插件名称或标识" className={tw('h-8 w-full rounded-lg pl-9 text-xs')} /></div></TextField>
    {loading && !data ? <p role="status" className={tw('text-sm text-muted')}>正在读取插件…</p> : null}
    {data ? <>
      <div className={tw('flex flex-wrap items-center justify-between gap-2')}><h2 className={tw('m-0 text-[13px] font-medium')}>会话插件 <span className={tw('ml-1 text-xs text-muted')}>{rows.length}</span></h2>
        {selected ? <CompactSelect label="查看预设插件" value={selected.id} onChange={setChosen} options={data.presets.map(preset => ({ value: preset.id, label: `${preset.label}${preset.isDefault ? '（默认）' : ''}` }))} /> : null}
      </div>
      {selected?.unavailableReason ? <p className={tw('text-xs text-danger')}>{selected.unavailableReason}</p> : null}
      {rows.length ? <PluginGrid rows={rows} source={selected?.label} inventory={data} /> : <p className={tw('m-0 text-xs text-muted')}>{query ? '此预设没有匹配的插件。' : '暂无会话插件。'}</p>}
      {otherMatches.length ? <div className={tw('flex flex-wrap items-center gap-2 text-xs text-muted')}>其他预设匹配：{otherMatches.map(preset => <Button key={preset.id} size="sm" variant="ghost" className={tw('text-xs')} onPress={() => setChosen(preset.id)}>{preset.label} · {preset.plugins.filter(matches).length}</Button>)}</div> : null}
      <h2 className={tw('mb-0 mt-3 text-sm font-medium')}>全局插件 <span className={tw('ml-1 text-xs text-muted')}>{global.length}</span></h2>
      {global.length ? <PluginGrid rows={global} inventory={data} /> : <p className={tw('m-0 text-xs text-muted')}>{query ? '没有匹配的全局插件。' : '暂无全局插件。'}</p>}
    </> : null}
  </section>
}
