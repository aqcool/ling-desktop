// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { KnowledgeDocument } from '../src/runtime/knowledge.js'
import {
  TaskRecapCard,
  latestTaskRecap,
  recapText,
} from '../src/ui/TaskRecap.js'

const summary: KnowledgeDocument = {
  id: 'summary',
  scope: 'project',
  kind: 'summary',
  title: '任务摘要',
  body: '## 已完成\n确认目录是演示工作区，尚未修改文件。',
  sources: [
    { kind: 'session', label: '当前会话', sessionId: 'current', seq: 3 },
  ],
  state: 'active',
  manual: false,
  version: 1,
  updatedAt: Date.UTC(2026, 9, 2, 7, 23),
}
let root: Root | undefined
beforeEach(() => vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true))
afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
  vi.unstubAllGlobals()
})
describe('current task recap', () => {
  it('selects the latest confirmed summary belonging to this session without mutating the catalog', () => {
    const docs = [
      summary,
      {
        ...summary,
        id: 'other',
        updatedAt: 10000000000000,
        sources: [
          {
            kind: 'session' as const,
            label: '另一会话',
            sessionId: 'other',
            seq: 5,
          },
        ],
      },
      {
        ...summary,
        id: 'archived',
        state: 'archived' as const,
        updatedAt: summary.updatedAt + 3,
      },
      {
        ...summary,
        id: 'candidate',
        state: 'candidate' as const,
        updatedAt: summary.updatedAt + 2,
      },
      { ...summary, id: 'newest', updatedAt: summary.updatedAt + 1 },
    ]
    expect(latestTaskRecap(docs, 'current')?.id).toBe('newest')
    expect(docs.map((doc) => doc.id)).toEqual([
      'summary',
      'other',
      'archived',
      'candidate',
      'newest',
    ])
    expect(latestTaskRecap(docs, 'missing')).toBeUndefined()
    expect(
      latestTaskRecap([{ ...summary, kind: 'wiki' }], 'current'),
    ).toBeUndefined()
  })
  it('shows the existing summary preview with its actual timestamp and independent actions', () => {
    const html = renderToStaticMarkup(
      <TaskRecapCard document={summary} onOpen={() => {}} />,
    )
    expect(html).toContain('查看当前会话摘要')
    expect(html).toContain('2026-10-02T07:23:00.000Z')
    expect(html).toContain('确认目录是演示工作区，尚未修改文件。')
    expect(html).toContain('data-icon="feather"')
    expect(html).toContain('aria-label="展开摘要"')
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('完整摘要')
    expect(html).not.toContain('<details')
    expect(html).not.toContain('最近回复')
  })
  it('expands and collapses locally through a keyboard-focusable button without opening the knowledge document', async () => {
    const onOpen = vi.fn()
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    const longSummary = { ...summary, body: '确认已完成。'.repeat(80) }
    await act(async () => root!.render(<TaskRecapCard document={longSummary} onOpen={onOpen} />))

    const toggle = container.querySelector<HTMLButtonElement>('[aria-controls]')!
    const preview = document.getElementById(toggle.getAttribute('aria-controls')!)!
    const open = container.querySelector<HTMLButtonElement>('[aria-label="查看当前会话摘要"]')!
    expect(toggle.tagName).toBe('BUTTON')
    expect(toggle.tabIndex).toBe(0)
    toggle.focus()
    expect(document.activeElement).toBe(toggle)
    expect(preview.textContent).toBe(longSummary.body)
    expect(preview.className).toContain('overflow-hidden')
    expect(preview.querySelector('[aria-hidden="true"]')).not.toBeNull()

    await act(async () => toggle.click())
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(toggle.getAttribute('aria-label')).toBe('收起摘要')
    expect(preview.className).not.toContain('overflow-hidden')
    expect(preview.querySelector('[aria-hidden="true"]')).toBeNull()
    expect(onOpen).not.toHaveBeenCalled()

    await act(async () => open.click())
    expect(onOpen).toHaveBeenCalledExactlyOnceWith(summary.id)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')

    await act(async () => toggle.click())
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(preview.className).toContain('overflow-hidden')
    expect(onOpen).toHaveBeenCalledTimes(1)
  })
  it('keeps source locations and unresolved status legible in the compact preview', () => {
    expect(
      recapText(
        '## 结果\n- **已完成**：检查 `main_entry.ts`。\n- 尚未执行：[部署](wiki:deploy)，需要确认。',
      ),
    ).toBe('已完成：检查 main_entry.ts。 尚未执行：部署，需要确认。')
  })
})
