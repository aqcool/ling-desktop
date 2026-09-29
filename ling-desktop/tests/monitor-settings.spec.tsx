import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
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
