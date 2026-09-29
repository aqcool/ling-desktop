import { saveTaskNote, openTaskNotes } from './TaskNotes.js'
import { useBehavior, formatElapsed, type BehaviorPreferences } from './behavior-preferences.js'
import { Button } from '@heroui/react/button'
import { Toolbar } from '@heroui/react/toolbar'
import { Tooltip } from '@heroui/react/tooltip'
import { createPortal } from 'react-dom'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type Ref, type ReactNode } from 'react'
import type {
  LingAttachmentContent,
  LingReadResult,
  LingRuntimeConnection,
  LingTimelineAttachment,
  LingTimelineItem,
  LingTaskChanges,
} from '../runtime/contract.js'
import { formatBytes } from './attachments.js'
import { Icon, type IconName } from './Icon.js'
import { ConversationChangeSummary, type ChangeSelection } from './ChangeReview.js'
import { Markdown, renderedMarkdownText } from './Markdown.js'
import { tw } from './tailwind.js'
import { Menu, MenuItem } from './Menu.js'

const connectionLabels: Record<LingRuntimeConnection['phase'], string> = {
  offline: '未连接',
  connecting: '正在连接',
  ready: '已连接',
  failed: '连接失败',
}

const timeFormat = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })

function formatTime(createdAt: string): string {
  const date = new Date(createdAt)
  return Number.isNaN(date.getTime()) ? '' : timeFormat.format(date)
}

interface ConversationProps {
  readonly latestChanges?: LingTaskChanges
  readonly onReviewChanges?: (selection: ChangeSelection) => void
  readonly items: readonly LingTimelineItem[]
  readonly connection: LingRuntimeConnection
  readonly demo: boolean
  readonly hasOlder: boolean
  readonly loadAttachment?: (
    taskId: string,
    attachmentId: string,
  ) => Promise<LingReadResult<LingAttachmentContent>>
  readonly loadingOlder: boolean
  readonly onLoadOlder: () => void
  readonly onForkAt?: (seq: number) => void | Promise<void>
  readonly onAddReply?: (text: string, preview: string) => void
  readonly onAskInSideTask?: (text: string, preview: string) => void
  readonly onReconnect: () => void
  readonly running: boolean
  readonly threadKey: string
}

interface AttachmentChipProps {
  readonly attachment: LingTimelineAttachment
  readonly inverted?: boolean
  readonly load?: (
    taskId: string,
    attachmentId: string,
  ) => Promise<LingReadResult<LingAttachmentContent>>
  readonly taskId: string
}

function AttachmentChip({ attachment, inverted = false, load, taskId }: AttachmentChipProps) {
  const [previewUrl, setPreviewUrl] = useState<string | undefined>(undefined)

  useEffect(() => {
    if (attachment.kind !== 'image' || load === undefined) return
    let active = true
    let created: string | undefined
    void load(taskId, attachment.attachmentId).then((result) => {
      if (!active || !result.ok) return
      created = URL.createObjectURL(new Blob([result.value.data.slice()], { type: result.value.mediaType }))
      setPreviewUrl(created)
    })
    return () => {
      active = false
      if (created !== undefined) URL.revokeObjectURL(created)
    }
  }, [attachment.attachmentId, attachment.kind, load, taskId])

  const meta = attachment.bytes !== undefined ? formatBytes(attachment.bytes) : attachment.mediaType
  const chip = (
    <span className={tw("timeline-item__attachment inline-flex max-w-64 items-center gap-1.5 rounded-lg border border-[var(--panel-border)] bg-[var(--surface-secondary)] px-2 py-1", inverted && "border-white/20 bg-white/8")} title={attachment.name}>
      <Icon name={attachment.kind === 'image' ? 'image' : 'file'} size={16} />
      <span className={tw("timeline-item__attachment-name overflow-hidden text-ellipsis whitespace-nowrap text-[0.73rem] text-[var(--foreground)]", inverted && "text-[#f4f4f2]")}>{attachment.name}</span>
      {meta ? <small className={tw("text-[0.65rem] text-[#a2a2a2]", inverted && "text-[#c9c9c4]")}>{meta}</small> : null}
    </span>
  )
  if (previewUrl === undefined) return chip
  return (
    <>
      {chip}
      <a className={tw("timeline-item__attachment-image mt-1.5 block")} href={previewUrl} rel="noreferrer" target="_blank">
        <img alt={attachment.name} className={tw("block max-h-[220px] max-w-[min(100%,320px)] rounded-lg border border-white/20 object-contain")} src={previewUrl} />
      </a>
    </>
  )
}

function Disclosure({ expanded, className, children }: { expanded: boolean; className: string; children: ReactNode }) {
  const [open, setOpen] = useState(expanded)
  useEffect(() => { setOpen(expanded) }, [expanded])
  return <details className={tw(className)} open={open} onToggle={event => { if (event.target === event.currentTarget) setOpen(event.currentTarget.open) }}>{children}</details>
}

function ServerExecutionView({ item, live, expanded }: { item: LingTimelineItem; live: boolean; expanded: boolean }) {
  const execution = item.execution!
  const output = useRef<HTMLPreElement>(null)
  const following = useRef(true)
  const active = execution.status === 'running' && live
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (!active) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [active])
  useEffect(() => { if (output.current && following.current) output.current.scrollTop = output.current.scrollHeight }, [execution.output])
  const status = active ? `执行中 · ${Math.max(0, Math.floor((now - Date.parse(item.createdAt)) / 1000))} 秒`
    : execution.status === 'completed' ? '已完成' : execution.status === 'failed' ? '执行失败' : '已停止'
  return <Disclosure expanded={active || execution.status === 'failed' || expanded} className={tw('group/execution min-w-0 rounded-lg border border-[var(--panel-border)] text-xs')}>
    <summary className={tw('flex min-h-9 cursor-pointer list-none items-center gap-2 rounded-lg px-3 py-2 text-[var(--text-secondary)]')}>
      <Icon name="terminal" size={14} className={tw('shrink-0')} />
      <span className={tw('min-w-0 flex-1 break-words font-medium text-[var(--foreground)]')}>{execution.summary || '执行远端命令'}</span>
      <span role="status" className={tw('shrink-0 tabular-nums', execution.status === 'failed' && 'text-[var(--danger)]')}>{status}</span>
      <Icon name="chevronRight" size={12} className={tw('shrink-0 transition-transform group-open/execution:rotate-90')} />
    </summary>
    <div className={tw('grid min-w-0 gap-2 px-3 pb-3')}>
      <div className={tw('break-words leading-5 text-[var(--text-tertiary)]')}>{execution.server} · <span className={tw('font-mono')}>{execution.cwd}</span></div>
      <details className={tw('text-[var(--text-secondary)]')}><summary className={tw('w-fit cursor-pointer')}>查看命令</summary><pre className={tw('mb-0 mt-2 max-h-32 overflow-auto whitespace-pre-wrap break-words font-mono leading-5')}>{execution.command}</pre></details>
      <pre ref={output} aria-label="命令输出" tabIndex={0} onScroll={event => { const el = event.currentTarget; following.current = el.scrollHeight - el.scrollTop - el.clientHeight < 32 }} className={tw('m-0 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-md bg-[var(--surface-secondary)] p-2.5 font-mono text-xs leading-5 text-[var(--text-secondary)]')}>{execution.output || (active ? '等待命令输出…' : '无输出')}</pre>
      {execution.error ? <p role="alert" className={tw('m-0 break-words leading-5 text-[var(--danger)]')}>{execution.error}</p> : null}
      {execution.exitCode !== undefined && execution.exitCode !== 0 ? <p className={tw('m-0 text-[var(--danger)]')}>退出码 {execution.exitCode}</p> : null}
    </div>
  </Disclosure>
}

function ThinkingStatus({ running, start, preferences }: { running: boolean; start: number; preferences: BehaviorPreferences }) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => { setNow(Date.now()); if (!running) return; const timer = setInterval(() => setNow(Date.now()), 100); return () => clearInterval(timer) }, [running])
  const phrase = preferences.thinkingPhrases[Math.floor(Math.max(0, now - start) / 4000) % preferences.thinkingPhrases.length]
  return <div className={tw('flex min-h-6 items-center gap-2 px-2 text-xs text-[var(--text-tertiary)]')} role={running ? 'status' : undefined}>
    {running ? <>{preferences.thinkingLoader === 'matrix' ? <span aria-hidden="true" className={tw('grid size-3 grid-cols-3 gap-px')}>{Array.from({ length: 9 }, (_, i) => <span className={tw('size-0.5 animate-pulse bg-current motion-reduce:animate-none')} style={{ animationDelay: `${i * 170}ms` }} key={i} />)}</span> : preferences.thinkingLoader === 'spinner' ? <Icon aria-hidden name="refresh" className={tw('animate-spin motion-reduce:animate-none')} size={12} /> : preferences.thinkingLoader === 'dots' ? <span aria-hidden="true" className={tw('flex gap-0.5')}>{[0, 1, 2].map(i => <span className={tw('size-1 animate-bounce rounded-full bg-current motion-reduce:animate-none')} style={{ animationDelay: `${i * 150}ms` }} key={i} />)}</span> : null}<span>{phrase}</span></> : null}
    <span className={tw('tabular-nums')}>{formatElapsed(now - start, preferences.elapsedFormat)}</span>
  </div>
}

const actionButtonClass = 'size-6 min-h-0 min-w-0 shrink-0 rounded-md border-0 bg-transparent p-0 text-[var(--text-tertiary)] shadow-none hover:bg-[var(--surface-hover)] data-[hovered=true]:bg-[var(--surface-hover)] data-[pressed=true]:scale-100'

export interface SelectionToolbarRect {
  readonly bottom: number
  readonly left: number
  readonly right: number
  readonly top: number
}

export interface SelectionToolbarSize {
  readonly height: number
  readonly width: number
}

export interface SelectionToolbarPlacement {
  readonly left: number
  readonly side: 'bottom' | 'top'
  readonly top: number
}

const selectionToolbarEdge = 8
const selectionToolbarGap = 4
const selectionToolbarCompactThreshold = 440

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max))

/** Center on the complete selection; when that would overflow, align to its nearest edge. */
export function placeSelectionToolbar(
  selection: SelectionToolbarRect,
  toolbar: SelectionToolbarSize,
  bounds: SelectionToolbarRect,
): SelectionToolbarPlacement {
  const minimumLeft = bounds.left + selectionToolbarEdge
  const maximumLeft = Math.max(minimumLeft, bounds.right - toolbar.width - selectionToolbarEdge)
  const centeredLeft = selection.left + (selection.right - selection.left - toolbar.width) / 2
  const candidateLeft = centeredLeft < minimumLeft
    ? selection.left
    : centeredLeft > maximumLeft
      ? selection.right - toolbar.width
      : centeredLeft
  const left = clamp(candidateLeft, minimumLeft, maximumLeft)
  const minimumTop = bounds.top + selectionToolbarEdge
  const maximumTop = Math.max(minimumTop, bounds.bottom - toolbar.height - selectionToolbarEdge)
  const above = selection.top - toolbar.height - selectionToolbarGap
  if (above >= minimumTop) return { left, side: 'top', top: above }
  const below = selection.bottom + selectionToolbarGap
  return { left, side: 'bottom', top: clamp(below, minimumTop, maximumTop) }
}

interface ConversationSelection {
  readonly rect: SelectionToolbarRect
  readonly taskId: string
  readonly text: string
}

function SelectionToolbar({ selection, container, onAddReply, onAskInSideTask, onDismiss }: {
  readonly selection: ConversationSelection
  readonly container: HTMLElement | null
  readonly onAddReply?: (text: string, preview: string) => void
  readonly onAskInSideTask?: (text: string, preview: string) => void
  readonly onDismiss: () => void
}) {
  const behavior = useBehavior()
  const toolbarRef = useRef<HTMLDivElement>(null)
  const [copied, setCopied] = useState(false)
  const [compact, setCompact] = useState(false)
  const [message, setMessage] = useState('')
  const [placement, setPlacement] = useState<SelectionToolbarPlacement>()

  const measure = useCallback(() => {
    const toolbar = toolbarRef.current
    if (!toolbar || !container) return
    const containerRect = container.getBoundingClientRect()
    const bounds = {
      bottom: Math.min(containerRect.bottom, window.innerHeight),
      left: Math.max(containerRect.left, 0),
      right: Math.min(containerRect.right, window.innerWidth),
      top: Math.max(containerRect.top, 0),
    }
    const shouldCompact = bounds.right - bounds.left < selectionToolbarCompactThreshold
    setCompact(current => current === shouldCompact ? current : shouldCompact)
    const measured = toolbar.getBoundingClientRect()
    setPlacement(placeSelectionToolbar(selection.rect, { height: measured.height, width: measured.width }, bounds))
  }, [container, selection.rect])

  useLayoutEffect(() => {
    measure()
    const observer = new ResizeObserver(measure)
    if (toolbarRef.current) observer.observe(toolbarRef.current)
    window.addEventListener('resize', measure)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [measure])

  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => { setCopied(false) }, 1600)
    return () => { window.clearTimeout(timer) }
  }, [copied])

  const copy = () => {
    if (!navigator.clipboard) {
      setMessage('复制不可用，请重试。')
      return
    }
    void navigator.clipboard.writeText(selection.text).then(
      () => { setCopied(true); setMessage('') },
      () => { setMessage('复制失败，请重试。') },
    )
  }
  const addToNotes = () => {
    try {
      saveTaskNote(selection.taskId, selection.text)
      openTaskNotes(selection.taskId)
      onDismiss()
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : '速记保存失败，请重试。') }
  }
  // Keep this lighter than the composer and message cards: it is a temporary
  // selection affordance, rather than a second surface in the conversation.
  const buttonClass = 'h-7 min-h-7 shrink-0 gap-1 rounded-lg border-0 bg-transparent px-2 text-xs font-normal leading-4 text-[var(--text-secondary)] shadow-none hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)] data-[hovered=true]:bg-[var(--surface-hover)] data-[pressed=true]:scale-100 focus-visible:ring-2 focus-visible:ring-[var(--focus)]'

  if (typeof document === 'undefined') return null
  return createPortal(
    <div
      ref={toolbarRef}
      data-selection-toolbar
      className={tw('fixed z-50 max-w-[calc(100vw_-_1rem)]')}
      onPointerDown={event => { event.preventDefault() }}
      style={placement ? { left: placement.left, top: placement.top } : { left: 0, top: 0, visibility: 'hidden' }}
    >
      <Toolbar aria-label="选中文字操作" className={tw('flex w-max max-w-full flex-nowrap items-center gap-0.5 rounded-xl border border-[var(--panel-border)] bg-[var(--surface)] p-1 shadow-[0_2px_8px_rgb(15_23_42_/_0.10)]')}>
        <Button aria-label={copied ? '已复制文本' : '复制文本'} className={tw(buttonClass)} onPress={copy} size="sm" variant="ghost">
          <Icon name={copied ? 'check' : 'copy'} size={14} />{copied ? '已复制' : '复制文本'}
        </Button>
        {onAddReply ? <Button aria-label="添加到任务" className={tw(buttonClass, 'bg-[var(--surface-secondary)] hover:bg-[var(--surface-hover)]')} onPress={() => { onAddReply(selection.text, selection.text); onDismiss() }} size="sm" variant="ghost">
          <Icon name="quote" size={14} />添加到任务
        </Button> : null}
        {!compact && onAskInSideTask ? <Button aria-label="在侧边任务中提问" className={tw(buttonClass)} onPress={() => { onAskInSideTask(selection.text, selection.text); onDismiss() }} size="sm" variant="ghost">
          <Icon name="sideChat" size={14} />在侧边任务中提问
        </Button> : null}
        {!compact && behavior.quickNotes ? <Button aria-label="添加到速记板" className={tw(buttonClass)} onPress={addToNotes} size="sm" variant="ghost">
          <Icon name="book" size={14} />添加到速记板
        </Button> : null}
        {compact && (onAskInSideTask || behavior.quickNotes) ? <Menu align="end" side="top" triggerAriaLabel="更多选中文字操作" triggerClassName={tw('size-7 min-h-7 min-w-7 rounded-lg p-0')} triggerLabel={<Icon name="more" size={14} />} listClassName={tw('min-w-44')}>
          {onAskInSideTask ? <MenuItem icon="sideChat" onPress={() => { onAskInSideTask(selection.text, selection.text); onDismiss() }}>在侧边任务中提问</MenuItem> : null}
          {behavior.quickNotes ? <MenuItem icon="book" onPress={addToNotes}>添加到速记板</MenuItem> : null}
        </Menu> : null}
      </Toolbar>
      {message ? <span className={tw('sr-only')} role="status">{message}</span> : null}
    </div>,
    document.body,
  )
}

function MessageActions({ item, plainText, onForkAt, onAddReply, forkDisabled }: {
  item: LingTimelineItem
  plainText: () => string
  onForkAt?: (seq: number) => void | Promise<void>
  onAddReply?: (text: string, preview: string) => void
  forkDisabled?: boolean
}) {
  const assistant = item.kind === 'assistant-message'
  const behavior = useBehavior()
  const [copied, setCopied] = useState<'plain' | 'markdown'>()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(undefined), 1600)
    return () => clearTimeout(timer)
  }, [copied])
  const copy = async (format: 'plain' | 'markdown') => {
    try { await navigator.clipboard.writeText(format === 'markdown' ? item.text : plainText()); setCopied(format); setError('') }
    catch { setError('复制失败，请重试') }
  }
  const fork = async () => {
    if (pending || forkDisabled || item.seq === undefined || !onForkAt) return
    setPending(true)
    try { await onForkAt(item.seq); setError('') }
    catch { setError('无法创建分支任务，请重试') }
    finally { setPending(false) }
  }
  const action = (label: string, icon: IconName, onPress: () => void, options: { disabled?: boolean; color?: string; hint?: string } = {}) => (
    <Tooltip delay={300}>
      <Button aria-label={label} isDisabled={options.disabled} isIconOnly size="sm" variant="ghost"
        className={tw(actionButtonClass, options.color)} onPress={onPress}>
        <Icon name={icon} size={16} />
      </Button>
      <Tooltip.Content placement="top" className={tw('rounded-md px-2 py-1 text-xs')}>{options.hint ?? label}</Tooltip.Content>
    </Tooltip>
  )
  const time = formatTime(item.createdAt)
  return <div aria-label={assistant ? '回复操作' : '消息操作'} role="group" className={tw('mt-1 flex min-h-6 flex-wrap items-center gap-0.5 text-[11px] text-[var(--text-tertiary)]', !assistant && 'opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100')}>
    {item.text ? action(copied === 'plain' ? '已复制消息' : '复制消息', copied === 'plain' ? 'check' : 'copy', () => { void copy('plain') }, { hint: copied === 'plain' ? '已复制文本' : '复制文本', color: copied === 'plain' ? 'text-[var(--success)]' : undefined }) : null}
    {onForkAt && item.seq !== undefined ? action(pending ? '正在创建分支任务' : '从这条消息分叉', assistant ? 'replyBranch' : 'fork', () => { void fork() }, { disabled: pending || forkDisabled, hint: forkDisabled ? '任务运行结束后可创建分支任务' : '从此处创建新的分支任务' }) : null}
    {assistant ? <Menu triggerAriaLabel="更多回复操作" triggerLabel={<Icon name="more" size={16} />} triggerClassName={tw(actionButtonClass)} listClassName={tw('min-w-44')} side="top">
      <MenuItem icon="markdown" onPress={() => { void copy('markdown') }}>{copied === 'markdown' ? '已复制 Markdown' : '复制 Markdown'}</MenuItem>
      {behavior.quickNotes ? <MenuItem icon="book" onPress={() => { try { const selected = window.getSelection()?.toString().trim(); const content = plainText(); saveTaskNote(item.taskId, selected && content.includes(selected) ? selected : item.text); openTaskNotes(item.taskId) } catch (cause) { setError(cause instanceof Error ? cause.message : '速记保存失败') } }}>保存到速记</MenuItem> : null}
      {onAddReply ? <MenuItem icon="quote" onPress={() => { onAddReply(item.text, plainText()) }}>添加回复到任务</MenuItem> : null}
    </Menu> : null}
    {item.status === 'interrupted' ? <span className={tw('ml-1')}>已停止</span> : null}
    {time ? <time className={tw('ml-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100')} dateTime={item.createdAt} title={item.createdAt}>{time}</time> : null}
    {error ? <span role="status">{error}</span> : null}
  </div>
}

function TimelineRow({
  item,
  loadAttachment,
  onForkAt,
  onAddReply,
  forkDisabled,
  articleRef,
  showActions = false,
  expandTools = false,
  live = false,
}: {
  readonly item: LingTimelineItem
  readonly showActions?: boolean
  readonly expandTools?: boolean
  readonly articleRef?: Ref<HTMLElement>
  readonly loadAttachment?: (
    taskId: string,
    attachmentId: string,
  ) => Promise<LingReadResult<LingAttachmentContent>>
  readonly onForkAt?: (seq: number) => void | Promise<void>
  readonly onAddReply?: (text: string, preview: string) => void
  readonly forkDisabled?: boolean
  readonly live?: boolean
}) {
  const textRef = useRef<HTMLDivElement>(null)
  const isUser = item.kind === 'user-message'
  const isProcess = item.kind === 'system-notice' || item.kind === 'tool-activity'
  const detailLabel = item.kind === 'tool-activity' ? '执行详情' : '思考过程'
  if (item.execution) return <ServerExecutionView item={item} live={live} expanded={expandTools} />
  if (isProcess && item.status === 'failed') {
    const missingCredential = item.title === 'MISSING_CREDENTIAL'
    return <article className={tw("timeline-item rounded-xl border border-[var(--panel-border)] p-4")} data-status="failed">
      <div className={tw("flex items-center gap-2 text-sm font-medium")}><Icon className={tw("shrink-0 text-[var(--warning)]")} name="bolt" size={17} />{missingCredential ? '模型尚未配置' : '任务未能完成'}</div>
      <p className={tw("mb-0 mt-2 text-[13px] leading-6 text-[var(--text-secondary)]")}>{missingCredential ? '请在模型设置中配置凭据后重试。' : item.title ?? '查看详情以了解原因。'}</p>
      <details className={tw("mt-3 text-xs text-[var(--text-tertiary)]")}>
        <summary className={tw("w-fit cursor-pointer rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]")}>查看错误详情</summary>
        <pre className={tw("mb-0 mt-2 max-h-60 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-[var(--surface-secondary)] p-3 text-xs leading-5")}>{[item.text, item.detail].filter(Boolean).join('\n\n')}</pre>
      </details>
    </article>
  }
  if (isProcess) return <Disclosure expanded={expandTools} className={tw("group/activity min-w-0 rounded-lg text-[var(--text-secondary)]")}>
    <summary className={tw("flex min-h-8 cursor-pointer list-none items-center gap-2 rounded-md px-2 py-1 text-[13px] leading-5 hover:bg-[var(--surface-hover)]")}>
      <Icon className={tw("shrink-0 text-[var(--text-tertiary)]")} name={item.kind === 'tool-activity' ? 'terminal' : 'file'} size={14} />
      <span className={tw("min-w-0 flex-1 truncate")} title={item.title}>{item.title ?? detailLabel}</span>
      {item.status === 'running' && live ? <span className={tw("text-xs text-[var(--text-tertiary)]")}>进行中</span> : null}
      <Icon className={tw("shrink-0 text-[var(--text-tertiary)] transition-transform group-open/activity:rotate-90")} name="chevronRight" size={12} />
    </summary>
    <pre className={tw("mx-2 mb-2 mt-1 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md bg-[var(--surface-secondary)] p-3 font-mono text-xs leading-5")}>{[item.text, item.detail].filter(Boolean).join('\n\n')}</pre>
  </Disclosure>
  return (
    <article className={tw(
      "timeline-item group relative flex min-w-0 max-w-full items-start gap-2 px-2 text-[var(--foreground)]",
      isUser && "timeline-item--user-message max-w-[min(47rem,100%)] justify-self-end px-0",
    )} data-conversation-message={item.itemId} data-status={item.status} data-task-id={item.taskId} ref={articleRef}>
      <div className={tw("timeline-item__body min-w-0 flex-1", isUser && "flex flex-col items-end")}>
        <div className={tw("min-w-0 max-w-full", isUser && "rounded-2xl [corner-shape:squircle] bg-[var(--surface-secondary)] px-[13px] py-2.5")} >
        {item.title ? <div className={tw("mb-1 flex min-w-0 items-center gap-2 text-xs")}>
          <strong className={tw("min-w-0 truncate font-medium")} title={item.title}>{item.title ?? detailLabel}</strong>

        </div> : null}
        {item.detail?.trim() ? <details className={tw("group/reasoning mb-3 min-w-0 text-[var(--text-secondary)]")} data-reasoning data-state={item.reasoningStreaming && live ? 'running' : 'completed'}>
          <summary className={tw("flex min-h-7 cursor-pointer list-none items-center gap-2 rounded-md text-[13px] leading-5 outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]")}>
            <Icon className={tw("shrink-0", item.reasoningStreaming && live && "animate-pulse")} name="sparkle" size={14} />
            <span className={tw("shrink-0")}>{item.reasoningStreaming && live ? '正在思考' : '思考过程'}</span>
            <Icon className={tw("shrink-0 transition-transform group-open/reasoning:rotate-90")} name="chevronRight" size={12} />
            <span className={tw("min-w-0 truncate text-[var(--text-tertiary)] group-open/reasoning:hidden")}>{(item.reasoningStreaming && live ? item.detail.trimEnd().split('\n').at(-1) : item.detail.trimStart().split('\n')[0])?.replaceAll('**', '')}</span>
          </summary>
          <div className={tw("mt-2 border-l border-[var(--panel-border)] pl-4")}><Markdown source={item.detail} subdued /></div>
        </details> : null}
        {item.text ? <div data-conversation-text ref={textRef}>{(isUser ? <p className={tw("m-0 whitespace-pre-wrap break-words text-xs font-normal leading-4 [overflow-wrap:anywhere]")}>{item.text}</p> : <Markdown chat source={item.text} />)}</div> : null}
        {(item.attachments?.length ?? 0) > 0 ? <div className={tw("mt-2 flex flex-wrap gap-1.5")}>
          {item.attachments?.map(attachment => <AttachmentChip attachment={attachment} key={attachment.attachmentId} load={loadAttachment} taskId={item.taskId} />)}
        </div> : null}

        </div>
        {(isUser || showActions) ? <MessageActions item={item} plainText={() => !isUser && textRef.current ? renderedMarkdownText(textRef.current) : item.text} onForkAt={onForkAt} onAddReply={onAddReply} forkDisabled={forkDisabled} /> : null}
      </div>
      {item.streaming && live ? <span className={tw("mt-1 h-4 w-1 shrink-0 animate-pulse bg-current")} aria-hidden="true" /> : null}
    </article>
  )
}

/** Keep consecutive runtime context and tool events together, without hiding failures. */
export function groupTimeline(items: readonly LingTimelineItem[]): readonly { readonly process: boolean; readonly items: readonly LingTimelineItem[] }[] {
  const groups: { process: boolean; items: LingTimelineItem[] }[] = []
  for (const item of items) {
    const process = (item.kind === 'system-notice' || item.kind === 'tool-activity') && item.status !== 'failed'
    const previous = groups.at(-1)
    if (process && previous?.process) previous.items.push(item)
    else groups.push({ process, items: [item] })
  }
  return groups
}

/** Legacy/demo adapters lack turn metadata; keep one footer per settled exchange. */
function replyActionIds(items: readonly LingTimelineItem[], running: boolean): ReadonlySet<string> {
  const ids = new Set<string>()
  let lastReply: LingTimelineItem | undefined
  const finish = (active: boolean) => {
    if (lastReply && !active && !lastReply.streaming && lastReply.status !== 'running' && lastReply.text.trim() && lastReply.turnComplete === undefined) ids.add(lastReply.itemId)
    lastReply = undefined
  }
  for (const item of items) {
    if (item.kind === 'user-message') finish(false)
    if (item.kind === 'assistant-message') {
      lastReply = item
      if (item.turnComplete && !item.streaming && item.status !== 'running' && item.text.trim()) ids.add(item.itemId)
    }
  }
  finish(running)
  return ids
}

export function displayTimeline(items: readonly LingTimelineItem[], running: boolean, collapse: boolean) {
  // Permission changes are reflected in the composer, not conversation content.
  items = items.filter(item => !(item.kind === 'tool-activity' && item.title === '/permission' && item.status === 'completed'))
  if (!collapse) return groupTimeline(items)
  const finals = replyActionIds(items, running)
  const groups: { process: boolean; items: LingTimelineItem[] }[] = []
  const lastUser = items.findLastIndex(item => item.kind === 'user-message')
  for (const [index, item] of items.entries()) {
    const process = item.status !== 'failed' && item.kind !== 'user-message' && !finals.has(item.itemId) && (index < lastUser || !running)
      || (item.status !== 'failed' && (item.kind === 'tool-activity' || item.kind === 'system-notice'))
    if (process && groups.at(-1)?.process) groups.at(-1)!.items.push(item)
    else groups.push({ process, items: [item] })
  }
  return groups
}

interface ConversationAnchor {
  readonly itemId: string
  readonly title: string
  readonly excerpt: string
}

function previewText(text: string): string {
  return text.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s*(?:#{1,6} |>|[-*+] |\d+\. )/gm, '')
    .replace(/```[^\n]*\n/g, '').replace(/```/g, '').replace(/(\*\*|__|~~)(.*?)\1/g, '$2').replace(/`([^`]+)`/g, '$1')
    .replace(/\s+/g, ' ').trim()
}

/** Each user turn owns its assistant replies; runtime context never becomes a preview. */
export function conversationAnchors(items: readonly LingTimelineItem[]): readonly ConversationAnchor[] {
  const anchors: { itemId: string; title: string; excerpt: string }[] = []
  for (const item of items) {
    if (item.kind === 'user-message') {
      anchors.push({
        itemId: item.itemId,
        title: previewText(item.text || item.title || item.attachments?.map(attachment => attachment.name).join('、') || '附件消息').slice(0, 200),
        excerpt: '',
      })
    } else if (item.kind === 'assistant-message') {
      const anchor = anchors.at(-1)
      if (anchor && anchor.excerpt.length < 400) {
        anchor.excerpt = [anchor.excerpt, previewText(item.text)].filter(Boolean).join(' ').slice(0, 400)
      }
    }
  }
  return anchors
}

function MessageAnchors({ anchors, activeId, onNavigate }: {
  readonly anchors: readonly ConversationAnchor[]
  readonly activeId: string | undefined
  readonly onNavigate: (itemId: string) => void
}) {
  const [hovered, setHovered] = useState<number | undefined>()
  if (anchors.length < 2) return null
  return <nav aria-label="消息锚点" className={tw("absolute inset-y-4 right-2 z-1 flex w-6 items-center")}>
    <div className={tw("flex max-h-full w-full flex-col overflow-y-auto overscroll-contain [scrollbar-width:none]")}>
      {anchors.map((anchor, index) => {
        const distance = hovered === undefined ? Infinity : Math.abs(index - hovered)
        return <Tooltip closeDelay={0} delay={100} key={anchor.itemId} shouldSkipAnimation>
          <Button aria-current={activeId === anchor.itemId ? 'location' : undefined} aria-label={`定位消息：${anchor.title}`}
            className={tw("h-3.5 min-h-0 w-6 min-w-0 shrink-0 justify-end rounded-sm bg-transparent p-0 shadow-none hover:bg-transparent data-[hovered=true]:bg-transparent data-[pressed=true]:scale-100")}
            onBlur={() => { setHovered(undefined) }} onFocus={() => { setHovered(index) }}
            onHoverStart={() => { setHovered(index) }} onHoverEnd={() => { setHovered(undefined) }}
            onPress={() => { onNavigate(anchor.itemId) }} variant="ghost">
            <span aria-hidden="true" className={tw("h-0.5 w-1.5 bg-[var(--text-tertiary)] opacity-35 transition-[width,opacity] duration-150 motion-reduce:transition-none",
              activeId === anchor.itemId && "w-2.5 opacity-65", distance === 2 && "w-2.5", distance === 1 && "w-3.5", distance === 0 && "w-5 opacity-75")} />
          </Button>
          <Tooltip.Content className={tw("block w-70 max-w-[calc(100vw_-_3rem)] rounded-lg border border-[var(--panel-border)] bg-[var(--surface)] px-3.5 py-3 text-left text-[var(--foreground)] shadow-[0_6px_14px_rgb(0_0_0_/_0.13)]")} offset={12} placement="left">
            <p className={tw("m-0 truncate text-sm font-semibold leading-5")}>{anchor.title}</p>
            {anchor.excerpt ? <p className={tw("m-0 mt-1 line-clamp-3 break-words text-[13px] font-normal leading-[22px] text-[var(--text-secondary)]")}>{anchor.excerpt}</p> : null}
          </Tooltip.Content>
        </Tooltip>
      })}
    </div>
  </nav>
}

export function Conversation({
  items,
  latestChanges,
  onReviewChanges,
  connection,
  demo,
  hasOlder,
  loadAttachment,
  loadingOlder,
  onLoadOlder,
  onForkAt,
  onAddReply,
  onAskInSideTask,
  onReconnect,
  running,
  threadKey,
}: ConversationProps) {
  const preferences = useBehavior()
  const latestUser = items.findLast(item => item.kind === 'user-message')
  const previousUser = useRef({ thread: threadKey, id: latestUser?.itemId })
  const readingAnchor = useRef<string | undefined>(undefined)
  const [readingSpace, setReadingSpace] = useState(0)
  const clockStart = useRef<{ thread: string; start: number } | undefined>(undefined)
  const wasRunning = useRef(false)
  if (running && (!wasRunning.current || !clockStart.current || clockStart.current.thread !== threadKey || clockStart.current.start < (Date.parse(latestUser?.createdAt ?? '') || 0))) clockStart.current = { thread: threadKey, start: Date.now() }
  wasRunning.current = running
  const scrollRef = useRef<HTMLDivElement>(null)
  const [selection, setSelection] = useState<ConversationSelection>()
  const anchorRef = useRef({ firstItemId: '', height: 0, threadKey: '' })
  const [following, setFollowing] = useState(true)
  const inspecting = useRef(false)
  const messageRefs = useRef(new Map<string, HTMLElement>())
  const anchors = useMemo(() => conversationAnchors(items), [items])
  const actionIds = useMemo(() => replyActionIds(items, running), [items, running])
  const liveItemIds = useMemo(() => {
    if (!running) return new Set<string>()
    const boundary = items.findLastIndex(item => item.kind === 'user-message' || item.status === 'failed' || item.status === 'interrupted' || item.turnComplete)
    return new Set(items.slice(boundary + 1).map(item => item.itemId))
  }, [items, running])
  const [activeAnchor, setActiveAnchor] = useState<string>()
  const dismissSelection = useCallback(() => {
    window.getSelection()?.removeAllRanges()
    setSelection(undefined)
  }, [])
  const captureSelection = useCallback(() => {
    const stream = scrollRef.current
    const nativeSelection = window.getSelection()
    if (!stream || !nativeSelection || nativeSelection.rangeCount !== 1 || nativeSelection.isCollapsed) {
      setSelection(undefined)
      return
    }
    const text = nativeSelection.toString().trim()
    const range = nativeSelection.getRangeAt(0)
    const elementFor = (node: Node) => node.nodeType === Node.ELEMENT_NODE ? node as HTMLElement : node.parentElement
    const start = elementFor(range.startContainer)
    const end = elementFor(range.endContainer)
    const startText = start?.closest<HTMLElement>('[data-conversation-text]')
    const endText = end?.closest<HTMLElement>('[data-conversation-text]')
    const message = startText?.closest<HTMLElement>('[data-conversation-message]')
    if (!text || !startText || startText !== endText || !message || !stream.contains(startText)
      || start?.closest('[data-copy-ignore]') || end?.closest('[data-copy-ignore]')) {
      setSelection(undefined)
      return
    }
    const rect = range.getBoundingClientRect()
    const streamRect = stream.getBoundingClientRect()
    if ((rect.width === 0 && rect.height === 0) || rect.bottom < streamRect.top || rect.top > streamRect.bottom || rect.right < streamRect.left || rect.left > streamRect.right) {
      setSelection(undefined)
      return
    }
    const taskId = message.dataset.taskId
    if (!taskId) {
      setSelection(undefined)
      return
    }
    setSelection({
      rect: { bottom: rect.bottom, left: rect.left, right: rect.right, top: rect.top },
      taskId,
      text,
    })
  }, [])

  useEffect(() => {
    document.addEventListener('selectionchange', captureSelection)
    window.addEventListener('resize', captureSelection)
    return () => {
      document.removeEventListener('selectionchange', captureSelection)
      window.removeEventListener('resize', captureSelection)
    }
  }, [captureSelection])

  useEffect(() => { dismissSelection() }, [dismissSelection, threadKey])

  const updateActiveAnchor = useCallback(() => {
    const node = scrollRef.current
    if (!node) return
    const top = node.getBoundingClientRect().top + 32
    let current = anchors[0]?.itemId
    for (const anchor of anchors) {
      const row = messageRefs.current.get(anchor.itemId)
      if (row && row.getBoundingClientRect().top <= top) current = anchor.itemId
    }
    if (node.scrollHeight - node.scrollTop - node.clientHeight < 2) current = anchors.at(-1)?.itemId
    setActiveAnchor(current)
  }, [anchors])

  useEffect(() => {
    const node = scrollRef.current
    if (!node) return
    const observer = new ResizeObserver(() => {
      if (following && !inspecting.current && !readingAnchor.current) node.scrollTop = node.scrollHeight
      updateActiveAnchor()
    })
    observer.observe(node)
    for (const child of node.children) observer.observe(child)
    updateActiveAnchor()
    return () => { observer.disconnect() }
  }, [items, following, updateActiveAnchor])

  const navigateToMessage = (itemId: string) => {
    const node = scrollRef.current
    const row = messageRefs.current.get(itemId)
    if (!node || !row) return
    inspecting.current = true
    setFollowing(false)
    node.scrollTop += row.getBoundingClientRect().top - node.getBoundingClientRect().top - 24
    setActiveAnchor(itemId)
  }

  const nearBottom = () => {
    const node = scrollRef.current
    if (!node) return true
    return node.scrollHeight - node.scrollTop - node.clientHeight < 120
  }

  useLayoutEffect(() => {
    const node = scrollRef.current
    if (!node) return
    if (!preferences.readingStart || previousUser.current.thread !== threadKey) { readingAnchor.current = undefined; if (readingSpace) setReadingSpace(0) }
    if (preferences.readingStart && (previousUser.current.thread === threadKey || previousUser.current.thread === 'new') && previousUser.current.id !== latestUser?.itemId && latestUser) {
      readingAnchor.current = latestUser.itemId
      inspecting.current = true
      setFollowing(false)
      setReadingSpace(Math.max(0, node.clientHeight - 100))
    }
    previousUser.current = { thread: threadKey, id: latestUser?.itemId }
    const pinned = readingAnchor.current && messageRefs.current.get(readingAnchor.current)
    if (pinned && readingSpace) node.scrollTop += pinned.getBoundingClientRect().top - node.getBoundingClientRect().top - 16
    const previous = anchorRef.current
    const firstItemId = items[0]?.itemId ?? ''

    if (readingAnchor.current) {
      // Keep the sent message at the reading origin as its reply grows.
    } else if (previous.threadKey !== threadKey) {
      inspecting.current = false
      if (!following) setFollowing(true)
      node.scrollTop = node.scrollHeight
    } else if (previous.firstItemId && firstItemId !== previous.firstItemId) {
      node.scrollTop += node.scrollHeight - previous.height
    } else if (following && !inspecting.current) {
      node.scrollTop = node.scrollHeight
    }
    anchorRef.current = { firstItemId, height: node.scrollHeight, threadKey }
  }, [items, following, running, threadKey, latestChanges, preferences.readingStart, readingSpace])

  const connectionStrip = connection.phase === 'ready' ? null : (
    <div className={tw("connection-strip flex min-h-8.5 flex-none items-center gap-2 border-b border-[#ece9e4] bg-[#faf8f4] px-6 py-2 text-[0.74rem] text-[#7d7a75] dark:border-b-[#2b2b2e] dark:bg-[#1b1b1d] dark:text-[#a3a3a8]")} role="status">
      <span className={tw(
        "connection-dot [width:0.38rem] [height:0.38rem] flex-none [border-radius:50%] [background:#b5b5b5]",
        connection.phase === "connecting" && "connection-dot--connecting [background:#b98931]",
        connection.phase === "failed" && "connection-dot--failed [background:#c15a50]",
        connection.phase === "offline" && "connection-dot--offline [background:#b7b7b7]",
      )} />
      <span>{connection.message ?? connectionLabels[connection.phase]}</span>
      <button className={tw("link-button ml-1 border-0 bg-transparent p-0 text-[0.78rem] text-[#4a6fa5] underline disabled:text-[#a8a8a8] disabled:no-underline dark:text-[#8ab0e8]")} onClick={onReconnect} type="button">重新连接</button>
    </div>
  )

  if (items.length === 0) {
    return (
      <div className={tw("conversation-canvas__inner flex min-w-0 flex-1 flex-col")}>
        {connectionStrip}
        <div className={tw("conversation-empty mx-auto flex w-full max-w-3xl flex-col items-center px-6 pb-7 pt-8 text-center")}>
          <h1 className={tw("m-0 text-[24px] font-medium leading-9 tracking-tight text-[var(--foreground)]")}>想用灵创完成什么？</h1>
          {demo ? <span className={tw("mt-2 text-[11px] text-[var(--text-tertiary)]")}>本地演示</span> : null}
        </div>
      </div>
    )
  }

  return (
    <div className={tw("conversation-canvas__inner relative flex min-h-0 flex-1 flex-col")}>
      {connectionStrip}
      <div className={tw("relative flex min-h-0 min-w-0 flex-1 flex-col")}><div
        className={tw("conversation-stream conversation-scroll [scrollbar-width:auto] [&::-webkit-scrollbar]:w-[5px]! [&::-webkit-scrollbar-track]:bg-transparent! [&::-webkit-scrollbar-thumb]:min-h-6! [&::-webkit-scrollbar-thumb]:rounded-full! [&::-webkit-scrollbar-thumb]:border-y-[6px]! [&::-webkit-scrollbar-thumb]:border-solid! [&::-webkit-scrollbar-thumb]:border-transparent! [&::-webkit-scrollbar-thumb]:bg-[var(--text-tertiary)]/30! [&::-webkit-scrollbar-thumb]:bg-clip-padding! [&::-webkit-scrollbar-thumb:hover]:bg-[var(--text-tertiary)]/50! [&::-webkit-scrollbar-button]:hidden! grid min-h-0 min-w-0 flex-1 auto-rows-max content-start gap-6 overflow-y-auto overflow-x-hidden px-[max(1rem,calc((100%_-_48rem)/2))] pb-6 pt-4 [overflow-anchor:none] [overscroll-behavior:contain]")}
        ref={scrollRef}
        onClickCapture={event => {
          if (event.target instanceof Element && event.target.closest('summary')) {
            inspecting.current = true
            setFollowing(false)
          }
        }}
        onWheel={() => { inspecting.current = false; readingAnchor.current = undefined; setReadingSpace(0) }}
        onPointerDown={event => { if (event.target === scrollRef.current) { inspecting.current = false; readingAnchor.current = undefined; setReadingSpace(0); dismissSelection() } }}
        onPointerUp={captureSelection}
        onKeyDown={event => { if (['PageUp', 'PageDown', 'Home', 'End', 'ArrowUp', 'ArrowDown'].includes(event.key)) { inspecting.current = false; readingAnchor.current = undefined; setReadingSpace(0) } }}
        onKeyUp={captureSelection}
        onScroll={() => { if (!inspecting.current) setFollowing(nearBottom()); updateActiveAnchor(); captureSelection() }}
      >
        {hasOlder ? (
          <div className={tw("conversation-stream__older [padding:0.2rem_0_0.9rem] text-center")}>
            <button className={tw("link-button dark:[color:#8ab0e8] p-0 border-0 bg-transparent [color:#4a6fa5] [font:inherit] [font-size:0.78rem] [text-decoration:underline] disabled:[color:#a8a8a8] disabled:[text-decoration:none]")} disabled={loadingOlder} onClick={onLoadOlder} type="button">
              {loadingOlder ? '正在加载…' : '加载更早的消息'}
            </button>
          </div>
        ) : null}
        {displayTimeline(items, running, preferences.collapseProcess).map(group => group.process ? (
          <Disclosure expanded={group.items.some(item => item.execution && item.status === 'running' && liveItemIds.has(item.itemId)) || preferences.expandTools && !(preferences.collapseProcess && (!running || items.indexOf(group.items[0]!) < items.findLastIndex(item => item.kind === 'user-message')))} className={tw("timeline-process group/process min-w-0 text-[var(--text-secondary)]")} key={group.items[0]?.itemId}>
            <summary className={tw("flex min-h-7 w-fit cursor-pointer list-none items-center gap-2 rounded-md px-2 text-sm leading-6 text-[var(--text-tertiary)] outline-none hover:text-[var(--foreground)] focus-visible:ring-2 focus-visible:ring-[var(--focus)]")}>
              <span className={tw("grid size-5 shrink-0 place-items-center rounded-md border border-[var(--panel-border)] bg-[var(--surface)] shadow-sm")}><Icon className={tw("transition-transform group-open/process:rotate-90")} name="chevronRight" size={12} /></span>
              <span>{group.items.some(item => item.status === 'running' && liveItemIds.has(item.itemId)) ? (group.items.some(item => item.execution && item.status === 'running') ? '正在执行命令' : '正在处理…') : group.items.some(item => item.kind === 'tool-activity' && !item.title?.startsWith('/')) ? (preferences.toolCounts ? `执行工具 ${String(group.items.filter(item => item.kind === 'tool-activity' && !item.title?.startsWith('/')).length)} 次` : '执行工具') : group.items.some(item => item.title?.startsWith('/')) ? '会话设置' : group.items.some(item => item.kind === 'assistant-message') ? '回复过程' : '上下文'}</span>
            </summary>
            <div className={tw("ml-4 mt-2 grid min-w-0 gap-0.5 border-l border-[var(--panel-border)] pl-3")}>
              {group.items.map(item => <TimelineRow expandTools={preferences.expandTools} item={item} key={item.itemId} live={liveItemIds.has(item.itemId)} loadAttachment={loadAttachment} onForkAt={onForkAt} onAddReply={onAddReply} forkDisabled={running} />)}
            </div>
          </Disclosure>
        ) : group.items.map(item => <TimelineRow articleRef={item.kind === 'user-message' ? node => {
          if (node) messageRefs.current.set(item.itemId, node)
          else messageRefs.current.delete(item.itemId)
        } : undefined} showActions={actionIds.has(item.itemId)} item={item} key={item.itemId} live={liveItemIds.has(item.itemId)} loadAttachment={loadAttachment} onForkAt={onForkAt} onAddReply={onAddReply} forkDisabled={running} />))}
        {clockStart.current?.thread === threadKey ? <ThinkingStatus key={`${threadKey}:${clockStart.current.start}`} running={running} start={clockStart.current.start} preferences={preferences} /> : null}
        {latestChanges && onReviewChanges ? <ConversationChangeSummary change={latestChanges} key={`${threadKey}-${String(latestChanges.seq)}`} onSelect={onReviewChanges} /> : null}
        {readingSpace > 0 ? <div aria-hidden style={{ height: readingSpace }} /> : null}
      </div>
      <MessageAnchors activeId={activeAnchor} anchors={anchors} key={threadKey} onNavigate={navigateToMessage} />
      {selection ? <SelectionToolbar container={scrollRef.current} onAddReply={onAddReply} onAskInSideTask={onAskInSideTask} onDismiss={dismissSelection} selection={selection} /> : null}
      {!following ? (
        <button aria-label="回到最新消息" title="回到最新消息" className={tw("conversation-jump absolute bottom-4 left-1/2 grid size-7 -translate-x-1/2 place-items-center rounded-lg border border-[var(--panel-border)] bg-[var(--surface)] text-[var(--text-secondary)] shadow-sm hover:bg-[var(--surface-hover)]")} onClick={() => {
          inspecting.current = false
          readingAnchor.current = undefined; setReadingSpace(0)
          if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
          setFollowing(true)
        }} type="button"><Icon name="chevronDown" size={16} /></button>
      ) : null}
      </div>
    </div>
  )
}
