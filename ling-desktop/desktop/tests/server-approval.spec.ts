import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LingServersController } from '../src/host/server-controller.ts'
import { decodeApprovalDetails } from '../src/approval-details.ts'
import type { PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'

afterEach(() => { vi.unstubAllEnvs() })

describe('server approval integration', () => {
  it('uses actual binding metadata and command analysis rather than the model purpose to decide approval', async () => {
    vi.stubEnv('DSH_HOME', '/tmp/ling-approval-integration')
    const ctx = new Context()
    ctx.provide('typert', { register: () => () => {} } as never)
    let policy!: (exec: ToolExecution, next: () => Promise<PreToolDecision>) => Promise<PreToolDecision>
    const on = ctx.on.bind(ctx)
    vi.spyOn(ctx, 'on').mockImplementation(((name: string, callback: unknown) => {
      if (name === 'tools/pre-execute') policy = callback as typeof policy
      return on(name as never, callback as never)
    }) as typeof ctx.on)
    const controller = new LingServersController(ctx)
    Object.assign(controller, {
      installed: new Map(), installedOperations: new Map([['task', () => {}]]),
      operations: { get: async () => ({ serverId: 'bound-server', cwd: '/srv/live' }) },
      store: { list: async () => [{ id: 'bound-server', name: '生产服务器' }] },
    })
    const exec = (command: string, description: string) => ({ name: 'server_exec', arguments: { command, description }, agent: { id: 'task' } }) as ToolExecution
    const next = async () => ({ kind: 'allow' as const })
    expect(await policy(exec('systemctl status nginx --no-pager', '检查服务'), next)).toEqual({ kind: 'allow' })
    const decision = await policy(exec('systemctl restart nginx', '读取信息'), next)
    expect(decision.kind).toBe('ask')
    if (decision.kind !== 'ask') throw new Error('expected approval')
    expect(decodeApprovalDetails(decision.reason)).toMatchObject({ summary: '读取信息', server: '生产服务器', cwd: '/srv/live', command: 'systemctl restart nginx', impact: expect.stringContaining('中断') })
    const upstream = { kind: 'ask', reason: '已有策略需要确认' } as const
    const inherited = await policy(exec('pwd', '检查目录'), async () => upstream)
    expect(inherited.kind).toBe('ask')
    if (inherited.kind === 'ask') expect(decodeApprovalDetails(inherited.reason)?.impact).toContain(upstream.reason)
  })
})
