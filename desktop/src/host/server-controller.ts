import { randomUUID } from 'node:crypto'
import { join, posix } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import type { RemotePolicy } from '../ssh/runtime.ts'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { LING_SERVERS_HOST, type LingServerInput } from '../server-contract.ts'
import { ServerStore } from '../server-store.ts'
import { ServerSessions, taskServersUpdateSchema, type ServerSessionBinding } from '../server-sessions.ts'
import { localDeploymentFile, localDeploymentTree, localDownloadTarget, parseRemoteFileHash,
  remoteDeploymentDirectory, remoteDeploymentPath, remoteFileHashCommand, shellQuote } from '../server-deployment.ts'
import { ServerAudit } from '../server-audit.ts'
import { encodeApprovalDetails } from '../approval-details.ts'
import { serverCommandImpact, serverToolDecision } from './server-command-policy.ts'
import { ServerExecutionRecorder } from './server-execution-recorder.ts'
import { getServerBridge } from './server-bridge.ts'
import { deployDirectory } from './server-directory-deploy.ts'
import { RemoteWorkspaceGit } from './server-git.ts'
import type { LingGitRequest, LingTaskServers, LingTaskServersUpdate, LingServerTerminalScope } from 'ling-desktop/runtime'
import type { LingRemoteFileRequest } from 'ling-desktop/runtime'
import { serverCopyOptionsSchema, type ServerCopyResult } from '../server-copy-contract.ts'
import { serverEndpoint } from '../server-task-contract.ts'

interface ExecutionTarget extends ServerSessionBinding { readonly revision: number; readonly endpoint: string }
const serverTools = new Set(['server_show_terminal', 'server_exec', 'server_copy', 'server_deploy_plan', 'server_deploy_apply', 'server_deploy_directory_plan', 'server_deploy_directory_apply', 'server_download_plan', 'server_download_apply', 'remote_run', 'remote_list', 'remote_read', 'remote_write', 'remote_cd'])

declare module '@deepseek-ai/cordis' {
  interface Context { lingServers: LingServersController }
}

/** First-party Host plugin. The model has no tool entry for these operations. */
export class LingServersController extends TypertRemoteService {
  static inject = ['typert', 'agents', 'tools', 'systemPrompt', 'sandboxPolicy']
  async fileManager(serverId: string, request: LingRemoteFileRequest, signal: AbortSignal) {
    await this.server(serverId)
    const result = await getServerBridge().file({ action: 'sftp', serverId, request }, signal)
    if (!('type' in result)) throw new Error('SFTP 返回了无效结果。')
    return result
  }
  private readonly store: ServerStore
  private readonly sessions: ServerSessions
  private readonly audit: ServerAudit
  private readonly executionRecorder: ServerExecutionRecorder
  private readonly executionPolicies = new WeakMap<object, RemotePolicy>()
  private readonly installed = new Map<string, () => void>()
  private readonly serverLabels = new Map<string, { name: string; environment: string }>()
  private readonly taskStates = new Map<string, LingTaskServers>()
  private readonly executionTargets = new WeakMap<object, ExecutionTarget>()
  private readonly taskTerminals = new Map<string, Set<string>>()
  private readonly draftTerminalBindings = new Map<string, ServerSessionBinding & { readonly taskId?: string }>()
  private readonly draftTerminalScopes = new Map<string, Promise<{ ownerId: string }>>()
  private readonly terminalUiRequests = new Map<string, string>()
  private readonly gitQueues = new Map<string, Promise<unknown>>()
  private readonly deploymentPlans = new Map<string, { taskId: string; serverId: string; revision: number; cwd: string; endpoint: string; root: string; source: string;
    destination: string; sha256: string; remoteSha256: string | null; expiresAt: number }>()
  private readonly downloadPlans = new Map<string, { taskId: string; serverId: string; revision: number; cwd: string; endpoint: string; root: string; source: string;
    destination: string; sha256: string; localSha256: string | null; expiresAt: number }>()
  private readonly directoryPlans = new Map<string, { taskId: string; serverId: string; revision: number; cwd: string; endpoint: string; root: string; source: string;
    destination: string; directories: readonly string[]; remoteSha256: string;
    files: Array<{ source: string; relative: string; sha256: string; mode: number }>;
    expiresAt: number }>()

  constructor(ctx: Context) {
    super(ctx, 'lingServers')
    const home = process.env.DSH_HOME
    if (!home) throw new Error('LING server plugin requires DSH_HOME')
    this.store = new ServerStore(join(home, 'ling-servers.json'))
    this.sessions = new ServerSessions(join(home, 'ling-task-servers.json'))
    this.audit = new ServerAudit(home)
    this.executionRecorder = new ServerExecutionRecorder(join(home, 'ling-server-executions'))
    ctx.effect(() => ctx.typert.register(LING_SERVERS_HOST), 'LING servers Remote contract')
    ctx.on('agent/created', async ({ agent }) => { await this.install(agent) })
    ctx.on('agent/disposed', ({ agent }) => {
      this.installed.get(String(agent.id))?.()
      this.installed.delete(String(agent.id))
      this.taskStates.delete(String(agent.id))
      this.terminalUiRequests.delete(String(agent.id))
      for (const [id, plan] of this.deploymentPlans) if (plan.taskId === String(agent.id)) this.deploymentPlans.delete(id)
      for (const [id, plan] of this.downloadPlans) if (plan.taskId === String(agent.id)) this.downloadPlans.delete(id)
      for (const [id, plan] of this.directoryPlans) if (plan.taskId === String(agent.id)) this.directoryPlans.delete(id)
    })
    ctx.on('tools/pre-execute', async (exec, next) => {
      const previous = await next()
      if (!exec.agent) return previous
      if (!serverTools.has(exec.name) || previous.kind === 'deny') return previous
      const taskId = String(exec.agent.id)
      const args = exec.arguments && typeof exec.arguments === 'object' ? exec.arguments as Record<string, unknown> : {}
      if (typeof args.serverId !== 'string') return { kind: 'deny' as const, reason: '必须明确指定当前会话已关联的服务器。' }
      const binding = await this.resolveTarget(taskId, args.serverId, exec.signal)
      this.executionTargets.set(exec, binding)
      const remote = exec.name.startsWith('remote_')
      const operations = !remote
      const mode = this.ctx.get('sandboxPolicy')?.resolve({ session: exec.agent.session }).mode ?? 'workspace-write'
      const decision = serverToolDecision(exec.name, exec.arguments, { remote, operations, mode, cwd: binding?.cwd }, previous)
      if (binding) this.executionPolicies.set(exec, { workspaceRoot: binding.cwd,
        mode: decision.kind === 'ask' && mode !== 'read-only' ? 'danger-full-access' : mode })
      if (decision.kind !== 'ask' || !['server_exec', 'server_copy', 'remote_run', 'remote_write', 'server_deploy_apply', 'server_deploy_directory_apply', 'server_download_apply'].includes(exec.name)) return decision
      if (!binding) return decision
      const server = await this.server(binding.serverId)
      const command = typeof args.command === 'string' ? args.command : undefined
      const titles: Record<string, string> = { server_copy: '拷贝本地文件到服务器', remote_write: '写入远端文件', server_deploy_apply: '部署文件到服务器',
        server_deploy_directory_apply: '部署目录到服务器', server_download_apply: '取回服务器文件' }
      const impacts: Record<string, string> = { server_copy: '会创建目标文件和目录；按所选覆盖方式合并目录，保留远端独有文件。', remote_write: '会创建文件，或覆盖目标文件的现有内容。',
        server_deploy_apply: '会创建文件，或覆盖目标文件的现有内容。',
        server_deploy_directory_apply: '会替换目标目录，删除远端独有的文件。',
        server_download_apply: '会写入本地目标文件，可能覆盖已有内容。' }
      const summary = typeof args.description === 'string' && args.description.trim()
        ? args.description.trim().slice(0, 240) : titles[exec.name] ?? '执行远端命令'
      return { kind: 'ask' as const, reason: encodeApprovalDetails({ summary, server: server.name,
        cwd: binding.cwd, impact: [command ? serverCommandImpact(command) : impacts[exec.name],
          previous.kind === 'ask' ? previous.reason : undefined].filter(Boolean).join(' '),
        ...(command ? { command } : {}),
        ...(typeof args.source === 'string' ? { source: args.source } : {}),
        ...(typeof args.destination === 'string' ? { destination: args.destination } : typeof args.path === 'string' ? { destination: args.path } : {}),
      }) }
    })
    ctx.effect(() => () => {
      for (const dispose of this.installed.values()) dispose()
      this.installed.clear()
      this.taskStates.clear()
      this.deploymentPlans.clear()
      this.downloadPlans.clear()
      this.directoryPlans.clear()
    }, 'LING remote session tools')
  }

  async list() {
    const servers = await this.store.list()
    for (const server of servers) this.serverLabels.set(server.id, { name: server.name, environment: server.environment })
    return servers
  }
  executions(taskId: string, callIds: readonly string[]) { return this.executionRecorder.list(taskId, callIds) }
  add(input: LingServerInput) { return this.store.add(input) }
  configure(id: string, input: LingServerInput) { return this.store.configure(id, input) }
  async forget(id: string) { await this.store.remove(id); return { ok: true as const } }

  async probe(id: string, signal: AbortSignal, expectedEndpoint?: string) {
    await this.server(id)
    const result = await getServerBridge().run(id, '/', "printf '__LING_HOME__\\n'; cd ~ && pwd -P", signal, undefined, undefined, undefined, expectedEndpoint)
    const marker = result.stdout.lastIndexOf('__LING_HOME__\n')
    const home = marker < 0 ? '' : result.stdout.slice(marker + '__LING_HOME__\n'.length).trim()
    if (result.exitCode !== 0 || !posix.isAbsolute(home) || home.includes('\n') || home.includes('\0')) throw new Error('无法解析服务器主目录。')
    return { home }
  }

  async directories(id: string, path: string, signal: AbortSignal) {
    await this.server(id)
    const result = await getServerBridge().file({ action: 'list', serverId: id, path }, signal)
    if (!('entries' in result)) throw new Error('服务器目录返回无效结果。')
    return { path, directories: result.entries.filter(item => item.type === 'directory')
      .map(item => ({ name: item.name, path: posix.join(path, item.name) })) }
  }

  taskServers(taskId: string): Promise<LingTaskServers> { return this.sessions.get(taskId) }

  async setTaskServers(taskId: string, request: LingTaskServersUpdate): Promise<LingTaskServers> {
    const update = taskServersUpdateSchema.parse(request)
    const agent = this.ctx.agents.get(SessionId(taskId))
    if (!agent) throw new RemoteError('gateway/bad-request', '任务不存在或尚未就绪。', {})
    const known = new Set((await this.list()).map(server => server.id))
    if (update.serverIds.some(id => !known.has(id))) throw new RemoteError('gateway/bad-request', '服务器已不存在。', {})
    const previous = await this.sessions.get(taskId)
    if (previous.developmentServerId !== update.developmentServerId && agent.status !== 'idle')
      throw new RemoteError('gateway/bad-request', '任务运行中无法改变主开发服务器。', {})
    const next = await this.sessions.set(taskId, update)
    this.rememberState(taskId, next)
    await this.install(agent)
    return next
  }

  /** Fork bindings on the Host so only previously resolved server paths can be inherited. */
  async copyTaskServers(sourceTaskId: string, targetTaskId: string): Promise<LingTaskServers> {
    const agent = this.ctx.agents.get(SessionId(targetTaskId))
    if (!agent) throw new RemoteError('gateway/bad-request', '任务不存在或尚未就绪。', {})
    if (agent.status !== 'idle') throw new RemoteError('gateway/bad-request', '任务运行中无法复制服务器关联。', {})
    const next = await this.sessions.copy(sourceTaskId, targetTaskId)
    this.rememberState(targetTaskId, next)
    await this.install(agent)
    return next
  }

  private rememberState(taskId: string, state: LingTaskServers): void {
    if ((this.taskStates.get(taskId)?.revision ?? -1) <= state.revision) this.taskStates.set(taskId, state)
  }

  async developmentTarget(taskId: string): Promise<ServerSessionBinding | undefined> {
    const state = await this.sessions.get(taskId)
    return state.developmentServerId ? this.resolveTarget(taskId, state.developmentServerId, new AbortController().signal) : undefined
  }

  /** Resolve only the explicitly selected server. Offline association never connects. */
  private async resolveTarget(taskId: string, serverId: string, signal: AbortSignal): Promise<ExecutionTarget> {
    let state = await this.sessions.get(taskId)
    let binding = state.servers.find(item => item.serverId === serverId)
    if (!binding) throw new RemoteError('gateway/bad-request', '此服务器未关联当前会话。', {})
    const endpoint = serverEndpoint(await this.server(serverId))
    if (!binding.cwd) {
      const { home } = await this.probe(serverId, signal, endpoint)
      signal.throwIfAborted()
      if (serverEndpoint(await this.server(serverId)) !== endpoint) throw new Error('服务器连接已变化，请重新执行该操作。')
      await this.sessions.changeDirectory(taskId, serverId, home, { revision: state.revision, cwd: binding.cwd }, true)
      state = await this.sessions.get(taskId)
      binding = state.servers.find(item => item.serverId === serverId)
    }
    if (!binding?.cwd) throw new Error('服务器关联已变化，请重试。')
    this.rememberState(taskId, state)
    if (serverEndpoint(await this.server(serverId)) !== endpoint) throw new Error('服务器连接已变化，请重新执行该操作。')
    return { serverId, cwd: binding.cwd, revision: state.revision, endpoint }
  }

  private async executionTarget(taskId: string, serverId: string, exec: ToolExecution): Promise<ExecutionTarget> {
    const target = this.executionTargets.get(exec) ?? await this.resolveTarget(taskId, serverId, exec.signal)
    if (target.serverId !== serverId) throw new Error('审批服务器与执行目标不一致。')
    await this.assertTarget(taskId, target)
    return target
  }
  private async assertTarget(taskId: string, target: ExecutionTarget): Promise<void> {
    const state = await this.sessions.get(taskId)
    const current = state.servers.find(item => item.serverId === target.serverId)
    if (state.revision !== target.revision || current?.cwd !== target.cwd) throw new Error('服务器关联或工作目录已变化，请重新执行该操作。')
    if (serverEndpoint(await this.server(target.serverId)) !== target.endpoint) throw new Error('服务器连接已变化，请重新执行该操作。')
  }

  async terminalScope(request: LingServerTerminalScope, signal: AbortSignal): Promise<{ ownerId: string }> {
    const { taskId, serverId, placement } = request
    await this.server(serverId)
    if (taskId && !(await this.sessions.get(taskId)).servers.some(item => item.serverId === serverId))
      throw new RemoteError('gateway/bad-request', '此服务器未关联当前会话。', {})
    const key = JSON.stringify([taskId ?? null, serverId, placement])
    const existing = this.draftTerminalScopes.get(key)
    if (existing) return existing
    const pending = (async () => {
      const binding = taskId ? await this.resolveTarget(taskId, serverId, signal)
        : { serverId, cwd: (await this.probe(serverId, signal)).home }
      signal.throwIfAborted()
      const ownerId = `ling-server-terminal:${randomUUID()}`
      this.draftTerminalBindings.set(ownerId, { serverId, cwd: binding.cwd, ...(taskId ? { taskId } : {}) })
      return { ownerId }
    })().catch(error => { this.draftTerminalScopes.delete(key); throw error })
    this.draftTerminalScopes.set(key, pending)
    return pending
  }

  private terminalOwner(ownerId: string, terminalId?: string): ServerSessionBinding & { readonly taskId?: string } {
    const binding = this.draftTerminalBindings.get(ownerId)
    if (!binding) throw new RemoteError('gateway/bad-request', '终端范围已不存在，请重新打开。', {})
    if (terminalId && !this.taskTerminals.get(ownerId)?.has(terminalId))
      throw new RemoteError('gateway/bad-request', '此终端不属于当前范围。', {})
    return binding
  }

  async takeTerminalUiRequest(taskId: string): Promise<{ open: boolean; serverId?: string }> {
    const serverId = this.terminalUiRequests.get(taskId)
    this.terminalUiRequests.delete(taskId)
    return serverId ? { open: true, serverId } : { open: false }
  }

  async terminalList(ownerId: string): Promise<readonly string[]> {
    this.terminalOwner(ownerId)
    return [...this.taskTerminals.get(ownerId) ?? []]
  }

  async terminalOpen(ownerId: string, cols: number, rows: number, signal: AbortSignal): Promise<{ terminalId: string }> {
    const owner = this.terminalOwner(ownerId)
    // An existing PTY stays usable after unlinking; opening another requires membership.
    const binding = owner.taskId ? await this.resolveTarget(owner.taskId, owner.serverId, signal) : owner
    const value = await getServerBridge().terminalOpen(binding.serverId, binding.cwd, cols, rows, signal)
    const terminals = this.taskTerminals.get(ownerId) ?? new Set<string>()
    terminals.add(value.terminalId)
    this.taskTerminals.set(ownerId, terminals)
    return value
  }

  async terminalPoll(ownerId: string, terminalId: string, offset: number, signal: AbortSignal) {
    this.terminalOwner(ownerId, terminalId)
    return getServerBridge().terminalPoll(terminalId, offset, signal)
  }
  async terminalWrite(ownerId: string, terminalId: string, data: string, signal: AbortSignal) {
    this.terminalOwner(ownerId, terminalId)
    return getServerBridge().terminalWrite(terminalId, data, signal)
  }
  async terminalResize(ownerId: string, terminalId: string, cols: number, rows: number, signal: AbortSignal) {
    this.terminalOwner(ownerId, terminalId)
    return getServerBridge().terminalResize(terminalId, cols, rows, signal)
  }
  async terminalClose(ownerId: string, terminalId: string, signal: AbortSignal) {
    this.terminalOwner(ownerId, terminalId)
    try {
      return await getServerBridge().terminalClose(terminalId, signal)
    } finally {
      this.taskTerminals.get(ownerId)?.delete(terminalId)
    }
  }

  private async remoteFilePath(taskId: string, serverId: string, path: string, signal: AbortSignal, pinned?: ExecutionTarget) {
    const binding = pinned ?? await this.resolveTarget(taskId, serverId, signal)
    if (pinned) await this.assertTarget(taskId, pinned)
    if (!path || path.length > 4096 || path.includes('\0')) throw new Error('远端文件路径无效。')
    const resolved = posix.resolve(binding.cwd, path)
    return { binding, resolved }
  }

  async filesList(taskId: string, serverId: string, path: string, signal: AbortSignal, pinned?: ExecutionTarget) {
    const { binding, resolved } = await this.remoteFilePath(taskId, serverId, path || '.', signal, pinned)
    const result = await getServerBridge().file({ action: 'list', serverId: binding.serverId, path: resolved }, signal, binding.endpoint)
    if (!('entries' in result)) throw new Error('远端目录返回无效结果。')
    const entries = [...result.entries].sort((a, b) => a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'directory' ? -1 : 1)
    return { path: path === '.' ? '' : path, entries }
  }
  async filesRead(taskId: string, serverId: string, path: string, signal: AbortSignal, pinned?: ExecutionTarget) {
    const { binding, resolved } = await this.remoteFilePath(taskId, serverId, path, signal, pinned)
    const result = await getServerBridge().file({ action: 'read', serverId: binding.serverId, path: resolved }, signal, binding.endpoint)
    if (!('text' in result)) throw new Error('远端文件返回无效结果。')
    return { ...result, path }
  }
  async filesSave(taskId: string, serverId: string, path: string, text: string, expectedSha256: string | null, signal: AbortSignal, policy?: RemotePolicy, pinned?: ExecutionTarget) {
    if (!path || path.length > 4096 || path.includes('\0')) throw new Error('远端文件路径无效。')
    const binding = pinned ?? await this.resolveTarget(taskId, serverId, signal)
    await this.assertTarget(taskId, binding)
    const resolved = posix.resolve(binding.cwd, path)
    // Renderer saves are explicit human operations; agent writes always pass session policy.
    const result = await this.audit.perform(taskId, binding.serverId, 'deploy-file', path,
      () => getServerBridge().file({ action: 'write', serverId: binding.serverId, path: resolved, text, expected: expectedSha256,
        policy: policy ?? { mode: 'danger-full-access', workspaceRoot: binding.cwd } }, signal, binding.endpoint))
    if (!('sha256' in result)) throw new Error('远端文件返回无效结果。')
    return { path, sha256: result.sha256 }
  }
  private executionPolicy(exec: ToolExecution, cwd: string): RemotePolicy {
    const approved = this.executionPolicies.get(exec)
    if (approved && approved.workspaceRoot !== cwd) throw new Error('远端工作目录已变化，请重新执行该操作。')
    return approved ?? { workspaceRoot: cwd,
      mode: this.ctx.get('sandboxPolicy')?.resolve(exec.agent ? { session: exec.agent.session } : {}).mode ?? 'read-only' }
  }
  private installTerminalTool(agent: Agent, taskId: string, dispose: Array<() => void>) {
    dispose.push(agent.ctx.tools.register(defineTool({
      name: 'server_show_terminal', description: 'Open the bound server terminal for private user interaction. Its input and output never enter the model transcript.',
      parameters: { serverId: { type: 'string', required: true } }, output: { schema: { type: 'object', additionalProperties: false, properties: { opened: { type: 'boolean', required: true } } },
        render: () => [{ type: 'text', text: '已请求在右侧打开服务器终端。' }] },
      execute: async (args, exec) => { const target = await this.executionTarget(taskId, args.serverId, exec); this.terminalUiRequests.set(taskId, target.serverId); return { opened: true } },
      presentCall: () => ({ card: 'generic', title: '打开服务器终端', kind: 'read' }),
    })))
  }

  async gitRequest(taskId: string, serverId: string, request: LingGitRequest, signal: AbortSignal) {
    const binding = await this.resolveTarget(taskId, serverId, signal)
    const run = async () => {
      await this.assertTarget(taskId, binding)
      const git = new RemoteWorkspaceGit({ run: (id, cwd, command, callSignal, limit) => getServerBridge().run(id, cwd, command, callSignal, limit, undefined, undefined, binding.endpoint) })
      return git.handle(binding, request, signal, async path => {
        const checked = await getServerBridge().run(binding.serverId, '/',
          `set -eu; cd ${shellQuote(path)}; pwd -P`, signal, undefined, undefined, undefined, binding.endpoint)
        if (checked.exitCode !== 0) throw new Error('远端 Worktree 目录无法访问。')
        await this.sessions.changeDirectory(taskId, serverId, checked.stdout.trim(), binding)
        this.rememberState(taskId, await this.sessions.get(taskId))
      })
    }
    if (request.type === 'inspect' || request.type === 'diff') return run()
    const previous = this.gitQueues.get(binding.serverId) ?? Promise.resolve()
    const next = previous.catch(() => undefined).then(() => this.audit.perform(taskId, binding.serverId,
      'git', JSON.stringify(request), run))
    this.gitQueues.set(binding.serverId, next)
    try { return await next } finally { if (this.gitQueues.get(binding.serverId) === next) this.gitQueues.delete(binding.serverId) }
  }

  private async install(agent: Agent): Promise<void> {
    const taskId = String(agent.id)
    await this.list()
    this.rememberState(taskId, await this.sessions.get(taskId))
    if (this.installed.has(taskId)) return
    const dispose: Array<() => void> = []
    const resultSchema = { type: 'object', additionalProperties: false, properties: {
      stdout: { type: 'string', required: true }, stderr: { type: 'string', required: true },
      exitCode: { type: 'integer', required: true },
    } } as const
    const output = { schema: resultSchema, render: (_args: unknown, value: { stdout: string; stderr: string; exitCode: number }) =>
      [{ type: 'text' as const, text: `Exit: ${value.exitCode}\n${value.stdout}${value.stderr ? `\n[stderr]\n${value.stderr}` : ''}` }] }
    const current = (exec: ToolExecution, serverId: string) => this.executionTarget(taskId, serverId, exec)
    try {
      const localOnlyTools = new Set(['bash', 'pwsh', 'read', 'write', 'edit', 'read_image', 'glob', 'grep', 'terminal_open', 'terminal_send', 'terminal_read', 'terminal_signal', 'terminal_close', 'terminal_list', 'job_output', 'job_list', 'job_kill'])
      dispose.push(agent.ctx.tools.guard(exec => this.taskStates.get(taskId)?.developmentServerId && localOnlyTools.has(exec.name) ? '此任务使用主远端开发服务器，请使用带serverId的远端工具。' : undefined))
      dispose.push(agent.ctx.systemPrompt.context({ name: 'ling:server-targets', order: 130,
        text: () => JSON.stringify({ developmentServerId: this.taskStates.get(taskId)?.developmentServerId ?? null, servers: (this.taskStates.get(taskId)?.servers ?? []).map(binding => ({ ...binding, ...this.serverLabels.get(binding.serverId) })) }),
      }))
      dispose.push(agent.ctx.systemPrompt.section({ name: 'ling:operations-server', order: agent.ctx.systemPrompt.getSectionOrder('PLAN_POLICY'),
        text: 'This session may associate multiple servers. Every server tool must receive the exact serverId from the current server-targets context. Association is not execution authority. Local tools remain local unless developmentServerId selects the primary remote project; in that case use remote_run, remote_list, remote_read, remote_write and remote_cd with its explicit serverId for the project. Selecting a terminal or file browser never changes the agent target. Each server has its own working directory. A missing, removed or offline target must fail explicitly, never fall back to another server. Prefer server_exec for ordinary remote operations on the explicitly selected associated server; LING supplies its saved credentials without exposing them to the model. Local SSH, scp, sftp and rsync are also available in local-workspace tasks under the current session permissions with existing local authentication, including when the user requests them; attaching a server does not prohibit these commands. The session permission mode applies to server tools: read-only forbids mutations, workspace-write requests approval for server changes, full access permits them without extra SSH prompts. Always supply a concise description in the user’s language explaining the purpose and intended change, not just the shell syntax. For credential viewing, entry, reset, or other sensitive interactive work, call server_show_terminal and let the user work in the terminal pane. Its input and output do not enter the agent context. Never run credential-revealing commands with server_exec or ask the user to paste credentials into chat. For copying local files or directories to the explicitly selected associated server, prefer server_copy: choose source, exact destination, exclusions, overwrite behavior, checksum and transport yourself. It reuses saved password/key/passphrase authentication with no file picker or mandatory plan/apply. A directory copies its CONTENTS into the destination and preserves remote-only files. auto uses rsync when both ends support it for directories, otherwise fast native SFTP, including on Windows. rsync is optional; if useful, you may install it remotely through server_exec under the current permissions, then retry. Successful files remain on interruption; retrying skips unchanged files (size/mtime/mode by default; checksum=true compares contents). Use dryRun=true for an optional preview. Sources are workspace-relative; absolute paths are also allowed in full access. Only use server_deploy_directory_plan/apply when the user explicitly wants complete replacement including deletion of remote-only paths. The reviewed server_deploy_plan/apply pair remains available for version-checked single-file deployment. For a remote file, call server_download_plan and then server_download_apply. Use server_exec for release switching and health checks.',
      }))
      dispose.push(agent.ctx.systemPrompt.context({
        name: 'ling:operations-permissions', order: agent.ctx.systemPrompt.getContextOrder('APPROVAL_POLICY') + 1,
        text: () => this.ctx.sandboxPolicy.resolve({ session: agent.session }).mode === 'danger-full-access'
          ? 'Current LING mode is danger-full-access. Local shell commands, including SSH and rsync, and selected associated server tools may perform the user-authorized work directly. No sandbox escalation is needed for normal allowed operations. If the approval policy is "never", it disables approval dialogs; it does not by itself deny ordinary commands in full access. Do not say approval is required or execution is impossible solely because approval dialogs are disabled. Only report a block when an actual tool or policy denies that operation, using its specific reason. Use the current permission context, not an earlier permission value or refusal in the conversation.'
          : '',
      }))
      this.installTerminalTool(agent, taskId, dispose)
      dispose.push(agent.ctx.tools.register(defineTool({
        name: 'server_exec', description: 'Run an ordinary shell command on the associated server identified by serverId. Its output enters the agent context; for credentials or other secret-bearing output, open the private server terminal instead. Use for deployment, service management, logs, containers, processes and diagnostics. The current session permission mode applies; restricted sessions require approval for state changes. Include a plain-language description of the purpose and intended change. Only session-associated server IDs are accepted; credentials remain private to LING.',
        parameters: { serverId: { type: 'string', required: true, description: 'Exact ID of a server associated with this session.' }, command: { type: 'string', required: true, description: 'Remote shell command to run on the explicitly selected associated server.' }, description: { type: 'string', required: true, description: 'In the user’s language, briefly explain what this does and why. Describe any intended changes.' } }, output,
        execute: async (args, exec) => {
          if (!args.command.trim() || args.command.length > 16384 || args.command.includes('\0')) throw new Error('远端命令无效。')
          const target = await current(exec, args.serverId)
          return this.audit.perform(taskId, target.serverId, 'exec', args.command,
            async () => this.executionRecorder.run(taskId, { callId: String(exec.callId), summary: args.description,
              server: (await this.server(target.serverId)).name, cwd: target.cwd, command: args.command }, exec.signal,
              output => getServerBridge().run(target.serverId, target.cwd, args.command, exec.signal, undefined, output, this.executionPolicy(exec, target.cwd), target.endpoint)))
        },
        presentCall: args => ({ card: 'generic', title: `远端执行 · ${args.serverId} · ${args.description}`, kind: 'execute' }),
      })))
      dispose.push(agent.ctx.tools.register(defineTool({
        name: 'server_copy',
        description: 'Copy one local file or directory to the explicitly selected associated server using LING’s saved password or key, without interactive authentication or a file picker. You control paths, merge/overwrite, exclusions, optional preview and checksum. Directory CONTENTS merge into the exact destination; remote-only files remain. auto uses available rsync for directories or parallel native SFTP on any desktop OS. rsync is optional and can be installed remotely with server_exec if useful. Retry skips unchanged completed files. Full access needs no additional SSH approval; restricted sessions use the current approval policy.',
        parameters: { serverId: { type: 'string', required: true, description: 'Exact ID of a server associated with this session.' },
          source: { type: 'string', required: true, description: 'Local file or directory, relative to this workspace; an absolute local path is accepted in full access (including Windows paths).' },
          destination: { type: 'string', required: true, description: 'Exact absolute POSIX path on the server. For a directory, its contents go directly into this directory.' },
          description: { type: 'string', required: true, description: 'Briefly explain the purpose and intended change in the user’s language.' },
          method: { type: 'string', enum: ['auto', 'sftp', 'rsync'], default: 'auto' },
          overwrite: { type: 'string', enum: ['replace', 'skip', 'error'], default: 'replace', description: 'replace updates existing files, skip keeps existing files, error refuses conflicts.' },
          exclude: { type: 'array', items: { type: 'string' }, description: 'Optional gitignore-style patterns relative to source, e.g. .git/, node_modules/, *.map. No implicit exclusions.' },
          dryRun: { type: 'boolean', default: false, description: 'Only preview changes; creates no remote paths.' },
          checksum: { type: 'boolean', default: false, description: 'Compare file contents instead of size/mtime for unchanged files, and verify SFTP payloads with SHA-256. More disk/network work.' },
          concurrency: { type: 'integer', default: 4, description: 'Simultaneous SFTP files, 1–8. Each file also pipelines writes.' },
        },
        output: { schema: { type: 'object', additionalProperties: false, properties: {
          source: { type: 'string', required: true }, destination: { type: 'string', required: true },
          method: { type: 'string', enum: ['sftp', 'rsync'], required: true }, dryRun: { type: 'boolean', required: true },
          files: { type: 'integer', required: true }, copied: { type: 'integer', required: true }, skipped: { type: 'integer', required: true },
          bytes: { type: 'integer', required: true }, durationMs: { type: 'integer', required: true },
          changes: { type: 'array', items: { type: 'string' }, required: true }, truncated: { type: 'boolean', required: true },
        } }, render: (_args, value) => [{ type: 'text', text: `${value.dryRun ? 'Preview' : 'Copied'} via ${value.method}: ${value.source} → ${value.destination}\n${value.copied} copied, ${value.skipped} skipped, ${value.files} total; ${value.bytes} bytes, ${value.durationMs} ms\n${value.changes.join('\n')}${value.truncated ? '\n…change list truncated' : ''}` }] },
        execute: async (args, exec) => {
          const target = await current(exec, args.serverId)
          const root = agent.session.header.cwd
          if (!root) throw new Error('此会话没有本地工作区，无法拷贝文件。')
          const { description, serverId: _serverId, ...values } = args
          const options = serverCopyOptionsSchema.parse(values)
          const allowOutsideWorkspace = this.ctx.sandboxPolicy.resolve({ session: agent.session }).mode === 'danger-full-access'
          let result!: ServerCopyResult
          const run = async () => this.executionRecorder.run(taskId, { callId: String(exec.callId), summary: description,
            server: (await this.server(target.serverId)).name, cwd: target.cwd, command: `server_copy ${JSON.stringify(options)}` }, exec.signal,
            async output => {
              result = await getServerBridge().copy(target.serverId, { ...options, root, allowOutsideWorkspace }, exec.signal, output, target.endpoint)
              output({ stream: 'stdout', data: `${result.method} · ${result.copied} copied · ${result.skipped} skipped · ${result.bytes} bytes\n` })
              return { stdout: '', stderr: '', exitCode: 0 }
            })
          if (options.dryRun) await run()
          else await this.audit.perform(taskId, target.serverId, 'copy', JSON.stringify(options), run)
          return result
        },
        presentCall: args => ({ card: 'generic', title: `拷贝到服务器 · ${args.serverId} · ${args.description}`, kind: args.dryRun ? 'read' : 'execute' }),
      })))
      dispose.push(agent.ctx.tools.register(defineTool({
        name: 'server_deploy_plan', description: 'Preview deploying one file from this task’s local workspace to an absolute path on the explicitly selected associated server. Returns a short-lived plan with local and existing remote SHA-256 hashes. This does not write remote files.',
        parameters: { serverId: { type: 'string', required: true, description: 'Exact ID of a server associated with this session.' },
          source: { type: 'string', required: true, description: 'File path relative to the local workspace.' },
          destination: { type: 'string', required: true, description: 'Absolute destination file path on the explicitly selected associated server.' },
        },
        output: { schema: { type: 'object', additionalProperties: false, properties: {
          planId: { type: 'string', required: true }, source: { type: 'string', required: true },
          destination: { type: 'string', required: true }, bytes: { type: 'integer', required: true },
          sha256: { type: 'string', required: true }, remote: { type: 'string', required: true },
        } }, render: (_args, value) => [{ type: 'text', text: `Plan: ${value.planId}\nLocal: ${value.source} (${value.bytes} bytes, SHA-256 ${value.sha256})\nRemote: ${value.destination} (${value.remote})` }] },
        execute: async (args, exec) => {
          const target = await current(exec, args.serverId)
          const root = agent.session.header.cwd
          if (!root) throw new Error('此会话没有本地工作区，无法部署本地文件。')
          const file = await localDeploymentFile(root, args.source)
          const destination = remoteDeploymentPath(args.destination)
          const remote = await getServerBridge().run(target.serverId, target.cwd, remoteFileHashCommand(destination), exec.signal, undefined, undefined, undefined, target.endpoint)
          if (remote.exitCode !== 0) throw new Error(remote.stderr || '无法读取远端目标状态。')
          const remoteSha256 = parseRemoteFileHash(remote.stdout)
          const planId = randomUUID()
          this.deploymentPlans.set(planId, { taskId, serverId: target.serverId, revision: target.revision, cwd: target.cwd, endpoint: target.endpoint, root, source: args.source, destination,
            sha256: file.sha256, remoteSha256, expiresAt: Date.now() + 10 * 60_000 })
          return { planId, source: args.source, destination, bytes: file.bytes, sha256: file.sha256,
            remote: remoteSha256 ? `SHA-256 ${remoteSha256}` : '新文件' }
        },
        presentCall: args => ({ card: 'generic', title: `部署预览 · ${args.source} → ${args.destination}`, kind: 'read' }),
      })))
      dispose.push(agent.ctx.tools.register(defineTool({
        name: 'server_deploy_apply', description: 'Deploy exactly one previously previewed local workspace file to the explicitly selected associated server. Follows session permissions and fails if either file changed after preview.',
        parameters: { serverId: { type: 'string', required: true, description: 'Exact ID of a server associated with this session.' },
          planId: { type: 'string', required: true, description: 'Plan ID returned by server_deploy_plan.' },
          source: { type: 'string', required: true, description: 'Exact source path from the preview.' },
          destination: { type: 'string', required: true, description: 'Exact destination path from the preview.' },
        },
        output: { schema: { type: 'object', additionalProperties: false, properties: {
          destination: { type: 'string', required: true }, bytes: { type: 'integer', required: true }, sha256: { type: 'string', required: true },
        } }, render: (_args, value) => [{ type: 'text', text: `Deployed ${value.bytes} bytes to ${value.destination}\nSHA-256 ${value.sha256}` }] },
        execute: async (args, exec) => {
          const target = await current(exec, args.serverId)
          const plan = this.deploymentPlans.get(args.planId)
          if (!plan || plan.taskId !== taskId || plan.serverId !== target.serverId || plan.revision !== target.revision || plan.cwd !== target.cwd || plan.endpoint !== target.endpoint || plan.source !== args.source
            || plan.destination !== args.destination || plan.expiresAt < Date.now()) throw new Error('部署预览已失效，请重新预览。')
          this.deploymentPlans.delete(args.planId)
          return this.audit.perform(taskId, target.serverId, 'deploy-file', `${plan.source}\0${plan.destination}\0${plan.sha256}`,
            () => getServerBridge().upload(target.serverId, plan.root, plan.source, plan.destination,
              plan.sha256, plan.remoteSha256, exec.signal, target.endpoint))
        },
        presentCall: args => ({ card: 'generic', title: `部署文件 · ${args.serverId} · ${args.source} → ${args.destination}`, kind: 'execute' }),
      })))
      dispose.push(agent.ctx.tools.register(defineTool({
        name: 'server_deploy_directory_plan', description: 'Preview a complete replacement of the remote destination directory from a local workspace directory, including remote-only paths that will be removed. Does not write remotely.',
        parameters: { serverId: { type: 'string', required: true, description: 'Exact ID of a server associated with this session.' },
          source: { type: 'string', required: true, description: 'Directory relative to the local workspace.' },
          destination: { type: 'string', required: true, description: 'Absolute destination directory on the explicitly selected associated server.' },
        },
        output: { schema: { type: 'object', additionalProperties: false, properties: {
          planId: { type: 'string', required: true }, source: { type: 'string', required: true },
          destination: { type: 'string', required: true }, bytes: { type: 'integer', required: true },
          count: { type: 'integer', required: true }, files: { type: 'string', required: true },
        } }, render: (_args, value) => [{ type: 'text', text: `Plan: ${value.planId}\n${value.source} → ${value.destination}\n${value.count} files, ${value.bytes} bytes\n${value.files}` }] },
        execute: async (args, exec) => {
          const target = await current(exec, args.serverId)
          const root = agent.session.header.cwd
          if (!root) throw new Error('此会话没有本地工作区，无法部署目录。')
          const destination = remoteDeploymentDirectory(args.destination)
          const tree = await localDeploymentTree(root, args.source)
          const remote = await getServerBridge().manifest(target.serverId, destination, exec.signal, false, target.endpoint)
          const remoteFiles = new Map(remote.entries.filter(entry => entry.type === 'file').map(entry => [entry.path, entry.sha256]))
          const planned = tree.files.map(file => ({ source: file.source, relative: file.relative, sha256: file.sha256, mode: file.mode }))
          const desired = new Set([...tree.directories, ...planned.map(file => file.relative)])
          const removed = remote.entries.filter(entry => !desired.has(entry.path)).map(entry => entry.path)
          const changes = planned.map(file => `${file.relative} · ${remoteFiles.get(file.relative) === undefined ? '新增' : remoteFiles.get(file.relative) === file.sha256 ? '不变' : '更新'} · ${file.mode.toString(8)} · SHA-256 ${file.sha256}`)
          changes.push(...removed.map(path => `${path} · 删除`))
          const planId = randomUUID()
          this.directoryPlans.set(planId, { taskId, serverId: target.serverId, revision: target.revision, cwd: target.cwd, endpoint: target.endpoint, root, source: args.source,
            destination, directories: tree.directories, remoteSha256: remote.sha256, files: planned,
            expiresAt: Date.now() + 10 * 60_000 })
          return { planId, source: args.source, destination, count: tree.files.length,
            bytes: tree.files.reduce((sum, file) => sum + file.bytes, 0),
            files: changes.join('\n') || '空目录' }
        },
        presentCall: args => ({ card: 'generic', title: `目录部署预览 · ${args.source} → ${args.destination}`, kind: 'read' }),
      })))
      dispose.push(agent.ctx.tools.register(defineTool({
        name: 'server_deploy_directory_apply', description: 'Replace the entire previewed remote directory, including deletion of remote-only paths, according to session permissions. Stage and verify all files before switching the destination.',
        parameters: { serverId: { type: 'string', required: true, description: 'Exact ID of a server associated with this session.' },
          planId: { type: 'string', required: true }, source: { type: 'string', required: true },
          destination: { type: 'string', required: true },
        },
        output: { schema: { type: 'object', additionalProperties: false, properties: {
          destination: { type: 'string', required: true }, count: { type: 'integer', required: true },
          bytes: { type: 'integer', required: true },
        } }, render: (_args, value) => [{ type: 'text', text: `Deployed ${value.count} files (${value.bytes} bytes) to ${value.destination}` }] },
        execute: async (args, exec) => {
          const target = await current(exec, args.serverId)
          const plan = this.directoryPlans.get(args.planId)
          if (!plan || plan.taskId !== taskId || plan.serverId !== target.serverId || plan.revision !== target.revision || plan.cwd !== target.cwd || plan.endpoint !== target.endpoint || plan.source !== args.source
            || plan.destination !== args.destination || plan.expiresAt < Date.now()) throw new Error('目录部署预览已失效，请重新预览。')
          this.directoryPlans.delete(args.planId)
          return this.audit.perform(taskId, target.serverId, 'deploy-directory',
            `${plan.source}\0${plan.destination}\0${plan.files.map(file => `${file.relative}:${file.mode}:${file.sha256}`).join('\n')}`,
            () => deployDirectory({
              run: (id, cwd, command, callSignal) => getServerBridge().run(id, cwd, command, callSignal, undefined, undefined, undefined, target.endpoint),
              upload: (id, root, source, destination, sha256, remoteSha256, callSignal) => getServerBridge().upload(id, root, source, destination, sha256, remoteSha256, callSignal, target.endpoint),
              manifest: (id, directory, callSignal) => getServerBridge().manifest(id, directory, callSignal, false, target.endpoint),
            }, plan, exec.signal))
        },
        presentCall: args => ({ card: 'generic', title: `部署目录 · ${args.serverId} · ${args.source} → ${args.destination}`, kind: 'execute' }),
      })))
      dispose.push(agent.ctx.tools.register(defineTool({
        name: 'server_download_plan', description: 'Preview copying a remote file into this task’s local workspace. Checks the remote SHA-256 and existing local destination without writing.',
        parameters: { serverId: { type: 'string', required: true, description: 'Exact ID of a server associated with this session.' },
          source: { type: 'string', required: true, description: 'Absolute file path on the explicitly selected associated server.' },
          destination: { type: 'string', required: true, description: 'File path relative to the local workspace.' },
        },
        output: { schema: { type: 'object', additionalProperties: false, properties: {
          planId: { type: 'string', required: true }, source: { type: 'string', required: true },
          destination: { type: 'string', required: true }, sha256: { type: 'string', required: true },
          local: { type: 'string', required: true },
        } }, render: (_args, value) => [{ type: 'text', text: `Plan: ${value.planId}\nRemote: ${value.source} · SHA-256 ${value.sha256}\nLocal: ${value.destination} · ${value.local}` }] },
        execute: async (args, exec) => {
          const target = await current(exec, args.serverId)
          const root = agent.session.header.cwd
          if (!root) throw new Error('此会话没有本地工作区，无法取回文件。')
          const source = remoteDeploymentPath(args.source)
          const local = await localDownloadTarget(root, args.destination)
          const result = await getServerBridge().run(target.serverId, target.cwd, remoteFileHashCommand(source), exec.signal, undefined, undefined, undefined, target.endpoint)
          if (result.exitCode !== 0) throw new Error(result.stderr.trim() || '无法读取远端文件状态。')
          const sha256 = parseRemoteFileHash(result.stdout)
          if (!sha256) throw new Error('远端文件不存在。')
          const planId = randomUUID()
          this.downloadPlans.set(planId, { taskId, serverId: target.serverId, revision: target.revision, cwd: target.cwd, endpoint: target.endpoint, root, source, destination: args.destination,
            sha256, localSha256: local.sha256, expiresAt: Date.now() + 10 * 60_000 })
          return { planId, source, destination: args.destination, sha256,
            local: local.sha256 ? `原 SHA-256 ${local.sha256}` : '新文件' }
        },
        presentCall: args => ({ card: 'generic', title: `取回预览 · ${args.source} → ${args.destination}`, kind: 'read' }),
      })))
      dispose.push(agent.ctx.tools.register(defineTool({
        name: 'server_download_apply', description: 'Copy exactly one previewed remote file into the local workspace. Follows session permissions and fails if the remote file or local target changed.',
        parameters: { serverId: { type: 'string', required: true, description: 'Exact ID of a server associated with this session.' },
          planId: { type: 'string', required: true }, source: { type: 'string', required: true },
          destination: { type: 'string', required: true },
        },
        output: { schema: { type: 'object', additionalProperties: false, properties: {
          destination: { type: 'string', required: true }, bytes: { type: 'integer', required: true },
          sha256: { type: 'string', required: true },
        } }, render: (_args, value) => [{ type: 'text', text: `Downloaded ${value.bytes} bytes to ${value.destination}\nSHA-256 ${value.sha256}` }] },
        execute: async (args, exec) => {
          const target = await current(exec, args.serverId)
          const plan = this.downloadPlans.get(args.planId)
          if (!plan || plan.taskId !== taskId || plan.serverId !== target.serverId || plan.revision !== target.revision || plan.cwd !== target.cwd || plan.endpoint !== target.endpoint || plan.source !== args.source
            || plan.destination !== args.destination || plan.expiresAt < Date.now()) throw new Error('取回预览已失效，请重新预览。')
          this.downloadPlans.delete(args.planId)
          return this.audit.perform(taskId, target.serverId, 'download-file', `${plan.source}\0${plan.destination}\0${plan.sha256}`,
            () => getServerBridge().download(target.serverId, plan.root, plan.source, plan.destination,
              plan.sha256, plan.localSha256, exec.signal, target.endpoint))
        },
        presentCall: args => ({ card: 'generic', title: `取回文件 · ${args.serverId} · ${args.source} → ${args.destination}`, kind: 'execute' }),
      })))
    dispose.push(agent.ctx.tools.register(defineTool({
      name: 'remote_run',
      description: 'Run a command on the associated server identified by serverId, in its current remote directory. The current session permission mode applies; restricted sessions require approval for state changes. Include a plain-language description of the purpose and intended change. Only session-associated server IDs are accepted; credentials remain private to LING.',
      parameters: { serverId: { type: 'string', required: true, description: 'Exact ID of a server associated with this session.' }, command: { type: 'string', required: true, description: 'Shell command to run on the associated server identified by serverId.' }, description: { type: 'string', required: true, description: 'In the user’s language, briefly explain what this does and why. Describe any intended changes.' } },
      output: {
        schema: { type: 'object', additionalProperties: false, properties: {
          cwd: { type: 'string', required: true }, stdout: { type: 'string', required: true },
          stderr: { type: 'string', required: true }, exitCode: { type: 'integer', required: true },
        } },
        render: (_args, value) => [{ type: 'text', text: `Remote cwd: ${value.cwd}\nExit: ${value.exitCode}\n${value.stdout}${value.stderr ? `\n[stderr]\n${value.stderr}` : ''}` }],
      },
      execute: async (args, exec) => {
        const current = await this.executionTarget(taskId, args.serverId, exec)
        if (!args.command.trim() || args.command.length > 16384) throw new Error('远端命令无效。')
        const server = await this.server(current.serverId)
        const result = await this.executionRecorder.run(taskId, { callId: String(exec.callId), summary: args.description,
          server: server.name, cwd: current.cwd, command: args.command }, exec.signal,
          output => getServerBridge().run(current.serverId, current.cwd, args.command, exec.signal, undefined, output, this.executionPolicy(exec, current.cwd), current.endpoint))
        return { cwd: current.cwd, ...result }
      },
      presentCall: args => ({ card: 'generic', title: `远端执行 · ${args.description}`, kind: 'execute' }),
    })))
    dispose.push(agent.ctx.tools.register(defineTool({
      name: 'remote_list', description: 'List files and directories on the associated server identified by serverId, relative to the current remote working directory.',
      parameters: { serverId: { type: 'string', required: true, description: 'Exact ID of a server associated with this session.' }, path: { type: 'string', required: true, description: 'Remote directory path, or . for current directory.' } },
      output: { schema: { type: 'object', additionalProperties: false, properties: {
        path: { type: 'string', required: true }, entries: { type: 'string', required: true },
      } }, render: (_args, value) => [{ type: 'text', text: `${value.path}\n${value.entries}` }] },
      execute: async (args, exec) => {
        const target = await this.executionTarget(taskId, args.serverId, exec)
        const listing = await this.filesList(taskId, args.serverId, args.path, exec.signal, target)
        return { path: listing.path, entries: listing.entries.map(item => `${item.type === 'directory' ? 'dir ' : item.type === 'file' ? 'file' : 'link'} ${item.name}`).join('\n') }
      },
      presentCall: args => ({ card: 'generic', title: `远端文件 · ${args.path}`, kind: 'read' }),
    })))
    dispose.push(agent.ctx.tools.register(defineTool({
      name: 'remote_read', description: 'Read a text file on the associated server identified by serverId with a SHA-256 version for safe edits.',
      parameters: { serverId: { type: 'string', required: true, description: 'Exact ID of a server associated with this session.' }, path: { type: 'string', required: true } },
      output: { schema: { type: 'object', additionalProperties: false, properties: {
        path: { type: 'string', required: true }, text: { type: 'string', required: true },
        sha256: { type: 'string', required: true }, truncated: { type: 'boolean', required: true },
      } }, render: (_args, value) => [{ type: 'text', text: `${value.path} · SHA-256 ${value.sha256}${value.truncated ? ' · preview truncated' : ''}\n${value.text}` }] },
      execute: async (args, exec) => this.filesRead(taskId, args.serverId, args.path, exec.signal, await this.executionTarget(taskId, args.serverId, exec)),
      presentCall: args => ({ card: 'generic', title: `远端读取 · ${args.path}`, kind: 'read' }),
    })))
    dispose.push(agent.ctx.tools.register(defineTool({
      name: 'remote_write', description: 'Atomically create or replace one text file on the associated server identified by serverId. Pass null version only for a new file; otherwise pass the exact SHA-256 returned by remote_read. Follows session permissions.',
      parameters: { serverId: { type: 'string', required: true, description: 'Exact ID of a server associated with this session.' }, path: { type: 'string', required: true }, text: { type: 'string', required: true },
        expectedSha256: { required: true, oneOf: [{ type: 'string' }, { type: 'null' }] } },
      output: { schema: { type: 'object', additionalProperties: false, properties: {
        path: { type: 'string', required: true }, sha256: { type: 'string', required: true },
      } }, render: (_args, value) => [{ type: 'text', text: `Saved ${value.path} · SHA-256 ${value.sha256}` }] },
      execute: async (args, exec) => {
        const current = await this.executionTarget(taskId, args.serverId, exec)
        return this.filesSave(taskId, args.serverId, posix.resolve(current.cwd, args.path), args.text, args.expectedSha256, exec.signal, this.executionPolicy(exec, current.cwd), current)
      },
      presentCall: args => ({ card: 'generic', title: `远端写入 · ${args.path}`, kind: 'execute' }),
    })))
    dispose.push(agent.ctx.tools.register(defineTool({
      name: 'remote_cd', description: 'Change the current directory for this task on the associated server identified by serverId. The directory must exist.',
      parameters: { serverId: { type: 'string', required: true, description: 'Exact ID of a server associated with this session.' }, path: { type: 'string', required: true, description: 'Absolute or relative remote directory path.' } },
      output: { schema: { type: 'object', additionalProperties: false, properties: { cwd: { type: 'string', required: true } } },
        render: (_args, value) => [{ type: 'text', text: value.cwd }] },
      execute: async (args, exec) => {
        if (!args.path.trim() || args.path.length > 4096 || args.path.includes('\0')) throw new Error('远端目录无效。')
        const current = await this.executionTarget(taskId, args.serverId, exec)
        const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`
        const path = args.path.startsWith('-') ? `./${args.path}` : args.path
        const result = await getServerBridge().run(current.serverId, current.cwd, `cd ${quote(path)} && printf '__LING_CD__\\n' && pwd -P`, exec.signal, undefined, undefined, undefined, current.endpoint)
        if (result.exitCode !== 0) throw new Error('远端目录不存在或无法进入。')
        const marker = result.stdout.lastIndexOf('__LING_CD__\n')
        if (marker < 0) throw new Error('远端没有返回工作目录。')
        const cwd = result.stdout.slice(marker + '__LING_CD__\n'.length).trim()
        const next = await this.sessions.changeDirectory(taskId, args.serverId, cwd, current)
        this.rememberState(taskId, await this.sessions.get(taskId))
        return { cwd: next.cwd }
      },
      presentCall: args => ({ card: 'generic', title: `远端目录 · ${args.path}`, kind: 'read' }),
    })))
    this.installed.set(taskId, () => { for (const teardown of dispose.reverse()) teardown() })
    } catch (error) { for (const teardown of dispose.reverse()) teardown(); throw error }
  }

  private async server(id: string) {
    const server = (await this.list()).find(item => item.id === id)
    if (!server) throw new RemoteError('gateway/bad-request', '服务器已不存在。', {})
    return server
  }
}

const prototype = LingServersController.prototype
const receiver = Object.create(prototype) as LingServersController
const decorate = Remote as unknown as (implementation: (...args: never[]) => unknown, context: {
  name: string; private: boolean; static: boolean; addInitializer(initializer: (this: LingServersController) => void): void
}) => void
for (const name of ['executions', 'list', 'add', 'configure', 'forget', 'probe', 'directories', 'taskServers', 'setTaskServers', 'copyTaskServers',
  'takeTerminalUiRequest', 'terminalScope', 'terminalList', 'terminalOpen', 'terminalPoll', 'terminalWrite', 'terminalResize', 'terminalClose',
  'filesList', 'filesRead', 'filesSave', 'fileManager', 'gitRequest'] as const) {
  decorate(prototype[name] as (...args: never[]) => unknown, {
    name, private: false, static: false, addInitializer(initializer) { initializer.call(receiver) },
  })
}
