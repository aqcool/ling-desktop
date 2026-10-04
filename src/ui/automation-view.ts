import type { AutomationSpec, AutomationSchedule } from '../runtime/automation.js'
export function newAutomation(timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone): AutomationSpec {
  return {
    name: '',
    prompt: '',
    workspaceId: null,
    model: null,
    schedule: { kind: 'daily', time: '09:00', timeZone, weekdays: [] },
    expiresAt: null,
    permission: 'read-only',
    output: 'separate',
    missed: 'skip',
    enabled: true,
  }
}
export function scheduleLabel(s: AutomationSchedule) {
  if (s.kind === 'once') return `仅一次 · ${new Date(s.at).toLocaleString()}`
  if (s.kind === 'interval') return `每 ${s.minutes} 分钟`
  const days = ['日', '一', '二', '三', '四', '五', '六']
  return `${s.kind === 'daily' ? '每天' : `每周${s.weekdays.map((d) => days[d]).join('、')}`} ${s.time} · ${s.timeZone}`
}
export const automationTemplates = [
  {
    name: '项目变更日报',
    description: '检查近期提交与工作区变更，整理进展、风险和下一步。',
    prompt:
      '查看此项目最近一天的提交与工作区变更，汇总完成事项、潜在风险和待处理工作。引用对应文件或提交。不要修改代码。',
    schedule: { kind: 'daily', time: '09:00', weekdays: [] },
  },
  {
    name: '代码安全检查',
    description: '检查高风险写法，给出有证据的修复建议。',
    prompt:
      '检查项目中可能的安全风险，重点关注鉴权、输入验证和敏感信息。只报告能定位到具体代码的问题，给出文件位置与修复建议，不修改代码。',
    schedule: { kind: 'weekly', time: '10:00', weekdays: [1] },
  },
  {
    name: '测试与质量回顾',
    description: '运行项目已有检查，整理失败原因和变化。',
    prompt:
      '阅读项目说明，运行现有测试和检查命令，汇总通过情况、失败原因和修复建议。不要安装依赖或修改项目配置。',
    schedule: { kind: 'weekly', time: '16:00', weekdays: [5] },
  },
  {
    name: '项目知识整理',
    description: '汇总本周项目变化，提出 Wiki 与记忆的更新建议。',
    prompt:
      '使用项目已有知识与最近提交，汇总本周架构、模块和约定的变化。提出需要更新的 Wiki 和项目记忆，并附上来源证据。不要把临时任务状态记为长期规则。',
    schedule: { kind: 'weekly', time: '17:00', weekdays: [5] },
  },
] as const
export const automationStatusLabels = {
  queued: '已排队',
  running: '运行中',
  'waiting-approval': '等待审批',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
  interrupted: '执行中断',
  skipped: '已跳过',
} as const
