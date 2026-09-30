import type { ComponentProps } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EnvironmentPanel } from '../src/ui/LingShell.js'
import { MonitorSettings } from '../src/ui/MonitorSettings.js'
import { defaultMonitorPreferences, effectiveMonitorPresentation, readMonitorPreferences } from '../src/ui/monitor-preferences.js'

describe('task monitor settings', () => {
  it('matches the task monitor groups and keeps workspace files out of the settings', () => {
    const markup = renderToStaticMarkup(<MonitorSettings onChange={() => {}} preferences={defaultMonitorPreferences} />)
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

  it('omits empty groups and unavailable placeholders in both presentations', () => {
    for (const presentation of ['fixed', 'floating'] as const) {
      const html = renderPanel({ presentation })
      for (const label of ['任务回顾', '任务目标', '子智能体', '后台进程', '侧边聊天', '技能与 MCP', '产出', '网页查阅', '来源', '速记', '记忆更新', '演示画面', '暂无']) {
        expect(html).not.toContain(label)
      }
      expect(html).toContain('环境信息')
    }
    expect(renderPanel({ changes: [{ taskId: 't', turn: 1, seq: 1, files: [], total: 0, added: 0, deleted: 0 }] })).not.toContain('产出')
  })

  it('keeps populated groups while respecting their display preferences', () => {
    const timeline: PanelProps['timeline'] = [{ itemId: 'i', taskId: 't', kind: 'tool-activity', text: '- `review`: skill https://example.com', createdAt: '2026-09-30', status: 'completed', attachments: [{ attachmentId: 'a', name: 'source.txt', kind: 'file' }] }]
    const changes: PanelProps['changes'] = [{ taskId: 't', turn: 1, seq: 1, files: [{ path: 'a.ts', display: 'a.ts', added: 1, deleted: 0 }], total: 1, added: 1, deleted: 0 }]
    const html = renderPanel({ timeline, changes })
    for (const label of ['技能与 MCP', '产出', '网页查阅', '来源', 'source.txt']) expect(html).toContain(label)
    const hidden = renderPanel({ timeline, changes, preferences: { ...defaultMonitorPreferences, skills: false, outputs: false, web: false, sources: false } })
    for (const label of ['技能与 MCP', '产出', '网页查阅', '来源']) expect(hidden).not.toContain(label)
  })

  it('shows notes only for the selected task when it contains saved notes', () => {
    const selectedTask = { taskId: 't', title: 'Task', status: 'completed', archived: false, updatedAt: '2026-09-30' } as const
    let notes = '[]'
    vi.stubGlobal('localStorage', { getItem: (key: string) => key === 'ling.task-notes.v1:t' ? notes : null })
    expect(renderPanel({ selectedTask })).not.toContain('打开任务速记')
    notes = JSON.stringify([{ id: 'n', text: 'Saved note', updatedAt: '2026-09-30' }])
    expect(renderPanel({ selectedTask })).toContain('打开任务速记')
    expect(renderPanel({ selectedTask: { ...selectedTask, taskId: 'other' } })).not.toContain('打开任务速记')
  })

  it('uses workspace Git counts instead of task history and never treats unavailable stats as zero', () => {
    const changes: PanelProps['changes'] = [{ taskId: 't', turn: 1, seq: 1, files: [], total: 0, added: 999, deleted: 888 }]
    const html = renderPanel({ changes, gitLineChanges: { added: 12, deleted: 3 } })
    expect(html).toContain('+12')
    expect(html).toContain('−3')
    expect(html).not.toContain('+999')
    expect(html).not.toContain('−888')
    expect(renderPanel({ changes })).not.toContain('审阅未提交更改')
    expect(renderPanel({ gitLineChanges: { added: 0, deleted: 0 } })).toContain('+0')
  })
})
