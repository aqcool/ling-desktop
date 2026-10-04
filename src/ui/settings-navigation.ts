import type { IconName } from './Icon.js'

export const settingsGroups = [
  { label: '个人', items: [
    { id: 'usage', label: '使用统计', icon: 'gauge' },
    { id: 'general', label: '常规', icon: 'settings' },
    { id: 'modes', label: '模式配置', icon: 'sparkle' },
    { id: 'monitor', label: '任务监控', icon: 'listCheck' },
    { id: 'shortcuts', label: '快捷键', icon: 'keyboard' },
    { id: 'appearance', label: '外观', icon: 'palette' },
    { id: 'voice', label: '语音', icon: 'waveform' },
    { id: 'models', label: '模型', icon: 'robot' },
    { id: 'agent-presets', label: '智能体预设', icon: 'agentPreset' },
    { id: 'memory', label: '记忆', icon: 'memory' },
  ] },
  { label: '集成', items: [
    { id: 'extensions', label: '扩展管理', icon: 'grid' },
    { id: 'builtin-plugins', label: '内置插件', icon: 'sliders' },
    { id: 'hooks', label: '钩子', icon: 'hook' },
    { id: 'control', label: '电脑操控', icon: 'desktop' },
  ] },
  { label: '编码', items: [
    { id: 'git', label: 'Git', icon: 'branch' },
    { id: 'worktrees', label: 'Worktrees', icon: 'fork' },
    { id: 'connections', label: '连接', icon: 'link' },
  ] },
  { label: '归档管理', items: [
    { id: 'archived', label: '已归档', icon: 'archive' },
  ] },
  { label: '其他', items: [
    { id: 'experimental', label: '实验功能', icon: 'flask' },
    { id: 'network', label: '网络', icon: 'globe' },
  ] },
] as const satisfies readonly { label: string; items: readonly { id: string; label: string; icon: IconName }[] }[]

export type LingSettingsTab = (typeof settingsGroups)[number]['items'][number]['id']
