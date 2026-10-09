import type { ComponentProps } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EnvironmentPanel } from '../src/ui/LingShell.js'
import { MonitorSettings } from '../src/ui/MonitorSettings.js'
import { MonitorSection, MonitorSectionsContext } from '../src/ui/MonitorSection.js'
import { defaultMonitorPreferences, effectiveMonitorPresentation, readMonitorPreferences } from '../src/ui/monitor-preferences.js'

describe('task monitor settings', () => {
  it('matches the task monitor groups and keeps workspace files out of the settings', () => {
    const markup = renderToStaticMarkup(<MonitorSettings onChange={() => {}} preferences={defaultMonitorPreferences} onOpenRecapSettings={() => {}} />)
    for (const label of ['展示方式', '进度与上下文', '执行活动', '结果与来源', '辅助入口', '侧边聊天', 'Skill 与 MCP']) {
      expect(markup).toContain(label)
    }
    expect(markup).not.toContain('工作区文件')
    expect(markup).not.toContain('界面预览')
  })

  it('restores saved display mode and enabled sections without accepting malformed values', () => {
    expect(readMonitorPreferences('{"presentation":"floating","outputs":false}')).toMatchObject({ presentation: 'floating', outputs: false, goal: true })
    expect(readMonitorPreferences('{"presentation":"invalid","outputs":"false"}')).toEqual(defaultMonitorPreferences)
    expect(readMonitorPreferences('{')).toEqual(defaultMonitorPreferences)
  })

  it('floats over an open workbench and returns to the configured presentation when it closes', () => {
    expect(effectiveMonitorPresentation('fixed', true)).toBe('floating')
    expect(effectiveMonitorPresentation('fixed', false)).toBe('fixed')
    expect(effectiveMonitorPresentation('floating', false)).toBe('floating')
  })
})

describe('task monitor content', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  type PanelProps = ComponentProps<typeof EnvironmentPanel>
  const renderPanel = (overrides: Partial<PanelProps> = {}) => renderToStaticMarkup(<EnvironmentPanel {...{
    preferences: defaultMonitorPreferences,
    presentation: 'fixed',
    sideChats: [],
    workspaces: [],
    timeline: [],
    changes: [],
    backgroundJobs: [],
    onSelectSideChat: () => {},
    ...overrides,
  } as PanelProps} />)

  it('restores a controlled collapsed group with its content excluded from keyboard and accessibility navigation', () => {
    const markup = renderToStaticMarkup(<MonitorSectionsContext.Provider value={{ values: { '环境信息': false }, set: () => {} }}><MonitorSection title="环境信息"><button>提交</button></MonitorSection></MonitorSectionsContext.Provider>)
    expect(markup).toContain('aria-expanded="false"')
    const contentId = markup.match(/aria-controls="([^"]+)"/)?.[1]
    expect(contentId).toBeTruthy()
    expect(markup).toContain(`id="${contentId}" hidden=""`)
  })

  it('omits empty groups and unavailable placeholders in both presentations', () => {
    for (const presentation of ['fixed', 'floating'] as const) {
      const html = renderPanel({ presentation })
      for (const label of ['任务回顾', '任务目标', '子智能体', '后台进程', '侧边聊天', '技能与 MCP', '产出', '网页查阅', '速记', '记忆更新', '演示画面', '暂无', '环境信息', '提交或推送']) {
        expect(html).not.toContain(label)
      }
      expect(html).toContain('来源')
      expect(html).toContain('aria-label="添加来源"')
    }
    expect(renderPanel({ changes: [{ taskId: 't', turn: 1, seq: 1, files: [], total: 0, added: 0, deleted: 0 }] })).not.toContain('产出')
  })

  it('keeps populated groups while respecting their display preferences', () => {
    const base = { taskId: 't', createdAt: '2026-09-30', status: 'completed' as const }
    const timeline: PanelProps['timeline'] = [
      { ...base, itemId: 'question', kind: 'user-message', text: '请参考 https://example.com/template', attachments: [{ attachmentId: 'a', name: 'source.txt', kind: 'file' }] },
      { ...base, itemId: 'skill', kind: 'tool-activity', title: 'skill', text: '已加载', tool: { input: '{"name":"review"}' } },
      { ...base, itemId: 'web', kind: 'tool-activity', title: 'web_fetch', text: 'Fetched https://example.com/review (HTTP 200)\n\nPage content' },
    ]
    const changes: PanelProps['changes'] = [{ taskId: 't', turn: 1, seq: 1, files: [{ path: 'a.ts', display: 'a.ts', added: 1, deleted: 0 }], total: 1, added: 1, deleted: 0 }]
    const html = renderPanel({ timeline, changes })
    for (const label of ['技能与 MCP', '产出', '网页查阅', '来源', 'source.txt']) expect(html).toContain(label)
    const hidden = renderPanel({ timeline, changes, preferences: { ...defaultMonitorPreferences, skills: false, outputs: false, web: false, sources: false } })
    for (const label of ['技能与 MCP', '产出', '网页查阅', '来源']) expect(hidden).not.toContain(label)
  })

  it('does not present the latest assistant reply as a generated session summary', () => {
    const html = renderPanel({ selectedTask: {taskId:'t',workspaceId:'w',title:'Task',status:'completed',archived:false,updatedAt:'2026-10-02'}, onOpenRecap:()=>{}, timeline:[{itemId:'reply',taskId:'t',kind:'assistant-message',text:'A long assistant answer is not a recap.',createdAt:'2026-10-02'}] })
    expect(html).not.toContain('A long assistant answer is not a recap.')
    expect(html).not.toContain('最近回复')
    expect(html).not.toContain('查看当前会话摘要')
  })

  it('keeps the notes entry available for creating a first note in the selected task', () => {
    const selectedTask = { taskId: 't', title: 'Task', status: 'completed', archived: false, updatedAt: '2026-09-30' } as const
    expect(renderPanel({ selectedTask })).toContain('打开任务速记')
    expect(renderPanel()).not.toContain('打开任务速记')
    expect(renderPanel({ selectedTask, preferences: { ...defaultMonitorPreferences, quickNotes: false } })).not.toContain('打开任务速记')
  })

  it('uses workspace Git counts instead of task history and never treats unavailable stats as zero', () => {
    const changes: PanelProps['changes'] = [{ taskId: 't', turn: 1, seq: 1, files: [], total: 0, added: 999, deleted: 888 }]
    const environment = { selectedTask: { taskId: 't', workspaceId: 'w', title: 'Task', status: 'completed' as const, archived: false, updatedAt: '2026-10-08' }, workspaces: [{ workspaceId: 'w', label: 'Project' }] }
    const html = renderPanel({ ...environment, changes, gitLineChanges: { added: 12, deleted: 3 } })
    expect(html).toContain('+12')
    expect(html).toContain('−3')
    expect(html).not.toContain('+999')
    expect(html).not.toContain('−888')
    expect(renderPanel({ ...environment, changes })).not.toContain('审阅未提交更改')
    expect(renderPanel({ ...environment, gitLineChanges: { added: 0, deleted: 0 } })).toContain('+0')
  })

  it('uses the actual remote environment and hides unavailable Git actions', () => {
    const html = renderPanel({ environmentRemote: true, environmentLabel: 'SSH Production' })
    expect(html).toContain('环境信息')
    expect(html).toContain('SSH Production')
    expect(html).toContain('data-icon="globe"')
    expect(html).not.toContain('本地')
    expect(html).not.toContain('提交或推送')
    expect(renderPanel({ environmentRemote: true, environmentLabel: 'SSH Production', onGitOpen: () => {} })).toContain('提交或推送')
  })
})
