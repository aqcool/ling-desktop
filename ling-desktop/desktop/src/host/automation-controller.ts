import { join } from 'node:path'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import type { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import { ApiSessionNotFound, type SessionRequestId } from '@deepseek-ai/dsh-api-session-controller'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { setSandboxMode } from '@deepseek-ai/dsh-sandbox-policy'
import { setApprovalPolicy } from '@deepseek-ai/dsh-user-approval'
import { ReasoningEffortId, createUserMessage } from '@deepseek-ai/dsh-llm'
import { extractSessionEventText } from '@deepseek-ai/dsh-session-query'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {
  AutomationRequest,
  AutomationResponse,
  AutomationRun,
  AutomationSpec,
} from 'ling-desktop/runtime'
import {
  LING_AUTOMATION_HOST,
  automationRequestSchema,
  automationSpecSchema,
} from '../automation-contract.ts'
import { AutomationStore } from '../automation/store.ts'
import { AutomationEngine } from '../automation/engine.ts'
declare module '@deepseek-ai/cordis' {
  interface Context {
    lingAutomation: LingAutomationController
  }
}
export class LingAutomationController extends TypertRemoteService {
  static inject = ['typert', 'sessionController', 'workspaceRegistry', 'llm', 'agentDefaultModel']
  readonly engine: AutomationEngine
  private readonly dispatching = new Set<string>()
  private awake = false
  constructor(ctx: Context) {
    super(ctx, 'lingAutomation')
    const home = process.env.DSH_HOME
    if (!home) throw new Error('LING automation requires a profile home')
    this.engine = new AutomationEngine(new AutomationStore(join(home, 'ling-automation.sqlite')), {
      dispatch: (run) => this.dispatch(run),
      inspect: (run) => this.inspect(run),
      cancel: (run) => this.cancel(run),
      changed: (awake) => {
        if (this.awake === awake) return
        this.awake = awake
        if (process.connected) process.send?.({ type: 'automation-state', awake })
      },
    })
    ctx.effect(() => ctx.typert.register(LING_AUTOMATION_HOST), 'LING automation Remote')
    ctx.effect(() => {
      void this.engine.tick().catch((error) => console.error('LING automation', error))
      const timer = setInterval(() => {
        void this.engine.tick().catch((error) => console.error('LING automation', error))
      }, 5000)
      return () => {
        clearInterval(timer)
        this.engine.close()
      }
    }, 'LING local automation scheduler')
  }
  private workspace(spec: AutomationSpec) {
    if (spec.workspaceId === null) return undefined
    const workspace = this.ctx.workspaceRegistry.get(WorkspaceId(spec.workspaceId))
    if (!workspace) throw new Error('工作区已不存在，请编辑计划重新选择。')
    return workspace.path
  }
  private async dispatch(run: AutomationRun) {
    if (this.dispatching.has(run.id)) return
    this.dispatching.add(run.id)
    try {
      const cwd = this.workspace(run.spec),
        id = SessionId(run.taskId)
      const before = await this.ctx.sessionController.inspect(id).catch((error) => {
        if (error instanceof ApiSessionNotFound) return null
        throw error
      })
      if (!before) await this.ctx.sessionController.create({ sessionId: id, ...(cwd ? { cwd } : {}) })
      else if (before.meta.cwd !== cwd && cwd !== undefined)
        throw new Error('自动化任务的工作区已改变，请使用独立任务输出。')
      const resolved = await this.ctx.sessionController.resolveAgent(id)
      if ('error' in resolved) throw resolved.error
      const agent = resolved.agent
      if (agent.status !== 'idle') throw new Error('专用任务正在执行其他工作，请等待结束。')
      await agent.runMaintenance(async (signal) => {
        // A plan never adopts a user-owned task. Apply its explicit policy before accepting input.
        setSandboxMode(agent.session, run.spec.permission)
        setApprovalPolicy(agent.session, run.spec.permission === 'danger-full-access' ? 'never' : 'ask')
        const model = run.spec.model ?? this.ctx.agentDefaultModel.currentSelection()
        if (!run.spec.model) {
          run.spec = { ...run.spec, model }
          this.engine.store.putRun(run)
        }
        if (model) await this.ctx.sessionController.selectModel({ sessionId: id, ...model })
        if (!before) await this.ctx.sessionController.rename({ sessionId: id, title: run.spec.name })
        signal.throwIfAborted()
        await this.ctx.sessionController.prompt(
          {
            sessionId: id,
            requestId: run.requestId as SessionRequestId,
            mode: 'queue',
            content: [{ type: 'text', text: run.spec.prompt }],
            ...(run.spec.schedule.kind === 'daily' || run.spec.schedule.kind === 'weekly'
              ? { clientTimeZone: run.spec.schedule.timeZone }
              : {}),
          },
          signal,
        )
        if (signal.aborted) {
          for (const message of [...agent.inbox.nextTurn, ...agent.inbox.nextStep])
            if (
              message.source.kind === 'user' &&
              'rpcId' in message.source &&
              message.source.rpcId === run.requestId
            )
              agent.inbox.remove(message.id)
          signal.throwIfAborted()
        }
        const current = this.engine.store.run(run.id)
        if (current) this.engine.store.putRun({ ...current, admitted: true })
      })
    } finally {
      this.dispatching.delete(run.id)
    }
  }
  private async inspect(
    run: AutomationRun,
  ): Promise<{ status: AutomationRun['status']; summary?: string } | null> {
    const snapshot = await this.ctx.sessionController.inspect(SessionId(run.taskId)).catch((error) => {
      // Only a missing session permits admission recovery; other read failures remain uncertain.
      if (error instanceof ApiSessionNotFound) return null
      throw error
    })
    if (!snapshot) return null
    const events = snapshot.events
    const index = events.findIndex(
      (e) =>
        e.type === 'user/message' &&
        e.data.source.kind === 'user' &&
        'rpcId' in e.data.source &&
        e.data.source.rpcId === run.requestId,
    )
    if (index < 0) {
      // Accepted but still queued input lives in the Agent's pending input projection.
      const agent = this.ctx.agents.get(SessionId(run.taskId))
      const matches = (message: UserMessage) =>
        message.source.kind === 'user' && 'rpcId' in message.source && message.source.rpcId === run.requestId
      const inbox: Record<string, UserMessage[]> = { nextTurn: [], nextStep: [] }
      let admitted = !!run.admitted,
        cancelled = false
      for (const event of events) {
        if (event.type !== 'agent/inbox/spliced') continue
        const list = inbox[event.data.target] ?? (inbox[event.data.target] = [])
        const removed = list.splice(event.data.start, event.data.removedCount ?? 0, ...event.data.inserted)
        if (event.data.inserted.some(matches)) admitted = true
        if (event.data.outcome === 'canceled' && removed.some(matches)) cancelled = true
      }
      const pending = agent
        ? [...agent.inbox.nextTurn, ...agent.inbox.nextStep].some(matches)
        : Object.values(inbox).flat().some(matches)
      if (pending) {
        if (!agent) {
          const resolved = await this.ctx.sessionController.resolveAgent(SessionId(run.taskId))
          if ('error' in resolved) throw resolved.error
        }
        return { status: 'queued' }
      }
      if (admitted)
        return {
          status: cancelled ? 'cancelled' : 'interrupted',
          summary: cancelled ? '排队的执行已取消。' : '输入已提交，但没有完整回合记录。请查看原任务。',
        }
      return null
    }
    const start = events.slice(0, index).findLast((e) => e.type === 'turn/start')
    if (!start || start.type !== 'turn/start') return { status: 'running' }
    const end = events.slice(index).find((e) => e.type === 'turn/end' && e.data.turn === start.data.turn)
    if (end?.type === 'turn/end') {
      const kind = end.data.reason.kind
      const status: AutomationRun['status'] =
        kind === 'completed'
          ? 'completed'
          : kind === 'aborted'
            ? 'cancelled'
            : kind === 'interrupted'
              ? 'interrupted'
              : 'failed'
      const reply = events
        .slice(index, events.indexOf(end))
        .filter((e) => e.type === 'assistant/message')
        .map(extractSessionEventText)
        .join('\n')
        .trim()
        .slice(-1200)
      return {
        status,
        summary:
          kind === 'error'
            ? end.data.reason.kind === 'error'
              ? end.data.reason.error.message
              : kind
            : reply || `回合结束：${kind}`,
      }
    }
    const pending = new Set<string>()
    for (const e of events.slice(index)) {
      if (e.type === 'approval/asked') pending.add(String(e.data.id))
      if (e.type === 'approval/decided') pending.delete(String(e.data.id))
    }
    if (!this.ctx.agents.get(SessionId(run.taskId)))
      return { status: 'interrupted', summary: '应用在执行结束前退出。请查看原任务，再决定是否重试。' }
    return { status: pending.size ? 'waiting-approval' : 'running' }
  }
  private async cancel(run: AutomationRun) {
    const resolved = await this.ctx.sessionController.resolveAgent(SessionId(run.taskId))
    if ('error' in resolved) throw resolved.error
    resolved.agent.cancel({ kind: 'user' }, { keepInbox: false })
    await resolved.agent.whenIdle()
  }
  async request(input: AutomationRequest, signal?: AbortSignal): Promise<AutomationResponse> {
    const r = automationRequestSchema.parse(input)
    signal?.throwIfAborted()
    if (r.type === 'snapshot') return { snapshot: this.engine.store.snapshot() }
    if (r.type === 'save') {
      this.workspace(r.spec)
      return { plan: this.engine.save(r.spec, r.id, r.version) }
    }
    if (r.type === 'toggle' || r.type === 'remove') {
      if (r.type === 'toggle' && r.enabled === undefined) throw new Error('缺少启用状态。')
      const plan = this.engine.store.toggle(r.id, r.version, !!r.enabled, Date.now(), r.type === 'remove')
      await this.engine.tick()
      return { plan }
    }
    if (r.type === 'run') return { run: await this.engine.run(r.id) }
    if (r.type === 'cancel') {
      await this.engine.cancel(r.runId)
      return { run: this.engine.store.run(r.runId) }
    }
    if (r.type === 'retry') {
      const run = this.engine.store.run(r.runId)
      if (!run || !['failed', 'interrupted', 'cancelled'].includes(run.status))
        throw new Error('只能重试未完成的执行。')
      return { run: await this.engine.run(run.planId, run.id) }
    }
    if (r.type === 'settings') {
      this.engine.store.setAwake(r.keepAwake)
      await this.engine.tick()
      return { snapshot: this.engine.store.snapshot() }
    }
    if (r.type !== 'draft') throw new Error('未知自动化操作。')
    const abort = signal ?? new AbortController().signal
    let text = '',
      finished = false
    const prompt = `将用户需求转换为本地桌面自动化草稿，只返回 JSON。不要调用工具或执行任务。当前时间 ${new Date().toISOString()}，时区 ${r.timeZone}。字段 name, prompt, schedule, expiresAt。schedule 使用 {kind:"daily",time:"09:00",timeZone:"${r.timeZone}",weekdays:[]} 或 weekly（weekdays 周日0至周六6），interval（minutes>=5）或 once（at 为毫秒时间戳）。expiresAt 为 null 或毫秒时间戳。不支持云端。无法确定时间时默认每天09:00，用户可以编辑。需求：\n${r.text}`
    for await (const chunk of this.ctx.llm.stream({
      provider: r.model.provider,
      model: r.model.model,
      ...(r.model.reasoningEffort ? { reasoningEffort: ReasoningEffortId(r.model.reasoningEffort) } : {}),
      messages: [createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: prompt }] })],
      maxTokens: 2500,
      signal: abort,
    })) {
      abort.throwIfAborted()
      if (chunk.type === 'text-delta') text += chunk.text
      if (text.length > 20000) throw new Error('草稿超过本次预算。')
      if (chunk.type === 'finish') {
        if (chunk.reason.kind !== 'stop') throw new Error('草稿生成未完成。')
        finished = true
      }
    }
    if (!finished) throw new Error('模型未返回完整草稿。')
    const parsed = JSON.parse(text.replace(/^\s*```(?:json)?\s*/, '').replace(/\s*```\s*$/, '')) as Record<
      string,
      unknown
    >
    return {
      draft: automationSpecSchema.parse({
        name: parsed.name,
        prompt: parsed.prompt,
        schedule: parsed.schedule,
        expiresAt: parsed.expiresAt ?? null,
        workspaceId: null,
        model: r.model,
        permission: 'read-only',
        output: 'separate',
        missed: 'skip',
        enabled: true,
      }),
    }
  }
}
const prototype = LingAutomationController.prototype
const receiver = Object.create(prototype) as LingAutomationController
const decorate = Remote as unknown as (
  implementation: (...args: never[]) => unknown,
  context: {
    name: string
    private: boolean
    static: boolean
    addInitializer(initializer: (this: LingAutomationController) => void): void
  },
) => void
decorate(prototype.request as (...args: never[]) => unknown, {
  name: 'request',
  private: false,
  static: false,
  addInitializer(initializer) {
    initializer.call(receiver)
  },
})
