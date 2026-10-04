import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { LingTimelineItem } from '../src/runtime/contract.js'
import { compactionFailure } from '../src/runtime/compaction.js'
import { CompactionActivity } from '../src/ui/CompactionActivity.js'
import { ContextWindowIndicator } from '../src/ui/ContextWindowIndicator.js'
import { displayTimeline, retrySource } from '../src/ui/Conversation.js'

const item: LingTimelineItem = { itemId: 'compact', taskId: 'test', kind: 'system-notice', title: '上下文已整理', text: '3 条早期记录已整理', createdAt: '2026-10-04T00:00:00Z', status: 'completed', compaction: { id: 'compact', checkpointLanded: true, canRetry: false, summary: '项目摘要正文', range: { start: 1, end: 8 } } }
describe('quiet context compaction presentation', () => {
  it('keeps the summary and exact range inside an initially collapsed row', () => {
    const html = renderToStaticMarkup(<CompactionActivity item={item} disabled={false} />)
    expect(html).toContain('上下文已整理')
    expect(html).toContain('记录 1 → 8')
    expect(html).toContain('项目摘要正文')
    expect(html).not.toMatch(/<details[^>]*\bopen/)
    expect(html).not.toContain('重新整理')
    expect(displayTimeline([item], false, true)).toMatchObject([{ process: false }])
  })
  it('shows retry for a failed compaction but never retries the user question through it', () => {
    const failed = { ...item, status: 'failed' as const, compaction: { id: 'compact', checkpointLanded: false, canRetry: true, error: 'fetch failed' } }
    const html = renderToStaticMarkup(<CompactionActivity item={failed} disabled={true} onRetry={() => {}} />)
    expect(html).toContain('重新整理')
    expect(html).toContain('disabled')
    expect(html).not.toContain('编辑')
    expect(retrySource([{ ...item, itemId: 'question', kind: 'user-message', text: '检查代码', compaction: undefined }, failed])).toBeUndefined()
  })
  it('shows progress without a made-up occupancy percentage before capacity is available', () => {
    const html = renderToStaticMarkup(<ContextWindowIndicator compaction={{ ...item, status: 'running' }} compactDisabled={false} onCompact={() => {}} />)
    expect(html).toContain('正在整理')
    expect(html).not.toContain('>0%</span>')
  })
  it('explains oversized input, ineffective summaries and uncertain persistence separately', () => {
    const record = { id: 'c', checkpointLanded: false, canRetry: true }
    expect(compactionFailure({ ...record, error: 'context capacity exceeded' })).toContain('缩小文件或工具输出范围')
    expect(compactionFailure({ ...record, error: 'summary did not shrink' })).toContain('更短的摘要')
    expect(compactionFailure({ ...record, error: 'persist failed' })).toContain('先检查当前会话状态')
  })
})
