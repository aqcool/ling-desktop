import type { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-workspace'
import type {} from '../session-lifecycle.ts'
import type {} from '../session-storage.ts'
import type {} from './automation-controller.ts'
import { deleteSessionRequest, LING_SESSION_DELETE_HOST, type DeleteSessionRequest } from '../session-delete-contract.ts'

declare module '@deepseek-ai/cordis' { interface Context { lingSessionDelete: LingSessionDeleteController } }
export class LingSessionDeleteController extends TypertRemoteService {
  static inject = ['typert', 'workspaceRegistry', 'lingSessionLifecycle', 'lingSessionStorage']
  constructor(ctx: Context) {
    super(ctx, 'lingSessionDelete')
    ctx.effect(() => ctx.typert.register(LING_SESSION_DELETE_HOST), 'LING archived session deletion Remote')
  }
  async deleteArchived(input: DeleteSessionRequest): Promise<{ deleted: true }> {
    const id = SessionId(deleteSessionRequest.parse(input).taskId)
    if (!this.ctx.workspaceRegistry.archivedSessionIds.includes(id)) throw new Error('只能删除已归档会话，请先归档。')
    const checkAutomation = () => {
      const store = this.ctx.get('lingAutomation')?.engine.store
      if (store?.plans().some(plan => !plan.archived && plan.output === 'reuse' && plan.taskId === id)) throw new Error('自动化计划仍在复用此会话，请先改为独立任务输出。')
      if (store?.runs().some(run => run.taskId === id && ['queued', 'running', 'waiting-approval'].includes(run.status))) throw new Error('自动化执行尚未结束，请结束后再删除。')
    }
    checkAutomation()
    await this.ctx.lingSessionLifecycle.deletingSession(id, async () => {
      checkAutomation()
      // Recheck after draining the selected identity, before the irreversible step.
      if (!this.ctx.workspaceRegistry.archivedSessionIds.includes(id)) throw new Error('会话已恢复，未删除。')
      await this.ctx.lingSessionStorage.deleteStoredSession(id)
      this.ctx.emit('api-session/removed', id)
      await this.ctx.workspaceRegistry.unarchiveSession(id).catch(error => {
        // Storage removal has committed. A metadata error must not invite the
        // user to retry an operation that already deleted their conversation.
        this.ctx.logger.warn('会话已删除，归档标记清理失败：%s', String(error))
      })
    })
    return { deleted: true }
  }
}
const prototype = LingSessionDeleteController.prototype
const receiver = Object.create(prototype) as LingSessionDeleteController
const decorate = Remote as unknown as (implementation: (...args: never[]) => unknown, context: { name: string; private: boolean; static: boolean; addInitializer(initializer: (this: LingSessionDeleteController) => void): void }) => void
decorate(prototype.deleteArchived as (...args: never[]) => unknown, { name: 'deleteArchived', private: false, static: false, addInitializer(initializer) { initializer.call(receiver) } })
