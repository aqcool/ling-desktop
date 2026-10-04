/** LING's adapter owns the public Agent handles needed for explicit deletion. */
import { AgentLoop } from '@deepseek-ai/dsh-agent-loop'
import type { Context } from '@deepseek-ai/cordis'
import type { AgentHandle, CreateAgentOptions, ResumeAgentOptions } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-jobs'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type {} from './host/hooks-controller.ts'

declare module '@deepseek-ai/cordis' { interface Context { lingSessionLifecycle: LingSessionLifecycle } }

export class LingSessionLifecycle extends AgentLoop {
  private readonly lifecycle = {
    handles: new Map<SessionId, AgentHandle>(),
    pending: new Map<SessionId, number>(),
    deleting: new Set<SessionId>(),
  }
  constructor(ctx: Context, config: ConstructorParameters<typeof AgentLoop>[1]) {
    super(ctx, config)
    ctx.provide('lingSessionLifecycle', this)
    ctx.on('agent/disposed', ({ agent }) => {
      if (this.lifecycle.handles.get(agent.id)?.agent === agent) this.lifecycle.handles.delete(agent.id)
    })
  }
  private async track(id: SessionId, create: () => Promise<AgentHandle>): Promise<AgentHandle> {
    if (this.lifecycle.deleting.has(id)) throw new Error('会话正在删除。')
    this.lifecycle.pending.set(id, (this.lifecycle.pending.get(id) ?? 0) + 1)
    try {
      const handle = await create()
      this.lifecycle.handles.set(id, handle)
      return handle
    } finally {
      const count = (this.lifecycle.pending.get(id) ?? 1) - 1
      if (count) this.lifecycle.pending.set(id, count); else this.lifecycle.pending.delete(id)
    }
  }
  override createAgent(owner: Context, options: CreateAgentOptions) {
    return this.track(options.sessionId, () => {
      const create = () => super.createAgent(owner, options)
      return this.ctx.get('lingHooks')?.withAgentCreation(create) ?? create()
    })
  }
  override resume(owner: Context, options: ResumeAgentOptions) {
    return this.track(options.resumeSessionId, () => {
      const resume = () => super.resume(owner, options)
      return this.ctx.get('lingHooks')?.withAgentCreation(resume) ?? resume()
    })
  }
  async withSessionOperation<T>(id: SessionId, operation: () => Promise<T>): Promise<T> {
    if (this.lifecycle.deleting.has(id)) throw new Error('会话正在删除。')
    this.lifecycle.pending.set(id, (this.lifecycle.pending.get(id) ?? 0) + 1)
    try { return await operation() }
    finally {
      const count = (this.lifecycle.pending.get(id) ?? 1) - 1
      if (count) this.lifecycle.pending.set(id, count); else this.lifecycle.pending.delete(id)
    }
  }
  /** Reserve identity before awaiting; never stop an active or queued task. */
  async deletingSession<T>(id: SessionId, operation: () => Promise<T>): Promise<T> {
    if (this.lifecycle.deleting.has(id) || this.lifecycle.pending.has(id)) throw new Error('会话正在处理其他操作，请稍后重试。')
    this.lifecycle.deleting.add(id)
    try {
      const agent = this.ctx.agents.get(id)
      if (agent) {
        const handle = this.lifecycle.handles.get(id)
        if (!handle || handle.agent !== agent) throw new Error('无法关闭此会话，请重启应用后重试。')
        const owned = [agent]
        const agents = this.ctx.agents.list()
        for (let i = 0; i < owned.length; i++) {
          for (const child of agents) {
            if (!owned.includes(child) && this.ctx.agents.isOwnedBy(child.id, owned[i]!)) owned.push(child)
          }
        }
        const jobs = this.ctx.get('jobs')
        if (jobs && owned.some(child => jobs.list(child).some(job => job.status === 'running' || job.status === 'stopping'))) throw new Error('会话的后台任务仍在运行，请结束后再删除。')
        if (owned.some(child => child.status !== 'idle' || child.inbox.nextTurn.length || child.inbox.nextStep.length)) throw new Error('会话或子任务仍在运行，请结束后再删除。')
        // Maintenance uses the idle status too. Its public reservation rejects if busy.
        for (const child of owned) await child.runMaintenance(async () => {})
        if (owned.some(child => child.status !== 'idle' || child.inbox.nextTurn.length || child.inbox.nextStep.length)) throw new Error('会话仍在运行，请结束后再删除。')
        await handle.dispose()
      }
      return await operation()
    } finally { this.lifecycle.deleting.delete(id) }
  }
}
export default LingSessionLifecycle
