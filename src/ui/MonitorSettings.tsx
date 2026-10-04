import { CompactSelect, CompactSwitch, CompactButton, SettingsHeader, SettingsRow, SettingsGroup } from './SettingsControls.js'
import { Icon } from './Icon.js'
import type { MonitorPreferences } from './monitor-preferences.js'
import { tw } from './tailwind.js'

type SwitchKey = Exclude<keyof MonitorPreferences, 'presentation' | 'showByDefault'>

const groups: readonly { title: string; rows: readonly { key: SwitchKey; title: string; description: string }[] }[] = [
  { title: '进度与上下文', rows: [
    { key: 'recap', title: '任务回顾', description: '在任务监控中显示当前任务的简短回顾。' },
    { key: 'goal', title: '任务目标', description: '显示当前任务正在追踪的目标。' },
    { key: 'plan', title: '计划', description: '显示当前任务的计划入口。' },
  ] },
  { title: '执行活动', rows: [
    { key: 'subagents', title: '子智能体', description: '显示后台子智能体的运行状态和入口。' },
    { key: 'processes', title: '后台进程', description: '显示后台命令和长时间运行进程。' },
    { key: 'sideChats', title: '侧边聊天', description: '显示从当前任务分出的侧边聊天。' },
    { key: 'skills', title: 'Skill 与 MCP', description: '显示任务使用的 Skill、MCP 和其他运行时能力。' },
  ] },
  { title: '结果与来源', rows: [
    { key: 'outputs', title: '产出', description: '显示任务产生的文件和其他结果。' },
    { key: 'web', title: '网页查阅', description: '显示任务过程中打开的网页。' },
    { key: 'sources', title: '来源', description: '显示任务引用的文件和链接，以及添加来源的入口。' },
  ] },
  { title: '辅助入口', rows: [
    { key: 'quickNotes', title: 'Quick Notes', description: '显示 Quick Notes 入口；仅在试验功能已启用时生效。' },
    { key: 'memoryUpdates', title: '记忆更新', description: '记忆发生更新时，显示前往记忆设置的入口。' },
    { key: 'demoScreen', title: '演示画面', description: '在固定模式中显示演示画面的显隐控制。' },
  ] },
]

interface MonitorSettingsProps {
  readonly preferences: MonitorPreferences
  readonly onChange: (next: MonitorPreferences) => void
  readonly onOpenRecapSettings: () => void
}

export function MonitorSettings({ preferences, onChange, onOpenRecapSettings }: MonitorSettingsProps) {
  const update = <Key extends keyof MonitorPreferences>(key: Key, value: MonitorPreferences[Key]) => {
    onChange({ ...preferences, [key]: value })
  }
  return <section aria-label="任务监控设置" className={tw('w-full min-w-0 max-w-3xl pb-8')}>
    <SettingsHeader title="任务监控" description="选择任务监控的展示方式，以及需要启用的内容。修改会立即应用到所有任务。" />
    <SettingsGroup title="展示方式">
      <SettingsRow title="任务监控形式" description="选择浮窗或右侧固定展示。工作面展开或聊天空间不足时使用浮窗，空间恢复后回到所选形式。">
        <CompactSelect label="任务监控形式" value={preferences.presentation} onChange={value => update('presentation', value as MonitorPreferences['presentation'])} options={[{ value: 'fixed', label: '固定' }, { value: 'floating', label: '浮动' }]} />
      </SettingsRow>
      <SettingsRow title="固定模式默认展示" description="首次进入任务时是否默认展示。手动收起后保持隐藏；展开工作面不会打开已隐藏的监控。">
        <CompactSelect label="固定模式默认展示" value={preferences.showByDefault ? 'show' : 'hide'} onChange={value => update('showByDefault', value === 'show')} options={[{ value: 'show', label: '默认展示' }, { value: 'hide', label: '默认隐藏' }]} />
      </SettingsRow>
    </SettingsGroup>
    {groups.map(group => <SettingsGroup title={group.title} key={group.title}>
      {group.rows.map(row => <SettingsRow key={row.key} title={row.title} description={row.description}>
        {row.key === 'recap' ? <CompactButton aria-label="设置任务回顾" isIconOnly variant="ghost" onPress={onOpenRecapSettings} title="设置整理模型与自动总结会话"><Icon name="settings" size={16} /></CompactButton> : null}
        <CompactSwitch label={row.title} selected={preferences[row.key]} onChange={value => update(row.key, value)} />
      </SettingsRow>)}
    </SettingsGroup>)}
  </section>
}
