export const compactionNamespace = 'ling-compaction'

export interface LingCompactionPreferences {
  auto: boolean
  thresholdRatio: number
  retainRatio: number
  summarizationProvider: string
  summarizationModel: string
}

export const defaultCompactionPreferences: LingCompactionPreferences = {
  auto: true, thresholdRatio: 0.8, retainRatio: 0.16,
  summarizationProvider: '', summarizationModel: '',
}

export function validateCompactionPreferences(value: LingCompactionPreferences): void {
  if (!Number.isFinite(value.thresholdRatio) || value.thresholdRatio <= 0 || value.thresholdRatio >= 1) throw new Error('触发比例必须大于 0% 且小于 100%。')
  if (!Number.isFinite(value.retainRatio) || value.retainRatio < 0 || value.retainRatio >= value.thresholdRatio) throw new Error('保留比例必须小于触发比例，且不能为负数。')
  if (Boolean(value.summarizationProvider) !== Boolean(value.summarizationModel)) throw new Error('请同时选择摘要提供商和模型，或使用当前会话模型。')
}

export interface LingCompactionRecord {
  readonly id: string
  readonly summary?: string
  readonly itemCount?: number
  readonly tokenCount?: number
  readonly range?: { readonly start: number; readonly end: number }
  readonly provider?: string
  readonly model?: string
  readonly error?: string
  readonly checkpointLanded: boolean
  readonly canRetry: boolean
}

/** Recovery advice describes the durable checkpoint, never promises lossless summarization. */
export function compactionFailure(record: LingCompactionRecord): string {
  const error = record.error ?? ''
  if (record.checkpointLanded) return '整理后的摘要已写入，但收尾未完成。原始聊天记录仍保留，请先检查当前会话再继续。'
  if (/commit|persist|save|append|flush|write|storage|写入|保存/i.test(error)) return '整理未正常结束，原始聊天记录仍保留。请先检查当前会话状态，再决定是否重新整理。'
  if (/abort|cancel|interrupt/i.test(error)) return '整理已取消，摘要未替换原文。可以继续对话，或在任务空闲时重新整理。'
  if (/changed|stability|history.*change/i.test(error)) return '整理期间上下文发生变化，摘要未替换原文。可以继续对话，或在任务空闲时重试。'
  if (/context|capacity|too.long|token.*limit|overflow/i.test(error)) return '待整理内容或固定提示超过模型容量，摘要未生效。请缩小文件或工具输出范围，并核对模型的上下文容量。'
  if (/shrink|shorter|useful|no text|empty|summary/i.test(error)) return '未能生成有效且更短的摘要，摘要未替换原文。可以继续对话，或在任务空闲时重试。'
  return '摘要未生效，原始聊天记录仍保留。可以重试整理；如果仍超出上下文容量，需要缩小输入范围。'
}
