import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { LingBackgroundJob, LingGitSnapshot, LingSkill, LingSubagentCatalog, LingTaskSchedule, LingTimelineItem } from '../../runtime/contract.js'
import { ChangeReview } from '../ChangeReview.js'
import { Icon } from '../Icon.js'
import { MonitorSection } from '../MonitorSection.js'
import { PromptDialog } from '../PromptDialog.js'
import { openTaskNotes, readTaskNotes, taskNotesEvent } from '../TaskNotes.js'
import { TaskRecap } from '../TaskRecap.js'
import { useBehavior } from '../behavior-preferences.js'
import { requestBrowserNavigation } from '../browser-navigation.js'
import type { MonitorPreferences } from '../monitor-preferences.js'
import { tw } from '../tailwind.js'
import type { LingShellProps, WorkbenchTab } from './types.js'

const jobStatusLabels: Record<LingBackgroundJob['status'], string> = {
  running: '运行中',
  stopping: '停止中',
  completed: '已完成',
  killed: '已终止',
  failed: '已失败',
}

function BackgroundJobList({ jobs }: { readonly jobs: readonly LingBackgroundJob[] }) {
  if (jobs.length === 0) return <p className={tw("environment-panel__state flex [min-height:2.4rem] items-center gap-2 m-0 py-1.5 px-1.5 [color:var(--text-secondary)] text-xs")}>当前任务没有后台作业。</p>
  return (
    <ul className={tw("job-list m-0 p-0 [list-style:none]")}>
      {jobs.map(job => (
        <li className={tw("job-list__item flex min-w-0 items-center gap-2 py-1.5 px-1.5 text-xs")} key={job.jobId}>
          <span className={tw(
            "job-list__state size-[0.45rem] flex-none rounded-full bg-[var(--disabled-background)]",
            job.status === 'running' && "job-list__state--running bg-[var(--success)]",
            job.status === 'stopping' && "job-list__state--stopping bg-[var(--warning)]",
            (job.status === 'failed' || job.status === 'killed') && "job-list__state--failed bg-[var(--danger)]",
          )} />
          <span className={tw("job-list__label min-w-0 overflow-hidden mr-auto [color:var(--foreground)] text-ellipsis whitespace-nowrap")} title={job.label}>{job.label}</span>
          <span className={tw("job-list__kind [flex-shrink:0] py-0 px-1.5 rounded-md [background:var(--surface-secondary)] [color:var(--text-secondary)] text-caption")}>{job.kind}</span>
          <span className={tw("job-list__status [flex-shrink:0] [max-width:9rem] overflow-hidden [color:var(--text-secondary)] text-caption text-ellipsis whitespace-nowrap")} title={job.detail ?? jobStatusLabels[job.status]}>
            {job.detail ?? jobStatusLabels[job.status]}
          </span>
        </li>
      ))}
    </ul>
  )
}

export function SubagentList({ catalog, onPrompt, onInterrupt }: {
  readonly catalog: LingSubagentCatalog | undefined
  readonly onPrompt?: (subagentSessionId: string, text: string) => Promise<{ readonly accepted: boolean; readonly message?: string }>
  readonly onInterrupt?: (subagentSessionId: string) => Promise<{ readonly accepted: boolean; readonly message?: string }>
}) {
  const [promptTarget, setPromptTarget] = useState<string>()
  const [busyTarget, setBusyTarget] = useState<string>()
  const [actionMessage, setActionMessage] = useState<string>()

  const interrupt = async (subagentSessionId: string) => {
    if (busyTarget !== undefined || onInterrupt === undefined) return
    setBusyTarget(subagentSessionId)
    setActionMessage(undefined)
    try {
      const result = await onInterrupt(subagentSessionId)
      if (!result.accepted) setActionMessage(result.message ?? '中断子任务失败。')
    } catch {
      setActionMessage('中断子任务失败。')
    } finally {
      setBusyTarget(undefined)
    }
  }
  if (catalog === undefined || catalog.state === 'loading') {
    return <p className={tw("environment-panel__state flex [min-height:2.4rem] items-center gap-2 m-0 py-1.5 px-1.5 [color:var(--text-secondary)] text-xs")}>正在读取子任务…</p>
  }
  if (catalog.state === 'error') {
    return <p className={tw("environment-panel__state flex [min-height:2.4rem] items-center gap-2 m-0 py-1.5 px-1.5 [color:var(--text-secondary)] text-xs")}>{catalog.message ?? '子任务读取失败。'}</p>
  }
  if (catalog.subagents.length === 0 && catalog.unreadable.length === 0) {
    return <p className={tw("environment-panel__state flex [min-height:2.4rem] items-center gap-2 m-0 py-1.5 px-1.5 [color:var(--text-secondary)] text-xs")}>当前任务没有子任务。</p>
  }
  return (
    <>
      <ul className={tw("subagent-list m-0 p-0 [list-style:none]")}>
        {catalog.subagents.map(subagent => (
          <li className={tw("subagent-list__item flex min-w-0 items-center gap-2 py-1.5 px-1.5 text-xs")} key={subagent.sessionId}>
            <span className={tw("subagent-list__state size-[0.45rem] flex-none rounded-full bg-[var(--disabled-background)]", subagent.activity === 'running' && "subagent-list__state--running bg-[var(--success)]")} />
            <span className={tw("subagent-list__title min-w-0 overflow-hidden mr-auto [color:var(--foreground)] text-ellipsis whitespace-nowrap")} title={subagent.title}>{subagent.title}</span>
            <span className={tw("subagent-list__mode [flex-shrink:0] py-0 px-1.5 rounded-md [background:var(--surface-secondary)] [color:var(--text-secondary)] text-caption")}>{subagent.mode === 'continuable' ? '可持续' : '一次性'}</span>
            {onPrompt && subagent.mode === 'continuable' ? (
              <button
                aria-label={`向子任务 ${subagent.title} 追加指令`}
                className={tw("subagent-list__action [flex-shrink:0] py-0 px-2 [border:1px_solid_var(--panel-border)] rounded-md [background:var(--surface)] [color:var(--text-secondary)] text-caption cursor-pointer hover:[background:var(--surface-secondary)]")}
                disabled={busyTarget !== undefined}
                onClick={() => { setPromptTarget(subagent.sessionId) }}
                type="button"
              >
                追加指令
              </button>
            ) : null}
            {onInterrupt && subagent.activity === 'running' ? (
              <button
                aria-busy={busyTarget === subagent.sessionId}
                aria-label={`中断子任务 ${subagent.title}`}
                className={tw("subagent-list__action [flex-shrink:0] py-0 px-2 [border:1px_solid_var(--panel-border)] rounded-md [background:var(--surface)] [color:var(--text-secondary)] text-caption cursor-pointer hover:[background:var(--surface-secondary)]")}
                disabled={busyTarget !== undefined}
                onClick={() => { void interrupt(subagent.sessionId) }}
                type="button"
              >
                {busyTarget === subagent.sessionId ? '中断中…' : '中断'}
              </button>
            ) : null}
          </li>
        ))}
        {catalog.unreadable.length === 0
          ? null
          : <li className={tw("subagent-list__unreadable py-1.5 px-1.5 [color:var(--text-secondary)] text-caption")}>{`${String(catalog.unreadable.length)} 个子任务无法读取`}</li>}
      </ul>
      {actionMessage ? <p className={tw("environment-panel__state flex [min-height:2.4rem] items-center gap-2 m-0 py-1.5 px-1.5 [color:var(--text-secondary)] text-xs")} role="status">{actionMessage}</p> : null}
      {promptTarget !== undefined && onPrompt ? (
        <PromptDialog
          confirmLabel="发送"
          description="指令会排队送达该子任务。"
          label="指令"
          onCancel={() => { setPromptTarget(undefined) }}
          onConfirm={value => onPrompt(promptTarget, value)}
          open
          placeholder="输入要追加给该子任务的指令"
          title="追加指令"
        />
      ) : null}
    </>
  )
}

const scheduleKindLabels: Record<LingTaskSchedule['kind'], string> = {
  after: '延时',
  at: '定时',
  every: '周期',
}

function ScheduleList(props: {
  readonly schedules: readonly LingTaskSchedule[]
  readonly loading: boolean
  readonly message?: string
}) {
  if (props.loading) return <p className={tw("environment-panel__state flex [min-height:2.4rem] items-center gap-2 m-0 py-1.5 px-1.5 [color:var(--text-secondary)] text-xs")}>正在读取定时提醒…</p>
  if (props.message) return <p className={tw("environment-panel__state flex [min-height:2.4rem] items-center gap-2 m-0 py-1.5 px-1.5 [color:var(--text-secondary)] text-xs")}>{props.message}</p>
  if (props.schedules.length === 0) return <p className={tw("environment-panel__state flex [min-height:2.4rem] items-center gap-2 m-0 py-1.5 px-1.5 [color:var(--text-secondary)] text-xs")}>当前任务没有定时提醒。</p>
  return (
    <ul className={tw("schedule-list m-0 p-0 [list-style:none]")}>
      {props.schedules.map(schedule => (
        <li className={tw("schedule-list__item flex min-w-0 items-center gap-2 py-1.5 px-1.5 text-xs")} key={schedule.scheduleId}>
          <span className={tw("schedule-list__prompt min-w-0 overflow-hidden mr-auto [color:var(--foreground)] text-ellipsis whitespace-nowrap")} title={schedule.prompt}>{schedule.prompt}</span>
          <span className={tw("schedule-list__kind [flex-shrink:0] py-0 px-1.5 rounded-md [background:var(--surface-secondary)] [color:var(--text-secondary)] text-caption")}>{scheduleKindLabels[schedule.kind]}</span>
          <span className={tw("schedule-list__status [flex-shrink:0] [max-width:9rem] overflow-hidden [color:var(--text-secondary)] text-caption text-ellipsis whitespace-nowrap")}>{new Date(schedule.scheduledAt).toLocaleString()}</span>
        </li>
      ))}
    </ul>
  )
}

const monitorRowClassName = "flex min-h-7 min-w-0 items-center gap-2 text-compact text-[var(--foreground)]"
const monitorIconClassName = "grid size-5 shrink-0 place-items-center rounded bg-[var(--surface-secondary)] text-[var(--text-secondary)]"

function taskSkillNames(items: readonly LingTimelineItem[]): readonly string[] {
  const names = new Set<string>()
  for (const item of items) {
    for (const match of item.text.matchAll(/-\s+`([^`]+)`\s*:/g)) names.add(match[1] ?? '')
  }
  return [...names].filter(Boolean)
}

function taskWebLinks(items: readonly LingTimelineItem[]): readonly string[] {
  const links = new Set<string>()
  for (const item of items) {
    if (item.kind !== 'tool-activity') continue
    for (const match of `${item.text} ${item.detail ?? ''}`.matchAll(/https?:\/\/[^\s<>()[\]"']+/g)) {
      links.add((match[0] ?? '').replace(/[.,;:!?]+$/, ''))
    }
  }
  return [...links]
}

export function EnvironmentPanel({
  preferences,
  presentation,
  sideChats,
  onSelectSideChat,
  workspaceBranch,
  gitLineChanges,
  onGitOpen,
  onGitReview,
  recapRemoteTaskId,
  onOpenRecap,
  ...props
}: Pick<
  LingShellProps,
  'backgroundJobs'
  | 'changeDiff'
  | 'changeDiffLoading'
  | 'changeDiffMessage'
  | 'changes'
  | 'changesLoading'
  | 'changesMessage'
  | 'extensions'
  | 'knowledge'
  | 'loadAttachment'
  | 'mode'
  | 'onAddFiles'
  | 'onChangeDiffClose'
  | 'onChangeSelect'
  | 'onSubagentInterrupt'
  | 'onSubagentPrompt'
  | 'schedules'
  | 'schedulesLoading'
  | 'schedulesMessage'
  | 'selectedChange'
  | 'selectedTask'
  | 'subagents'
  | 'supportsSubagents'
  | 'timeline'
  | 'workspaces'
> & {
  readonly environmentPinned?: boolean
  readonly onEnvironmentPinToggle?: () => void
  readonly recapRemoteTaskId?: string
  readonly onOpenRecap?: (id: string) => void
  readonly onGitOpen?: () => void
  readonly onGitReview?: () => void
  readonly workspaceBranch?: string | null
  readonly gitLineChanges?: LingGitSnapshot['lineChanges']
  readonly preferences: MonitorPreferences
  readonly presentation: MonitorPreferences['presentation']
  readonly sideChats: readonly Pick<WorkbenchTab, 'id' | 'label'>[]
  readonly onSelectSideChat: (id: string) => void
}) {
  const behavior = useBehavior()
  const { selectedTask, workspaces } = props
  const subscribeNotes = useCallback((refresh: () => void) => {
    window.addEventListener(taskNotesEvent, refresh)
    window.addEventListener('storage', refresh)
    return () => { window.removeEventListener(taskNotesEvent, refresh); window.removeEventListener('storage', refresh) }
  }, [])
  const readNoteCount = () => {
    try { return selectedTask ? readTaskNotes(selectedTask.taskId).filter(note => !note.archived).length : 0 }
    catch { return 0 }
  }
  const noteCount = useSyncExternalStore(subscribeNotes, readNoteCount, readNoteCount)
  const [skills, setSkills] = useState<readonly LingSkill[]>([])
  const activeWorkspace = workspaces.find(workspace => workspace.workspaceId === selectedTask?.workspaceId)
  const attachments = props.timeline.flatMap(item => (item.attachments ?? []).map(attachment => ({ ...attachment, taskId: item.taskId })))
  const sourceInput = useRef<HTMLInputElement>(null)
  const [sourceError, setSourceError] = useState<string>()
  const [downloading, setDownloading] = useState<string>()
  const downloadSource = async (taskId: string, attachmentId: string, name: string) => {
    setSourceError(undefined); setDownloading(attachmentId)
    try {
      const result = await props.loadAttachment(taskId, attachmentId)
      if (!result.ok) { setSourceError(result.message); return }
      const url = URL.createObjectURL(new Blob([new Uint8Array(result.value.data)], { type: result.value.mediaType }))
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = name
      document.body.append(anchor); anchor.click(); anchor.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (cause) { setSourceError(cause instanceof Error ? cause.message : '附件下载失败。') }
    finally { setDownloading(undefined) }
  }
  const visibleSkillNames = skills.length > 0 ? skills.map(skill => skill.name) : taskSkillNames(props.timeline)
  const webLinks = taskWebLinks(props.timeline)
  const goal = props.mode?.goal
  const hasSubagents = props.supportsSubagents && selectedTask && props.subagents?.state === 'ready'
    && (props.subagents.subagents.length > 0 || props.subagents.unreadable.length > 0)
  const fixed = presentation === 'fixed'

  useEffect(() => {
    const readSkills = props.extensions?.readSkills
    setSkills([])
    if (!selectedTask || !readSkills) return
    const controller = new AbortController()
    void readSkills(selectedTask.taskId, controller.signal).then(result => {
      if (!controller.signal.aborted) setSkills(result.ok ? result.value : [])
    }).catch(() => { if (!controller.signal.aborted) setSkills([]) })
    return () => { controller.abort() }
  }, [props.extensions?.readSkills, selectedTask?.taskId])

  return <div className={tw('task-monitor min-w-0', fixed && 'pt-2')}>
    {!fixed ? <div className={tw("sticky top-0 z-2 flex h-10 items-center justify-between bg-[var(--surface)]")}>
      <h2 className={tw("m-0 text-compact font-medium text-[var(--text-secondary)]")}>任务监控</h2>
      <button aria-pressed={props.environmentPinned} aria-label={props.environmentPinned ? '取消固定任务监控' : '固定任务监控'} className={tw("grid size-control-xs place-items-center rounded-md border-0 bg-transparent p-0 text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] aria-pressed:text-[var(--foreground)]")} onClick={props.onEnvironmentPinToggle} title={props.environmentPinned ? '取消固定任务监控' : '固定任务监控'} type="button"><Icon active={props.environmentPinned} name="pin" size={14} /></button>
    </div> : null}
    {preferences.recap && selectedTask && onOpenRecap ? <TaskRecap key={`${recapRemoteTaskId ?? selectedTask.workspaceId}:${selectedTask.taskId}`} service={props.knowledge} workspaceId={selectedTask.workspaceId} remoteTaskId={recapRemoteTaskId} taskId={selectedTask.taskId} onOpen={onOpenRecap} /> : null}
    {preferences.goal && goal ? <MonitorSection title="任务目标"><p className={tw("mb-2 mt-0 break-words text-compact leading-6")}>{goal.objective}</p><span className={tw("text-caption text-[var(--text-tertiary)]")}>{goal.phase === 'complete' ? '已完成' : goal.phase === 'paused' ? '已暂停' : goal.phase === 'blocked' ? '已阻塞' : '进行中'} · 第 {goal.roundsStarted} / {goal.maxGoalRounds} 轮</span></MonitorSection> : null}
    {preferences.plan && (props.mode?.planActive || props.mode?.planPending) ? <MonitorSection title="计划"><div className={tw(monitorRowClassName)}><span className={tw(monitorIconClassName)}><Icon name="listCheck" size={14} /></span><span>{props.mode.planPending ? '等待确认' : '按计划执行'}</span></div></MonitorSection> : null}
    {behavior.modes[behavior.workMode].monitorEnvironment ? <MonitorSection title="环境信息">
      <div className={tw("grid gap-0.5")}>
        {gitLineChanges ? <button aria-label="审阅未提交更改" className={tw(monitorRowClassName, 'w-full rounded-md border-0 bg-transparent p-0 text-left hover:bg-[var(--surface-hover)]')} disabled={!onGitReview} onClick={onGitReview} type="button"><span className={tw(monitorIconClassName)}><Icon name="branch" size={14} /></span>{!fixed ? <span className={tw("text-[var(--text-secondary)]")}>未提交</span> : null}<span className={tw('flex gap-1.5 tabular-nums', !fixed && 'ml-auto')}><span className={tw("text-[var(--success)]")}>+{gitLineChanges.added.toLocaleString()}</span><span className={tw("text-[var(--danger)]")}>−{gitLineChanges.deleted.toLocaleString()}</span></span></button> : null}
        <div className={tw(monitorRowClassName)}><span className={tw(monitorIconClassName)}><Icon name="desktop" size={14} /></span><span>本地</span>{!fixed ? <span className={tw("ml-auto min-w-0 truncate text-[var(--text-secondary)]")} title={activeWorkspace?.label}>{activeWorkspace?.label ?? '未指定'}</span> : null}</div>
        {workspaceBranch ? <div className={tw(monitorRowClassName)}><span className={tw(monitorIconClassName)}><Icon name="branch" size={14} /></span>{!fixed ? <span className={tw("text-[var(--text-secondary)]")}>分支</span> : null}<span className={tw('min-w-0 truncate text-[var(--foreground)]', !fixed && 'ml-auto')} title={workspaceBranch}>{workspaceBranch}</span></div> : null}
        <button className={tw(monitorRowClassName, 'w-full border-0 bg-transparent p-0 text-left disabled:text-[var(--text-tertiary)]')} disabled={!onGitOpen} onClick={onGitOpen} title="Git：查看更改、提交或推送" type="button"><span className={tw(monitorIconClassName)}><Icon name="gitCommit" size={14} /></span><span>提交或推送</span></button>
      </div>
    </MonitorSection> : null}
    {preferences.subagents && hasSubagents ? <MonitorSection title="子智能体"><SubagentList catalog={props.subagents} onInterrupt={props.onSubagentInterrupt} onPrompt={props.onSubagentPrompt} /></MonitorSection> : null}
    {preferences.processes && props.backgroundJobs.length > 0 ? <MonitorSection title="后台进程"><BackgroundJobList jobs={props.backgroundJobs} /></MonitorSection> : null}
    {preferences.sideChats && sideChats.length > 0 ? <MonitorSection title="侧边聊天">{sideChats.map(chat => <button className={tw(monitorRowClassName, 'w-full rounded-md border-0 bg-transparent p-0 text-left hover:bg-[var(--surface-hover)]')} key={chat.id} onClick={() => { onSelectSideChat(chat.id) }} type="button"><span className={tw(monitorIconClassName)}><Icon name="sideChat" size={14} /></span><span className={tw("min-w-0 truncate")}>{chat.label}</span><Icon className={tw("ml-auto shrink-0 text-[var(--text-tertiary)]")} name="external" size={12} /></button>)}</MonitorSection> : null}
    {props.schedules?.length ? <MonitorSection title="定时提醒"><ScheduleList loading={props.schedulesLoading} message={props.schedulesMessage} schedules={props.schedules} /></MonitorSection> : null}
    {preferences.skills && visibleSkillNames.length > 0 ? <MonitorSection accessory={<span className={tw("shrink-0 text-caption text-[var(--text-tertiary)]")} title="当前任务可用的技能">可用 {visibleSkillNames.length}</span>} title="技能与 MCP">
      <ul className={tw("m-0 grid list-none gap-0.5 p-0")}>{visibleSkillNames.map(name => <li className={tw(monitorRowClassName)} key={name}><span className={tw(monitorIconClassName)}><Icon name="hammer" size={14} /></span><span className={tw("min-w-0 truncate")} title={name}>{name}</span></li>)}</ul>
    </MonitorSection> : null}
    {preferences.outputs && props.changes.some(change => change.files.length > 0) ? <MonitorSection title="产出" initiallyOpen={props.selectedChange !== undefined}>
      <ChangeReview changes={props.changes} diff={props.changeDiff} diffLoading={props.changeDiffLoading} diffMessage={props.changeDiffMessage} loading={props.changesLoading} message={props.changesMessage} onCloseDiff={props.onChangeDiffClose} onSelect={props.onChangeSelect} selection={props.selectedChange} />
    </MonitorSection> : null}
    {preferences.web && webLinks.length > 0 ? <MonitorSection initiallyOpen={false} title="网页查阅"><ul className={tw("m-0 grid list-none gap-0.5 p-0")}>{webLinks.slice(0, 8).map(link => <li key={link}><button type="button" onClick={() => requestBrowserNavigation(link)} className={tw(monitorRowClassName, 'w-full rounded-md border-0 bg-transparent p-0 text-left hover:bg-[var(--surface-hover)]')}><span className={tw(monitorIconClassName)}><Icon name="globe" size={14} /></span><span className={tw("min-w-0 truncate")} title={link}>{link}</span></button></li>)}</ul></MonitorSection> : null}
    {preferences.sources && attachments.length > 0 ? <MonitorSection accessory={<button aria-label="添加来源" className={tw("grid size-control-xs place-items-center rounded border-0 bg-transparent p-0 text-[var(--text-tertiary)]")} onClick={() => sourceInput.current?.click()} title="添加附件到输入框" type="button"><Icon name="plus" size={14} /></button>} title="来源" initiallyOpen={false}>
      <input ref={sourceInput} type="file" multiple hidden onChange={event => { const files = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = ''; if (files.length) props.onAddFiles(files) }} />
      {sourceError ? <p role="alert" className={tw('text-xs text-[var(--danger)]')}>{sourceError}</p> : null}
      <ul className={tw("m-0 grid list-none gap-1 p-0")}>{attachments.map((attachment, index) => <li className={tw(monitorRowClassName)} key={`${attachment.attachmentId}-${index}`}><button type="button" disabled={Boolean(downloading)} onClick={() => { void downloadSource(attachment.taskId, attachment.attachmentId, attachment.name) }} className={tw('flex w-full min-w-0 items-center gap-2 rounded-md border-0 bg-transparent p-0 text-left hover:bg-[var(--surface-hover)]')}><span className={tw(monitorIconClassName, 'text-[var(--focus)]')}><Icon name={attachment.kind === 'image' ? 'image' : 'file'} size={14} /></span><span className={tw("min-w-0 truncate")} title={attachment.name}>{attachment.name}</span><Icon name="download" size={12} className={tw('ml-auto shrink-0')} /></button></li>)}</ul>
    </MonitorSection> : null}
    {preferences.quickNotes && (behavior.quickNotes || behavior.replyAnnotations) && selectedTask && noteCount > 0 ? <button className={tw("flex h-control-lg w-full items-center justify-between border-0 bg-transparent p-0 text-left text-compact text-[var(--text-tertiary)]")} onClick={() => openTaskNotes(selectedTask.taskId)} title="打开任务速记" type="button"><span>Quick Notes</span><Icon name="external" size={13} /></button> : null}
  </div>
}
