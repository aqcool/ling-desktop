import { useEffect, useState, type ChangeEvent } from 'react'
import type { LingPluginManager, LingPluginNamespace } from '../runtime/plugins.js'
import { compactionNamespace, defaultCompactionPreferences, validateCompactionPreferences, type LingCompactionPreferences } from '../runtime/compaction.js'
import { CompactButton, CompactInput, CompactSelect, CompactSwitch, SettingsGroup, SettingsRow } from './SettingsControls.js'
import { tw } from './tailwind.js'

type Model = { provider: string; model: string; name: string; providerName: string }
const modelKey = (provider: string, model: string) => JSON.stringify([provider, model])

export function CompactionSettings({ service }: { service?: LingPluginManager }) {
  const [view, setView] = useState<LingPluginNamespace>()
  const [writable, setWritable] = useState(false)
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState('')
  const [reload, setReload] = useState(0)
  const [models, setModels] = useState<Model[]>([])
  const [modelMessage, setModelMessage] = useState('')
  const [threshold, setThreshold] = useState('80')
  const [retain, setRetain] = useState('16')
  const [route, setRoute] = useState(modelKey('', ''))
  const [advanced, setAdvanced] = useState(false)
  const preferences = { ...defaultCompactionPreferences, ...(view?.value as Partial<LingCompactionPreferences> | undefined) }
  const adopt = (next: LingPluginNamespace) => {
    const value = next.value as unknown as LingCompactionPreferences
    setView(next); setThreshold(String(value.thresholdRatio * 100)); setRetain(String(value.retainRatio * 100))
    setRoute(modelKey(value.summarizationProvider, value.summarizationModel))
  }
  useEffect(() => {
    let stale = false
    if (!service) { setMessage('上下文整理设置暂不可用。'); return }
    setPending(true)
    void service.read().then(result => {
      if (stale) return
      if (!result.ok) { setMessage(result.message); return }
      setWritable(result.value.writable)
      const next = result.value.namespaces.find(ns => ns.ns === compactionNamespace)
      if (next) { adopt(next); setMessage('') }
      else setMessage('请重启应用以加载上下文整理设置。')
    }, () => { if (!stale) setMessage('读取设置失败，请重试。') }).finally(() => { if (!stale) setPending(false) })
    return () => { stale = true }
  }, [service, reload])
  useEffect(() => {
    if (!advanced || !service) return
    let stale = false
    void service.models().then(result => {
      if (stale) return
      if (result.ok) { setModels(result.value.models); setModelMessage(result.value.partial ? '部分模型未能加载，已保存的模型仍保留。' : '') }
      else setModelMessage(result.message)
    }, () => { if (!stale) setModelMessage('模型列表暂不可用，已保存的选择仍保留。') })
    return () => { stale = true }
  }, [advanced, service])
  const save = async (edits: Partial<LingCompactionPreferences>) => {
    if (!service || !view || pending || !writable) return
    try {
      validateCompactionPreferences({ ...preferences, ...edits })
      setPending(true); setMessage('')
      const result = await service.save(compactionNamespace, edits, view.revision)
      if (result.ok) {
        if (Object.hasOwn(edits, 'thresholdRatio')) adopt(result.value)
        else setView(result.value)
        setMessage('已保存，重启应用后生效。')
      }
      else setMessage(result.message)
    } catch (error) { setMessage(error instanceof Error ? error.message : '保存失败，请重试。') }
    finally { setPending(false) }
  }
  const options = [{ value: modelKey('', ''), label: '当前会话模型' }, ...models.map(model => ({ value: modelKey(model.provider, model.model), label: `${model.providerName} · ${model.name}` }))]
  if (route !== modelKey('', '') && !options.some(option => option.value === route)) {
    const [provider, model] = JSON.parse(route) as [string, string]
    options.push({ value: route, label: `${provider} · ${model}（已保存）` })
  }
  const disabled = pending || !view || !writable
  return <SettingsGroup title="上下文整理">
    <SettingsRow title="自动压缩上下文" description="接近模型上下文上限时整理早期对话，保留近期原文和原始聊天记录。设置在重启应用后生效。">
      <CompactSwitch label="自动压缩上下文" selected={preferences.auto} disabled={disabled} onChange={auto => { void save({ auto }) }} />
    </SettingsRow>
    <details className={tw('mx-4 mb-3 text-xs text-[var(--text-secondary)]')} onToggle={event => setAdvanced(event.currentTarget.open)}>
      <summary className={tw('cursor-pointer py-2 outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]')}>高级设置</summary>
      <div className={tw('mt-2 grid gap-3')}>
        <label className={tw('flex flex-wrap items-center justify-between gap-3')}>触发比例（%）<CompactInput aria-label="触发比例（%）" className={tw('w-24')} type="number" min={1} max={99} step={1} disabled={disabled} value={threshold} onChange={(event: ChangeEvent<HTMLInputElement>) => setThreshold(event.target.value)} /></label>
        <label className={tw('flex flex-wrap items-center justify-between gap-3')}>近期原文保留比例（%）<CompactInput aria-label="近期原文保留比例（%）" className={tw('w-24')} type="number" min={0} max={98} step={1} disabled={disabled} value={retain} onChange={(event: ChangeEvent<HTMLInputElement>) => setRetain(event.target.value)} /></label>
        <p className={tw('m-0 text-xs leading-5')}>比例以当前模型的上下文容量计算。保留比例只控制近期原文，不包含摘要、系统提示和工具定义。</p>
        <div className={tw('flex flex-wrap items-center justify-between gap-3')}><span>摘要模型</span><CompactSelect label="摘要模型" className={tw('w-64')} value={route} options={options} disabled={disabled} onChange={setRoute} /></div>
        {modelMessage ? <p className={tw('m-0 leading-5')} role="status">{modelMessage}</p> : null}
        <p className={tw('m-0 text-xs leading-5')}>摘要请求会消耗所选模型的用量。未单独选择时沿用当前会话模型。</p>
        <div className={tw('flex justify-end gap-2')}>
          <CompactButton variant="ghost" isDisabled={disabled} onPress={() => { setThreshold('80'); setRetain('16'); setRoute(modelKey('', '')) }}>恢复默认值</CompactButton>
          <CompactButton variant="secondary" isDisabled={disabled} onPress={() => {
            if (!threshold.trim() || !retain.trim()) { setMessage('请输入触发比例和保留比例。'); return }
            const [summarizationProvider, summarizationModel] = JSON.parse(route) as [string, string]
            void save({ thresholdRatio: Number(threshold) / 100, retainRatio: Number(retain) / 100, summarizationProvider, summarizationModel })
          }}>保存</CompactButton>
        </div>
      </div>
    </details>
    {message ? <div className={tw('mx-4 mb-3 flex items-center justify-between gap-2 text-xs leading-5 text-[var(--text-secondary)]')} role="status"><span>{message}</span>{!message.startsWith('已保存') ? <CompactButton variant="ghost" isDisabled={pending} onPress={() => setReload(value => value + 1)}>{view ? '重新读取' : '重试'}</CompactButton> : null}</div> : null}
  </SettingsGroup>
}
