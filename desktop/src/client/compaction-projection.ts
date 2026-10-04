import type { ConversationNodeDefinition, ConversationViewNode } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-compaction/types'
import { isReplacementSurfaceEvent } from '@deepseek-ai/dsh-session/surface'
import type { LingTimelineItem, LingCompactionRecord } from 'ling-desktop/runtime'
import { compactionFailure } from 'ling-desktop/runtime'

interface CompactionView {
  readonly time: number
  readonly status: 'running' | 'completed' | 'failed' | 'interrupted'
  readonly turn?: number
  readonly checkpointSeq?: number
  readonly sourceCommandId?: string
  readonly record: LingCompactionRecord
}

function checkpoint(value: unknown): { compactionId: string; sourceCommandId?: string } | undefined {
  if (!value || typeof value !== 'object') return undefined
  const source = value as Record<string, unknown>
  return source.kind === 'plugin' && source.plugin === 'compact' && typeof source.compactionId === 'string'
    ? { compactionId: source.compactionId, ...(typeof source.sourceCommandId === 'string' ? { sourceCommandId: source.sourceCommandId } : {}) } : undefined
}

/** A resumed session closes any incomplete transaction from the previous process. */
export const lingCompactionBoundaryDefinition: ConversationNodeDefinition = {
  kind: 'ling-compaction-boundary', target: 'chat',
  match: event => event.type === 'session/end-seed' ? { id: 'resume', role: 'update' } : null,
  start: () => ({}), update: () => ({}),
  buildViewNode(context) {
    const match = context.matches.at(-1)
    if (!match) return null
    return { key: context.key, id: context.id, kind: 'ling-compaction-boundary', target: 'chat', anchorSeq: match.event.seq,
      location: match.location, visibility: 'visible', data: null }
  },
}

/** Native presentation over the public DSH lifecycle; it never changes the model surface. */
export const lingCompactionDefinition: ConversationNodeDefinition = {
  kind: 'ling-compaction', target: 'chat',
  match(event) {
    if (event.type === 'compaction/start' || event.type === 'compaction/summary' || event.type === 'compaction/end') return { id: event.data.compactionId, role: event.type === 'compaction/start' ? 'start' : 'update' }
    if (event.type === 'user/message' && isReplacementSurfaceEvent(event)) {
      const source = checkpoint(event.data.source)
      if (source) return { id: source.compactionId, role: 'update' }
    }
    return null
  },
  start: () => ({}), update: () => ({}),
  buildViewNode(context) {
    const start = context.matches.find(match => match.event.type === 'compaction/start')?.event
    const summary = context.matches.find(match => match.event.type === 'compaction/summary')?.event
    const end = context.matches.find(match => match.event.type === 'compaction/end')?.event
    const landed = context.matches.find(match => match.event.type === 'user/message' && isReplacementSurfaceEvent(match.event) && checkpoint(match.event.data.source))?.event
    if (!start && !summary && !end && !landed) return null
    const error = end?.type === 'compaction/end' ? end.data.error : undefined
    const record: LingCompactionRecord = {
      id: context.id, checkpointLanded: Boolean(landed), canRetry: Boolean(error) && !landed && !/commit|persist|save|append|flush|write|storage|写入|保存/i.test(error ?? ''),
      ...(summary?.type === 'compaction/summary' ? {
        summary: summary.data.summary.filter(block => block.type === 'text').map(block => block.text).join('\n'),
        itemCount: summary.data.shadowedSeqs.length, tokenCount: summary.data.shadowedTokenCount,
        range: summary.data.shadowedRange, provider: summary.data.provider, model: summary.data.model,
      } : {}),
      ...(error ? { error } : {}),
    }
    const owner = start?.type === 'compaction/start' ? start.data.turn : end?.type === 'compaction/end' ? end.data.turn : null
    const sourceCommandId = start?.type === 'compaction/start' ? start.data.sourceCommandId
      : summary?.type === 'compaction/summary' ? summary.data.sourceCommandId
        : landed?.type === 'user/message' ? checkpoint(landed.data.source)?.sourceCommandId
          : end?.type === 'compaction/end' ? end.data.sourceCommandId : undefined
    const data: CompactionView = {
      time: (start ?? summary ?? end ?? landed)!.time,
      status: error ? /abort|cancel|interrupt/i.test(error) ? 'interrupted' : 'failed'
        : start && !end ? 'running' : landed ? 'completed' : end ? 'interrupted' : 'running',
      ...(typeof owner === 'number' ? { turn: owner } : {}),
      ...(landed ? { checkpointSeq: landed.seq } : {}), record,
      ...(sourceCommandId === undefined ? {} : { sourceCommandId }),
    }
    return { key: context.key, id: context.id, kind: 'ling-compaction', target: 'chat', anchorSeq: (start ?? summary ?? end ?? landed)!.seq,
      location: context.start?.location ?? context.matches[0]?.location ?? { kind: 'unresolved' }, visibility: 'visible', data }
  },
}

export function projectCompaction(taskId: string, node: ConversationViewNode & { readonly anchorSeq: number }, turnClosed = false): LingTimelineItem {
  const data = node.data as CompactionView
  const status = data.status === 'running' && turnClosed ? 'interrupted' : data.status
  const record = status === 'interrupted' && !data.record.error ? { ...data.record, error: 'interrupted', canRetry: !data.record.checkpointLanded } : data.record
  return {
    itemId: `${taskId}:compaction:${record.id}`, taskId, seq: node.anchorSeq,
    ...(data.turn === undefined ? {} : { turn: data.turn }), kind: 'system-notice',
    title: status === 'running' ? '正在整理上下文' : status === 'completed' ? '上下文已整理' : status === 'interrupted' ? '上下文整理未完成' : '上下文整理失败',
    text: status === 'completed' ? `${record.itemCount === undefined ? '早期记录已整理' : `${record.itemCount} 条早期记录已整理`}${record.tokenCount === undefined ? '' : ` · 约 ${record.tokenCount.toLocaleString('zh-CN')} tokens`}`
      : status === 'running' ? '整理早期对话，完成后继续任务。' : compactionFailure(record),
    createdAt: new Date(data.time).toISOString(), status, compaction: record,
  }
}
