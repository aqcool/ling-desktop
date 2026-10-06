import { updateBehavior, useBehavior } from './behavior-preferences.js'
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type ClipboardEvent, type DragEvent, type KeyboardEvent, type MouseEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { Header, type Selection } from 'react-aria-components'
import { SelectableCollectionContext } from 'react-aria-components/Autocomplete'
import { ListBox } from '@heroui/react/list-box'
import { Input } from '@heroui/react/input'
import { Button } from '@heroui/react/button'
import { Dropdown } from '@heroui/react/dropdown'
import type { LingReadResult, LingSlashCommand, LingSkill, LingModelSelection, LingModelSettings, LingTaskGoal, LingTaskMode, LingTaskPermission, LingTimelineAttachment } from '../runtime/contract.js'
import { enabledModelOptions } from '../model-visibility.js'
import { Icon, type IconName } from './Icon.js'
import { FileIcon } from './FileIcon.js'
import { formatBytes, workspaceContextPresentation, type ComposerAttachment } from './attachments.js'
import { Menu, MenuItem, placeList } from './Menu.js'
import { tw } from './tailwind.js'
import { ProviderIcon } from './ProviderIcon.js'
import { composerSkillPresentation, withComposerSkills } from './composer-skills.js'

interface ComposerProps {
  readonly value: string
  readonly onChange: (value: string) => void
  readonly running: boolean
  readonly hasTask: boolean
  readonly disabled: boolean
  readonly attachments: readonly ComposerAttachment[]
  readonly recordedAttachments?: readonly LingTimelineAttachment[]
  readonly onRemoveRecordedAttachment?: (id: string) => void
  readonly focusKey?: number
  readonly browserAnnotationCount?: number
  readonly onAddFiles: (files: File[]) => void
  readonly onRemoveAttachment: (id: string) => void
  readonly onRemoveBrowserAnnotations?: () => void
  readonly onSubmit: () => void
  readonly onStop: () => void
  readonly modelLabel: string
  readonly modelSettings?: LingModelSettings
  readonly taskScoped: boolean
  readonly taskModel?: LingModelSelection
  readonly onSelectModel: (selection: LingModelSelection) => void
  readonly onOpenModelSettings: () => void
  readonly permission?: LingTaskPermission
  readonly onSelectPermission: (value: string) => void
  readonly mode?: LingTaskMode
  readonly onPlanModeToggle: (active: boolean) => void
  readonly onGoalAction: (action: 'pause' | 'resume' | 'complete' | 'clear', goal: LingTaskGoal) => void
  readonly taskId?: string
  readonly getTaskCommands?: (taskId: string) => Promise<LingReadResult<readonly LingSlashCommand[]>>
  readonly agentPreset?: string
  readonly workspaceId?: string
  readonly getWorkspaceSkills?: (workspaceId: string | undefined, signal: AbortSignal, agentPreset?: string) => Promise<LingReadResult<readonly LingSkill[]>>
  readonly getTaskSkills?: (taskId: string, signal: AbortSignal) => Promise<LingReadResult<readonly LingSkill[]>>
}

const goalPhaseLabels: Record<LingTaskGoal['phase'], string> = {
  active: '进行中',
  paused: '已暂停',
  blocked: '受阻',
  complete: '已完成',
}

interface SlashEntry {
  readonly name: string
  readonly description: string
  readonly icon: IconName
  readonly label?: string
  readonly action: 'file' | 'command'
  readonly command?: string
  readonly source?: 'runtime' | 'skill'
}

const quickSlashEntries: readonly SlashEntry[] = [
  { name: 'file', label: '文件', description: '', icon: 'paperclip', action: 'file' },
  { name: 'goal', label: '目标', description: '设置或查看长期任务目标', icon: 'target', action: 'command', command: 'goal' },
  { name: 'plan', label: '计划', description: '进入或退出计划模式', icon: 'plan', action: 'command', command: 'plan' },
]

// LING owns the presentation; command availability still comes from DSH.
const commandFaces: Readonly<Record<string, Pick<SlashEntry, 'label' | 'description' | 'icon'>>> = {
  compact: { label: '压缩', description: '压缩以上对话内容', icon: 'compressContext' },
  permission: { label: '权限', description: '切换权限预设（沙箱模式与审批策略）', icon: 'shield' },
  model: { label: '模型', description: '选择本会话使用的模型', icon: 'modelCatalog' },
  export: { label: '下载日志', description: '将当前会话内容导出为 ZIP', icon: 'download' },
  feedback: { label: '反馈', description: '发送关于当前会话的反馈', icon: 'paperPlane' },
}

// Keep the existing persisted command draft and transport; present its mode as a chip.
export function composerDraftPresentation(raw: string): { text: string; mode?: 'goal' | 'plan' } {
  const match = /^\/(goal|plan) ([\s\S]*)$/u.exec(raw)
  if (!match || (match[1] === 'plan' && match[2]?.trim() === 'off')) return { text: raw }
  return { text: match[2] ?? '', mode: match[1] as 'goal' | 'plan' }
}

/** DSH commands claim registered names only; skill references remain prompts. */
export function isComposerCommand(text: string, commands: readonly LingSlashCommand[]): boolean {
  const name = /^\/([^\s]+)/u.exec(text.trim())?.[1]
  return name !== undefined && commands.some(command => command.name === name)
}

export function permissionPresentation(value: string, label = value, description?: string): { label: string; description?: string; icon: IconName; danger: boolean } {
  switch (value) {
    case 'read-only': return { label: '只读', description: '仅查看文件与信息，不允许修改文件', icon: 'eye', danger: false }
    case 'workspace-write': return { label: '询问审批', description: '可修改工作区文件，越界访问前询问', icon: 'shieldCheck', danger: false }
    case 'danger-full-access': return { label: '完全访问', description: '无需询问，可访问文件、终端和网络', icon: 'warning', danger: true }
    case 'ask': return { label: '询问审批', description: '执行命令或越界访问前询问', icon: 'shieldCheck', danger: false }
    case 'auto': return { label: '自动审批', description: '仅在检测到潜在风险时询问', icon: 'playCircle', danger: false }
    default: return { label, description, icon: 'shield', danger: false }
  }
}

const reasoningEffortLabels: Readonly<Record<string, string>> = {
  off: '关闭',
  minimal: '最低',
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '极高',
  max: '最大',
  ultra: '超高',
}

function reasoningEffortLabel(effort: { readonly id: string; readonly name: string }): string {
  return reasoningEffortLabels[effort.id.toLowerCase()] ?? effort.name
}

export function Composer({
  value: rawValue,
  onChange: onDraftChange,
  running,
  hasTask,
  disabled,
  attachments,
  recordedAttachments = [],
  onRemoveRecordedAttachment,
  focusKey,
  browserAnnotationCount = 0,
  onAddFiles,
  onRemoveAttachment,
  onRemoveBrowserAnnotations,
  onSubmit,
  onStop,
  modelLabel,
  modelSettings,
  taskScoped,
  taskModel,
  onSelectModel,
  onOpenModelSettings,
  permission,
  onSelectPermission,
  mode,
  onPlanModeToggle,
  onGoalAction,
  taskId,
  getTaskCommands,
  getTaskSkills,
  workspaceId,
  agentPreset,
  getWorkspaceSkills,
}: ComposerProps) {
  const behavior = useBehavior()
  const sendLabel = behavior.sendMode === 'queue' ? '排队发送' : '立即插话'
  const draft = composerDraftPresentation(rawValue)
  const [slashCommands, setSlashCommands] = useState<readonly LingSlashCommand[]>([])
  const [slashSkills, setSlashSkills] = useState<readonly LingSkill[]>([])
  const skillDraft = composerSkillPresentation(draft.text, slashSkills
    .filter(skill => !quickSlashEntries.some(entry => entry.name === skill.name) && !slashCommands.some(command => command.name === skill.name))
    .map(skill => skill.name))
  const value = skillDraft.text
  const updateDraft = (text: string) => { onDraftChange(draft.mode ? `/${draft.mode} ${text}` : text) }
  const onChange = (text: string) => { updateDraft(withComposerSkills(text, skillDraft.skills)) }
  const selectedMode = draft.mode ?? (mode?.planActive ? 'plan' : undefined)
  const suggestionId = useId()
  const composerRef = useRef<HTMLDivElement>(null)
  const suggestionListRef = useRef<HTMLDivElement>(null)
  const [suggestionMaxHeight, setSuggestionMaxHeight] = useState(400)
  const [overflowBelow, setOverflowBelow] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => { if (focusKey) textareaRef.current?.focus() }, [focusKey])
  const skillPrefixRef = useRef<HTMLDivElement>(null)
  const [skillPrefixLayout, setSkillPrefixLayout] = useState({ indent: 0, top: 0 })
  const fileInputRef = useRef<HTMLInputElement>(null)
  const toolsRef = useRef<HTMLDivElement>(null)
  const [skillPlacement, setSkillPlacement] = useState<{ left: number; top: number; maxHeight: number }>()
  const skillPanelRef = useRef<HTMLDivElement>(null)
  const skillSearchRef = useRef<HTMLInputElement>(null)
  const [skillsOpen, setSkillsOpen] = useState(false)
  const [modelPickerOpen, setModelPickerOpen] = useState(false)
  const [skillQuery, setSkillQuery] = useState('')
  const [skillsLoading, setSkillsLoading] = useState(false)
  const [skillsError, setSkillsError] = useState<string>()
  const [skillsRevision, setSkillsRevision] = useState(0)
  const composingRef = useRef(false)
  const catalogRef = useRef<{ taskId: string; commands: readonly LingSlashCommand[] } | undefined>(undefined)
  const failedRef = useRef<{ taskId: string; message: string } | undefined>(undefined)
  const [dragOver, setDragOver] = useState(false)
  const [dismissedValue, setDismissedValue] = useState<string>()
  const [slashError, setSlashError] = useState<string>()
  const [slashIndex, setSlashIndex] = useState(0)
  const [manualInputHeight, setManualInputHeight] = useState<number>()
  const resizeStartRef = useRef<{ y: number; height: number } | null>(null)

  useEffect(() => {
    const node = textareaRef.current
    if (!node) return
    node.style.height = 'auto'
    node.style.height = `${Math.min(Math.max(node.scrollHeight, manualInputHeight ?? 72), 240)}px`
  }, [manualInputHeight, value, skillPrefixLayout.indent, skillPrefixLayout.top])

  // Reserve the first line for inline skill tags while retaining the native textarea.
  const skillPrefixKey = skillDraft.skills.map(skill => skill.name).join('\n')
  useLayoutEffect(() => {
    const prefix = skillPrefixRef.current
    const measure = () => {
      const last = prefix?.lastElementChild as HTMLElement | null | undefined
      const end = last ? last.offsetLeft + last.offsetWidth + 4 : 0
      const nextLine = !!prefix && prefix.clientWidth - end < 80
      const next = { indent: nextLine ? 0 : end, top: last ? last.offsetTop + (nextLine ? 26 : 0) : 0 }
      setSkillPrefixLayout(current => current.indent === next.indent && current.top === next.top ? current : next)
    }
    measure()
    if (!prefix) return
    const observer = new ResizeObserver(measure)
    observer.observe(prefix)
    return () => observer.disconnect()
  }, [skillPrefixKey])

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const start = resizeStartRef.current
      if (start) setManualInputHeight(Math.max(72, Math.min(240, start.height - (event.clientY - start.y))))
    }
    const onEnd = () => { resizeStartRef.current = null }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onEnd)
    window.addEventListener('pointercancel', onEnd)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onEnd)
      window.removeEventListener('pointercancel', onEnd)
    }
  }, [])

  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!textareaRef.current) return
    event.preventDefault()
    resizeStartRef.current = { y: event.clientY, height: textareaRef.current.getBoundingClientRect().height }
  }

  const slashMatch = /(^|\s)\/([^\s/]*)$/u.exec(value)
  const slashQuery = skillsOpen ? skillQuery : slashMatch ? (slashMatch[2] ?? '') : null
  const slashOpen = skillsOpen || (slashQuery !== null && value !== dismissedValue)
  const slashLoading = slashOpen && hasTask && taskId !== undefined && getTaskCommands !== undefined
    && catalogRef.current?.taskId !== taskId && failedRef.current?.taskId !== taskId

  useEffect(() => {
    if (!taskId) { setSlashCommands([]); setSlashError(undefined); return }
    if (catalogRef.current?.taskId === taskId) {
      setSlashCommands(catalogRef.current.commands)
      setSlashError(undefined)
      return
    }
    if (failedRef.current?.taskId === taskId) {
      setSlashCommands([])
      setSlashError(failedRef.current.message)
      return
    }
    if (getTaskCommands === undefined) {
      setSlashCommands([])
      return
    }
    let cancelled = false
    void getTaskCommands(taskId).then(result => {
      if (cancelled) return
      if (result.ok) {
        catalogRef.current = { taskId, commands: result.value }
        setSlashCommands(result.value)
        setSlashError(undefined)
      }
      else {
        failedRef.current = { taskId, message: result.message }
        setSlashCommands([])
        setSlashError(result.message)
      }
    }).catch(() => {
      if (cancelled) return
      failedRef.current = { taskId, message: '无法读取指令列表。' }
      setSlashCommands([])
      setSlashError('无法读取指令列表。')
    })
    return () => { cancelled = true }
  }, [getTaskCommands, taskId])

  useEffect(() => {
    setSkillsOpen(false)
    setSkillQuery('')
  }, [taskId, workspaceId])

  useEffect(() => {
    if (skillsOpen) skillSearchRef.current?.focus()
    if (!slashOpen) return
    const dismiss = (event: Event) => {
      if (!(event.target instanceof Node) || skillPanelRef.current?.contains(event.target)) return
      if (!skillsOpen && composerRef.current?.contains(event.target)) return
      setDismissedValue(value)
      setSkillsOpen(false)
    }
    document.addEventListener('pointerdown', dismiss, true)
    return () => { document.removeEventListener('pointerdown', dismiss, true) }
  }, [slashOpen, skillsOpen, value])

  useEffect(() => {
    setSlashSkills([])
    setSkillsError(undefined)
    setSkillsLoading(false)
    const read = taskId ? getTaskSkills?.bind(null, taskId) : getWorkspaceSkills ? (signal: AbortSignal) => getWorkspaceSkills(workspaceId, signal, agentPreset) : undefined
    if (!read) { setSkillsError('当前运行时未提供技能目录。'); return }
    const abort = new AbortController()
    setSkillsLoading(true)
    void read(abort.signal).then(result => {
      if (abort.signal.aborted) return
      if (result.ok) setSlashSkills(result.value)
      else setSkillsError(result.message)
    }).catch(() => {
      if (!abort.signal.aborted) setSkillsError('技能目录读取失败，请重试。')
    }).finally(() => { if (!abort.signal.aborted) setSkillsLoading(false) })
    return () => { abort.abort() }
  }, [getTaskSkills, getWorkspaceSkills, taskId, workspaceId, agentPreset, skillsRevision])

  const visibleCommands = useMemo(() => {
    if (slashQuery === null) return []
    const query = slashQuery.toLowerCase()
    const matches = (entry: SlashEntry) => entry.name.toLowerCase().includes(query) || entry.label?.includes(query)
    const quick = quickSlashEntries.filter(matches)
    const runtime: SlashEntry[] = slashCommands
      .filter(command => !quickSlashEntries.some(entry => entry.command === command.name))
      .map(command => ({ name: command.name, description: command.description ?? command.hint ?? '', icon: 'terminal', action: 'command', command: command.name, source: 'runtime', ...commandFaces[command.name] }))
    if (modelSettings?.providers.length && !runtime.some(command => command.name === 'model')) {
      runtime.push({ name: 'model', description: '', icon: 'modelCatalog', action: 'command', command: 'model', source: 'runtime', ...commandFaces.model })
    }
    const order = ['feedback', 'compact', 'permission', 'model', 'export']
    runtime.sort((a, b) => (order.indexOf(a.name) < 0 ? order.length : order.indexOf(a.name)) - (order.indexOf(b.name) < 0 ? order.length : order.indexOf(b.name)))
    const skills: SlashEntry[] = slashSkills
      .filter(skill => !quickSlashEntries.some(entry => entry.name === skill.name) && !runtime.some(command => command.name === skill.name))
      .map(skill => ({ name: skill.name, description: skill.modelInvocable ? skill.description : `仅限用户调用 · ${skill.description}`, icon: 'hammer', action: 'command', command: skill.name, source: 'skill' }))
    return skillsOpen ? skills.filter(matches) : [...quick, ...runtime.filter(matches), ...skills.filter(matches)]
  }, [slashCommands, slashSkills, slashQuery, skillsOpen, modelSettings])
  const activeSlashIndex = Math.min(slashIndex, visibleCommands.length - 1)
  const suggestionGroups = [
    { name: '添加', entries: visibleCommands.filter(entry => !entry.source || entry.name === 'feedback') },
    { name: '指令', entries: visibleCommands.filter(entry => entry.source === 'runtime' && entry.name !== 'feedback') },
    { name: '技能', entries: visibleCommands.filter(entry => entry.source === 'skill') },
  ].filter(group => group.entries.length > 0)

  useEffect(() => { setSlashIndex(0) }, [slashQuery])

  useLayoutEffect(() => {
    const input = skillsOpen ? skillSearchRef.current : textareaRef.current
    const list = suggestionListRef.current
    const option = list?.querySelector<HTMLElement>(`[data-command-index="${activeSlashIndex}"]`)
    if (slashOpen && option) {
      input?.setAttribute('aria-activedescendant', option.id)
      // Scroll only the menu, never the conversation or composer behind it.
      const bounds = option.getBoundingClientRect()
      const viewport = list!.getBoundingClientRect()
      if (bounds.top < viewport.top) list!.scrollTop -= viewport.top - bounds.top
      else if (bounds.bottom > viewport.bottom) list!.scrollTop += bounds.bottom - viewport.bottom
    } else input?.removeAttribute('aria-activedescendant')
    return () => { input?.removeAttribute('aria-activedescendant') }
  }, [activeSlashIndex, slashOpen, skillsOpen, visibleCommands])

  useLayoutEffect(() => {
    if (!slashOpen) return
    const measure = () => {
      const top = composerRef.current?.getBoundingClientRect().top ?? 412
      setSuggestionMaxHeight(Math.max(40, Math.min(400, top - 12)))
      const list = suggestionListRef.current
      setOverflowBelow(!!list && list.scrollHeight - list.clientHeight - list.scrollTop > 1)
    }
    const observer = new ResizeObserver(measure)
    if (composerRef.current) observer.observe(composerRef.current)
    if (suggestionListRef.current) observer.observe(suggestionListRef.current)
    measure()
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => { observer.disconnect(); window.removeEventListener('resize', measure); window.removeEventListener('scroll', measure, true) }
  }, [slashOpen, skillsOpen, visibleCommands])

  const syncComposing = (event: { type: string }) => {
    composingRef.current = event.type === 'compositionend' ? false : true
  }

  const commandPrefix = slashMatch
    ? value.slice(0, slashMatch.index + (slashMatch[1]?.length ?? 0))
    : `${value}${value && !/\s$/u.test(value) ? ' ' : ''}`
  const addInstruction = (name: string) => {
    if (name === 'goal' || name === 'plan') {
      selectMode(name, commandPrefix)
      return
    }
    onChange(`${commandPrefix}/${name} `)
    setDismissedValue(undefined)
    textareaRef.current?.focus()
  }

  const selectMode = (next: 'goal' | 'plan', text = value) => {
    if (disabled) return
    const selected = selectedMode === next ? undefined : next
    if (mode?.planActive && selected !== 'plan') onPlanModeToggle(false)
    const content = withComposerSkills(text, skillDraft.skills)
    onDraftChange(selected ? `/${selected} ${content}` : content)
    setDismissedValue(undefined)
    textareaRef.current?.focus()
  }

  const insertSlash = (entry: SlashEntry) => {
    if (entry.action === 'file') {
      onChange(commandPrefix)
      fileInputRef.current?.click()
      return
    }
    if (disabled) return
    if (entry.name === 'model') {
      onChange(commandPrefix)
      setDismissedValue(value)
      if (modelSettings?.providers.length) setModelPickerOpen(true)
      else onOpenModelSettings()
      return
    }
    if (entry.source === 'skill') {
      const skills = skillDraft.skills.some(skill => skill.name === entry.name)
        ? skillDraft.skills
        : [...skillDraft.skills, { name: entry.name, prefix: `/${entry.name} ` }]
      updateDraft(withComposerSkills(skillsOpen ? value : commandPrefix, skills))
      setSkillsOpen(false)
      setDismissedValue(undefined)
      textareaRef.current?.focus()
      return
    }
    addInstruction(entry.command ?? entry.name)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>) => {
    if (composingRef.current || event.nativeEvent.isComposing) return
    if (!disabled && !slashOpen && event.key === 'Backspace' && !event.metaKey && !event.ctrlKey && !event.altKey
      && event.currentTarget === textareaRef.current && event.currentTarget.selectionStart === 0 && event.currentTarget.selectionEnd === 0 && skillDraft.skills.length > 0) {
      event.preventDefault()
      updateDraft(withComposerSkills(value, skillDraft.skills.slice(0, -1)))
      return
    }
    if (!slashOpen && event.key === 'Tab' && event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault()
      selectMode('plan')
      return
    }
    if (event.key === 'Escape') {
      if (slashOpen) { event.preventDefault(); event.stopPropagation(); setDismissedValue(value); setSkillsOpen(false); textareaRef.current?.focus() }
      return
    }
    if (slashOpen && visibleCommands.length > 0 && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault()
      const step = event.key === 'ArrowDown' ? 1 : -1
      setSlashIndex((activeSlashIndex + step + visibleCommands.length) % visibleCommands.length)
      return
    }
    if (event.key === 'Tab' && slashOpen && visibleCommands.length > 0) {
      event.preventDefault()
      const command = visibleCommands[Math.min(slashIndex, visibleCommands.length - 1)]
      if (command) insertSlash(command)
      return
    }
    if (event.key === 'Enter' && !event.shiftKey && !composingRef.current && !event.nativeEvent.isComposing) {
      if (slashOpen && visibleCommands.length > 0) {
        event.preventDefault()
        const command = visibleCommands[Math.min(slashIndex, visibleCommands.length - 1)]
        if (command) insertSlash(command)
        return
      }
      if (slashOpen) { event.preventDefault(); return }
      event.preventDefault()
      if (!disabled && (draft.text.trim() || attachments.length || recordedAttachments.length || browserAnnotationCount)) onSubmit()
    }
  }

  const handleFiles = (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return
    onAddFiles(Array.from(fileList))
  }

  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData.files)
    if (files.length > 0) {
      event.preventDefault()
      onAddFiles(files)
    }
  }

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDragOver(false)
    handleFiles(event.dataTransfer.files)
  }

  const models = modelSettings?.providers ?? []
  const modelOptions = enabledModelOptions(modelSettings)
  const modelSelection = taskScoped ? taskModel : modelSettings?.defaultSelection
  const selectedModelProvider = modelSelection?.provider
  const selectedModel = models.find(provider => provider.providerId === selectedModelProvider)?.models.find(model => model.id === modelSelection?.model)
  const modelEfforts = selectedModel?.efforts ?? []
  const effectiveEffort = modelSelection?.reasoningEffort ?? selectedModel?.defaultEffort
  const selectedEffort = modelEfforts.find(effort => effort.id === effectiveEffort)
  const effortLabel = selectedEffort === undefined ? undefined : reasoningEffortLabel(selectedEffort)
  const canChooseEffort = modelEfforts.some(effort => effort.id !== 'off')
  const permissionOptions = permission?.options ?? []
  const permissionOption = permissionOptions.find(option => option.value === permission?.currentValue)
  const currentPermission = permissionPresentation(permission?.currentValue ?? '', permissionOption?.label ?? permission?.currentValue ?? '权限')
  const canSend = (draft.text.trim().length > 0 || attachments.length > 0 || recordedAttachments.length > 0 || browserAnnotationCount > 0) && !disabled
  const quotes = attachments.filter(attachment => attachment.quote !== undefined)
  const files = [
    ...attachments.filter(attachment => attachment.quote === undefined),
    ...recordedAttachments.map(attachment => ({ id: attachment.attachmentId, name: attachment.name, size: attachment.bytes, isImage: attachment.kind === 'image', previewUrl: undefined, context: undefined, recorded: true })),
  ]
  const goal = mode?.goal

  useLayoutEffect(() => {
    if (!skillsOpen) { setSkillPlacement(undefined); return }
    const place = () => {
      const anchor = toolsRef.current
      if (!anchor) return
      setSkillPlacement(placeList(anchor.getBoundingClientRect(),
        { width: Math.min(360, window.innerWidth - 16), height: 280 },
        { width: window.innerWidth, height: window.innerHeight }, 'start'))
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true) }
  }, [skillsOpen])

  const suggestionLoading = skillsLoading || (!skillsOpen && slashLoading)
  const suggestionError = skillsError ?? (!skillsOpen ? slashError : undefined)
  const suggestions = (
    <div
      ref={skillPanelRef}
      style={skillsOpen ? { ...skillPlacement, maxHeight: skillPlacement?.maxHeight ?? 280, visibility: skillPlacement ? undefined : 'hidden' } : { maxHeight: suggestionMaxHeight }}
      className={tw("composer__slash-wrap flex min-h-0 flex-col overflow-hidden rounded-2xl bg-[var(--surface)] p-1 text-[var(--foreground)] shadow-[var(--overlay-shadow)]", skillsOpen ? 'fixed z-50 w-[360px] max-w-[calc(100vw-16px)]' : 'absolute inset-x-0 bottom-[calc(100%+4px)] z-20')}
      onMouseMove={event => {
        const index = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-command-index]')?.dataset.commandIndex : undefined
        if (index !== undefined) setSlashIndex(Number(index))
      }}
    >
      {skillsOpen ? <div className={tw('flex shrink-0 items-center gap-2 px-2 py-1')}>
        <Icon name="search" size={16} className={tw('text-[var(--text-tertiary)]')} />
        <Input aria-label="搜索技能" aria-controls={suggestionId} aria-autocomplete="list" ref={skillSearchRef} value={skillQuery} onChange={(event: ChangeEvent<HTMLInputElement>) => { setSkillQuery(event.target.value) }} onKeyDown={handleKeyDown} onCompositionStart={syncComposing} onCompositionEnd={syncComposing} placeholder="搜索技能…" className={tw("h-control min-w-0 flex-1 rounded-lg border-0 bg-transparent px-0 text-sm shadow-none")} />
        <Button aria-label="关闭技能列表" isIconOnly size="sm" variant="ghost" className={tw("size-control-sm min-w-7 rounded-lg")} onPress={() => { setSkillsOpen(false); textareaRef.current?.focus() }}><Icon name="close" size={14} /></Button>
      </div> : null}
      <SelectableCollectionContext.Provider value={{ shouldUseVirtualFocus: true, disallowTypeAhead: true }}>
        <ListBox
          id={suggestionId}
          ref={suggestionListRef}
          aria-label={skillsOpen ? '技能列表' : '斜杠指令'}
          selectionMode="none"
          shouldFocusOnHover={false}
          autoFocus={false}
          onAction={(key: string | number) => { const command = visibleCommands.find(entry => entry.name === key); if (command) insertSlash(command) }}
          onMouseDown={(event: MouseEvent<HTMLDivElement>) => event.preventDefault()}
          className={tw('composer__slash min-h-0 w-full flex-1 gap-0 overflow-x-hidden overflow-y-auto p-0 outline-none [scrollbar-width:thin] [scrollbar-color:var(--text-tertiary)_transparent]')}
          renderEmptyState={() => suggestionLoading || suggestionError ? null : <span className={tw('block px-2.5 py-3 text-xs text-[var(--text-tertiary)]')}>{skillsOpen ? '没有匹配的技能' : '没有匹配的指令'}</span>}
        >
          {suggestionGroups.map(group => (
            <ListBox.Section key={group.name} id={group.name} aria-label={group.name} className={tw('gap-0 p-0')}>
              <Header className={tw('px-2.5 py-2 text-xs leading-4 font-normal text-[var(--text-tertiary)]')}>{group.name}</Header>
              {group.entries.map(command => {
                const index = visibleCommands.indexOf(command)
                const selectedSkill = command.source === 'skill' && skillDraft.skills.some(skill => skill.name === command.name)
                return <ListBox.Item
                  key={command.name}
                  id={command.name}
                  textValue={command.label ?? command.name}
                  data-command-index={index}
                  data-active={index === activeSlashIndex || undefined}
                  className={tw("min-h-10 w-full gap-2 rounded-lg px-2.5 py-2 text-sm leading-[22px] font-normal shadow-none outline-none transition-none active:scale-100 data-[pressed=true]:scale-100 data-[focus-visible=true]:outline-none", index === activeSlashIndex ? 'bg-[var(--surface-hover)] hover:bg-[var(--surface-hover)] data-[hovered=true]:bg-[var(--surface-hover)]' : 'bg-transparent hover:bg-transparent data-[hovered=true]:bg-transparent')}
                >
                  <Icon name={command.icon} size={16} className={tw('text-[var(--text-tertiary)]')} />
                  <span className={tw('max-w-[40%] shrink-0 truncate')}>{command.label ?? command.name}</span>
                  {command.label ? <span className={tw('max-w-[20%] shrink-0 truncate text-[var(--text-tertiary)]')}>{command.name}</span> : null}
                  <span className={tw('min-w-0 flex-1 truncate text-right text-[var(--text-tertiary)]')}>{command.description}</span>
                  {selectedSkill ? <span className={tw('inline-flex shrink-0 items-center gap-1 text-xs text-[var(--text-secondary)]')}><Icon name="check" size={14} />已选</span> : null}
                </ListBox.Item>
              })}
            </ListBox.Section>
          ))}
        </ListBox>
      </SelectableCollectionContext.Provider>
      {suggestionLoading ? <p role="status" className={tw('m-0 shrink-0 px-2.5 py-2 text-xs text-[var(--text-tertiary)]')}>正在读取{skillsLoading ? '技能' : '指令'}…</p> : null}
      {suggestionError ? <div role="alert" className={tw('flex shrink-0 items-center gap-2 px-2.5 py-2 text-xs text-[var(--text-tertiary)]')}>{suggestionError}{skillsError ? <Button size="sm" variant="ghost" onPress={() => setSkillsRevision(current => current + 1)} className={tw("h-control-xs min-w-0 px-1.5 text-xs")}>重试</Button> : null}</div> : null}
      {overflowBelow ? <div aria-hidden="true" className={tw('pointer-events-none absolute right-3.5 bottom-1 left-1 h-4 bg-linear-to-b from-transparent to-[var(--surface)]')} /> : null}
    </div>
  )

  return (
    <div
      ref={composerRef}
      className={tw("composer relative flex-none overflow-visible rounded-2xl border border-[var(--panel-border)] bg-[var(--field-background)] [container:composer_/_inline-size]", dragOver && "composer--dragover border-[var(--panel-border)] shadow-[var(--overlay-shadow)]")}
      onDragOver={event => { event.preventDefault(); setDragOver(true) }}
      onDragLeave={() => { setDragOver(false) }}
      onDrop={handleDrop}
    >
      {slashOpen ? (skillsOpen ? createPortal(suggestions, document.body) : suggestions) : null}
      <div
        aria-label="调整输入框高度"
        aria-orientation="horizontal"
        aria-valuemax={240}
        aria-valuemin={72}
        aria-valuenow={manualInputHeight ?? 72}
        className={tw("composer__resize absolute [z-index:1] [top:-0.3rem] [left:25%] [width:50%] [height:0.65rem] cursor-ns-resize after:absolute after:[top:0.2rem] after:[left:calc(50%_-_1rem)] after:[width:2rem] after:[height:0.18rem] after:rounded-2xl after:[background:var(--disabled-background)] after:[content:''] after:opacity-0 hover:after:opacity-100 focus-visible:after:opacity-100 focus-visible:[outline:0]")}
        onKeyDown={event => {
          if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
          event.preventDefault()
          setManualInputHeight(current => Math.max(72, Math.min(240, (current ?? 72) + (event.key === 'ArrowUp' ? 16 : -16))))
        }}
        onPointerDown={startResize}
        role="separator"
        tabIndex={0}
      />
      {goal ? (
        <div className={tw("composer__goal flex items-center gap-1.5 py-1.5 px-2.5 [border-bottom:1px_solid_var(--panel-border)] [color:var(--text-secondary)] text-xs")}>
          <Icon name="target" size={15} />
          <span className={tw("composer__goal-objective flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap [color:var(--text-secondary)]")} title={goal.blockedReason ?? goal.objective}>{goal.objective}</span>
          <span className={tw(
            "composer__goal-phase whitespace-nowrap rounded-md bg-[var(--surface-tertiary)] px-1.5 py-px text-caption text-[var(--text-secondary)]",
            (goal.phase === 'active' || goal.phase === 'complete') && "composer__goal-phase--active bg-[color-mix(in_oklab,var(--success)_14%,var(--surface))] text-[var(--success)]",
            goal.phase === 'blocked' && "composer__goal-phase--blocked bg-[color-mix(in_oklab,var(--danger)_10%,var(--surface))] text-[var(--danger)]",
            goal.phase === 'paused' && "composer__goal-phase--paused bg-[color-mix(in_oklab,var(--warning)_12%,var(--surface))] text-[var(--warning)]",
          )}>{goalPhaseLabels[goal.phase]}</span>
          <small>轮次 {goal.roundsStarted}/{goal.maxGoalRounds}</small>
          {goal.phase === 'active' ? (
            <>
              <button className={tw("composer__goal-action py-0.5 px-2 [border:1px_solid_var(--panel-border)] rounded-lg bg-transparent [color:var(--text-secondary)] text-caption whitespace-nowrap hover:[background:var(--surface-secondary)] hover:[color:var(--text-secondary)]")} onClick={() => { onGoalAction('pause', goal) }} type="button">暂停</button>
              <button className={tw("composer__goal-action py-0.5 px-2 [border:1px_solid_var(--panel-border)] rounded-lg bg-transparent [color:var(--text-secondary)] text-caption whitespace-nowrap hover:[background:var(--surface-secondary)] hover:[color:var(--text-secondary)]")} onClick={() => { onGoalAction('complete', goal) }} type="button">完成</button>
            </>
          ) : null}
          {goal.phase === 'paused' || goal.phase === 'blocked' ? (
            <>
              <button className={tw("composer__goal-action py-0.5 px-2 [border:1px_solid_var(--panel-border)] rounded-lg bg-transparent [color:var(--text-secondary)] text-caption whitespace-nowrap hover:[background:var(--surface-secondary)] hover:[color:var(--text-secondary)]")} onClick={() => { onGoalAction('resume', goal) }} type="button">继续</button>
              <button className={tw("composer__goal-action py-0.5 px-2 [border:1px_solid_var(--panel-border)] rounded-lg bg-transparent [color:var(--text-secondary)] text-caption whitespace-nowrap hover:[background:var(--surface-secondary)] hover:[color:var(--text-secondary)]")} onClick={() => { onGoalAction('clear', goal) }} type="button">移除</button>
            </>
          ) : null}
          {goal.phase === 'complete' ? (
            <button className={tw("composer__goal-action py-0.5 px-2 [border:1px_solid_var(--panel-border)] rounded-lg bg-transparent [color:var(--text-secondary)] text-caption whitespace-nowrap hover:[background:var(--surface-secondary)] hover:[color:var(--text-secondary)]")} onClick={() => { onGoalAction('clear', goal) }} type="button">移除</button>
          ) : null}
        </div>
      ) : null}
      {browserAnnotationCount > 0 ? (
        <div className={tw("flex flex-wrap gap-1.5 px-3 pt-2")}>
          <div className={tw("inline-flex h-10 items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-secondary)] px-2.5 text-xs text-[var(--foreground)]")}>
            <span className={tw("grid size-control-xs place-items-center rounded-md bg-[var(--info-subtle)] font-semibold text-[var(--info)]")}>{browserAnnotationCount}</span>
            <strong className={tw("font-medium")}>网页注释 {browserAnnotationCount}</strong>
            <button aria-label="移除全部网页注释" className={tw("grid size-5 place-items-center rounded-sm border-0 bg-transparent p-0 text-[var(--muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)]")} onClick={onRemoveBrowserAnnotations} type="button"><Icon name="close" size={12} /></button>
          </div>
        </div>
      ) : null}
      {quotes.length > 0 ? (
        <div aria-label="引用对话" className={tw('composer__quotes flex max-h-48 flex-wrap gap-2 overflow-y-auto px-3 pt-3 pb-1.5')}>
          {quotes.map((quote, index) => <div key={quote.id} title={quote.quote} className={tw('composer__quote group/quote relative h-14 w-50 max-w-full shrink-0')}>
            <div className={tw('flex h-full w-full items-center overflow-hidden rounded-lg border border-[var(--panel-border)] bg-[var(--surface)]')}>
              <span aria-hidden="true" className={tw('flex h-full w-14 shrink-0 items-center justify-center')}>
                <span className={tw('grid size-10 place-items-center rounded bg-[var(--surface-secondary)] text-[var(--text-tertiary)]')}><Icon name="textSelection" size={24} /></span>
              </span>
              <div className={tw('flex min-w-0 flex-1 flex-col gap-0.5 py-2 pr-3')}>
                <span className={tw("w-full truncate text-compact font-medium leading-5 text-[var(--foreground)]")}>{quote.quote?.replace(/\s+/gu, ' ').trim() || '引用对话'}</span>
                <span className={tw('text-xs leading-[18px] text-[var(--text-tertiary)]')}>选中的文本</span>
              </div>
            </div>
            <Button aria-label={quotes.length > 1 ? `移除引用对话 ${index + 1}` : '移除引用对话'} isIconOnly size="sm" variant="ghost" className={tw('absolute -right-1.5 -top-1.5 z-10 size-5 min-w-5 rounded-full border border-[var(--panel-border)] bg-[var(--surface)] text-[var(--foreground)] opacity-0 shadow-sm transition-opacity hover:bg-[var(--surface-hover)] group-hover/quote:opacity-100 group-focus-within/quote:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100')} onPress={() => { onRemoveAttachment(quote.id); textareaRef.current?.focus() }}><Icon name="close" size={12} /></Button>
          </div>)}
        </div>
      ) : null}
      {files.length > 0 ? (
        <div className={tw("composer__attachments flex flex-wrap gap-1.5 pt-2 px-3 pb-0")}>
          {files.map(attachment => {
            const context = attachment.context
            const presentation = context ? workspaceContextPresentation(context) : undefined
            return <div className={tw("composer__attachment grid max-w-60 grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-1.5 rounded-lg border border-[var(--panel-border)] bg-[var(--surface-secondary)] px-1.5 py-1")} data-context-kind={context?.kind} title={presentation?.title} key={attachment.id}>
              {attachment.isImage && attachment.previewUrl
                ? <img alt={attachment.name} className={tw("composer__attachment-thumb [width:1.6rem] [height:1.6rem] object-cover rounded-md")} src={attachment.previewUrl} />
                : context?.kind === 'selection' ? <Icon name="textSelection" size={18} />
                : <FileIcon path={context?.path ?? attachment.name} directory={context?.kind === 'directory'} mediaType={attachment.isImage ? 'image/png' : undefined} size={18} />}
              <span className={tw("composer__attachment-name overflow-hidden [color:var(--foreground)] text-xs text-ellipsis whitespace-nowrap")} title={presentation?.title ?? attachment.name}>{presentation?.label ?? attachment.name}</span>
              <small className={tw("text-micro text-[var(--text-tertiary)]")}>{presentation?.typeLabel ?? (attachment.size === undefined ? '' : formatBytes(attachment.size))}</small>
              <button aria-label={presentation ? `移除${presentation.typeLabel}引用：${presentation.label}` : '移除附件'} className={tw("composer__attachment-remove flex p-0.5 border-0 rounded-sm bg-transparent [color:var(--text-tertiary)] hover:[background:var(--surface-tertiary)] hover:[color:var(--text-secondary)]")} onClick={() => { if ('recorded' in attachment) onRemoveRecordedAttachment?.(attachment.id); else onRemoveAttachment(attachment.id) }} type="button">
                <Icon name="close" size={14} />
              </button>
            </div>
          })}
        </div>
      ) : null}

      <div className={tw("composer__input-row pt-0.5 px-3 pb-0")}>
        <input
          accept="*/*"
          className={tw("hidden")}
          multiple
          onChange={(event: ChangeEvent<HTMLInputElement>) => { handleFiles(event.target.files); event.target.value = '' }}
          ref={fileInputRef}
          type="file"
        />
        <div className={tw("composer__text-wrap relative min-w-0 overflow-hidden")}>
          {skillDraft.skills.length > 0 ? <div ref={skillPrefixRef} aria-label="已选技能" className={tw('composer__skills pointer-events-none absolute inset-x-1 top-[11px] z-1 flex flex-wrap items-start gap-1')}>
            {skillDraft.skills.map((skill, index) => <button key={`${skill.name}-${index}`} type="button" aria-label={`移除技能 ${skill.name}`} title={slashSkills.find(item => item.name === skill.name)?.description || skill.name} className={tw("composer__skill group/skill pointer-events-auto inline-flex h-[22px] min-w-0 max-w-[min(180px,100%)] items-center gap-1 overflow-hidden rounded-lg border-0 bg-[var(--skill-tag-background)] px-1.5 py-[3px] text-caption leading-4 text-[var(--skill-tag-foreground)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--focus)]")} onClick={() => { updateDraft(withComposerSkills(value, skillDraft.skills.filter((_, skillIndex) => skillIndex !== index))); textareaRef.current?.focus() }}>
              <span className={tw('relative size-3 shrink-0')}><Icon name="hammer" size={12} className={tw('absolute inset-0 group-hover/skill:opacity-0 group-focus-visible/skill:opacity-0')} /><Icon name="close" size={12} className={tw('absolute inset-0 opacity-0 group-hover/skill:opacity-100 group-focus-visible/skill:opacity-100')} /></span>
              <span className={tw('min-w-0 truncate')}>@{skill.name}</span>
            </button>)}
          </div> : null}
          <textarea
            aria-label="消息"
            aria-controls={slashOpen && !skillsOpen ? suggestionId : undefined}
            aria-autocomplete="list"
            className={tw("composer__textarea min-h-18 w-full resize-none rounded-none border-0 bg-transparent px-1 pt-3 pb-1.5 text-sm leading-[1.6] shadow-none outline-0 [--field-background:transparent] placeholder:text-[var(--text-tertiary)]")}
            style={{ textIndent: skillPrefixLayout.indent, paddingTop: 12 + skillPrefixLayout.top }}
            maxLength={8000}
            onChange={event => { onChange(event.target.value) }}
            onCompositionEnd={syncComposing}
            onCompositionStart={syncComposing}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            onScroll={event => { if (skillPrefixRef.current) skillPrefixRef.current.style.transform = `translateY(${-event.currentTarget.scrollTop}px)` }}
            placeholder={running ? (behavior.sendMode === 'queue' ? '输入消息，当前轮次结束后发送…' : '输入消息，立即调整当前任务…') : '描述你要完成的任务…'}
            ref={textareaRef}
            rows={1}
            title="Enter 发送，Shift+Enter 换行"
            value={value}
          />
        </div>
      </div>

      <div className={tw("composer__footer flex min-h-10 items-center justify-between gap-2 py-1 px-2")}>
        <div ref={toolsRef} className={tw("composer__tools flex items-center min-w-0 gap-0.5")}>
          <Menu
            align="start"
            triggerAriaLabel="添加内容"
            triggerClassName="composer__add size-control-sm rounded-lg border border-[var(--panel-border)] bg-[var(--surface)]"
            listClassName="composer-menu composer-menu--add"
            triggerLabel={open => <Icon name={open ? 'close' : 'plus'} size={18} />}
          >
            <MenuItem checked={selectedMode === 'goal'} disabled={disabled} icon="target" onPress={() => { selectMode('goal') }}>目标</MenuItem>
            <MenuItem checked={selectedMode === 'plan'} disabled={disabled} icon="calendar" onPress={() => { selectMode('plan') }} suffix="⇧Tab">计划</MenuItem>
            <MenuItem disabled={disabled} icon="hammer" onPress={() => { setSkillQuery(''); setSkillsOpen(true) }}>技能</MenuItem>
          </Menu>
          <button aria-label="添加附件" className={tw("composer__attach flex items-center justify-center size-control-sm border-0 rounded-lg bg-transparent [color:var(--text-secondary)] hover:[background:var(--surface-secondary)] hover:[color:var(--text-secondary)]")} onClick={() => { fileInputRef.current?.click() }} type="button">
            <Icon name="paperclip" size={16} />
          </button>
          {permissionOptions.length > 0 ? (
            <Menu
              align="start"
              triggerAriaLabel="切换权限预设"
              triggerClassName={tw("composer__pill composer__pill--permission h-control-sm min-w-0 gap-1 rounded-md px-1.5 text-xs font-normal hover:bg-[var(--surface-hover)]", currentPermission.danger && "text-[var(--permission-danger)]")}
              listClassName="composer-menu composer-menu--permission w-72 min-w-0 max-w-[calc(100vw_-_16px)] rounded-lg p-1 shadow-[var(--overlay-shadow)]"
              triggerLabel={<><Icon className={tw(currentPermission.danger && "text-[var(--permission-danger)]")} name={currentPermission.icon} size={16} /><span className={tw("composer__permission-label whitespace-nowrap @max-[22rem]/composer:hidden", currentPermission.danger && "text-[var(--permission-danger)]")}>{currentPermission.label}</span><Icon name="chevronDown" size={12} /></>}
            >
              {permissionOptions.map(option => {
                const presentation = permissionPresentation(option.value, option.label, option.description)
                const selected = option.value === permission?.currentValue
                return <button
                  aria-checked={selected}
                  className={tw("flex min-h-10 w-full items-start gap-1.5 rounded-md border-0 bg-transparent px-2 py-1 text-left outline-none hover:bg-[var(--surface-hover)] focus-visible:bg-[var(--surface-hover)]", presentation.danger && "text-[var(--permission-danger)]")}
                  key={option.value}
                  onClick={() => { onSelectPermission(option.value) }}
                  role="menuitemradio"
                  type="button"
                >
                  <Icon className={tw("mt-0.5 shrink-0 text-[var(--text-tertiary)]", presentation.danger && "text-[var(--permission-danger)]")} name={presentation.icon} size={14} />
                  <span className={tw("grid min-w-0 flex-1 gap-0.5")}>
                    <span className={tw("text-xs font-medium leading-4 text-[var(--foreground)]", presentation.danger && "text-[var(--permission-danger)]")}>{presentation.label}</span>
                    {presentation.description ? <span className={tw("text-caption font-normal leading-[15px] text-[var(--text-tertiary)]", presentation.danger && "text-[var(--permission-danger)]")}>{presentation.description}</span> : null}
                  </span>
                  {selected ? <span className={tw("grid size-3.5 shrink-0 self-center place-items-center text-[var(--text-tertiary)]", presentation.danger && "text-[var(--permission-danger)]")}><Icon name="check" size={12} /></span> : null}
                </button>
              })}
            </Menu>
          ) : (
            <span className={tw("composer__pill inline-flex [height:1.85rem] min-w-0 items-center gap-1 py-0 px-1.5 border-0 rounded-lg bg-transparent [color:var(--text-secondary)] text-xs [font-weight:520] hover:[background:var(--surface-secondary)] max-[700px]:[max-width:9rem] max-[700px]:overflow-hidden max-[700px]:whitespace-nowrap composer__pill--unavailable [color:var(--text-tertiary)] cursor-help hover:bg-transparent")} title="当前运行时未提供权限预设">
              <Icon name="shield" size={14} /><span className={tw("composer__permission-label whitespace-nowrap @max-[22rem]/composer:hidden")}>访问权限</span><Icon name="chevronDown" size={11} />
            </span>
          )}
          {selectedMode ? (
            <button
              aria-label={selectedMode === 'goal' ? '关闭目标模式' : '关闭计划模式'}
              aria-pressed
              className={tw("composer__mode group/mode-chip ml-1 inline-flex h-control-sm max-w-33 shrink-0 items-center gap-1.5 rounded-2xl [corner-shape:squircle] border-0 px-2 text-xs font-medium leading-4 [font-family:Inter,_-apple-system,_BlinkMacSystemFont,_Segoe_UI,_sans-serif] disabled:opacity-50", selectedMode === 'goal' ? "bg-[var(--goal-mode-background)] text-[var(--goal-mode-foreground)]" : "bg-[var(--plan-mode-background)] text-[var(--plan-mode-foreground)]")}
              disabled={disabled}
              onClick={() => { selectMode(selectedMode) }}
              title={selectedMode === 'goal' ? '关闭目标模式' : '关闭计划模式（⇧Tab）'}
              type="button"
            >
              <span className={tw("relative size-3.5 shrink-0")}>
                <Icon className={tw("absolute inset-0 transition-opacity group-hover/mode-chip:opacity-0 group-focus-visible/mode-chip:opacity-0")} name={selectedMode === 'goal' ? 'target' : 'calendar'} size={14} />
                <Icon className={tw("absolute inset-0 opacity-0 transition-opacity group-hover/mode-chip:opacity-100 group-focus-visible/mode-chip:opacity-100")} name="closeCircleFill" size={14} />
              </span>
              <span className={tw("truncate")}>{selectedMode === 'goal' ? '目标' : '计划'}</span>
            </button>
          ) : null}
        </div>
        <div className={tw("composer__submit flex items-center min-w-0 gap-0.5")}>
          {modelOptions.length > 0 ? (
            <Dropdown isOpen={modelPickerOpen} onOpenChange={setModelPickerOpen}>
              <Button
                aria-label={taskScoped ? '选择当前任务模型' : '选择默认模型'}
                className={tw("h-control-sm max-w-[min(15rem,35vw)] min-w-0 gap-1 rounded-md bg-transparent px-1.5 text-xs font-normal text-[var(--text-secondary)] @max-[22rem]/composer:max-w-26")}
                isDisabled={disabled}
                size="sm"
                variant="ghost"
              >
                <span className={tw("min-w-0 truncate")}>{modelLabel}</span>
                {effortLabel ? <span className={tw("shrink-0 text-muted")}>{effortLabel}</span> : null}
                <Icon className={tw("shrink-0 text-muted transition-transform", modelPickerOpen && "rotate-180")} name="chevronDown" size={12} />
              </Button>
              <Dropdown.Popover className={tw("w-72 max-w-[calc(100vw-1rem)] rounded-2xl border border-[var(--panel-border)]")} offset={8} placement="top end">
                <Dropdown.Menu aria-label="模型选择" className={tw("p-1.5")}>
                  <Dropdown.SubmenuTrigger>
                    <Dropdown.Item className={tw("h-10 gap-3 rounded-lg ps-2 pe-8 text-compact")} id="model" textValue="模型">
                      <span className={tw("shrink-0")}>模型</span>
                      <span className={tw("ml-auto min-w-0 truncate text-muted")}>{modelLabel}</span>
                      <Dropdown.SubmenuIndicator className={tw("size-3.5 shrink-0 text-muted")} />
                    </Dropdown.Item>
                    <Dropdown.Popover className={tw("w-72 max-w-[calc(100vw-1rem)] rounded-xl border border-[var(--panel-border)]")}>
                      <Dropdown.Menu aria-label="模型列表" className={tw("max-h-72 overflow-y-auto p-1 [scrollbar-width:thin] [scrollbar-color:var(--text-tertiary)_transparent]")}>
                        <Dropdown.Section
                          aria-label="可用模型"
                          disallowEmptySelection
                          selectedKeys={modelSelection ? [JSON.stringify([modelSelection.provider, modelSelection.model])] : []}
                          selectionMode="single"
                          onSelectionChange={(keys: Selection) => {
                            if (keys === 'all') return
                            const option = modelOptions.find(item => item.key === [...keys][0])
                            if (!option) return
                            onSelectModel({ provider: option.provider, model: option.model.id })
                            setModelPickerOpen(false)
                          }}
                        >
                          {modelOptions.map(option => (
                            <Dropdown.Item className={tw("min-h-control-lg gap-2 rounded-lg ps-8 text-compact")} id={option.key} key={option.key} textValue={option.model.name}>
                              <ProviderIcon providerId={option.provider} size={18} />
                              <span className={tw("min-w-0 flex-1 truncate")}>{option.model.name}</span>
                              <Dropdown.ItemIndicator />
                            </Dropdown.Item>
                          ))}
                        </Dropdown.Section>
                        <Dropdown.Item
                          className={tw("min-h-control-lg gap-2 rounded-lg text-xs text-[var(--text-secondary)]")}
                          id="manage-models"
                          textValue="模型管理"
                          onAction={() => { setModelPickerOpen(false); onOpenModelSettings() }}
                        ><Icon name="settings" size={16} />模型管理</Dropdown.Item>
                      </Dropdown.Menu>
                    </Dropdown.Popover>
                  </Dropdown.SubmenuTrigger>
                  {modelSelection !== undefined && canChooseEffort ? (
                    <Dropdown.SubmenuTrigger>
                      <Dropdown.Item className={tw("h-10 gap-3 rounded-lg ps-2 pe-8 text-compact")} id="reasoning" textValue="推理等级">
                        <span className={tw("shrink-0")}>推理等级</span>
                        <span className={tw("ml-auto min-w-0 truncate text-muted")}>{effortLabel ?? '默认'}</span>
                        <Dropdown.SubmenuIndicator className={tw("size-3.5 shrink-0 text-muted")} />
                      </Dropdown.Item>
                      <Dropdown.Popover className={tw("w-36 min-w-36 rounded-xl border border-[var(--panel-border)] md:min-w-36")}>
                        <Dropdown.Menu
                          aria-label="推理等级"
                          className={tw("p-1")}
                          disallowEmptySelection
                          selectedKeys={[modelSelection.reasoningEffort ?? 'default']}
                          selectionMode="single"
                          onSelectionChange={(keys: Selection) => {
                            if (keys === 'all') return
                            const effort = [...keys][0]
                            if (typeof effort !== 'string') return
                            onSelectModel({ provider: modelSelection.provider, model: modelSelection.model, ...(effort === 'default' ? {} : { reasoningEffort: effort }) })
                            setModelPickerOpen(false)
                          }}
                        >
                          <Dropdown.Item className={tw("min-h-control-lg rounded-lg ps-8 text-compact")} id="default" textValue="默认">
                            <span className={tw("flex-1")}>默认</span><Dropdown.ItemIndicator />
                          </Dropdown.Item>
                          {modelEfforts.map(effort => (
                            <Dropdown.Item className={tw("min-h-control-lg rounded-lg ps-8 text-compact")} id={effort.id} key={effort.id} textValue={reasoningEffortLabel(effort)}>
                              <span className={tw("flex-1")}>{reasoningEffortLabel(effort)}</span><Dropdown.ItemIndicator />
                            </Dropdown.Item>
                          ))}
                        </Dropdown.Menu>
                      </Dropdown.Popover>
                    </Dropdown.SubmenuTrigger>
                  ) : null}
                </Dropdown.Menu>
              </Dropdown.Popover>
            </Dropdown>
          ) : (
            <span className={tw("composer__pill composer__pill--static composer__pill--model inline-flex h-7.5 max-w-[min(15rem,35vw)] min-w-0 items-center gap-1 rounded-lg border-0 bg-transparent px-1.5 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--surface-secondary)] max-[700px]:max-w-36 max-[700px]:overflow-hidden max-[700px]:whitespace-nowrap @max-[22rem]/composer:max-w-26")}><Icon className={tw("flex-none")} name="bolt" size={14} /><span className={tw("overflow-hidden text-ellipsis whitespace-nowrap")}>{modelLabel}</span></span>
          )}
          {running ? (
            <Menu align="end" side="top" triggerAriaLabel="运行中发送方式"
              triggerClassName={tw('h-7.5 shrink-0 gap-1 rounded-lg px-1.5 text-xs hover:bg-[var(--surface-secondary)]')}
              triggerLabel={<>{behavior.sendMode === 'queue' ? '排队' : '插话'}<Icon name="chevronDown" size={12} /></>}>
              <MenuItem checked={behavior.sendMode === 'queue'} onPress={() => updateBehavior({ sendMode: 'queue' })}>排队发送</MenuItem>
              <MenuItem checked={behavior.sendMode === 'steer'} onPress={() => updateBehavior({ sendMode: 'steer' })}>立即插话</MenuItem>
            </Menu>
          ) : null}
          {running ? (
            <button aria-label="停止" className={tw("composer__stop flex items-center justify-center [width:2.1rem] [height:2.1rem] border-0 [border-radius:50%] [background:var(--danger-subtle)] [color:var(--danger)] hover:[background:var(--danger-subtle)]")} onClick={onStop} type="button">
              <Icon name="stop" size={16} />
            </button>
          ) : null}
          <span className={tw("composer__voice-unavailable flex [width:1.55rem] [height:1.65rem] items-center justify-center [color:var(--text-tertiary)] cursor-help @max-[22rem]/composer:[width:1.2rem]")} title="离线语音输入尚未接入" aria-label="离线语音输入尚未接入">
            <Icon name="mic" size={16} />
          </span>
          <button
            aria-label={!canSend && !disabled ? '语音输入尚未接入' : running ? sendLabel : '发送'}
            className={tw("composer__send flex h-7.5 w-7.5 flex-none items-center justify-center rounded-lg bg-[var(--action)] text-[var(--action-foreground)] disabled:cursor-default disabled:bg-[var(--action)] disabled:text-[var(--action-foreground)] text-[var(--action-foreground)]", disabled && "disabled:bg-[var(--surface-tertiary)]")}
            disabled={!canSend}
            onClick={onSubmit}
            title={disabled ? '运行时未连接，暂时无法发送' : !canSend ? '离线语音输入尚未接入；输入内容后可发送' : running ? `${sendLabel}（Enter）` : '发送（Enter）'}
            type="button"
          >
            <Icon name={!canSend && !disabled ? 'waveform' : 'send'} size={16} />
          </button>
        </div>
      </div>
    </div>
  )
}
