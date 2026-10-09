import type { LingEvolutionService, LingReadResult } from 'ling-desktop/runtime'
import type { LingEvolutionRemote } from '../evolution-contract.ts'

export function createEvolutionProjection(read: () => LingEvolutionRemote | undefined, mounted: Promise<unknown>): LingEvolutionService {
  async function request<T>(call: (remote: LingEvolutionRemote) => Promise<{ ok: true; value: T } | { ok: false; error: { code: string; message?: string } }>, signal?: AbortSignal): Promise<LingReadResult<T>> {
    try {
      await mounted; signal?.throwIfAborted()
      const remote = read()
      if (!remote) throw new Error('自进化服务尚未就绪，请重试。')
      const result = await call(remote)
      if (result.ok) return result
      const code = result.error.code
      return { ok: false, reason: /permission|denied/u.test(code) ? 'permission-denied' : /conflict/u.test(code) ? 'document-conflict' : /not-found/u.test(code) ? 'task-not-found' : /invalid/u.test(code) ? 'invalid-command' : 'runtime-unavailable',
        message: result.error.message || '自进化服务暂不可用。', retryable: /transport|connection|timeout/u.test(code) }
    } catch (error) { return { ok: false, reason: 'runtime-unavailable', message: error instanceof Error ? error.message : '自进化服务暂不可用。', retryable: true } }
  }
  return {
    list: (taskId, signal) => request(remote => remote.list(taskId, signal), signal),
    async create(taskId, id, version) {
      const result = await request(remote => remote.create({ taskId, id, version }))
      return result.ok ? { ok: true, value: undefined } : result
    },
    async ignore(taskId, id, version) {
      const result = await request(remote => remote.ignore({ taskId, id, version }))
      return result.ok ? { ok: true, value: undefined } : result
    },
  }
}
