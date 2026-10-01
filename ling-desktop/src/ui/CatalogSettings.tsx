import { useState } from 'react'
import type { LingModelSettings, LingProviderTestTarget, LingReadResult, LingDiscoveredModel } from '../runtime/contract.js'
import { useBehavior, updateBehavior } from './behavior-preferences.js'
import { CompactSelect, CompactSwitch, CompactInput, CompactButton, SettingsHeader, SettingsGroup, SettingsRow } from './SettingsControls.js'
import { type IconName } from './Icon.js'
import type { LingSettingsTab } from './settings-navigation.js'
import { tw } from './tailwind.js'

type CatalogTab = Exclude<LingSettingsTab, 'usage' | 'shortcuts' | 'appearance' | 'models' | 'archived' | 'monitor' | 'git' | 'worktrees' | 'general' | 'modes' | 'agent-presets' | 'builtin-plugins' | 'connections' | 'control'>
type Control = { kind: 'toggle'; selected?: boolean } | { kind: 'select' | 'button' | 'input'; label: string } | { kind: 'none' }
interface Row { title: string; description: string; icon: IconName; control?: Control }
interface Group { title?: string; rows: readonly Row[]; empty?: { title: string } }
interface Page { title: string; description?: string; groups: readonly Group[] }

const toggle: Control = { kind: 'toggle' }
const select = (label: string): Control => ({ kind: 'select', label })
const button = (label: string): Control => ({ kind: 'button', label })
const input = (label: string): Control => ({ kind: 'input', label })

const pages: Record<CatalogTab, Page> = {
  voice: {
    title: '语音', description: '配置语音输入与实时语音。', groups: [
      { title: '通用', rows: [{ title: '输入设备', description: '选择用于语音输入的麦克风。', icon: 'mic', control: select('自动') }] },
      { title: '语音输入', rows: [
        { title: '语音输入', description: '在任务输入框中使用麦克风输入。', icon: 'mic', control: toggle },
        { title: '语音识别润色', description: '调整口语停顿、重复和标点。', icon: 'edit', control: toggle },
        { title: '声纹识别', description: '降低周围人声对识别结果的干扰。', icon: 'waveform', control: toggle },
        { title: '常用词纠正', description: '添加专有名词或术语。', icon: 'book', control: input('添加词汇') },
      ], empty: { title: '语音输入历史尚未接入' } },
      { title: '实时语音', rows: [
        { title: '实时语音快捷键', description: '开始或结束实时语音。', icon: 'keyboard', control: button('⌘ ⇧ L') },
        { title: '播报音色', description: '新语音连接使用的音色。', icon: 'waveform', control: select('默认') },
        { title: '播报速度', description: '新语音连接使用的速度。', icon: 'clock', control: select('正常') },
        { title: '屏幕上下文', description: '允许语音任务参考当前屏幕。', icon: 'desktop', control: toggle },
      ] },
      { title: '录音纪要', rows: [{ title: '最长时长', description: '到达上限后停止录音。', icon: 'clock', control: select('5 分钟') }] },
    ],
  },
  pet: {
    title: '桌面宠物', description: '管理显示在桌面上的宠物。', groups: [
      { title: '显示', rows: [
        { title: '显示桌面宠物', description: '在桌面上显示可拖动的宠物。', icon: 'ghost', control: toggle },
        { title: '当前宠物', description: '选择已安装的桌面宠物。', icon: 'ghost', control: select('未安装') },
        { title: '显示大小', description: '调整桌面宠物的尺寸。', icon: 'expand', control: select('100%') },
      ] },
    ],
  },
  memory: {
    title: '记忆', description: '查看和管理保存在本机的长期记忆。', groups: [
      { title: '记忆行为', rows: [
        { title: '全局记忆', description: '在不同项目中读取和更新个人偏好。', icon: 'book', control: toggle },
        { title: '项目记忆', description: '按项目保存规则、经验与上下文。', icon: 'folder', control: toggle },
      ] },
      { title: '全局记忆', rows: [], empty: { title: '全局记忆列表尚未接入' } },
      { title: '项目记忆', rows: [], empty: { title: '项目记忆列表尚未接入' } },
    ],
  },
  import: {
    title: '数据导入', description: '从其他本地应用导入内容，不修改来源数据。', groups: [
      { title: '从应用导入', rows: [], empty: { title: '数据来源检测尚未接入' } },
    ],
  },
  extensions: {
    title: '扩展管理', description: '管理本机插件、技能、连接器和智能体。', groups: [
      { title: '已安装项', rows: [], empty: { title: '扩展列表尚未接入' } },
    ],
  },
  hooks: {
    title: '钩子', description: '查看本机配置中声明的 Hooks。', groups: [
      { title: '配置来源', rows: [{ title: '用户级 settings.json', description: '此页面只展示磁盘配置，不代表运行时已加载。', icon: 'file', control: select('未读取') }] },
      { title: '已配置的 Hooks', rows: [], empty: { title: '尚未读取 Hooks' } },
    ],
  },
  security: {
    title: '安全', description: '在本地开发流程中检查代码风险。', groups: [
      { title: '扫描层级', rows: [
        { title: '静态检查', description: '检查本轮任务生成的代码中的常见危险模式。', icon: 'shield', control: toggle },
        { title: '轻量扫描', description: '检查增量代码中的注入及敏感信息泄露风险。', icon: 'search', control: toggle },
        { title: '深度扫描', description: '跨文件追踪数据流和关联风险。', icon: 'code', control: toggle },
      ] },
    ],
  },
  experimental: {
    title: '实验功能', description: '仍在验证中的本地功能。', groups: [
      { rows: [
        { title: '速记板', description: '将回复中的选中文字保存为本机速记。', icon: 'book', control: toggle },
        { title: '回复批注', description: '划选回复文字并添加评论。', icon: 'edit', control: toggle },
        { title: 'Workspace Actions', description: '从任务标题执行本机工作区命令。', icon: 'terminal', control: toggle },
        { title: '录音纪要', description: '录音并生成可发送的纪要。', icon: 'mic', control: toggle },
        { title: '按工作模式区分对话列表', description: '按当前模式筛选本机任务列表。', icon: 'sort', control: toggle },
      ] },
    ],
  },
  network: {
    title: '网络', description: '查看本机网络和代理设置。', groups: [
      { title: '连接检测', rows: [{ title: '模型服务连接', description: '检查当前配置的模型服务是否可访问。', icon: 'globe', control: button('运行诊断') }] },
      { title: '网络代理', rows: [
        { title: '代理方式', description: '设置本机应用与本地 Agent 的网络代理。', icon: 'globe', control: select('跟随系统') },
        { title: '配置状态', description: '代理配置读取尚未接入。', icon: 'info', control: button('保存') },
      ] },
    ],
  },
}

function PreviewControl({ control, title }: { control?: Control; title: string }) {
  if (!control || control.kind === 'none') return null
  if (control.kind === 'toggle') return <CompactSwitch label={title} selected={control.selected ?? false} disabled />
  if (control.kind === 'select') return <CompactSelect label={title} value={control.label} options={[{ value: control.label, label: control.label }]} disabled onChange={() => {}} />
  if (control.kind === 'input') return <CompactInput aria-label={title} className={tw('w-40')} disabled placeholder={control.label} />
  return <CompactButton variant="secondary" isDisabled>{control.label}</CompactButton>
}

export function CatalogSettings({ tab, modelSettings, onTestProvider }: { readonly tab: CatalogTab; readonly modelSettings?: LingModelSettings; readonly onTestProvider?: (target: LingProviderTestTarget) => Promise<LingReadResult<readonly LingDiscoveredModel[]>> }) {
  const behavior = useBehavior()
  const page = pages[tab]
  if (tab === 'network') return <NetworkDiagnostics modelSettings={modelSettings} onTestProvider={onTestProvider} />
  return <section aria-label={page.title} className={tw('w-full min-w-0 max-w-3xl pb-8')}>
    <SettingsHeader title={page.title} description={page.description}><span className={tw('pt-1 text-xs text-[var(--text-tertiary)]')}>{tab === 'experimental' ? '灰色控件尚未接入' : '界面预览 · 功能尚未接入'}</span></SettingsHeader>
    {page.groups.map((group, index) => <SettingsGroup key={`${group.title ?? 'main'}-${index}`} title={group.title}>
      {group.rows.map(row => <SettingsRow key={row.title} title={row.title} description={row.description}><>{tab === 'experimental' && row.title === '速记板' ? <CompactSwitch label="速记板" selected={behavior.quickNotes} onChange={quickNotes => updateBehavior({ quickNotes })} /> : <PreviewControl control={row.control} title={row.title} />}</></SettingsRow>)}
      {group.empty ? <p className={tw('m-0 px-4 py-8 text-center text-xs text-[var(--text-tertiary)]')}>{group.empty.title}</p> : null}
    </SettingsGroup>)}
  </section>
}

function NetworkDiagnostics({ modelSettings, onTestProvider }: { modelSettings?: LingModelSettings; onTestProvider?: (target: LingProviderTestTarget) => Promise<LingReadResult<readonly LingDiscoveredModel[]>> }) {
  const [pending, setPending] = useState<string>()
  const [results, setResults] = useState<Record<string, { ok: boolean; message: string }>>({})
  const providers = modelSettings?.providers.filter(provider => provider.configured && provider.canTest) ?? []
  const diagnose = async (providerId: string) => {
    if (!onTestProvider || pending) return
    setPending(providerId)
    try {
      const result = await onTestProvider({ providerId })
      setResults(current => ({ ...current, [providerId]: result.ok ? { ok: true, message: `连接成功 · 返回 ${result.value.length} 个模型` } : { ok: false, message: result.message } }))
    } catch (cause) { setResults(current => ({ ...current, [providerId]: { ok: false, message: cause instanceof Error ? cause.message : '连接检测失败。' } })) }
    finally { setPending(undefined) }
  }
  return <section aria-label="网络" className={tw('w-full min-w-0 max-w-3xl pb-8')}>
    <SettingsHeader title="网络" description="检测已配置模型服务的连接。" />
    <SettingsGroup title="连接检测">
      {providers.map(provider => <SettingsRow key={provider.providerId} title={provider.displayName} description={results[provider.providerId]?.message ?? '读取服务端模型列表，检查认证与网络连接。'}>
        <CompactButton variant="secondary" isDisabled={!onTestProvider || Boolean(pending)} onPress={() => { void diagnose(provider.providerId) }}>{pending === provider.providerId ? '检测中…' : '检测连接'}</CompactButton>
      </SettingsRow>)}
      {!providers.length ? <p className={tw('m-0 px-4 py-6 text-xs text-[var(--text-tertiary)]')}>暂无支持连接检测的已配置提供商。</p> : null}
    </SettingsGroup>
    <SettingsGroup title="网络代理"><SettingsRow title="启动环境" description="DSH 使用启动环境中的代理配置；更改后需要重启应用。">{null}</SettingsRow></SettingsGroup>
  </section>
}
