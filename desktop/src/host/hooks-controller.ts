import type { Context, Fiber } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import * as ClaudeHooks from '@deepseek-ai/dsh-hooks-claude-code'
import * as CodexHooks from '@deepseek-ai/dsh-hooks-codex'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { LingHookRun, LingHookSettings, LingHooksRequest, LingHooksResponse, LingHooksSnapshot } from 'ling-desktop/runtime'
import { HooksStore, importHooks, validateHookSettings } from '../hooks-manager.ts'
import { hooksRequestSchema, LING_HOOKS_HOST } from '../hooks-contract.ts'

declare module '@deepseek-ai/cordis' { interface Context { lingHooks: LingHooksController } }
const managedHooks = { name: 'ling-command-hooks', apply(ctx: Context, config: { dialect: LingHookSettings['dialect']; configPath: string }) { (config.dialect === 'codex' ? CodexHooks : ClaudeHooks).apply(ctx, { configPath: config.configPath }) } }

export class LingHooksController extends TypertRemoteService {
  static inject = ['typert', 'shell', 'sessionProjections', 'agents']
  readonly store: HooksStore
  private runtime: Fiber | undefined
  private state: LingHooksSnapshot['state'] = 'disabled'
  private error: string | undefined
  private history: LingHookRun[] = []
  private ready: Promise<void>
  private creating = 0
  private barrier: { promise: Promise<void>; release: () => void; leases: Promise<unknown>[] } | undefined
  constructor(ctx: Context) {
    super(ctx, 'lingHooks')
    if (!process.env.DSH_HOME) throw new Error('LING Hooks requires a profile home')
    this.store = new HooksStore(process.env.DSH_HOME)
    ctx.effect(() => ctx.typert.register(LING_HOOKS_HOST), 'LING hooks Remote')
    // Publication already holds the new agent's initialization maintenance phase.
    ctx.on('agent/created', async () => { await this.barrier?.promise })
    ctx.on('session/event', (session, event) => {
      if (event.type !== 'hook/result') return
      const { point, handlerId, decision, durationMs, exitCode, stderrSummary } = event.data
      this.history.unshift({ taskId: String(session.header.id), time: event.time, point, handlerId, decision, durationMs, ...(exitCode !== undefined ? { exitCode } : {}), ...(stderrSummary !== undefined ? { stderrSummary } : {}) })
      this.history = this.history.slice(0, 50)
    })
    this.ready = this.store.error ? Promise.resolve() : this.mount(this.store.settings).catch(error => { this.state = 'error'; this.error = error instanceof Error ? error.message : String(error) })
    if (this.store.error) { this.state = 'error'; this.error = this.store.error }
    ctx.effect(() => async () => { await this.ready; this.barrier?.release(); await this.runtime?.dispose() }, 'LING hooks runtime')
  }
  /** Gate the LING factory before publication captures any lifecycle listeners. */
  async withAgentCreation<T>(create: () => Promise<T>): Promise<T> {
    await this.ready
    while (this.barrier) await this.barrier.promise
    this.creating++
    try { return await create() } finally { this.creating-- }
  }
  private busy(): boolean { return this.creating > 0 || this.ctx.agents.list().some(agent => agent.status !== 'idle' || agent.inbox.nextTurn.length || agent.inbox.nextStep.length) }
  private reserve(agent: Agent): void {
    const barrier = this.barrier!
    const lease = agent.runMaintenance(async () => { await barrier.promise })
    // Install a rejection handler immediately; all leases are settled below.
    void lease.catch(() => {})
    barrier.leases.push(lease)
  }
  private async mount(settings: LingHookSettings, beforeDispose?: () => void): Promise<void> {
    this.store.prepare(settings)
    beforeDispose?.()
    await this.runtime?.dispose()
    this.runtime = undefined
    if (!settings.enabled) { this.state = 'disabled'; this.error = undefined; return }
    // The official bridge owns payloads, command execution, decisions and durable logs.
    const fiber = this.ctx.plugin(managedHooks, { dialect: settings.dialect, configPath: this.store.runtimePath })
    this.runtime = await fiber
    this.state = 'loaded'; this.error = undefined
  }
  private snapshot(): LingHooksSnapshot {
    return { settings: structuredClone(this.store.settings), revision: this.store.revision, configPath: this.store.configPath, scope: 'process', state: this.state, ...(this.error ? { error: this.error } : {}), activeCount: this.state === 'loaded' ? this.store.settings.entries.filter(entry => entry.enabled).length : 0, busy: this.busy() || !!this.barrier, history: this.history.map(run => ({ ...run })) }
  }
  async request(input: LingHooksRequest, signal?: AbortSignal): Promise<LingHooksResponse> {
    const request = hooksRequestSchema.parse(input)
    await this.ready
    signal?.throwIfAborted()
    if (request.type === 'snapshot') return { snapshot: this.snapshot() }
    if (request.type === 'import') return { imported: importHooks(request.path, request.dialect) }
    if (this.barrier) throw new Error('Hooks 配置正在应用，请稍后重试。')
    if (request.revision !== this.store.revision) throw new Error('Hooks 配置已更新，请刷新后再编辑。')
    const settings = validateHookSettings(request.settings)
    if (this.busy()) throw new Error('有任务或子任务正在运行，请等待全部任务结束后再应用 Hooks。')
    let release!: () => void
    const barrier = { promise: new Promise<void>(resolve => { release = resolve }), release: () => release(), leases: [] as Promise<unknown>[] }
    this.barrier = barrier
    const previous = this.store.settings
    let changed = false
    try {
      for (const agent of this.ctx.agents.list()) this.reserve(agent)
      signal?.throwIfAborted()
      await this.mount(settings, () => { changed = true })
      this.store.commit(settings)
    } catch (error) {
      if (changed) try { await this.mount(previous) } catch (rollback) { this.state = 'error'; this.error = `加载失败：${String(error)}；恢复失败：${String(rollback)}` }
      throw error
    } finally { this.barrier = undefined; barrier.release(); await Promise.allSettled(barrier.leases) }
    return { snapshot: this.snapshot() }
  }
}
const prototype = LingHooksController.prototype
const receiver = Object.create(prototype) as LingHooksController
const decorate = Remote as unknown as (implementation: (...args: never[]) => unknown, context: { name: string; private: boolean; static: boolean; addInitializer(initializer: (this: LingHooksController) => void): void }) => void
decorate(prototype.request as (...args: never[]) => unknown, { name: 'request', private: false, static: false, addInitializer(initializer) { initializer.call(receiver) } })
