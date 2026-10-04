import { useEffect, useRef, useState } from 'react'
import type { LingCommandResult, LingModelSelection, LingModelSettings, LingRuntimeAdapter, LingTaskMode, LingTaskPermission } from '../runtime/contract.js'
import { useLingRuntime } from '../runtime/use-ling-runtime.js'
import { Composer, isComposerCommand } from './Composer.js'
import { Conversation } from './Conversation.js'
import { InteractionPanel } from './InteractionPanel.js'
import { Icon } from './Icon.js'
import { releaseComposerAttachment, toComposerAttachment, toComposerQuote, type ComposerAttachment } from './attachments.js'
import { useBehavior } from './behavior-preferences.js'
import { rememberCreatedTaskMode } from './task-work-modes.js'
import { tw } from './tailwind.js'

export interface SideTaskState {
  readonly error?: string
  readonly pending?: boolean
  readonly taskId?: string
  readonly workspaceId?: string
  readonly workspaceLabel: string
  readonly agentPreset?: string
  readonly model?: LingModelSelection
  readonly permissionPreset?: string
  readonly prompt: string
  readonly attachments: readonly ComposerAttachment[]
}

/** Each pane retains its own task binding; none of these actions selects the main conversation. */
export function SideTaskPanel({ runtime, state, modelSettings, onUpdate, onTitle, onOpenModels }: {
  runtime: LingRuntimeAdapter; state: SideTaskState; modelSettings?: LingModelSettings
  onUpdate: (patch: Partial<SideTaskState>) => void; onTitle: (title: string) => void; onOpenModels: () => void
}) {
  const task = useLingRuntime(runtime, state.taskId)
  const behavior = useBehavior()
  const [busy, setBusy] = useState(false)
  const [readingFiles, setReadingFiles] = useState(false)
  const [error, setError] = useState<string>(state.error ?? '')
  const [permission, setPermission] = useState<LingTaskPermission>()
  const [mode, setMode] = useState<LingTaskMode>()
  const [revision, setRevision] = useState(0)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const locked = useRef(false)
  const mounted = useRef(true)
  const latest = useRef({ state, onUpdate, onTitle })
  latest.current = { state, onUpdate, onTitle }
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => { if (state.taskId) task.selectTask(state.taskId) }, [state.taskId, task.selectTask])
  useEffect(() => { setError(state.error ?? '') }, [state.error])
  const id = task.selectedTask?.taskId ?? state.taskId
  const running = task.selectedTask?.status === 'running' || task.selectedTask?.status === 'queued'
  const model = (id ? task.taskModel : state.model) ?? modelSettings?.defaultSelection
  const modelLabel = modelSettings?.providers.find(provider => provider.providerId === model?.provider)?.models.find(option => option.id === model?.model)?.name ?? model?.model ?? '选择模型'

  useEffect(() => {
    if (task.selectedTask) latest.current.onTitle(task.selectedTask.title)
  }, [task.selectedTask?.title])
  useEffect(() => {
    let active = true
    if (!id) {
      setMode(undefined)
      void task.getPermissionCatalog().then(result => { if (active) setPermission(result.ok ? { options: result.value, currentValue: latest.current.state.permissionPreset } : undefined) })
    } else {
      void task.getTaskPermissions(id).then(result => { if (active) setPermission(result.ok ? result.value : undefined) })
      void task.getTaskMode(id).then(result => { if (active) setMode(result.ok ? result.value : undefined) })
    }
    return () => { active = false }
  }, [id, revision, task.selectedTask?.status, task.timeline.length, state.permissionPreset, task.getPermissionCatalog, task.getTaskPermissions, task.getTaskMode])

  const act = async (operation: () => Promise<LingCommandResult>) => {
    if (locked.current || latest.current.state.pending) return
    locked.current = true; latest.current.onUpdate({ pending: true }); setBusy(true); setError(''); latest.current.onUpdate({ error: undefined })
    try {
      const result = await operation()
      if (!result.accepted) { latest.current.onUpdate({ error: result.message }); if (mounted.current) setError(result.message); return result }
      if (mounted.current) setRevision(value => value + 1)
      return result
    } catch (cause) { const message = cause instanceof Error ? cause.message : '操作失败，请重试。'; latest.current.onUpdate({ error: message }); if (mounted.current) setError(message) }
    finally { locked.current = false; latest.current.onUpdate({ pending: false }); if (mounted.current) setBusy(false) }
  }
  const send = async () => {
    const draft = latest.current.state
    if (readingFiles || (!draft.prompt.trim() && !draft.attachments.length)) return
    const result = await act(async () => {
      if (id && draft.prompt.trim().startsWith('/')) {
        const commands = await task.getTaskCommands(id)
        if (!commands.ok) return { accepted: false, requestId: 'side-command', ...commands }
        if (isComposerCommand(draft.prompt, commands.value)) {
          if (draft.attachments.length) return { accepted: false, requestId: 'side-command', reason: 'invalid-command', message: '指令不支持附件，请移除附件后重试。', retryable: false }
          return task.runCommand(id, draft.prompt.trim(), behavior.goalRounds)
        }
      }
      return task.submit(draft.prompt, { workspaceId: draft.workspaceId, agentPreset: draft.agentPreset, model: draft.model, permissionPreset: draft.permissionPreset, mode: behavior.sendMode, maxGoalRounds: runtime.supportsGoalLimit ? behavior.goalRounds : undefined, attachments: draft.attachments.map(item => item.attachment) })
    })
    if (result?.accepted) {
      if (!id) {
        try { rememberCreatedTaskMode(result, behavior.workMode) }
        catch { setError('消息已发送，但任务所属模式未能保存。') }
      }
      for (const attachment of draft.attachments) releaseComposerAttachment(attachment)
      latest.current.onUpdate({ prompt: '', attachments: [], ...(result.output?.taskId ? { taskId: result.output.taskId } : {}) })
    }
  }
  const addFiles = async (files: File[]) => {
    setReadingFiles(true)
    const results = await Promise.allSettled(files.map(toComposerAttachment))
    const added = results.flatMap(result => result.status === 'fulfilled' ? [result.value] : [])
    if (!mounted.current) { added.forEach(releaseComposerAttachment); return }
    onUpdate({ attachments: [...latest.current.state.attachments, ...added] })
    if (results.some(result => result.status === 'rejected')) setError('部分附件读取失败，请重试。')
    setReadingFiles(false)
  }
  return <section aria-label="侧边任务" className={tw('flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden')}>
    {id ? <Conversation items={task.timeline} connection={task.connection} demo={runtime.kind === 'offline-demo'} hasOlder={task.selectedTask?.hasOlder === true} loadingOlder={loadingOlder} onLoadOlder={() => { if (loadingOlder) return; setLoadingOlder(true); void act(() => task.loadOlder(id)).finally(() => setLoadingOlder(false)) }} onReconnect={() => { void act(task.reconnect) }} running={running} threadKey={id} loadAttachment={task.loadTaskAttachment} onAddReply={(text, preview) => onUpdate({ attachments: [...latest.current.state.attachments, toComposerQuote(text, preview)] })} /> : <div className={tw('grid min-h-24 flex-1 place-content-center gap-2 text-center text-[var(--text-secondary)]')}><Icon className={tw('mx-auto')} name="sideChat" size={24} /><h2 className={tw('m-0 text-sm font-medium')}>新任务</h2></div>}
    <InteractionPanel interactions={task.pendingInteractions.filter(item => item.taskId === id)} onApprove={(key, decision) => act(() => task.answerApproval(key, decision))} onAnswer={(key, answers) => act(() => task.answerQuestion(key, answers))} onCancel={key => act(() => task.cancelInteraction(key))} />
    <div className={tw('shrink-0 px-3 pb-2')}>
      {error ? <p role="alert" className={tw('my-2 text-xs text-[var(--danger)]')}>{error}</p> : null}
      <Composer value={state.prompt} onChange={prompt => onUpdate({ prompt })} running={running} hasTask={Boolean(id)} disabled={state.pending || busy || readingFiles || task.connection.phase !== 'ready'} attachments={state.attachments} onAddFiles={files => { void addFiles(files) }} onRemoveAttachment={key => { const attachment = state.attachments.find(item => item.id === key); if (attachment) releaseComposerAttachment(attachment); onUpdate({ attachments: state.attachments.filter(item => item.id !== key) }) }} onSubmit={() => { void send() }} onStop={() => { if (id) void act(() => task.cancelTask(id)) }} modelLabel={modelLabel} modelSettings={modelSettings} taskScoped taskModel={model ?? modelSettings?.defaultSelection} onSelectModel={selection => { if (id) void act(() => task.selectTaskModel(id, selection)); else onUpdate({ model: selection }) }} onOpenModelSettings={onOpenModels} permission={permission} onSelectPermission={value => { if (id) void act(() => task.runCommand(id, `/permission ${value}`)); else onUpdate({ permissionPreset: value }) }} mode={mode} onPlanModeToggle={active => { if (id) void act(() => task.runCommand(id, active ? '/plan' : '/plan off')); else onUpdate({ prompt: active ? '/plan ' : '' }) }} onGoalAction={(action, goal) => { if (id) void act(() => task.runGoalAction(id, action, goal)) }} taskId={id} getTaskCommands={task.getTaskCommands} getTaskSkills={task.getTaskSkills} getWorkspaceSkills={runtime.getWorkspaceSkills} workspaceId={state.workspaceId} agentPreset={state.agentPreset} />
      <div className={tw("mt-2 flex h-control-xs items-center gap-1.5 px-1 text-xs text-[var(--text-tertiary)]")}><Icon name="folder" size={14} /><span className={tw('truncate')}>{state.workspaceLabel}</span></div>
    </div>
  </section>
}
