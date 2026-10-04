import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, chmodSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  automationActive,
  type AutomationPlan,
  type AutomationRun,
  type AutomationSpec,
  type AutomationSnapshot,
} from 'ling-desktop/runtime'
import { nextOccurrence } from './calendar.ts'
export class AutomationStore {
  readonly db: DatabaseSync
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    this.db = new DatabaseSync(path)
    if (path !== ':memory:') chmodSync(path, 0o600)
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000;')
    const version = Number(this.db.prepare('PRAGMA user_version').get()!.user_version)
    if (version > 1) {
      this.db.close()
      throw new Error('自动化数据由更新版本创建，请升级应用。')
    }
    this.db.exec(`CREATE TABLE IF NOT EXISTS plans(id TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY,planId TEXT NOT NULL,occurrence TEXT UNIQUE,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL); PRAGMA user_version=1;`)
  }
  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const v = fn()
      this.db.exec('COMMIT')
      return v
    } catch (e) {
      this.db.exec('ROLLBACK')
      throw e
    }
  }
  plans(): AutomationPlan[] {
    return this.db
      .prepare('SELECT value FROM plans')
      .all()
      .map((r) => JSON.parse(String(r.value)) as AutomationPlan)
  }
  runs(): AutomationRun[] {
    return this.db
      .prepare('SELECT value FROM runs ORDER BY rowid DESC LIMIT 500')
      .all()
      .map((r) => JSON.parse(String(r.value)) as AutomationRun)
  }
  active(): AutomationRun[] {
    return this.db
      .prepare('SELECT value FROM runs')
      .all()
      .map((r) => JSON.parse(String(r.value)) as AutomationRun)
      .filter((r) => automationActive(r.status))
  }
  plan(id: string) {
    const r = this.db.prepare('SELECT value FROM plans WHERE id=?').get(id)
    return r ? (JSON.parse(String(r.value)) as AutomationPlan) : undefined
  }
  run(id: string) {
    const r = this.db.prepare('SELECT value FROM runs WHERE id=?').get(id)
    return r ? (JSON.parse(String(r.value)) as AutomationRun) : undefined
  }
  putPlan(plan: AutomationPlan) {
    this.db.prepare('INSERT OR REPLACE INTO plans VALUES (?,?)').run(plan.id, JSON.stringify(plan))
    return plan
  }
  putRun(run: AutomationRun) {
    this.db.prepare('UPDATE runs SET value=? WHERE id=?').run(JSON.stringify(run), run.id)
    return run
  }
  save(spec: AutomationSpec, now: number, id?: string, version?: number) {
    return this.transaction(() => {
      const old = id ? this.plan(id) : undefined
      if (id && (!old || old.archived || old.version !== version))
        throw new Error('计划已变化，请刷新后再保存。')
      const plan: AutomationPlan = {
        ...spec,
        id: old?.id ?? randomUUID(),
        version: (old?.version ?? 0) + 1,
        createdAt: old?.createdAt ?? now,
        updatedAt: now,
        archived: false,
        taskId: old?.workspaceId === spec.workspaceId ? old.taskId : null,
        nextAt: spec.enabled ? nextOccurrence(spec.schedule, now, now, spec.expiresAt) : null,
      }
      if (spec.enabled && plan.nextAt === null)
        throw new Error('计划没有未来执行时间，请检查时间和到期日期。')
      return this.putPlan(plan)
    })
  }
  toggle(id: string, version: number, enabled: boolean, now: number, remove = false) {
    return this.transaction(() => {
      const plan = this.plan(id)
      if (!plan || plan.archived || plan.version !== version) throw new Error('计划已变化，请刷新。')
      return this.putPlan({
        ...plan,
        enabled: remove ? false : enabled,
        archived: remove,
        version: version + 1,
        updatedAt: now,
        nextAt: enabled && !remove ? nextOccurrence(plan.schedule, now, now, plan.expiresAt) : null,
      })
    })
  }
  /** Freeze the full plan and reserve task/request ids before any side effect. */
  claim(
    plan: AutomationPlan,
    at: number,
    now: number,
    occurrence: string,
    retryOf?: string,
    status: AutomationRun['status'] = 'queued',
  ): AutomationRun | undefined {
    return this.transaction(() => {
      if (this.db.prepare('SELECT 1 FROM runs WHERE occurrence=?').get(occurrence)) return undefined
      const id = randomUUID(),
        taskId = plan.output === 'reuse' && plan.taskId ? plan.taskId : `ling-auto-${randomUUID()}`
      const {
        id: _id,
        version: _v,
        createdAt: _c,
        updatedAt: _u,
        nextAt: _n,
        taskId: _t,
        archived: _a,
        ...spec
      } = plan
      const run: AutomationRun = {
        id,
        planId: plan.id,
        spec,
        scheduledAt: at,
        createdAt: now,
        updatedAt: now,
        status,
        taskId,
        requestId: `ling-auto-${id}`,
        summary: status === 'skipped' ? '上一次执行仍未结束，本次已跳过。' : '',
        ...(retryOf ? { retryOf } : {}),
      }
      this.db.prepare('INSERT INTO runs VALUES (?,?,?,?)').run(id, plan.id, occurrence, JSON.stringify(run))
      if (plan.output === 'reuse') this.putPlan({ ...plan, taskId })
      return run
    })
  }
  awake() {
    return this.db.prepare("SELECT value FROM settings WHERE key='awake'").get()?.value === 'true'
  }
  setAwake(value: boolean) {
    this.db.prepare("INSERT OR REPLACE INTO settings VALUES ('awake',?)").run(String(value))
  }
  snapshot(): AutomationSnapshot {
    return { plans: this.plans().filter((p) => !p.archived), runs: this.runs(), keepAwake: this.awake() }
  }
  close() {
    this.db.close()
  }
}
