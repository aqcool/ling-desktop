import { homedir } from 'node:os'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import type {} from '@deepseek-ai/dsh-api-terminal-controller'
import type { TerminalAttachmentId, TerminalCreateRequest, WebTerminalId } from '@deepseek-ai/dsh-api-terminal-controller/types'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { LING_WORKSPACE_TERMINAL_HOST } from '../workspace-terminal-contract.ts'

declare module '@deepseek-ai/cordis' {
  interface Context { lingWorkspaceTerminals: LingWorkspaceTerminalsController }
}

/** Adapt DSH's PTY owner seam without creating an Agent, session log or workspace task. */
export class LingWorkspaceTerminalsController extends TypertRemoteService {
  static inject = ['terminalController', 'workspaceRegistry', 'typert', 'subprocess', 'sandboxPolicy']
  constructor(ctx: Context) {
    super(ctx, 'lingWorkspaceTerminals')
    ctx.effect(() => ctx.typert.register(LING_WORKSPACE_TERMINAL_HOST), 'LING workspace terminal Remote')
  }

  private owner(workspaceId: string): Agent {
    const workspace = workspaceId ? this.ctx.workspaceRegistry.get(WorkspaceId(workspaceId)) : undefined
    if (workspaceId && !workspace) throw new RemoteError('workspace/not-found', '工作区已不存在。', { workspaceId: WorkspaceId(workspaceId) })
    // TerminalController consumes only these execution/lifetime fields. The Host context
    // owns cleanup; this identity is never registered with agents or sessions.
    return { id: brandString<SessionId>(`ling-workspace-terminal:${workspaceId || 'home'}`),
      ctx: this.ctx, session: { header: { cwd: workspace?.path ?? homedir() } } } as unknown as Agent
  }

  environment(workspaceId: string, signal: AbortSignal) { return this.ctx.terminalController.environment(this.owner(workspaceId), signal) }
  shells(workspaceId: string, signal: AbortSignal) { return this.ctx.terminalController.shells(this.owner(workspaceId), signal) }
  list(workspaceId: string) { return this.ctx.terminalController.list(this.owner(workspaceId).id) }
  create(workspaceId: string, request: TerminalCreateRequest, signal: AbortSignal) { return this.ctx.terminalController.create(this.owner(workspaceId), request, signal) }
  follow(workspaceId: string, id: WebTerminalId, attachmentId: TerminalAttachmentId, signal: AbortSignal) { return this.ctx.terminalController.follow(this.owner(workspaceId), id, attachmentId, signal) }
  retain(workspaceId: string, id: WebTerminalId, signal: AbortSignal) { return this.ctx.terminalController.retain(this.owner(workspaceId).id, id, signal) }
  write(workspaceId: string, id: WebTerminalId, attachmentId: TerminalAttachmentId, data: string) { return this.ctx.terminalController.write(this.owner(workspaceId), id, attachmentId, data) }
  resize(workspaceId: string, id: WebTerminalId, attachmentId: TerminalAttachmentId, cols: number, rows: number) { return this.ctx.terminalController.resize(this.owner(workspaceId), id, attachmentId, cols, rows) }
  rename(workspaceId: string, id: WebTerminalId, title: string) { return this.ctx.terminalController.rename(this.owner(workspaceId), id, title) }
  close(workspaceId: string, id: WebTerminalId) { return this.ctx.terminalController.close(this.owner(workspaceId), id) }
}

const prototype = LingWorkspaceTerminalsController.prototype
const receiver = Object.create(prototype) as LingWorkspaceTerminalsController
const decorate = Remote as unknown as (implementation: (...args: never[]) => unknown, context: {
  name: string; private: boolean; static: boolean; addInitializer(initializer: (this: LingWorkspaceTerminalsController) => void): void
}) => void
for (const name of ['environment', 'shells', 'list', 'create', 'follow', 'retain', 'write', 'resize', 'rename', 'close'] as const) {
  const marker = name === 'follow' || name === 'retain' ? Remote({ mode: 'stream' }) as unknown as typeof decorate : decorate
  marker(prototype[name] as (...args: never[]) => unknown, { name, private: false, static: false,
    addInitializer(initializer) { initializer.call(receiver) } })
}
