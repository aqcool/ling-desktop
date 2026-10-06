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
import { LING_SESSION_DELETE_REMOTE, type LingSessionDeleteRemote } from '../session-delete-contract.ts'
import { LING_MESSAGE_ACTIONS_REMOTE, type LingMessageActionsRemote } from '../message-actions-contract.ts'
import { LING_CHANGE_HISTORY_REMOTE, type LingChangeHistoryRemote } from '../change-history-contract.ts'
import { LING_COMPUTER_CONTROL_REMOTE, type LingComputerControlRemote } from '../computer-control-contract.ts'
import { LING_AUTOMATION_REMOTE, type LingAutomationRemote } from '../automation-contract.ts'
import { LING_HOOKS_REMOTE, type LingHooksRemote } from '../hooks-contract.ts'
import { LING_WORKSPACE_DOCUMENTS_REMOTE, type LingWorkspaceDocumentsRemote } from '../workspace-document-contract.ts'
import { LING_KNOWLEDGE_REMOTE, type LingKnowledgeRemote } from '../knowledge-contract.ts'
import { LING_AUTHORIZATION_REMOTE } from '../authorization-contract.ts'
import { LING_MODEL_CATALOG_REMOTE, type LingModelCatalogRemote } from '../model-catalog-contract.ts'
import { LING_SERVERS_REMOTE } from '../server-contract.ts'
import type { LingServersRemote } from '../server-contract.ts'
import type { LingAuthorizationRemote } from '../authorization-contract.ts'
import { createDshAuthorizationProjection } from './authorization-projection.js'
import { createDshAttachmentPreparation } from './attachment-preparation.js'
import { lingCompactionDefinition, lingCompactionBoundaryDefinition } from './compaction-projection.js'
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
import { createDshWorkspaceChangesProjection, lingWorkspaceChangesDefinition } from './workspace-changes-projection.js'
import { createDshWorkspaceFilesProjection } from './workspace-files-projection.js'
import { lingDeliverablesDefinition } from './deliverables-projection.js'
import { createReplyFeaturesProjection } from './reply-features-projection.js'
import { LING_REPLY_REMOTE, type LingReplyRemote } from '../reply-features-contract.ts'

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
  ctx.uiConversation.events.register(lingDeliverablesDefinition)
  ctx.uiConversation.events.register(lingWorkspaceChangesDefinition)
  ctx.uiConversation.events.register(lingCompactionDefinition)
  ctx.uiConversation.events.register(lingCompactionBoundaryDefinition)
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
  const changesMount = typeof ctx.remote.$mount === 'function' ? ctx.remote.$mount(LING_CHANGE_HISTORY_REMOTE) : undefined
  if (changesMount) ctx.effect(async () => await changesMount, 'LING change history Remote')
  const changes = createDshWorkspaceChangesProjection(ctx.uiConversation, globalThis.fetch, changesMount ? async () => {
    await changesMount
    const service = ctx.get('remote.lingChangeHistory') as unknown as LingChangeHistoryRemote | undefined
    if (!service) throw new Error('本地文件变更服务暂不可用。')
    return service
  } : undefined)
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
  const modelCatalogMount = typeof ctx.remote.$mount === 'function' ? ctx.remote.$mount(LING_MODEL_CATALOG_REMOTE) : undefined
  if (modelCatalogMount) ctx.effect(async () => await modelCatalogMount, 'LING model catalog Remote')
  const models = createDshModelSettingsProjection(ctx.remote, authorization, modelCatalogMount ? async () => {
    await modelCatalogMount
    const service = ctx.get('remote.lingModelCatalog') as unknown as LingModelCatalogRemote | undefined
    if (!service) throw new Error('本地模型目录服务暂不可用。')
    return service
  } : undefined)
  const taskModels = createDshTaskModelProjection(ctx.remote, sessions, models.validateSelection)
  const directoryPicker = createDshDirectoryPicker(ctx.remote)
  const commands = createDshSlashCommandProjection(ctx.remote)
  const permissions = createDshPermissionProjection(ctx.remote)
  const mode = createDshModeProjection(ctx.remote)
  const schedules = createDshScheduleProjection()
  const documentsMount = typeof ctx.remote.$mount === 'function' ? ctx.remote.$mount(LING_WORKSPACE_DOCUMENTS_REMOTE) : undefined
  if (documentsMount) ctx.effect(async () => await documentsMount, 'LING workspace documents Remote')
  const documentService = async () => {
    await documentsMount
    const service = ctx.get('remote.lingWorkspaceDocuments') as unknown as LingWorkspaceDocumentsRemote | undefined
    if (!service) throw new Error('本地文件编辑服务暂不可用。')
    return service
  }
  const files = createDshWorkspaceFilesProjection(ctx.remote, documentsMount === undefined ? undefined : {
    async list(request, signal) { return (await documentService()).list(request, signal) },
    async read(request, signal) { return (await documentService()).read(request, signal) },
    async readOffice(request, signal) { return (await documentService()).readOffice(request, signal) },
    async readBinary(request, signal) { return (await documentService()).readBinary(request, signal) },
    async save(request, signal) { return (await documentService()).save(request, signal) },
  })
  const replyMount = typeof ctx.remote.$mount === 'function' ? ctx.remote.$mount(LING_REPLY_REMOTE) : undefined
  if (replyMount) ctx.effect(async () => await replyMount, 'LING reply Remote')
  const replyFeatures = replyMount ? createReplyFeaturesProjection(() => ctx.get('remote.lingReply') as unknown as LingReplyRemote | undefined, replyMount) : undefined
  const terminals = createDshTerminalProjection(ctx.remote, ctx.webTerminals)
  attachWorkspaceTerminals(ctx, terminals.service)
  const skillsMount = typeof ctx.remote.$mount === 'function' ? ctx.remote.$mount(LING_SKILLS_REMOTE) : undefined
  const deleteMount = typeof ctx.remote.$mount === 'function' ? ctx.remote.$mount(LING_SESSION_DELETE_REMOTE) : undefined
  if (deleteMount) ctx.effect(async () => await deleteMount, 'LING session delete Remote')
  const messagesMount = typeof ctx.remote.$mount === 'function' ? ctx.remote.$mount(LING_MESSAGE_ACTIONS_REMOTE) : undefined
  const computerMount = typeof ctx.remote.$mount === 'function' ? ctx.remote.$mount(LING_COMPUTER_CONTROL_REMOTE) : undefined
  const automationMount = typeof ctx.remote.$mount === 'function' ? ctx.remote.$mount(LING_AUTOMATION_REMOTE) : undefined
  const hooksMount = typeof ctx.remote.$mount === 'function' ? ctx.remote.$mount(LING_HOOKS_REMOTE) : undefined
  if (hooksMount) ctx.effect(async () => await hooksMount, 'LING hooks Remote')
  if (automationMount) ctx.effect(async () => await automationMount, 'LING automation Remote')
  const knowledgeMount = typeof ctx.remote.$mount === 'function' ? ctx.remote.$mount(LING_KNOWLEDGE_REMOTE) : undefined
  if (knowledgeMount) ctx.effect(async () => await knowledgeMount, 'LING knowledge Remote')
  if (computerMount) ctx.effect(async () => await computerMount, 'LING computer control Remote')
  const computerRequest = async <T,>(method: (remote: LingComputerControlRemote) => Promise<{ ok: true; value: T } | { ok: false; error: { message?: string } }>): Promise<LingReadResult<T>> => {
    try {
      if (!computerMount) throw new Error('电脑操控服务暂不可用，请重启应用。')
      await computerMount
      const remote = ctx.get('remote.lingComputerControl') as unknown as LingComputerControlRemote
      const result = await method(remote)
      return result.ok ? result : { ok: false, reason: 'runtime-unavailable', message: result.error.message || '电脑操控服务暂不可用。', retryable: true }
    } catch (error) { return { ok: false, reason: 'runtime-unavailable', message: error instanceof Error ? error.message : '电脑操控服务暂不可用。', retryable: true } }
  }
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
    replyFeatures,
    hooks: { async request(request, signal) {
      try {
        if (!hooksMount) throw new Error('Hooks 服务暂不可用，请重启应用。')
        await hooksMount
        signal?.throwIfAborted()
        const remote = ctx.get('remote.lingHooks') as unknown as LingHooksRemote
        const result = await remote.request(request, signal)
        return result.ok ? result : { ok: false, reason: 'runtime-unavailable', message: result.error.message || 'Hooks 服务暂不可用。', retryable: true }
      } catch (error) { return { ok: false, reason: 'runtime-unavailable', message: error instanceof Error ? error.message : 'Hooks 服务暂不可用。', retryable: true } }
    } },
    automation: { async request(request, signal) {
      try {
        if (!automationMount) throw new Error('自动化服务暂不可用，请重启应用。')
        await automationMount
        signal?.throwIfAborted()
        const remote = ctx.get('remote.lingAutomation') as unknown as LingAutomationRemote
        const result = await remote.request(request, signal)
        return result.ok ? result : { ok: false, reason: 'runtime-unavailable', message: result.error.message || '自动化服务暂不可用。', retryable: true }
      } catch (error) { return { ok: false, reason: 'runtime-unavailable', message: error instanceof Error ? error.message : '自动化服务暂不可用。', retryable: true } }
    } },
    knowledge: { async request(request, signal) {
      try {
        if (!knowledgeMount) throw new Error('知识服务暂不可用，请重启应用。')
        await knowledgeMount
        signal?.throwIfAborted()
        const remote = ctx.get('remote.lingKnowledge') as unknown as LingKnowledgeRemote
        const result = await remote.request(request, signal)
        return result.ok ? result : { ok: false, reason: 'runtime-unavailable', message: result.error.message || '知识服务暂不可用。', retryable: true }
      } catch (error) { return { ok: false, reason: 'runtime-unavailable', message: error instanceof Error ? error.message : '知识服务暂不可用。', retryable: true } }
    } },
    computerControl: { capabilities: () => computerRequest(remote => remote.capabilities()), snapshot: () => computerRequest(remote => remote.snapshot()) },
    sessions,
    deleteArchivedSession: async (taskId) => {
      try {
        if (!deleteMount) throw new Error('删除服务暂不可用，请重启应用。')
        await deleteMount
        const remote = ctx.get('remote.lingSessionDelete') as unknown as LingSessionDeleteRemote
        const result = await remote.deleteArchived({ taskId })
        return result.ok ? { ok: true, value: undefined } : { ok: false, reason: 'runtime-unavailable', message: result.error.message || '删除失败，请重试。', retryable: true }
      } catch (error) { return { ok: false, reason: 'runtime-unavailable', message: error instanceof Error ? error.message : '删除失败，请重试。', retryable: true } }
    },
    messageActions: { async prepareAttachments(taskId, seq, attachmentIds) {
      if (!messagesMount) return { ok: false, reason: 'runtime-unavailable', message: '原附件服务暂不可用。', retryable: true }
      await messagesMount
      const remote = ctx.get('remote.lingMessageActions') as unknown as LingMessageActionsRemote
      const result = await remote.prepareAttachments({ taskId, seq, attachmentIds: [...attachmentIds] })
      return result.ok ? { ok: true, value: result.value } : { ok: false, reason: 'runtime-unavailable', message: result.error.message || '无法读取原附件。', retryable: true }
    } },
    messageQueue: {
      async withdraw(taskId, itemId) {
        try {
          if (!messagesMount) throw new Error('队列服务暂不可用，请重启应用。')
          await messagesMount
          const remote = ctx.get('remote.lingMessageActions') as unknown as LingMessageActionsRemote
          const result = await remote.withdrawQueue({ taskId, itemId })
          return result.ok ? result : { ok: false, reason: 'runtime-unavailable', message: result.error.message || '无法撤回消息。', retryable: true }
        } catch (error) { return { ok: false, reason: 'runtime-unavailable', message: error instanceof Error ? error.message : '无法撤回消息。', retryable: true } }
      },
      async reorder(taskId, itemIds) {
        try {
          if (!messagesMount) throw new Error('队列服务暂不可用，请重启应用。')
          await messagesMount
          const remote = ctx.get('remote.lingMessageActions') as unknown as LingMessageActionsRemote
          const result = await remote.reorderQueue({ taskId, itemIds: [...itemIds] })
          return result.ok ? { ok: true, value: undefined } : { ok: false, reason: 'runtime-unavailable', message: result.error.message || '无法调整队列顺序。', retryable: true }
        } catch (error) { return { ok: false, reason: 'runtime-unavailable', message: error instanceof Error ? error.message : '无法调整队列顺序。', retryable: true } }
      },
    },
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
