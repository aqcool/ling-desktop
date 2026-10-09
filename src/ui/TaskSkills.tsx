import { useEffect, useRef, useState } from 'react'
import { Button } from '@heroui/react/button'
import { Popover } from '@heroui/react/popover'
import type { LingEvolutionService, LingEvolutionSuggestion } from '../runtime/evolution.js'
import { Icon } from './Icon.js'
import { MonitorSection } from './MonitorSection.js'
import { pollKnowledge } from './knowledge-polling.js'
import type { TaskMonitorResource } from './task-monitor-content.js'
import { tw } from './tailwind.js'

export function EvolutionSuggestionList({ suggestions, busy, message, onAction }: {
  readonly suggestions: readonly LingEvolutionSuggestion[]
  readonly busy?: { readonly id: string; readonly action: 'create' | 'ignore' }
  readonly message?: string
  readonly onAction: (suggestion: LingEvolutionSuggestion, action: 'create' | 'ignore') => void
}) {
  return <>
    {message ? <p role="alert" className={tw('m-0 px-2 pb-2 text-xs text-[var(--danger)]')}>{message}</p> : null}
    <ul className={tw('m-0 grid list-none p-0')}>
      {suggestions.map(suggestion => <li key={suggestion.id} className={tw('group min-w-0 rounded-lg px-2 py-1.5 hover:bg-[var(--surface-hover)] focus-within:bg-[var(--surface-hover)]')}>
        <div className={tw('flex min-w-0 items-center gap-2')}>
          <span className={tw('min-w-0 flex-1 truncate text-compact font-semibold text-[var(--foreground)]')} title={suggestion.name}>{suggestion.name}</span>
          <div className={tw('flex shrink-0 gap-2 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100', busy?.id === suggestion.id && 'opacity-100')}>
            {(['create', 'ignore'] as const).map(action => <Button key={action} size="sm" variant="ghost" aria-label={`${action === 'create' ? '创建' : '忽略'}技能 ${suggestion.name}`} isDisabled={Boolean(busy)} onPress={() => onAction(suggestion, action)} className={tw('h-5 min-w-0 rounded px-0 text-compact font-medium text-[color-mix(in_oklab,var(--success)_50%,var(--plan-mode-foreground))] shadow-none hover:bg-transparent focus-visible:outline-2 focus-visible:outline-[var(--focus)]')}>
              {busy?.id === suggestion.id && busy?.action === action ? (action === 'create' ? '创建中…' : '忽略中…') : (action === 'create' ? '创建' : '忽略')}
            </Button>)}
          </div>
        </div>
        <p className={tw('mb-0 mt-1 line-clamp-2 break-words text-compact leading-[1.4] text-[var(--text-secondary)]')} title={suggestion.description}>{suggestion.description}</p>
      </li>)}
    </ul>
    {!suggestions.length ? <p role="status" className={tw('m-0 px-2 py-3 text-compact text-[var(--text-tertiary)]')}>建议已处理完</p> : null}
  </>
}

/** Suggestions and task usage share an entry point, but never a fabricated count. */
export function TaskSkills({ service, taskId, refreshKey, resources }: {
  readonly service?: LingEvolutionService
  readonly taskId: string
  readonly refreshKey?: string
  readonly resources: readonly TaskMonitorResource[]
}) {
  const [suggestions, setSuggestions] = useState<readonly LingEvolutionSuggestion[]>([])
  const [busy, setBusy] = useState<{ id: string; action: 'create' | 'ignore' }>()
  const [message, setMessage] = useState<string>()
  const [open, setOpen] = useState(false)
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.innerWidth < 600)
  const active = useRef(true)
  const operation = useRef(false)
  const revision = useRef(0)
  const dialog = useRef<HTMLElement>(null)
  const entry = useRef<HTMLDivElement>(null)
  const wasOpen = useRef(false)
  const restoreActionFocus = useRef(false)
  useEffect(() => {
    const resize = () => setNarrow(window.innerWidth < 600)
    resize()
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])
  useEffect(() => {
    active.current = true
    return () => { active.current = false }
  }, [])
  useEffect(() => {
    if (!service) return
    return pollKnowledge(async signal => {
      const requestedRevision = revision.current
      try {
        const result = await service.list(taskId, signal)
        if (!signal.aborted && result.ok && !operation.current && revision.current === requestedRevision) setSuggestions(result.value)
      } catch { /* Keep the last confirmed list during transient disconnections. */ }
      return false
    }, 10000)
  }, [service, taskId, refreshKey])
  useEffect(() => {
    if (!open || busy || !restoreActionFocus.current) return
    restoreActionFocus.current = false
    const target = dialog.current?.querySelector<HTMLButtonElement>('button:not([disabled])') ?? dialog.current
    target?.focus()
  }, [open, busy, suggestions])
  useEffect(() => {
    if (wasOpen.current && !open && !suggestions.length) {
      const target = entry.current?.querySelector<HTMLButtonElement>('h3 button')
        ?? document.querySelector<HTMLButtonElement>('[aria-controls="task-monitor"]')
      target?.focus()
    }
    wasOpen.current = open
  }, [open, suggestions.length])

  const act = async (suggestion: LingEvolutionSuggestion, action: 'create' | 'ignore') => {
    if (!service || operation.current) return
    operation.current = true
    revision.current += 1
    restoreActionFocus.current = true
    // Disabled or removed action buttons must not strand focus on the inert page.
    dialog.current?.focus()
    setBusy({ id: suggestion.id, action }); setMessage(undefined)
    try {
      const result = await service[action](taskId, suggestion.id, suggestion.version)
      if (!active.current) return
      if (result.ok) setSuggestions(current => current.filter(item => item.id !== suggestion.id))
      else setMessage(result.message)
    } catch {
      if (active.current) setMessage(action === 'create' ? '技能创建失败，请重试。' : '忽略失败，请重试。')
    } finally {
      operation.current = false
      if (active.current) setBusy(undefined)
    }
  }
  const names = new Set(resources.filter(item => item.kind === 'skill').map(item => item.name))
  const candidates = suggestions.filter(item => !names.has(item.name))
  if (!resources.length && !suggestions.length && !open) return null
  return <div ref={entry} className={tw('min-w-0')}><MonitorSection title="技能与 MCP" accessory={suggestions.length || open ? <Popover isOpen={open} onOpenChange={setOpen}>
    <Button size="sm" variant="ghost" aria-label={`查看 ${suggestions.length} 条技能自进化建议`} className={tw('h-5 min-w-0 shrink-0 rounded px-1.5 py-0 text-caption font-semibold text-[var(--skill-tag-foreground)] bg-[var(--skill-tag-background)] shadow-none hover:brightness-95')}>
      {suggestions.length}条建议
    </Button>
    <Popover.Content placement={narrow ? 'bottom end' : 'left top'} offset={8} className={tw('z-50 w-70 max-w-[calc(100vw-1rem)] rounded-xl border border-[var(--panel-border)] bg-[var(--surface)] p-0 shadow-[var(--overlay-shadow)]')}>
      <Popover.Dialog ref={dialog} className={tw('p-2')}>
        <Popover.Heading className={tw('m-0 px-2 pb-2 pt-1 text-sm font-semibold text-[var(--foreground)]')}>自进化建议</Popover.Heading>
        <div className={tw('max-h-[min(30rem,70vh)] overflow-y-auto overscroll-contain')}>
          <EvolutionSuggestionList suggestions={suggestions} busy={busy} message={message} onAction={(suggestion, action) => { void act(suggestion, action) }} />
        </div>
      </Popover.Dialog>
    </Popover.Content>
  </Popover> : undefined}>
    <ul className={tw('m-0 grid list-none gap-1 p-0')}>
      {candidates.map(item => <li key={item.id} className={tw('flex min-h-8 min-w-0 items-center gap-2 text-compact')} title={item.description}>
        <span className={tw('grid size-6 shrink-0 place-items-center rounded bg-[var(--surface-secondary)] text-[var(--text-secondary)]')}><Icon name="hammer" size={14} /></span>
        <span className={tw('min-w-0 truncate')}>{item.name}</span>
      </li>)}
      {resources.map(item => <li key={item.id} className={tw('flex min-h-8 min-w-0 items-center gap-2 text-compact')} title={item.toolName ?? item.name}>
        <span className={tw('grid size-6 shrink-0 place-items-center rounded bg-[var(--surface-secondary)] text-[var(--text-secondary)]')}><Icon name={item.kind === 'skill' ? 'hammer' : 'plugin'} size={14} /></span>
        <span className={tw('min-w-0 truncate')}>{item.name}</span>
      </li>)}
    </ul>
  </MonitorSection></div>
}
