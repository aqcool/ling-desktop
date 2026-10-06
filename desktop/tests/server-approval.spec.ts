import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LingServersController } from '../src/host/server-controller.ts'
import { decodeApprovalDetails } from '../src/approval-details.ts'
import type { PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'
import { SandboxPolicyService } from '@deepseek-ai/dsh-sandbox-policy'
import { setSandboxMode } from '@deepseek-ai/dsh-sandbox-policy'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt, { renderContextSnapshot } from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import Approval, { setApprovalPolicy } from '@deepseek-ai/dsh-user-approval'
import type { Agent } from '@deepseek-ai/dsh-agent'

afterEach(() => { vi.unstubAllEnvs() })

describe('server approval integration', () => {
  it('keeps local SSH available and explains full access using the live permission context', async () => {
    vi.stubEnv('DSH_HOME', '/tmp/ling-permission-prompt-test')
    const ctx = new Context()
    try {
      await ctx.plugin(SessionStore)
      await ctx.plugin(SessionProjectionRegistry)
      await ctx.plugin(SystemPrompt)
      await ctx.plugin(ToolRuntime)
      await ctx.plugin(SandboxPolicyService, { mode: 'workspace-write', workspaceRoot: '/local' })
      await ctx.plugin(Approval)
      ctx.provide('typert', { register: () => () => {} } as never)
      const controller = new LingServersController(ctx)
      Object.assign(controller, {
        sessions: { get: async () => undefined },
        operations: { get: async () => ({ serverId: 'bound-server', cwd: '/srv/app' }) },
        store: { list: async () => [{ id: 'bound-server', name: 'Fixture server' }] },
      })
      const session = ctx.sessions.create(SessionId('permission-prompt-test'), { meta: { cwd: '/local' } })
      const agent = { id: session.id, session, ctx } as Agent
      await (controller as unknown as { installOperations(agent: Agent): Promise<void> }).installOperations(agent)
      setSandboxMode(session, 'danger-full-access')
      setApprovalPolicy(session, 'never')
      const assembly = await ctx.systemPrompt.assemble({ agent })
      const guidance = assembly.sections.find(section => section.name === 'ling:operations-server')!.text
      expect(guidance).toContain('Local SSH, scp, sftp and rsync are also available')
      expect(guidance).not.toContain('Do not use local shell tools to reach that server')
      expect(ctx.tools.get('server_exec')).toBeDefined()
      expect(assembly.contexts.find(context => context.name === 'ling:operations-permissions')?.text).toContain('does not by itself deny ordinary commands in full access')
      expect(assembly.contexts.find(context => context.name === 'approval:policy')?.text).toContain('Approval prompts are disabled')
      expect(ctx.sandboxPolicy.resolve({ session }).mode).toBe('danger-full-access')
      // A live switch must remove full-access guidance without rebuilding the task.
      setSandboxMode(session, 'workspace-write')
      setApprovalPolicy(session, 'ask')
      const restricted = await ctx.systemPrompt.assemble({ agent })
      expect(restricted.contexts.find(context => context.name === 'ling:operations-permissions')?.text).toBe('')
      expect(renderContextSnapshot(restricted)).not.toContain('Current LING mode is danger-full-access')
      expect(restricted.contexts.find(context => context.name === 'approval:policy')?.text).toContain('Approval policy: ask')
    } finally { await ctx.fiber.dispose() }
  })
  it('uses actual binding metadata and command analysis rather than the model purpose to decide approval', async () => {
    vi.stubEnv('DSH_HOME', '/tmp/ling-approval-integration')
    const ctx = new Context()
    ctx.provide('typert', { register: () => () => {} } as never)
    let mode: 'read-only' | 'workspace-write' | 'danger-full-access' = 'workspace-write'
    ctx.provide('sessionProjections', { register: () => {}, stateOf: () => mode } as never)
    new SandboxPolicyService(ctx, { mode: 'read-only', workspaceRoot: '/local' })
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
    const exec = (command: string, description: string) => ({ name: 'server_exec', arguments: { command, description },
      agent: { id: 'task', session: { header: { cwd: '/local' } } } }) as ToolExecution
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
    mode = 'danger-full-access'
    expect(await policy(exec('systemctl restart nginx', '重启'), next)).toEqual({ kind: 'allow' })
    for (const command of ['ssh configured-host pwd', 'rsync -a ./dist/ configured-host:/srv/app/']) {
      const local = { ...exec(command, '本地 SSH'), name: 'bash' } as ToolExecution
      expect(await policy(local, next)).toEqual({ kind: 'allow' })
      expect(await policy(local, async () => ({ kind: 'deny', reason: 'independent policy' }))).toEqual({ kind: 'deny', reason: 'independent policy' })
    }
    mode = 'read-only'
    expect((await policy(exec('systemctl restart nginx', '重启'), next)).kind).toBe('deny')
    expect((await policy(exec('systemctl restart nginx', '重启'), async () => upstream)).kind).toBe('deny')
  })
})
