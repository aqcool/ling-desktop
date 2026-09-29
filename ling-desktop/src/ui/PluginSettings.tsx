import { useEffect, useState, type ChangeEvent } from 'react'
import { CompactButton as Button } from './SettingsControls.js'
import { CompactInput as Input } from './SettingsControls.js'
import { CompactSwitch } from './SettingsControls.js'
import { Checkbox } from '@heroui/react/checkbox'
import type { LingPluginManager, LingPluginNamespace, PluginValue } from '../runtime/contract.js'
import { tw } from './tailwind.js'

export const pluginSettings = [
  { id: 'bash', title: '终端', description: '限制 agent 运行的每一条命令。', namespaces: ['shell'], fields: [{ ns: 'shell', key: 'timeoutMs', label: '命令超时（毫秒）', min: 1 }, { ns: 'shell', key: 'maxOutputBytes', label: '每路输出上限（字节）', min: 1 }] },
  { id: 'agent-loop', title: 'Agent 循环', description: 'Agent 如何派发工具调用。', namespaces: ['agent-loop'], fields: [{ ns: 'agent-loop', key: 'maxParallelToolCalls', label: '并行工具调用上限', min: 1 }] },
  { id: 'subagent', title: 'Subagent', description: '设置 Subagent 的递归层级、数量和模型。', namespaces: ['subagent', 'subagent-model-selection'], fields: [{ ns: 'subagent', key: 'maxDepth', label: '最大递归深度', min: 0 }, { ns: 'subagent', key: 'maxActiveSubagents', label: '并行子智能体上限', min: 1 }] },
  { id: 'web-search', title: '网页搜索', description: 'DeepSeek 搜索提供方。', namespaces: ['web-search-deepseek'], fields: [{ ns: 'web-search-deepseek', key: 'baseURL', label: '服务地址', min: undefined }, { ns: 'web-search-deepseek', key: 'maxUses', label: '每次请求的搜索上限', min: 1 }] },
] as const
export type PluginSetting = typeof pluginSettings[number]
const record = (value: PluginValue | undefined): Record<string, PluginValue> => value && typeof value === 'object' && !Array.isArray(value) ? value : {}

export function PluginSettings({ config, namespaces, writable, service, onSaved }: { config: PluginSetting; namespaces: LingPluginNamespace[]; writable: boolean; service: LingPluginManager; onSaved: () => void }) {
  const [views, setViews] = useState(() => namespaces.filter(ns => (config.namespaces as readonly string[]).includes(ns.ns)))
  const [edits, setEdits] = useState<Record<string, Record<string, PluginValue | undefined>>>({})
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string>()
  const [key, setKey] = useState('')
  const [credential, setCredential] = useState<{ configured: boolean; writable: boolean }>()
  const [models, setModels] = useState<{ provider: string; providerName: string; model: string; name: string }[]>([])
  const [modelError, setModelError] = useState<string>()
  const [catalogRevision, setCatalogRevision] = useState(0)
  const web = record(views.find(ns => ns.ns === 'web-search-deepseek')?.value)
  const keyRef = typeof web.apiKeyEnv === 'string' && web.apiKeyEnv ? web.apiKeyEnv : 'DEEPSEEK_API_KEY'
  useEffect(() => {
    if (config.id !== 'web-search') return
    let stale = false
    void service.credential(keyRef).then(result => { if (!stale) { if (result.ok) setCredential(result.value); else setMessage(result.message) } })
    return () => { stale = true }
  }, [service, keyRef, config.id])
  useEffect(() => {
    if (config.id !== 'subagent') return
    let stale = false
    setModelError(undefined)
    void service.models().then(result => {
      if (stale) return
      if (result.ok) { setModels(result.value.models); if (result.value.partial) setModelError('部分提供商未能加载，已保存的模型仍可取消选择。') }
      else setModelError(result.message)
    })
    return () => { stale = true }
  }, [service, config.id, catalogRevision])
  const valueOf = (ns: string, field: string) => edits[ns] && field in edits[ns] ? edits[ns][field] : record(views.find(view => view.ns === ns)?.value)[field]
  const edit = (ns: string, field: string, value: PluginValue | undefined) => { setEdits(current => ({ ...current, [ns]: { ...current[ns], [field]: value } })); setMessage(undefined) }
  const modelNs = 'subagent-model-selection'
  const enabled = valueOf(modelNs, 'enabled') === true
  const allowedValue = valueOf(modelNs, 'allowedModels')
  const allowed = (Array.isArray(allowedValue) ? allowedValue : []).flatMap(value => { const row = record(value); return typeof row.provider === 'string' && typeof row.model === 'string' ? [{ provider: row.provider, model: row.model }] : [] })
  const candidates = [...models, ...allowed.filter(route => !models.some(model => model.provider === route.provider && model.model === route.model)).map(route => ({ ...route, providerName: route.provider, name: `${route.model}（当前不可用）` }))]
  const invalid = config.fields.some(field => {
    const value = valueOf(field.ns, field.key)
    return field.min !== undefined && value !== undefined && (typeof value !== 'number' || !Number.isSafeInteger(value) || value < field.min)
  }) || (enabled && allowed.length === 0)
  const dirty = Object.values(edits).some(edit => Object.keys(edit).length > 0) || key.length > 0
  const save = async () => {
    if (busy || invalid) return
    setBusy(true); setMessage(undefined)
    try {
      let restart = false
      for (const view of views) {
        const patch = edits[view.ns]
        if (!patch || Object.keys(patch).length === 0) continue
        const result = await service.save(view.ns, patch, view.revision)
        if (!result.ok) { setMessage(result.message); return }
        restart ||= result.value.applies === 'restart'
        setViews(current => current.map(item => item.ns === view.ns ? result.value : item))
        setEdits(current => { const next = { ...current }; delete next[view.ns]; return next })
      }
      if (key) {
        const result = await service.saveCredential(keyRef, key)
        if (!result.ok) { setMessage(result.message); return }
        setKey(''); setCredential({ configured: true, writable: true })
      }
      setMessage(restart ? '已保存，重启后生效。' : '已保存。'); onSaved()
    } catch { setMessage('保存失败，请重试。') } finally { setBusy(false) }
  }
  return <div className={tw('flex flex-col gap-4')}>
    {!writable ? <p role="status" className={tw('text-[13px] text-muted')}>当前配置只读。</p> : null}
    {config.fields.filter(field => views.some(view => view.ns === field.ns)).map(field => <div key={field.key} className={tw('flex min-h-12 flex-wrap items-center justify-between gap-x-4 gap-y-2')}>
      <label htmlFor={`plugin-${field.key}`} className={tw('text-[13px]')}>{field.label}</label>
      <div className={tw('flex w-60 max-w-full items-center gap-1.5')}>
        <Input id={`plugin-${field.key}`} aria-label={field.label} type={field.min === undefined ? 'text' : 'number'} min={field.min} step={field.min === undefined ? undefined : 1} placeholder="默认值" value={String(valueOf(field.ns, field.key) ?? '')} disabled={!writable || busy} onChange={(event: ChangeEvent<HTMLInputElement>) => edit(field.ns, field.key, event.target.value === '' ? undefined : field.min === undefined ? event.target.value : Number(event.target.value))} className={tw('h-8 min-h-8 min-w-0 flex-1 rounded-lg text-xs')} />
        <Button size="sm" variant="ghost" isDisabled={!writable || busy} onPress={() => edit(field.ns, field.key, undefined)} className={tw('min-w-0 px-2 text-xs')}>重置</Button>
      </div>
    </div>)}
    {views.some(view => view.ns === modelNs) ? <div className={tw('flex flex-col gap-4')}>
      <div className={tw('flex items-center justify-between gap-4')}><span className={tw('text-[13px]')}>允许智能体选择子智能体模型</span><CompactSwitch label="允许智能体选择子智能体模型" selected={enabled} disabled={!writable || busy} onChange={selected => edit(modelNs, 'enabled', selected)} /></div>
      <p className={tw('m-0 text-xs text-muted')}>仅影响新会话。关闭时使用配置的默认模型或继承父智能体模型。</p>
      {enabled ? <div className={tw('grid gap-3')}>
        {modelError ? <div role="status" className={tw('flex items-center gap-2 text-[13px] text-muted')}>{modelError}<Button size="sm" variant="ghost" onPress={() => setCatalogRevision(value => value + 1)}>重试</Button></div> : null}
        {candidates.map(model => <Checkbox key={JSON.stringify([model.provider, model.model])} isSelected={allowed.some(route => route.provider === model.provider && route.model === model.model)} isDisabled={!writable || busy} onChange={(selected: boolean) => edit(modelNs, 'allowedModels', selected ? [...allowed, { provider: model.provider, model: model.model }] : allowed.filter(route => route.provider !== model.provider || route.model !== model.model))}><Checkbox.Content aria-label={`${model.providerName} ${model.name}`}><Checkbox.Control><Checkbox.Indicator /></Checkbox.Control><span className={tw('text-[13px]')}>{model.name}</span><span className={tw('text-xs text-muted')}>{model.providerName}</span></Checkbox.Content></Checkbox>)}
        {!candidates.length ? <p className={tw('text-[13px] text-muted')}>暂无可用模型</p> : null}
      </div> : null}
    </div> : null}
    {config.id === 'web-search' ? <div className={tw('flex flex-col gap-2')}><label htmlFor="plugin-search-key" className={tw('text-[13px]')}>API Key</label><Input id="plugin-search-key" type="password" autoComplete="new-password" value={key} disabled={busy || !credential?.writable} placeholder={credential?.configured ? '已配置，留空保留现有密钥' : '输入 API Key'} onChange={(event: ChangeEvent<HTMLInputElement>) => setKey(event.target.value)} className={tw('h-8 min-h-8 rounded-lg text-xs')} /></div> : null}
    {invalid ? <p role="alert" className={tw('text-[13px] text-danger')}>请检查数值范围；启用模型选择时至少选择一个模型。</p> : null}
    {message ? <p role="status" className={tw('text-[13px] text-muted')}>{message}</p> : null}
    <Button size="sm" variant="primary" isDisabled={!dirty || invalid || (!writable && !key)} isPending={busy} onPress={() => { void save() }} className={tw('h-8 min-h-8 self-end rounded-lg px-3 text-xs')}>保存</Button>
  </div>
}
