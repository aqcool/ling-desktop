import { expect, it } from 'vitest'
import type { LingTimelineItem } from '../src/runtime/contract.js'
import { sameTimelineItem, sameTimelineProps } from '../src/ui/timeline-item-equality.js'

const item: LingTimelineItem = {
  itemId: 'call', taskId: 'task', kind: 'tool-activity', text: 'output', createdAt: 'now', status: 'running',
  attachments: [{ attachmentId: 'image', name: 'screen.png', kind: 'image', bytes: 32 }],
  execution: { callId: 'call', summary: 'check', server: 'local', cwd: '/qa', command: 'ls', output: 'one', status: 'running' },
}

it('reuses unchanged runtime and presentation records even when snapshots clone them', () => {
  expect(sameTimelineItem(item, structuredClone(item))).toBe(true)
  expect(sameTimelineItem({ ...item, detail: undefined }, { ...structuredClone(item), detail: undefined })).toBe(true)
  expect(sameTimelineItem(item, { ...item, attachments: undefined })).toBe(false)
})

it('does not hide changes to text, reasoning, execution status, logs or attachment metadata', () => {
  for (const patch of [
    { text: 'new output' }, { detail: 'new thought' }, { reasoningStreaming: true }, { turnComplete: true },
    { status: 'failed' as const }, { execution: { ...item.execution!, output: 'two' } },
    { execution: { ...item.execution!, status: 'failed' as const, exitCode: 1 } },
    { attachments: [{ ...item.attachments![0]!, name: 'updated.png' }] },
  ]) expect(sameTimelineItem(item, { ...item, ...patch })).toBe(false)
})

it('refreshes message actions when callbacks, disabled flags or retry sources change', () => {
  const props = { item, live: false, disabled: false, onEdit: () => {} }
  expect(sameTimelineProps(props, { ...props, item: structuredClone(item) })).toBe(true)
  expect(sameTimelineProps(props, { ...props, onEdit: () => {} })).toBe(false)
  expect(sameTimelineProps(props, { ...props, disabled: true })).toBe(false)
  expect(sameTimelineProps(props, { ...props, live: true })).toBe(false)
  const retry = { ...props, retryItem: item }
  expect(sameTimelineProps(retry, { ...retry, retryItem: { ...item, text: 'different question' } })).toBe(false)
})
