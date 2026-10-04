import { randomUUID } from 'node:crypto'
import {
  automationActive,
  type AutomationRun,
  type AutomationPlan,
  type AutomationSpec,
} from 'ling-desktop/runtime'
import { nextOccurrence } from './calendar.ts'
import { AutomationStore } from './store.ts'
export interface AutomationPorts {
  dispatch(run: AutomationRun): Promise<void>
  inspect(run: AutomationRun): Promise<{ status: AutomationRun['status']; summary?: string } | null>
  cancel(run: AutomationRun): Promise<void>
  changed?(awake: boolean): void
}
export class AutomationEngine {
  private readonly cancelling = new Set<string>()
  private ticking = false
  private closed = false
  constructor(
    readonly store: AutomationStore,
    readonly ports: AutomationPorts,
    readonly now = Date.now,
  ) {}
  private changed() {
    this.ports.changed?.(
      this.store.awake() &&
        (this.store.plans().some((p) => p.enabled && !p.archived && p.nextAt !== null) ||
          this.store.active().length > 0),
    )
  }
  save(spec: AutomationSpec, id?: string, version?: number) {
    const p = this.store.save(spec, this.now(), id, version)
    this.changed()
    return p
  }
  async run(id: string, retryOf?: string) {
    const plan = this.store.plan(id)
    if (!plan || plan.archived) throw new Error('计划已不存在。')
    if (this.store.active().some((r) => r.planId === id)) throw new Error('此计划已有未结束的执行。')
    const run = this.store.claim(plan, this.now(), this.now(), `manual:${randomUUID()}`, retryOf)!
    this.changed()
    await this.dispatch(run)
    return this.store.run(run.id)!
  }
  private async dispatch(run: AutomationRun) {
    try {
      await this.ports.dispatch(run)
    } catch (error) {
      if (this.store.run(run.id)?.cancelRequested) {
        this.finish(run, { status: 'cancelled', summary: '执行已取消。' })
        return
      }
      // An ambiguous prompt acceptance is reconciled from the durable request id, never resubmitted blindly.
      try {
        const state = await this.ports.inspect(run)
        if (state) {
          this.finish(run, state)
          return
        }
      } catch {
        /* retain failure details */
      }
      this.finish(run, {
        status: 'failed',
        summary: error instanceof Error ? error.message : '无法启动执行。',
      })
    }
  }
  private finish(run: AutomationRun, state: { status: AutomationRun['status']; summary?: string }) {
    const current = this.store.run(run.id)
    if (current && !automationActive(current.status) && automationActive(run.status)) return
    const value = {
      ...(current ?? run),
      status: state.status,
      summary: state.summary ?? run.summary,
      updatedAt: this.now(),
    }
    this.store.putRun(value)
    this.changed()
  }
  async cancel(id: string) {
    if (this.cancelling.has(id)) return
    const run = this.store.run(id)
    if (!run || !automationActive(run.status)) throw new Error('执行已结束。')
    this.cancelling.add(id)
    this.store.putRun({ ...run, cancelRequested: true })
    try {
      await this.ports.cancel(run)
      const state = await this.ports.inspect(run)
      this.finish(
        run,
        state && !automationActive(state.status) ? state : { status: 'cancelled', summary: '执行已取消。' },
      )
    } catch (error) {
      const current = this.store.run(id)
      if (current) this.store.putRun({ ...current, cancelRequested: false })
      throw error
    } finally {
      this.cancelling.delete(id)
    }
  }
  async tick() {
    if (this.ticking || this.closed) return
    this.ticking = true
    try {
      // Recover existing runs first. Missing queued admission is safely dispatched with its stable request id.
      for (const run of this.store.active()) {
        if (run.cancelRequested) {
          try {
            await this.cancel(run.id)
          } catch {
            /* retry cancellation reconciliation on the next tick */
          }
          continue
        }
        try {
          const state = await this.ports.inspect(run)
          if (state) this.finish(run, state)
          else if (run.status === 'queued') await this.dispatch(run)
          else this.finish(run, { status: 'interrupted', summary: '执行未留下完整结束记录，请查看原任务。' })
        } catch {
          /* A temporarily unreachable Host/session must not cause an automatic retry. */
        }
      }
      const now = this.now()
      for (const plan of this.store.plans()) {
        if (!plan.enabled || plan.archived || plan.nextAt === null || plan.nextAt > now) continue
        let at = plan.nextAt
        // Discard a long backlog, optionally execute only its latest occurrence.
        if (now - at > 60_000 && plan.missed === 'skip') {
          this.store.putPlan({
            ...plan,
            nextAt: nextOccurrence(plan.schedule, now, plan.updatedAt, plan.expiresAt),
          })
          continue
        }
        if (now - at > 60_000) {
          if (plan.schedule.kind === 'interval')
            at += Math.floor((now - at) / (plan.schedule.minutes * 60_000)) * plan.schedule.minutes * 60_000
          else {
            for (let n = 0; n < 370; n++) {
              const next = nextOccurrence(plan.schedule, at, plan.updatedAt, plan.expiresAt)
              if (next === null || next > now) break
              at = next
            }
          }
        }
        const busy = this.store.active().some((r) => r.planId === plan.id),
          expired = plan.expiresAt !== null && now > plan.expiresAt
        const run = !expired
          ? this.store.claim(plan, at, now, `${plan.id}:${at}`, undefined, busy ? 'skipped' : 'queued')
          : undefined
        const latest = this.store.plan(plan.id)!
        this.store.putPlan({
          ...latest,
          nextAt: nextOccurrence(plan.schedule, now, plan.updatedAt, plan.expiresAt),
        })
        if (run && !busy) await this.dispatch(run)
      }
      this.changed()
    } finally {
      this.ticking = false
    }
  }
  close() {
    this.closed = true
    this.ports.changed?.(false)
  }
}
