import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { ReactNode } from 'react'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionCreateRequest } from '@deepseek-ai/dsh-api-session-controller'
import { brandString } from '@deepseek-ai/dsh-brand'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-terminal-controller/client'
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type {} from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-file-upload/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import { mountLingRenderer } from 'ling-desktop/client'
import type { LingGitRequest, LingGitResult, LingReadResult, LingWorkspaceToolRequest, LingWorkspaceTools } from 'ling-desktop/runtime'
import { LING_SKILLS_REMOTE, type LingSkillsRemote } from '../skill-contract.ts'
import { LING_MESSAGE_ACTIONS_REMOTE, type LingMessageActionsRemote } from '../message-actions-contract.ts'
import { LING_AUTHORIZATION_REMOTE } from '../authorization-contract.ts'
import { LING_SERVERS_REMOTE } from '../server-contract.ts'
import type { LingServersRemote } from '../server-contract.ts'
import type { LingAuthorizationRemote } from '../authorization-contract.ts'
import { createDshAuthorizationProjection } from './authorization-projection.js'
import { createDshAttachmentPreparation } from './attachment-preparation.js'
import { createDshConversationProjection } from './conversation-projection.js'
import { createDshDirectoryPicker } from './directory-picker.js'
import { createDshExtensionProjection } from './extension-projection.js'
import { createDshInteractionProjection } from './interaction-projection.js'
import { createDshLocaleProjection } from './locale-projection.js'
import { createDshModeProjection } from './mode-projection.js'
import { createDshModelSettingsProjection } from './model-settings-projection.js'
import { createDshPermissionProjection } from './permission-projection.js'
import { createDshScheduleProjection } from './schedule-projection.js'
import { createDshServerProjection } from './server-projection.js'
import { createDshSlashCommandProjection } from './slash-command-projection.js'
import { createDshSubagentProjection } from './subagent-projection.js'
import { createDshTaskModelProjection } from './task-model-projection.js'
import { createDshTerminalProjection } from './terminal-projection.js'
import { attachWorkspaceTerminals } from './workspace-terminal-projection.ts'
import { createDshWorkspaceChangesProjection } from './workspace-changes-projection.js'
import { createDshWorkspaceFilesProjection } from './workspace-files-projection.js'

declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap {
    lingRenderer: unknown
  }
}

export const inject = [
  'sessions',
  'workspaces',
  'connection',
  'fileUpload',
  'uiConversation',
  'uiSession',
  'remote',
  'remote.settings',
  'remote.llm',
  'remote.session',
  'remote.credentials',
  'remote.directoryPicker',
  'remote.commands',
  'remote.permissionPresets',
  'remote.goals',
  'remote.workspaceFiles',
  'remote.officeToPdf',
  'remote.skills',
  'remote.agentPresets',
  'remote.pluginInventory',
  'remote.pluginManager',
  'remote.terminal',
  'webTerminals',
  'remote.subagents',
  'slots',
]

function installStylesheet(): () => void {
  const existing = document.querySelector<HTMLLinkElement>('link[data-ling-renderer-styles]')
  if (existing) return () => {}
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = `/ling-renderer.css?v=${String(Date.now())}`
  link.dataset.lingRendererStyles = ''
  document.head.append(link)
  return () => { link.remove() }
}

function createLingRootApp(getFacades: () => Parameters<typeof mountLingRenderer>[1]): () => ReactNode {
  let disposer: (() => void) | undefined
  const attach = (container: HTMLDivElement | null): void => {
    if (container !== null && disposer === undefined) disposer = mountLingRenderer(container, getFacades())
    else if (container === null && disposer !== undefined) { disposer(); disposer = undefined }
  }
  return () => ({
    $$typeof: Symbol.for('react.element'),
    type: 'div',
    key: null,
    ref: attach,
    props: { style: { position: 'fixed', inset: 0, overflow: 'hidden' } },
    _owner: null,
  } as unknown as ReactNode)
}

export async function createLingSession(
  remote: Pick<Context['remote'], 'session'>,
  sessions: Pick<ISessions, 'refresh'>,
  request: { workspaceId?: string; agentPreset: string },
) {
  // ISessions.create's manager rebuilds the payload without agentPreset.
  const payload: SessionCreateRequest = {
    agentPreset: request.agentPreset,
    ...(request.workspaceId ? { workspaceId: brandString<NonNullable<SessionCreateRequest['workspaceId']>>(request.workspaceId) } : {}),
  }
  const result = await remote.session.create(payload)
  if (!result.ok) throw new Error(result.error.message, { cause: result.error })
  await sessions.refresh()
  return result.value.sessionId
}

export function apply(ctx: Context): void {
  ctx.effect(() => {
    if (typeof document === 'undefined') return () => {}
    const previousTitle = document.title
    document.title = '灵创'
    return () => { document.title = previousTitle }
  }, 'LING window title')
  // Published typings still declare only the host-side shape for `ctx.connection`.
  const connection = ctx.connection as unknown as ConnectionHandle
  // This build includes both Host and Client context augmentations.
  const sessions = ctx.sessions as unknown as ISessions
  const interactions = createDshInteractionProjection(ctx.uiSession)
  const attachments = createDshAttachmentPreparation(ctx.fileUpload)
  const changes = createDshWorkspaceChangesProjection(ctx.uiConversation)
  const authorizationMount = typeof ctx.remote.$mount === 'function'
    ? ctx.remote.$mount(LING_AUTHORIZATION_REMOTE)
    : undefined
  if (authorizationMount !== undefined) {
    ctx.effect(async () => {
      const dispose = await authorizationMount
      return dispose
    }, 'LING authorization Remote')
  }
  const authorization = authorizationMount === undefined
    ? undefined
    : createDshAuthorizationProjection(
        ctx.remote,
        authorizationMount,
        () => ctx.get('remote.lingAuthorization') as unknown as LingAuthorizationRemote | undefined,
      )
  const serversMount = typeof ctx.remote.$mount === 'function'
    ? ctx.remote.$mount(LING_SERVERS_REMOTE)
    : undefined
  if (serversMount) ctx.effect(async () => await serversMount, 'LING servers Remote')
  const servers = serversMount === undefined ? undefined : createDshServerProjection(
    () => ctx.get('remote.lingServers') as unknown as LingServersRemote | undefined,
    serversMount,
  )
  const conversation = createDshConversationProjection(ctx.uiConversation, serversMount === undefined ? undefined : async (taskId, callIds) => {
    await serversMount
    const service = ctx.get('remote.lingServers') as unknown as LingServersRemote | undefined
    const result = await service?.executions(taskId, callIds)
    return result?.ok ? result.value : []
  })
  const models = createDshModelSettingsProjection(ctx.remote, authorization)
  const taskModels = createDshTaskModelProjection(ctx.remote, sessions, models.validateSelection)
  const directoryPicker = createDshDirectoryPicker(ctx.remote)
  const commands = createDshSlashCommandProjection(ctx.remote)
  const permissions = createDshPermissionProjection(ctx.remote)
  const mode = createDshModeProjection(ctx.remote)
  const schedules = createDshScheduleProjection()
  const files = createDshWorkspaceFilesProjection(ctx.remote)
  const terminals = createDshTerminalProjection(ctx.remote, ctx.webTerminals)
  attachWorkspaceTerminals(ctx, terminals.service)
  const skillsMount = typeof ctx.remote.$mount === 'function' ? ctx.remote.$mount(LING_SKILLS_REMOTE) : undefined
  const messagesMount = typeof ctx.remote.$mount === 'function' ? ctx.remote.$mount(LING_MESSAGE_ACTIONS_REMOTE) : undefined
  if (messagesMount) ctx.effect(async () => await messagesMount, 'LING message actions Remote')
  if (skillsMount) ctx.effect(async () => await skillsMount, 'LING draft skills Remote')
  const extensions = createDshExtensionProjection(ctx.remote, skillsMount === undefined ? undefined : async (workspaceId, agentPreset, signal) => {
    await skillsMount
    const remote = ctx.get('remote.lingSkills') as unknown as LingSkillsRemote
    return remote.list(workspaceId ?? null, agentPreset, signal)
  })
  const subagents = createDshSubagentProjection(ctx.remote)
  const locale = createDshLocaleProjection(ctx.remote)
  ctx.effect(installStylesheet, 'LING renderer stylesheet')
  ctx.slots.register({ name: 'root', priority: -1 }, createLingRootApp(() => ({
    sessions,
    messageActions: { async prepareAttachments(taskId, seq, attachmentIds) {
      if (!messagesMount) return { ok: false, reason: 'runtime-unavailable', message: '原附件服务暂不可用。', retryable: true }
      await messagesMount
      const remote = ctx.get('remote.lingMessageActions') as unknown as LingMessageActionsRemote
      const result = await remote.prepareAttachments({ taskId, seq, attachmentIds: [...attachmentIds] })
      return result.ok ? { ok: true, value: result.value } : { ok: false, reason: 'runtime-unavailable', message: result.error.message || '无法读取原附件。', retryable: true }
    } },
    createSession: request => createLingSession(ctx.remote, sessions, request),
    workspaces: ctx.workspaces,
    workspaceTools: {
      request: async (path: string, request: LingWorkspaceToolRequest): Promise<LingReadResult<LingWorkspaceTools>> => {
        const bridge = (globalThis as { __LING_WORKSPACE_TOOLS__?: { request(path: string, request: LingWorkspaceToolRequest): Promise<LingReadResult<LingWorkspaceTools>> } }).__LING_WORKSPACE_TOOLS__
        return bridge ? bridge.request(path, request) : { ok: false, reason: 'runtime-unavailable', message: '此操作需要桌面应用。', retryable: false }
      },
    },
    workspaceGit: {
      request: async (path: string, request: LingGitRequest) => {
        const bridge = (globalThis as { __LING_WORKSPACE_GIT__?: { request?(path: string, request: LingGitRequest): Promise<LingReadResult<LingGitResult>> } }).__LING_WORKSPACE_GIT__
        return bridge?.request ? bridge.request(path, request) : { ok: false, reason: 'runtime-unavailable', message: 'Git 操作需要新版桌面应用。', retryable: false }
      },
      branch: async (path: string) => {
        const bridge = (globalThis as { __LING_WORKSPACE_GIT__?: { branch(path: string): Promise<string | null> } }).__LING_WORKSPACE_GIT__
        return bridge ? bridge.branch(path) : null
      },
    },
    conversation,
    interactions,
    models,
    ...(authorization === undefined ? {} : { authorization }),
    taskModels,
    directoryPicker,
    commands,
    permissions,
    mode,
    schedules,
    extensions,
    ...(servers === undefined ? {} : { servers }),
    attachments,
    changes,
    files,
    terminals,
    subagents,
    locale,
    connectionState: connection.state,
    reconnect: () => { connection.reconnect() },
  })))
}
