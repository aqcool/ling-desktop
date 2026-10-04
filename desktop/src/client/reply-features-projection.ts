import type { LingReplyFeatures, LingReadResult } from 'ling-desktop/runtime'
import type { LingReplyRemote } from '../reply-features-contract.ts'

export function createReplyFeaturesProjection(read: () => LingReplyRemote | undefined, mounted: Promise<unknown>, fetcher: typeof fetch = globalThis.fetch): LingReplyFeatures {
  return {
    async suggestions(taskId, seq, signal) {
      try {
        await mounted; signal.throwIfAborted()
        const service = read()
        if (!service) throw new Error('建议服务尚未就绪。')
        const result = await service.suggestions({ taskId, seq }, signal)
        return result.ok ? result : { ok: false, reason: 'runtime-unavailable', message: result.error.message || '建议暂不可用。', retryable: true }
      } catch { return { ok: false, reason: 'runtime-unavailable', message: '建议暂不可用。', retryable: true } }
    },
    async openFile(taskId, file, signal): Promise<LingReadResult<void>> {
      try {
        const query = new URLSearchParams({ sessionId: taskId, seq: String(file.seq), index: String(file.index) })
        const result = await fetcher(`/api/present.open?${query}`, { method: 'POST', signal })
        if (result.ok) return { ok: true, value: undefined }
        return { ok: false, reason: 'runtime-unavailable', retryable: result.status >= 500,
          message: result.status === 404 ? '文件已不存在或交付记录不可用。'
            : result.status === 422 ? '该文件无法在本机应用打开，请使用右侧预览。'
              : result.status === 409 ? '系统应用打开暂不可用，请使用右侧预览。' : '文件打开失败，请重试。' }
      } catch { return { ok: false, reason: 'runtime-unavailable', message: '文件打开失败，请检查连接。', retryable: true } }
    },
  }
}
