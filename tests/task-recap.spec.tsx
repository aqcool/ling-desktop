import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
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
  it('shows the existing summary as an open card with its actual timestamp, rather than a collapsed reply', () => {
    const html = renderToStaticMarkup(
      <TaskRecapCard document={summary} onOpen={() => {}} />,
    )
    expect(html).toContain('查看当前会话摘要')
    expect(html).toContain('2026-10-02T07:23:00.000Z')
    expect(html).toContain('确认目录是演示工作区，尚未修改文件。')
    expect(html).toContain('data-icon="feather"')
    expect(html).not.toContain('<details')
    expect(html).not.toContain('最近回复')
  })
  it('keeps source locations and unresolved status legible in the compact preview', () => {
    expect(
      recapText(
        '## 结果\n- **已完成**：检查 `main_entry.ts`。\n- 尚未执行：[部署](wiki:deploy)，需要确认。',
      ),
    ).toBe('已完成：检查 main_entry.ts。 尚未执行：部署，需要确认。')
  })
})
