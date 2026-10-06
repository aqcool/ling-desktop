import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LingTaskChanges, LingTimelineItem } from '../src/runtime/contract.js'
import { Conversation } from '../src/ui/Conversation.js'
import { deliveryForChangedFile, withoutReviewedDeliveries } from '../src/ui/conversation-deliveries.js'

const question: LingTimelineItem = { taskId: 'task', itemId: 'question', seq: 1, turn: 1, kind: 'user-message', text: '更新入口', createdAt: '2026-10-06T00:00:00Z' }
const answer: LingTimelineItem = { ...question, itemId: 'answer', seq: 4, kind: 'assistant-message', text: '入口已更新。', turnComplete: true,
  turnTiming: { startedAt: '2026-10-06T00:00:00Z', endedAt: '2026-10-06T00:18:46Z' },
  presentedFiles: [{ seq: 3, index: 0, path: './src/app.ts' }, { seq: 3, index: 1, path: 'report.pdf' }] }
const changes: LingTaskChanges = { taskId: 'task', seq: 5, turn: 1, total: 1, added: 3, deleted: 1,
  files: [{ path: '/workspace/src/app.ts', display: 'src/app.ts', added: 3, deleted: 1 }] }

function render(items: readonly LingTimelineItem[], review = true) {
  return renderToStaticMarkup(<Conversation connection={{ phase: 'ready' }} demo={false} hasOlder={false} items={items}
    latestChanges={changes} loadingOlder={false} onLoadOlder={() => {}} onReconnect={() => {}} running={false} threadKey="task"
    onReviewChanges={review ? () => {} : undefined} onOpenDelivery={async () => ({ ok: true, value: undefined })} onPreviewDelivery={() => {}} />)
}

afterEach(() => vi.useRealTimers())

describe('conversation turn results', () => {
  it('shows edited files once, preserves separate deliverables, and places elapsed time before the answer', () => {
    const html = render([question, answer])
    expect(html).not.toContain('aria-label="打开 app.ts"')
    expect(html).toContain('已编辑 1 个文件')
    expect(html).toContain('aria-label="预览 src/app.ts"')
    expect(html).toContain('aria-label="打开 report.pdf"')
    expect(html.match(/aria-label="本轮用时"/g)).toHaveLength(1)
    expect(html.indexOf('用时 1126 秒')).toBeLessThan(html.indexOf('入口已更新。'))
    expect(html.indexOf('入口已更新。')).toBeLessThan(html.indexOf('已编辑 1 个文件'))
    expect(html.indexOf('已编辑 1 个文件')).toBeLessThan(html.lastIndexOf('aria-label="复制消息"'))
  })

  it('keeps the previous result attached to its own turn when another question arrives', () => {
    const html = render([question, answer, { ...question, itemId: 'next', seq: 6, turn: 2, text: '下一步检查服务' }])
    expect(html.indexOf('已编辑 1 个文件')).toBeLessThan(html.indexOf('下一步检查服务'))
  })

  it('keeps every loaded turn result in its own exchange rather than only the latest card', () => {
    const nextQuestion = { ...question, turn: 2, itemId: 'next-question', seq: 6, text: '再修改页面' }
    const nextAnswer = { ...answer, turn: 2, itemId: 'next-answer', seq: 8, text: '第二轮完成', presentedFiles: undefined }
    const html = renderToStaticMarkup(<Conversation connection={{ phase: 'ready' }} demo={false} hasOlder={false}
      items={[question, answer, nextQuestion, nextAnswer]} changes={[changes, { ...changes, turn: 2, seq: 9 }]}
      loadingOlder={false} onLoadOlder={() => {}} onReconnect={() => {}} running={false} threadKey="task" onReviewChanges={() => {}} />)
    expect(html.match(/已编辑 1 个文件/g)).toHaveLength(2)
    expect(html.indexOf('第 1 轮文件变更')).toBeLessThan(html.indexOf('再修改页面'))
    expect(html.indexOf('第 2 轮文件变更')).toBeGreaterThan(html.indexOf('第二轮完成'))
  })

  it('uses settled runtime time after reload rather than time since opening the conversation', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-06T01:00:00Z'))
    const before = render([question, answer])
    vi.setSystemTime(new Date('2026-10-07T01:00:00Z'))
    const after = render([question, answer])
    for (const html of [before, after]) expect(html).toContain('用时 1126 秒')
    expect(render([question, { ...answer, turnTiming: undefined }])).not.toContain('本轮用时')
  })

  it('preserves file opening when the changes view is disabled', () => {
    const html = render([question, answer], false)
    expect(html).toContain('aria-label="打开 app.ts"')
    expect(html).not.toContain('已编辑 1 个文件')
  })

  it('matches complete paths across platform separators without merging different files or turns', () => {
    const deliveries = [{ seq: 3, index: 0, path: 'src\\app.ts' }, { seq: 3, index: 1, path: 'other/app.ts' }]
    const original = { ...answer, presentedFiles: deliveries }
    expect(withoutReviewedDeliveries([original], changes)[0]?.presentedFiles).toEqual([deliveries[1]])
    expect(original.presentedFiles).toHaveLength(2)
    expect(deliveryForChangedFile(changes.files[0]!, deliveries)).toBe(deliveries[0])
    for (const item of [{ ...original, taskId: 'other' }, { ...original, turn: 2 }]) {
      expect(withoutReviewedDeliveries([item], changes)[0]).toBe(item)
    }
  })

  it('keeps the changes card when files were delivered without any closing response', () => {
    const delivery = { ...answer, kind: 'system-notice' as const, text: '', presentedFiles: [answer.presentedFiles![0]!] }
    const html = render([delivery])
    expect(html).toContain('已编辑 1 个文件')
    expect(html).not.toContain('aria-label="打开 app.ts"')
    expect(html).not.toContain('已处理')
  })

  it('matches absolute deliveries to relative recorded changes only inside that turn’s workspace', () => {
    const file = { path: 'src/app.ts', display: 'src/app.ts', added: 3, deleted: 1 }
    const recorded = { ...changes, workspacePath: '/workspace/', files: [file] }
    const deliveries = [{ seq: 3, index: 0, path: '/workspace/src/app.ts' },
      { seq: 3, index: 1, path: '/other/src/app.ts' }, { seq: 3, index: 2, path: '../other/src/app.ts' }]
    expect(withoutReviewedDeliveries([{ ...answer, presentedFiles: deliveries }], recorded)[0]?.presentedFiles).toEqual(deliveries.slice(1))
    expect(deliveryForChangedFile(file, deliveries, recorded.workspacePath)).toBe(deliveries[0])
    const html = renderToStaticMarkup(<Conversation connection={{ phase: 'ready' }} demo={false} hasOlder={false}
      items={[question, { ...answer, presentedFiles: [deliveries[0]!] }]} changes={[recorded]} loadingOlder={false}
      onLoadOlder={() => {}} onReconnect={() => {}} running={false} threadKey="task" onReviewChanges={() => {}}
      onOpenDelivery={async () => ({ ok: true, value: undefined })} onPreviewDelivery={() => {}} />)
    expect(html).not.toContain('aria-label="打开 app.ts"')
    expect(html).toContain('aria-label="预览 src/app.ts"')
    expect(deliveryForChangedFile({ ...file, path: 'src\\app.ts', display: 'src\\app.ts' }, [{ seq: 3, index: 0, path: 'C:\\work\\src\\app.ts' }], 'C:\\work')).toBeDefined()
  })
})
