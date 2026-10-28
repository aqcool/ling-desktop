import { AsyncLocalStorage } from 'node:async_hooks'
import type { Context } from '@deepseek-ai/cordis'
import type { TypertGateway } from '@deepseek-ai/dsh-api-gateway'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-jobs'
import type {} from './host/automation-controller.ts'

interface Lease { active: boolean; release(): void }

/** Freeze new work before draining work already admitted; cancellation does not cancel that work. */
export class UpdateAdmission {
  private locked = false
  private count = 0
  private readonly scope = new AsyncLocalStorage<Lease>()
  private drain: { promise: Promise<void>; resolve(): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> } | undefined
  get isLocked() { return this.locked }
  get active() { return this.count }

  private acquire(): Lease {
    if (this.locked && !this.scope.getStore()?.active) throw new Error('LING 正在准备更新，请稍后重试。')
    this.count++
    const lease: Lease = { active: true, release: () => {
      if (!lease.active) return
      lease.active = false
      this.count--
      if (!this.count && this.drain) {
        const drain = this.drain
        this.drain = undefined
        clearTimeout(drain.timer)
        drain.resolve()
      }
    } }
    return lease
  }

  async run<T>(operation: () => T | Promise<T>): Promise<T> {
    const lease = this.acquire()
    try { return await this.scope.run(lease, operation) }
    finally { lease.release() }
  }

  async openStream<T>(open: () => Promise<AsyncIterable<T>>, passive: boolean, signal?: AbortSignal): Promise<AsyncIterable<T>> {
    const lease = this.acquire()
    let source: AsyncIterable<T>
    try { source = await this.scope.run(lease, open) }
    catch (error) { lease.release(); throw error }
    let started = false
    const abortBeforeStart = () => { if (!started) lease.release() }
    signal?.addEventListener('abort', abortBeforeStart, { once: true })
    if (signal?.aborted) abortBeforeStart()
    const scope = this.scope
    return {
      async *[Symbol.asyncIterator]() {
        started = true
        signal?.removeEventListener('abort', abortBeforeStart)
        const iterator = source[Symbol.asyncIterator]()
        try {
          signal?.throwIfAborted()
          while (true) {
            const next = await scope.run(lease, () => iterator.next())
            // Existing snapshot/follow subscriptions may remain open; their initialization has now settled.
            if (passive) lease.release()
            if (next.done) return
            yield next.value
          }
        } finally {
          try { await iterator.return?.() } finally { lease.release() }
        }
      },
    }
  }

  lock(timeoutMs = 8_000): Promise<void> {
    this.locked = true
    if (!this.count) return Promise.resolve()
    if (this.drain) return this.drain.promise
    const pending = Promise.withResolvers<void>()
    const timer = setTimeout(() => {
      this.drain = undefined
      pending.reject(new Error('仍有请求正在完成，请稍后再更新。'))
    }, timeoutMs)
    this.drain = { ...pending, timer }
    return pending.promise
  }

  unlock(): void {
    this.locked = false
    if (this.drain) {
      clearTimeout(this.drain.timer)
      this.drain.reject(new Error('更新准备已取消。'))
      this.drain = undefined
    }
  }
}

// Host and its dynamically loaded Web plugin share one gate even if emitted in separate bundles.
const key = Symbol.for('ling.desktop.update-admission')
const globalGate = globalThis as typeof globalThis & { [key]?: UpdateAdmission }
export const updateAdmission = globalGate[key] ??= new UpdateAdmission()

const passiveStreams = new Set([
  'session/follow', 'session/control', 'workspace/follow', 'workspaceFiles/changes',
  'terminal/follow', 'terminal/retain', 'lingWorkspaceTerminals/follow', 'lingWorkspaceTerminals/retain',
])

/** Guard the public dispatcher, including stream opens on an already-connected WebSocket. */
export function guardUpdateGateway(gateway: TypertGateway, gate = updateAdmission): () => void {
  const invoke = gateway.invoke, stream = gateway.stream
  gateway.invoke = request => gate.run(() => invoke.call(gateway, request))
  gateway.stream = request => gate.openStream(() => stream.call(gateway, request), passiveStreams.has(`${request.namespace}/${request.method}`), request.signal)
  return () => { gateway.invoke = invoke; gateway.stream = stream }
}

/** Includes live descendants, queued input and detached background jobs. */
export function updateWorkActive(ctx: Context, gate = updateAdmission): boolean {
  if (gate.active) return true
  if (ctx.agents.list().some(agent => agent.status !== 'idle' || agent.inbox.nextTurn.length > 0 || agent.inbox.nextStep.length > 0)) return true
  if (ctx.get('jobs')?.list().some(job => job.status === 'running' || job.status === 'stopping')) return true
  return (ctx.get('lingAutomation')?.engine.store.active().length ?? 0) > 0
}

export interface UpdateTaskRequest { readonly type: 'update-tasks'; readonly requestId: number; readonly action: 'inspect' | 'lock' | 'unlock' }
export function isUpdateTaskRequest(value: unknown): value is UpdateTaskRequest {
  if (!value || typeof value !== 'object') return false
  const request = value as Record<string, unknown>
  return request.type === 'update-tasks' && Number.isSafeInteger(request.requestId)
    && (request.action === 'inspect' || request.action === 'lock' || request.action === 'unlock')
}

export async function handleUpdateTaskRequest(request: UpdateTaskRequest, inspect: () => boolean, gate = updateAdmission) {
  try {
    if (request.action === 'unlock') gate.unlock()
    else if (request.action === 'lock') await gate.lock()
    return { type: 'update-tasks' as const, requestId: request.requestId, active: inspect() }
  } catch {
    return { type: 'update-tasks' as const, requestId: request.requestId, active: true, error: '无法确认任务已停止，请稍后重试更新。' }
  }
}
