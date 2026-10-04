import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { AutomationCenter } from '../src/ui/AutomationCenter.js'
import { automationTemplates, newAutomation } from '../src/ui/automation-view.js'
describe('local automation presentation', () => {
  it('offers a standalone local workspace without creating sessions or plans on render', () => {
    const request = vi.fn(),
      html = renderToStaticMarkup(
        <AutomationCenter workspaces={[]} service={{ request }} onOpenTask={() => {}} />,
      )
    expect(html).toContain('aria-label="自动化"')
    expect(html).toContain('用自然语言创建')
    expect(html).toContain('退出应用后计划暂停执行')
    expect(html).toContain('执行记录')
    expect(html).toContain('模板')
    expect(request).not.toHaveBeenCalled()
    for (const label of ['云端运行', '订阅', 'Credits', '当前任务的本地定时提醒'])
      expect(html).not.toContain(label)
  })
  it('uses read-only defaults and makes templates editable proposals', () => {
    expect(newAutomation()).toMatchObject({
      permission: 'read-only',
      output: 'separate',
      missed: 'skip',
      workspaceId: null,
    })
    expect(automationTemplates).toHaveLength(4)
    expect(automationTemplates.every((t) => t.prompt && t.description)).toBe(true)
  })
})
