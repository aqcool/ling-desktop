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
import { ServerSessions, type ServerSessionBinding } from '../server-sessions.ts'
import { localDeploymentFile, localDeploymentTree, localDownloadTarget, parseRemoteFileHash,
  remoteDeploymentDirectory, remoteDeploymentPath, remoteFileHashCommand, shellQuote } from '../server-deployment.ts'
import { ServerAudit } from '../server-audit.ts'
import { listServerDirectories, probeServer } from '../server-ssh.ts'
import { encodeApprovalDetails } from '../approval-details.ts'
import { serverCommandImpact, serverToolDecision } from './server-command-policy.ts'
import { ServerExecutionRecorder } from './server-execution-recorder.ts'
import { getServerBridge } from './server-bridge.ts'
import { deployDirectory } from './server-directory-deploy.ts'
import { RemoteWorkspaceGit } from './server-git.ts'
import type { LingGitRequest } from 'ling-desktop/runtime'

declare module '@deepseek-ai/cordis' {
  interface Context { lingServers: LingServersController }
}

/** First-party Host plugin. The model has no tool entry for these operations. */
export class LingServersController extends TypertRemoteService {
  static inject = ['typert', 'agents', 'tools', 'systemPrompt', 'sandboxPolicy']
  private readonly store: ServerStore
  private readonly sessions: ServerSessions
  private readonly operations: ServerSessions
  private readonly audit: ServerAudit
  private readonly executionRecorder: ServerExecutionRecorder
  private readonly executionPolicies = new WeakMap<object, RemotePolicy>()
  private readonly installed = new Map<string, () => void>()
  private readonly installedOperations = new Map<string, () => void>()
  private readonly taskTerminals = new Map<string, Set<string>>()
  private readonly draftTerminalBindings = new Map<string, ServerSessionBinding>()
  private readonly draftTerminalScopes = new Map<string, Promise<{ ownerId: string }>>()
  private readonly terminalUiRequests = new Set<string>()
  private readonly gitQueues = new Map<string, Promise<unknown>>()
  private readonly deploymentPlans = new Map<string, { taskId: string; serverId: string; root: string; source: string;
    destination: string; sha256: string; remoteSha256: string | null; expiresAt: number }>()
  private readonly downloadPlans = new Map<string, { taskId: string; serverId: string; root: string; source: string;
    destination: string; sha256: string; localSha256: string | null; expiresAt: number }>()
  private readonly directoryPlans = new Map<string, { taskId: string; serverId: string; root: string; source: string;
    destination: string; directories: readonly string[]; remoteSha256: string;
    files: Array<{ source: string; relative: string; sha256: string; mode: number }>;
    expiresAt: number }>()

  constructor(ctx: Context) {
    super(ctx, 'lingServers')
    const home = process.env.DSH_HOME
    if (!home) throw new Error('LING server plugin requires DSH_HOME')
    this.store = new ServerStore(join(home, 'ling-servers.json'))
    this.sessions = new ServerSessions(join(home, 'ling-server-sessions.json'))
    this.operations = new ServerSessions(join(home, 'ling-operation-sessions.json'))
    this.audit = new ServerAudit(home)
    this.executionRecorder = new ServerExecutionRecorder(join(home, 'ling-server-executions'))
    ctx.effect(() => ctx.typert.register(LING_SERVERS_HOST), 'LING servers Remote contract')
    ctx.on('agent/created', async ({ agent }) => { await this.install(agent); await this.installOperations(agent) })
    ctx.on('agent/disposed', ({ agent }) => {
      this.installed.get(String(agent.id))?.()
      this.installed.delete(String(agent.id))
      this.installedOperations.get(String(agent.id))?.()
      this.installedOperations.delete(String(agent.id))
      this.terminalUiRequests.delete(String(agent.id))
      for (const [id, plan] of this.deploymentPlans) if (plan.taskId === String(agent.id)) this.deploymentPlans.delete(id)
      for (const [id, plan] of this.downloadPlans) if (plan.taskId === String(agent.id)) this.downloadPlans.delete(id)
      for (const [id, plan] of this.directoryPlans) if (plan.taskId === String(agent.id)) this.directoryPlans.delete(id)
    })
    ctx.on('tools/pre-execute', async (exec, next) => {
      const previous = await next()
      if (!exec.agent) return previous
      const taskId = String(exec.agent.id)
      const remote = this.installed.has(taskId)
      const operations = this.installedOperations.has(taskId)
      const binding = remote || operations ? await (remote ? this.sessions : this.operations).get(taskId) : undefined
      const mode = this.ctx.get('sandboxPolicy')?.resolve({ session: exec.agent.session }).mode ?? 'workspace-write'
      const decision = serverToolDecision(exec.name, exec.arguments, { remote, operations, mode, cwd: binding?.cwd }, previous)
      if (binding) this.executionPolicies.set(exec, { workspaceRoot: binding.cwd,
        mode: decision.kind === 'ask' && mode !== 'read-only' ? 'danger-full-access' : mode })
      if (decision.kind !== 'ask' || !['server_exec', 'remote_run', 'remote_write', 'server_deploy_apply', 'server_deploy_directory_apply', 'server_download_apply'].includes(exec.name)) return decision
      if (!binding) return decision
      const server = await this.server(binding.serverId)
      const args = exec.arguments && typeof exec.arguments === 'object' ? exec.arguments as Record<string, unknown> : {}
      const command = typeof args.command === 'string' ? args.command : undefined
      const titles: Record<string, string> = { remote_write: '写入远端文件', server_deploy_apply: '部署文件到服务器',
        server_deploy_directory_apply: '部署目录到服务器', server_download_apply: '取回服务器文件' }
      const impacts: Record<string, string> = { remote_write: '会创建文件，或覆盖目标文件的现有内容。',
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
      for (const dispose of this.installedOperations.values()) dispose()
      this.installedOperations.clear()
      this.deploymentPlans.clear()
      this.downloadPlans.clear()
      this.directoryPlans.clear()
    }, 'LING remote session tools')
  }

  list() { return this.store.list() }
  executions(taskId: string, callIds: readonly string[]) { return this.executionRecorder.list(taskId, callIds) }
  add(input: LingServerInput) { return this.store.add(input) }
  configure(id: string, input: LingServerInput) { return this.store.configure(id, input) }
  async forget(id: string) { await this.store.remove(id); return { ok: true as const } }

  async probe(id: string, signal: AbortSignal) {
    const server = await this.server(id)
    return await probeServer(server, signal)
  }

  async directories(id: string, path: string, signal: AbortSignal) {
    const server = await this.server(id)
    return await listServerDirectories(server, path, signal)
  }

  async bindTask(taskId: string, serverId: string, home: string): Promise<ServerSessionBinding> {
    await this.server(serverId)
    const agent = this.ctx.agents.get(SessionId(taskId))
    if (!agent) throw new RemoteError('gateway/bad-request', '任务不存在或尚未就绪。', {})
    if (await this.sessions.get(taskId)) throw new RemoteError('gateway/bad-request', '此任务已经绑定服务器。', {})
    await this.install(agent, { serverId, cwd: home })
    try { return await this.sessions.bind(taskId, serverId, home) }
    catch (error) { this.installed.get(taskId)?.(); this.installed.delete(taskId); throw error }
  }

  async taskBinding(taskId: string): Promise<ServerSessionBinding | null> {
    return await this.sessions.get(taskId) ?? null
  }

  async attachOperations(taskId: string, serverId: string, home: string): Promise<ServerSessionBinding> {
    await this.server(serverId)
    const agent = this.ctx.agents.get(SessionId(taskId))
    if (!agent) throw new RemoteError('gateway/bad-request', '任务不存在或尚未就绪。', {})
    if (await this.sessions.get(taskId)) throw new RemoteError('gateway/bad-request', '远端开发任务不能再关联运维目标。', {})
    if (await this.operations.get(taskId)) throw new RemoteError('gateway/bad-request', '此任务已经关联服务器。', {})
    await this.installOperations(agent, { serverId, cwd: home })
    try { return await this.operations.bind(taskId, serverId, home) }
    catch (error) { this.installedOperations.get(taskId)?.(); this.installedOperations.delete(taskId); throw error }
  }

  async operationsBinding(taskId: string): Promise<ServerSessionBinding | null> {
    return await this.operations.get(taskId) ?? null
  }

  async terminalScope(serverId: string, placement: 'side' | 'bottom', signal: AbortSignal): Promise<{ ownerId: string }> {
    await this.server(serverId)
    const key = JSON.stringify([serverId, placement])
    const existing = this.draftTerminalScopes.get(key)
    if (existing) return existing
    const pending = (async () => {
      const server = await this.server(serverId)
      const { home } = await probeServer(server, signal)
      signal.throwIfAborted()
      const ownerId = `ling-draft-terminal:${randomUUID()}`
      this.draftTerminalBindings.set(ownerId, { serverId, cwd: home })
      return { ownerId }
    })().catch(error => { this.draftTerminalScopes.delete(key); throw error })
    this.draftTerminalScopes.set(key, pending)
    return pending
  }

  private async terminalOwner(taskId: string, terminalId?: string): Promise<ServerSessionBinding> {
    const draft = taskId.startsWith('ling-draft-terminal:') ? this.draftTerminalBindings.get(taskId) : undefined
    const binding = draft ?? await this.sessions.get(taskId) ?? await this.operations.get(taskId)
    if (!binding) throw new RemoteError('gateway/bad-request', '此任务未绑定远端服务器。', {})
    if (terminalId && !this.taskTerminals.get(taskId)?.has(terminalId))
      throw new RemoteError('gateway/bad-request', '此终端不属于当前任务。', {})
    return binding
  }

  async takeTerminalUiRequest(taskId: string): Promise<{ open: boolean }> {
    await this.terminalOwner(taskId)
    const open = this.terminalUiRequests.delete(taskId)
    return { open }
  }

  async terminalList(taskId: string): Promise<readonly string[]> {
    await this.terminalOwner(taskId)
    return [...this.taskTerminals.get(taskId) ?? []]
  }

  async terminalOpen(taskId: string, cols: number, rows: number, signal: AbortSignal): Promise<{ terminalId: string }> {
    const binding = await this.terminalOwner(taskId)
    const value = await getServerBridge().terminalOpen(binding.serverId, binding.cwd, cols, rows, signal)
    const terminals = this.taskTerminals.get(taskId) ?? new Set<string>()
    terminals.add(value.terminalId)
    this.taskTerminals.set(taskId, terminals)
    return value
  }

  async terminalPoll(taskId: string, terminalId: string, offset: number, signal: AbortSignal) {
    await this.terminalOwner(taskId, terminalId)
    return getServerBridge().terminalPoll(terminalId, offset, signal)
  }

  async terminalWrite(taskId: string, terminalId: string, data: string, signal: AbortSignal) {
    await this.terminalOwner(taskId, terminalId)
    return getServerBridge().terminalWrite(terminalId, data, signal)
  }

  async terminalResize(taskId: string, terminalId: string, cols: number, rows: number, signal: AbortSignal) {
    await this.terminalOwner(taskId, terminalId)
    return getServerBridge().terminalResize(terminalId, cols, rows, signal)
  }

  async terminalClose(taskId: string, terminalId: string, signal: AbortSignal) {
    await this.terminalOwner(taskId, terminalId)
    const result = await getServerBridge().terminalClose(terminalId, signal)
    this.taskTerminals.get(taskId)?.delete(terminalId)
    return result
  }

  private async remoteFilePath(taskId: string, path: string) {
    const binding = await this.terminalOwner(taskId)
    if (!path || path.length > 4096 || path.includes('\0')) throw new Error('远端文件路径无效。')
    const resolved = posix.resolve(binding.cwd, path)
    return { binding, resolved }
  }

  async filesList(taskId: string, path: string, signal: AbortSignal) {
    const { binding, resolved } = await this.remoteFilePath(taskId, path || '.')
    const result = await getServerBridge().file({ action: 'list', serverId: binding.serverId, path: resolved }, signal)
    if (!('entries' in result)) throw new Error('远端目录返回无效结果。')
    const entries = [...result.entries].sort((a, b) => a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'directory' ? -1 : 1)
    return { path: path === '.' ? '' : path, entries }
  }
  async filesRead(taskId: string, path: string, signal: AbortSignal) {
    const { binding, resolved } = await this.remoteFilePath(taskId, path)
    const result = await getServerBridge().file({ action: 'read', serverId: binding.serverId, path: resolved }, signal)
    if (!('text' in result)) throw new Error('远端文件返回无效结果。')
    return { ...result, path }
  }
  async filesSave(taskId: string, path: string, text: string, expectedSha256: string | null, signal: AbortSignal, policy?: RemotePolicy) {
    const { binding, resolved } = await this.remoteFilePath(taskId, path)
    // Renderer saves are explicit human operations; agent writes always pass session policy.
    const result = await this.audit.perform(taskId, binding.serverId, 'deploy-file', path,
      () => getServerBridge().file({ action: 'write', serverId: binding.serverId, path: resolved, text, expected: expectedSha256,
        policy: policy ?? { mode: 'danger-full-access', workspaceRoot: binding.cwd } }, signal))
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
      parameters: {}, output: { schema: { type: 'object', additionalProperties: false, properties: { opened: { type: 'boolean', required: true } } },
        render: () => [{ type: 'text', text: '已请求在右侧打开服务器终端。' }] },
      execute: async () => { await this.terminalOwner(taskId); this.terminalUiRequests.add(taskId); return { opened: true } },
      presentCall: () => ({ card: 'generic', title: '打开服务器终端', kind: 'read' }),
    })))
  }

  async gitRequest(taskId: string, request: LingGitRequest, signal: AbortSignal) {
    const binding = await this.terminalOwner(taskId)
    const run = async () => {
      const git = new RemoteWorkspaceGit(getServerBridge())
      return git.handle(binding, request, signal, async path => {
        const checked = await getServerBridge().run(binding.serverId, '/',
          `set -eu; cd ${shellQuote(path)}; pwd -P`, signal)
        if (checked.exitCode !== 0) throw new Error('远端 Worktree 目录无法访问。')
        await this.sessions.changeDirectory(taskId, checked.stdout.trim())
      })
    }
    if (request.type === 'inspect' || request.type === 'diff') return run()
    const previous = this.gitQueues.get(binding.serverId) ?? Promise.resolve()
    const next = previous.catch(() => undefined).then(() => this.audit.perform(taskId, binding.serverId,
      'git', JSON.stringify(request), run))
    this.gitQueues.set(binding.serverId, next)
    try { return await next } finally { if (this.gitQueues.get(binding.serverId) === next) this.gitQueues.delete(binding.serverId) }
  }

  private async installOperations(agent: Agent, given?: ServerSessionBinding): Promise<void> {
    const taskId = String(agent.id)
    if (this.installedOperations.has(taskId)) return
    const binding = given ?? await this.operations.get(taskId)
    if (!binding) return
    if (await this.sessions.get(taskId)) throw new Error('远端开发任务不能关联运维目标。')
    const server = await this.server(binding.serverId)
    const dispose: Array<() => void> = []
    const resultSchema = { type: 'object', additionalProperties: false, properties: {
      stdout: { type: 'string', required: true }, stderr: { type: 'string', required: true },
      exitCode: { type: 'integer', required: true },
    } } as const
    const output = { schema: resultSchema, render: (_args: unknown, value: { stdout: string; stderr: string; exitCode: number }) =>
      [{ type: 'text' as const, text: `Exit: ${value.exitCode}\n${value.stdout}${value.stderr ? `\n[stderr]\n${value.stderr}` : ''}` }] }
    const current = async () => {
      const value = await this.operations.get(taskId)
      if (!value || value.serverId !== binding.serverId) throw new Error('运维服务器绑定已变化。')
      return value
    }
    try {
      dispose.push(agent.ctx.systemPrompt.section({ name: 'ling:operations-server', order: agent.ctx.systemPrompt.getSectionOrder('PLAN_POLICY'),
        text: 'This is a local-workspace task with a separate operations target. Local file, Git, build and shell tools remain local. Use server_exec for ordinary remote operations on the attached server; its output enters the agent context and the session permission mode applies: read-only forbids mutations, workspace-write requests approval for server changes, full access permits them without extra SSH prompts. Always supply a concise description in the user’s language explaining the purpose and intended change, not just the shell syntax. For credential viewing, entry, reset, or other sensitive interactive work, call server_show_terminal and let the user work in the terminal pane. Its input and output do not enter the agent context. Never run credential-revealing commands with server_exec or ask the user to paste credentials into chat. For local file or directory deployment, call the corresponding server_deploy_plan or server_deploy_directory_plan and then its apply tool with the exact returned plan ID, source and destination. For a remote file, call server_download_plan and then server_download_apply. Directory deployment previews and replaces the complete destination tree, including removal of remote-only paths; use approved server_exec for release switching and health checks. Do not use local shell tools to reach that server.',
      }))
      this.installTerminalTool(agent, taskId, dispose)
      dispose.push(agent.ctx.tools.register(defineTool({
        name: 'server_exec', description: 'Run an ordinary shell command on the server attached to this local task. Its output enters the agent context; for credentials or other secret-bearing output, open the private server terminal instead. Use for deployment, service management, logs, containers, processes and diagnostics. The current session permission mode applies; restricted sessions require approval for state changes. Include a plain-language description of the purpose and intended change. The server and credentials cannot be changed by this tool.',
        parameters: { command: { type: 'string', required: true, description: 'Remote shell command to run on the attached server.' }, description: { type: 'string', required: true, description: 'In the user’s language, briefly explain what this does and why. Describe any intended changes.' } }, output,
        execute: async (args, exec) => {
          if (!args.command.trim() || args.command.length > 16384 || args.command.includes('\0')) throw new Error('远端命令无效。')
          const target = await current()
          return this.audit.perform(taskId, target.serverId, 'exec', args.command,
            () => this.executionRecorder.run(taskId, { callId: String(exec.callId), summary: args.description,
              server: server.name, cwd: target.cwd, command: args.command }, exec.signal,
              output => getServerBridge().run(target.serverId, target.cwd, args.command, exec.signal, undefined, output, this.executionPolicy(exec, target.cwd))))
        },
        presentCall: args => ({ card: 'generic', title: `远端执行 · ${server.name} · ${args.description}`, kind: 'execute' }),
      })))
      dispose.push(agent.ctx.tools.register(defineTool({
        name: 'server_deploy_plan', description: 'Preview deploying one file from this task’s local workspace to an absolute path on the attached server. Returns a short-lived plan with local and existing remote SHA-256 hashes. This does not write remote files.',
        parameters: {
          source: { type: 'string', required: true, description: 'File path relative to the local workspace.' },
          destination: { type: 'string', required: true, description: 'Absolute destination file path on the attached server.' },
        },
        output: { schema: { type: 'object', additionalProperties: false, properties: {
          planId: { type: 'string', required: true }, source: { type: 'string', required: true },
          destination: { type: 'string', required: true }, bytes: { type: 'integer', required: true },
          sha256: { type: 'string', required: true }, remote: { type: 'string', required: true },
        } }, render: (_args, value) => [{ type: 'text', text: `Plan: ${value.planId}\nLocal: ${value.source} (${value.bytes} bytes, SHA-256 ${value.sha256})\nRemote: ${value.destination} (${value.remote})` }] },
        execute: async (args, exec) => {
          const target = await current()
          const root = agent.session.header.cwd
          if (!root) throw new Error('此会话没有本地工作区，无法部署本地文件。')
          const file = await localDeploymentFile(root, args.source)
          const destination = remoteDeploymentPath(args.destination)
          const remote = await getServerBridge().run(target.serverId, target.cwd, remoteFileHashCommand(destination), exec.signal)
          if (remote.exitCode !== 0) throw new Error(remote.stderr || '无法读取远端目标状态。')
          const remoteSha256 = parseRemoteFileHash(remote.stdout)
          const planId = randomUUID()
          this.deploymentPlans.set(planId, { taskId, serverId: target.serverId, root, source: args.source, destination,
            sha256: file.sha256, remoteSha256, expiresAt: Date.now() + 10 * 60_000 })
          return { planId, source: args.source, destination, bytes: file.bytes, sha256: file.sha256,
            remote: remoteSha256 ? `SHA-256 ${remoteSha256}` : '新文件' }
        },
        presentCall: args => ({ card: 'generic', title: `部署预览 · ${args.source} → ${args.destination}`, kind: 'read' }),
      })))
      dispose.push(agent.ctx.tools.register(defineTool({
        name: 'server_deploy_apply', description: 'Deploy exactly one previously previewed local workspace file to the attached server. Follows session permissions and fails if either file changed after preview.',
        parameters: {
          planId: { type: 'string', required: true, description: 'Plan ID returned by server_deploy_plan.' },
          source: { type: 'string', required: true, description: 'Exact source path from the preview.' },
          destination: { type: 'string', required: true, description: 'Exact destination path from the preview.' },
        },
        output: { schema: { type: 'object', additionalProperties: false, properties: {
          destination: { type: 'string', required: true }, bytes: { type: 'integer', required: true }, sha256: { type: 'string', required: true },
        } }, render: (_args, value) => [{ type: 'text', text: `Deployed ${value.bytes} bytes to ${value.destination}\nSHA-256 ${value.sha256}` }] },
        execute: async (args, exec) => {
          const target = await current()
          const plan = this.deploymentPlans.get(args.planId)
          if (!plan || plan.taskId !== taskId || plan.serverId !== target.serverId || plan.source !== args.source
            || plan.destination !== args.destination || plan.expiresAt < Date.now()) throw new Error('部署预览已失效，请重新预览。')
          this.deploymentPlans.delete(args.planId)
          return this.audit.perform(taskId, target.serverId, 'deploy-file', `${plan.source}\0${plan.destination}\0${plan.sha256}`,
            () => getServerBridge().upload(target.serverId, plan.root, plan.source, plan.destination,
              plan.sha256, plan.remoteSha256, exec.signal))
        },
        presentCall: args => ({ card: 'generic', title: `部署文件 · ${server.name} · ${args.source} → ${args.destination}`, kind: 'execute' }),
      })))
      dispose.push(agent.ctx.tools.register(defineTool({
        name: 'server_deploy_directory_plan', description: 'Preview a complete replacement of the remote destination directory from a local workspace directory, including remote-only paths that will be removed. Does not write remotely.',
        parameters: {
          source: { type: 'string', required: true, description: 'Directory relative to the local workspace.' },
          destination: { type: 'string', required: true, description: 'Absolute destination directory on the attached server.' },
        },
        output: { schema: { type: 'object', additionalProperties: false, properties: {
          planId: { type: 'string', required: true }, source: { type: 'string', required: true },
          destination: { type: 'string', required: true }, bytes: { type: 'integer', required: true },
          count: { type: 'integer', required: true }, files: { type: 'string', required: true },
        } }, render: (_args, value) => [{ type: 'text', text: `Plan: ${value.planId}\n${value.source} → ${value.destination}\n${value.count} files, ${value.bytes} bytes\n${value.files}` }] },
        execute: async (args, exec) => {
          const target = await current()
          const root = agent.session.header.cwd
          if (!root) throw new Error('此会话没有本地工作区，无法部署目录。')
          const destination = remoteDeploymentDirectory(args.destination)
          const tree = await localDeploymentTree(root, args.source)
          const remote = await getServerBridge().manifest(target.serverId, destination, exec.signal)
          const remoteFiles = new Map(remote.entries.filter(entry => entry.type === 'file').map(entry => [entry.path, entry.sha256]))
          const planned = tree.files.map(file => ({ source: file.source, relative: file.relative, sha256: file.sha256, mode: file.mode }))
          const desired = new Set([...tree.directories, ...planned.map(file => file.relative)])
          const removed = remote.entries.filter(entry => !desired.has(entry.path)).map(entry => entry.path)
          const changes = planned.map(file => `${file.relative} · ${remoteFiles.get(file.relative) === undefined ? '新增' : remoteFiles.get(file.relative) === file.sha256 ? '不变' : '更新'} · ${file.mode.toString(8)} · SHA-256 ${file.sha256}`)
          changes.push(...removed.map(path => `${path} · 删除`))
          const planId = randomUUID()
          this.directoryPlans.set(planId, { taskId, serverId: target.serverId, root, source: args.source,
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
        parameters: {
          planId: { type: 'string', required: true }, source: { type: 'string', required: true },
          destination: { type: 'string', required: true },
        },
        output: { schema: { type: 'object', additionalProperties: false, properties: {
          destination: { type: 'string', required: true }, count: { type: 'integer', required: true },
          bytes: { type: 'integer', required: true },
        } }, render: (_args, value) => [{ type: 'text', text: `Deployed ${value.count} files (${value.bytes} bytes) to ${value.destination}` }] },
        execute: async (args, exec) => {
          const target = await current()
          const plan = this.directoryPlans.get(args.planId)
          if (!plan || plan.taskId !== taskId || plan.serverId !== target.serverId || plan.source !== args.source
            || plan.destination !== args.destination || plan.expiresAt < Date.now()) throw new Error('目录部署预览已失效，请重新预览。')
          this.directoryPlans.delete(args.planId)
          return this.audit.perform(taskId, target.serverId, 'deploy-directory',
            `${plan.source}\0${plan.destination}\0${plan.files.map(file => `${file.relative}:${file.mode}:${file.sha256}`).join('\n')}`,
            () => deployDirectory(getServerBridge(), plan, exec.signal))
        },
        presentCall: args => ({ card: 'generic', title: `部署目录 · ${server.name} · ${args.source} → ${args.destination}`, kind: 'execute' }),
      })))
      dispose.push(agent.ctx.tools.register(defineTool({
        name: 'server_download_plan', description: 'Preview copying a remote file into this task’s local workspace. Checks the remote SHA-256 and existing local destination without writing.',
        parameters: {
          source: { type: 'string', required: true, description: 'Absolute file path on the attached server.' },
          destination: { type: 'string', required: true, description: 'File path relative to the local workspace.' },
        },
        output: { schema: { type: 'object', additionalProperties: false, properties: {
          planId: { type: 'string', required: true }, source: { type: 'string', required: true },
          destination: { type: 'string', required: true }, sha256: { type: 'string', required: true },
          local: { type: 'string', required: true },
        } }, render: (_args, value) => [{ type: 'text', text: `Plan: ${value.planId}\nRemote: ${value.source} · SHA-256 ${value.sha256}\nLocal: ${value.destination} · ${value.local}` }] },
        execute: async (args, exec) => {
          const target = await current()
          const root = agent.session.header.cwd
          if (!root) throw new Error('此会话没有本地工作区，无法取回文件。')
          const source = remoteDeploymentPath(args.source)
          const local = await localDownloadTarget(root, args.destination)
          const result = await getServerBridge().run(target.serverId, target.cwd, remoteFileHashCommand(source), exec.signal)
          if (result.exitCode !== 0) throw new Error(result.stderr.trim() || '无法读取远端文件状态。')
          const sha256 = parseRemoteFileHash(result.stdout)
          if (!sha256) throw new Error('远端文件不存在。')
          const planId = randomUUID()
          this.downloadPlans.set(planId, { taskId, serverId: target.serverId, root, source, destination: args.destination,
            sha256, localSha256: local.sha256, expiresAt: Date.now() + 10 * 60_000 })
          return { planId, source, destination: args.destination, sha256,
            local: local.sha256 ? `原 SHA-256 ${local.sha256}` : '新文件' }
        },
        presentCall: args => ({ card: 'generic', title: `取回预览 · ${args.source} → ${args.destination}`, kind: 'read' }),
      })))
      dispose.push(agent.ctx.tools.register(defineTool({
        name: 'server_download_apply', description: 'Copy exactly one previewed remote file into the local workspace. Follows session permissions and fails if the remote file or local target changed.',
        parameters: {
          planId: { type: 'string', required: true }, source: { type: 'string', required: true },
          destination: { type: 'string', required: true },
        },
        output: { schema: { type: 'object', additionalProperties: false, properties: {
          destination: { type: 'string', required: true }, bytes: { type: 'integer', required: true },
          sha256: { type: 'string', required: true },
        } }, render: (_args, value) => [{ type: 'text', text: `Downloaded ${value.bytes} bytes to ${value.destination}\nSHA-256 ${value.sha256}` }] },
        execute: async (args, exec) => {
          const target = await current()
          const plan = this.downloadPlans.get(args.planId)
          if (!plan || plan.taskId !== taskId || plan.serverId !== target.serverId || plan.source !== args.source
            || plan.destination !== args.destination || plan.expiresAt < Date.now()) throw new Error('取回预览已失效，请重新预览。')
          this.downloadPlans.delete(args.planId)
          return this.audit.perform(taskId, target.serverId, 'download-file', `${plan.source}\0${plan.destination}\0${plan.sha256}`,
            () => getServerBridge().download(target.serverId, plan.root, plan.source, plan.destination,
              plan.sha256, plan.localSha256, exec.signal))
        },
        presentCall: args => ({ card: 'generic', title: `取回文件 · ${server.name} · ${args.source} → ${args.destination}`, kind: 'execute' }),
      })))
      this.installedOperations.set(taskId, () => { for (const teardown of dispose.reverse()) teardown() })
    } catch (error) { for (const teardown of dispose.reverse()) teardown(); throw error }
  }

  private async install(agent: Agent, given?: ServerSessionBinding): Promise<void> {
    const taskId = String(agent.id)
    if (this.installed.has(taskId)) return
    const binding = given ?? await this.sessions.get(taskId)
    if (!binding) return
    const localOnlyTools = new Set(['bash', 'pwsh', 'read', 'write', 'edit', 'read_image', 'glob', 'grep',
      'terminal_open', 'terminal_send', 'terminal_read', 'terminal_signal', 'terminal_close', 'terminal_list',
      'job_output', 'job_list', 'job_kill'])
    const dispose: Array<() => void> = []
    try {
    this.installTerminalTool(agent, taskId, dispose)
    dispose.push(agent.ctx.tools.guard(exec => localOnlyTools.has(exec.name) ? '此任务使用远端服务器，请使用远端工具。' : undefined))
    const globalLocalTools = [...localOnlyTools].filter(name => this.ctx.tools.get(name) !== undefined)
    if (globalLocalTools.length) dispose.push(agent.ctx.tools.restrict({ deny: globalLocalTools }))
    dispose.push(agent.ctx.systemPrompt.section({ name: 'ling:remote-server', order: agent.ctx.systemPrompt.getSectionOrder('PLAN_POLICY'),
      text: 'This task is bound to a remote server. Use remote_list, remote_read and remote_write for project files, and remote_run for Git, builds, tests and shell commands. remote_cd changes the shared remote working directory used by these tools and new terminals. Follow the session permission mode: read-only forbids mutations, workspace-write confines operations to the remote workspace and approves wider effects, full access permits operations without additional SSH prompts. For private input/output call server_show_terminal; never put secrets in ordinary tool results. Supply a concise purpose and intended change in the user’s language with each command. Local filesystem and shell tools do not target the selected server. Credentials are held by LING and must never be requested or printed.',
    }))
    dispose.push(agent.ctx.tools.register(defineTool({
      name: 'remote_run',
      description: 'Run a command on the server selected for this task, in its current remote directory. The current session permission mode applies; restricted sessions require approval for state changes. Include a plain-language description of the purpose and intended change. The server and credentials cannot be changed by this tool.',
      parameters: { command: { type: 'string', required: true, description: 'Shell command to run on the selected server.' }, description: { type: 'string', required: true, description: 'In the user’s language, briefly explain what this does and why. Describe any intended changes.' } },
      output: {
        schema: { type: 'object', additionalProperties: false, properties: {
          cwd: { type: 'string', required: true }, stdout: { type: 'string', required: true },
          stderr: { type: 'string', required: true }, exitCode: { type: 'integer', required: true },
        } },
        render: (_args, value) => [{ type: 'text', text: `Remote cwd: ${value.cwd}\nExit: ${value.exitCode}\n${value.stdout}${value.stderr ? `\n[stderr]\n${value.stderr}` : ''}` }],
      },
      execute: async (args, exec) => {
        const current = await this.sessions.get(taskId)
        if (!current || current.serverId !== binding.serverId) throw new Error('服务器任务绑定已变化。')
        if (!args.command.trim() || args.command.length > 16384) throw new Error('远端命令无效。')
        const server = await this.server(current.serverId)
        const result = await this.executionRecorder.run(taskId, { callId: String(exec.callId), summary: args.description,
          server: server.name, cwd: current.cwd, command: args.command }, exec.signal,
          output => getServerBridge().run(current.serverId, current.cwd, args.command, exec.signal, undefined, output, this.executionPolicy(exec, current.cwd)))
        return { cwd: current.cwd, ...result }
      },
      presentCall: args => ({ card: 'generic', title: `远端执行 · ${args.description}`, kind: 'execute' }),
    })))
    dispose.push(agent.ctx.tools.register(defineTool({
      name: 'remote_list', description: 'List files and directories on the selected server, relative to the current remote working directory.',
      parameters: { path: { type: 'string', required: true, description: 'Remote directory path, or . for current directory.' } },
      output: { schema: { type: 'object', additionalProperties: false, properties: {
        path: { type: 'string', required: true }, entries: { type: 'string', required: true },
      } }, render: (_args, value) => [{ type: 'text', text: `${value.path}\n${value.entries}` }] },
      execute: async (args, exec) => {
        const listing = await this.filesList(taskId, args.path, exec.signal)
        return { path: listing.path, entries: listing.entries.map(item => `${item.type === 'directory' ? 'dir ' : item.type === 'file' ? 'file' : 'link'} ${item.name}`).join('\n') }
      },
      presentCall: args => ({ card: 'generic', title: `远端文件 · ${args.path}`, kind: 'read' }),
    })))
    dispose.push(agent.ctx.tools.register(defineTool({
      name: 'remote_read', description: 'Read a text file on the selected server with a SHA-256 version for safe edits.',
      parameters: { path: { type: 'string', required: true } },
      output: { schema: { type: 'object', additionalProperties: false, properties: {
        path: { type: 'string', required: true }, text: { type: 'string', required: true },
        sha256: { type: 'string', required: true }, truncated: { type: 'boolean', required: true },
      } }, render: (_args, value) => [{ type: 'text', text: `${value.path} · SHA-256 ${value.sha256}${value.truncated ? ' · preview truncated' : ''}\n${value.text}` }] },
      execute: async (args, exec) => this.filesRead(taskId, args.path, exec.signal),
      presentCall: args => ({ card: 'generic', title: `远端读取 · ${args.path}`, kind: 'read' }),
    })))
    dispose.push(agent.ctx.tools.register(defineTool({
      name: 'remote_write', description: 'Atomically create or replace one text file on the selected server. Pass null version only for a new file; otherwise pass the exact SHA-256 returned by remote_read. Follows session permissions.',
      parameters: { path: { type: 'string', required: true }, text: { type: 'string', required: true },
        expectedSha256: { required: true, oneOf: [{ type: 'string' }, { type: 'null' }] } },
      output: { schema: { type: 'object', additionalProperties: false, properties: {
        path: { type: 'string', required: true }, sha256: { type: 'string', required: true },
      } }, render: (_args, value) => [{ type: 'text', text: `Saved ${value.path} · SHA-256 ${value.sha256}` }] },
      execute: async (args, exec) => {
        const current = await this.sessions.get(taskId)
        if (!current || current.serverId !== binding.serverId) throw new Error('远端服务器绑定已变化。')
        return this.filesSave(taskId, posix.resolve(current.cwd, args.path), args.text, args.expectedSha256, exec.signal, this.executionPolicy(exec, current.cwd))
      },
      presentCall: args => ({ card: 'generic', title: `远端写入 · ${args.path}`, kind: 'execute' }),
    })))
    dispose.push(agent.ctx.tools.register(defineTool({
      name: 'remote_cd', description: 'Change the current directory for this task on the selected server. The directory must exist.',
      parameters: { path: { type: 'string', required: true, description: 'Absolute or relative remote directory path.' } },
      output: { schema: { type: 'object', additionalProperties: false, properties: { cwd: { type: 'string', required: true } } },
        render: (_args, value) => [{ type: 'text', text: value.cwd }] },
      execute: async (args, exec) => {
        if (!args.path.trim() || args.path.length > 4096 || args.path.includes('\0')) throw new Error('远端目录无效。')
        const current = await this.sessions.get(taskId)
        if (!current || current.serverId !== binding.serverId) throw new Error('服务器任务绑定已变化。')
        const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`
        const path = args.path.startsWith('-') ? `./${args.path}` : args.path
        const result = await getServerBridge().run(current.serverId, current.cwd, `cd ${quote(path)} && printf '__LING_CD__\\n' && pwd -P`, exec.signal)
        if (result.exitCode !== 0) throw new Error('远端目录不存在或无法进入。')
        const marker = result.stdout.lastIndexOf('__LING_CD__\n')
        if (marker < 0) throw new Error('远端没有返回工作目录。')
        const cwd = result.stdout.slice(marker + '__LING_CD__\n'.length).trim()
        const next = await this.sessions.changeDirectory(taskId, cwd)
        return { cwd: next.cwd }
      },
      presentCall: args => ({ card: 'generic', title: `远端目录 · ${args.path}`, kind: 'read' }),
    })))
    this.installed.set(taskId, () => { for (const teardown of dispose.reverse()) teardown() })
    } catch (error) { for (const teardown of dispose.reverse()) teardown(); throw error }
  }

  private async server(id: string) {
    const server = (await this.store.list()).find(item => item.id === id)
    if (!server) throw new RemoteError('gateway/bad-request', '服务器已不存在。', {})
    return server
  }
}

const prototype = LingServersController.prototype
const receiver = Object.create(prototype) as LingServersController
const decorate = Remote as unknown as (implementation: (...args: never[]) => unknown, context: {
  name: string; private: boolean; static: boolean; addInitializer(initializer: (this: LingServersController) => void): void
}) => void
for (const name of ['executions', 'list', 'add', 'configure', 'forget', 'probe', 'directories', 'bindTask', 'taskBinding', 'attachOperations', 'operationsBinding',
  'takeTerminalUiRequest', 'terminalScope', 'terminalList', 'terminalOpen', 'terminalPoll', 'terminalWrite', 'terminalResize', 'terminalClose',
  'filesList', 'filesRead', 'filesSave', 'gitRequest'] as const) {
  decorate(prototype[name] as (...args: never[]) => unknown, {
    name, private: false, static: false, addInitializer(initializer) { initializer.call(receiver) },
  })
}
