import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { LingContextBreakdown, LingContextPressure, LingWorkspaceSummary } from '../runtime/contract.js'
import { ContextWindowIndicator } from './ContextWindowIndicator.js'
import { Icon } from './Icon.js'
import { tw } from './tailwind.js'

interface ComposerContextProps {
  readonly showEnvironment?: boolean
  readonly interactive?: boolean
  readonly locationControl?: ReactNode
  readonly operationsControl?: ReactNode
  readonly branchControl?: ReactNode
  readonly agentPresetControl?: ReactNode
  readonly onGitOpen?: () => void
  readonly branch?: string | null
  readonly workspaceLabel: string
  readonly serverLabel?: string
  readonly workspaces: readonly LingWorkspaceSummary[]
  readonly onSelectWorkspace: (workspaceId: string) => void
  readonly onSelectWithoutWorkspace: () => void
  readonly onCreateWorkspace: () => void
  readonly contextPressure?: LingContextPressure
  readonly contextBreakdown?: LingContextBreakdown
  readonly compactDisabled: boolean
  readonly onCompactContext: () => void
}

export function ComposerContext({ showEnvironment = true, interactive = true, locationControl, operationsControl, branchControl, agentPresetControl, onGitOpen, branch, workspaceLabel, serverLabel, workspaces, onSelectWorkspace, onSelectWithoutWorkspace, onCreateWorkspace, contextPressure, contextBreakdown, compactDisabled, onCompactContext }: ComposerContextProps) {
  const [open, setOpen] = useState<'workspace' | null>(null)
  const [query, setQuery] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open !== 'workspace') return
    searchRef.current?.focus()
  }, [open])

  useEffect(() => {
    if (!open) return
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(null)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(null)
    }
    document.addEventListener('pointerdown', closeOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  const visibleWorkspaces = workspaces.filter(workspace =>
    `${workspace.label} ${workspace.locationLabel ?? ''}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))

  return (
    <div aria-label="当前工作区" className={tw("composer-context relative flex min-h-control min-w-0 items-center gap-3 px-1 pt-0.5 text-xs leading-4 text-[var(--text-secondary)]")} ref={rootRef}>
      {showEnvironment ? <>
      <div className={tw("composer-context__anchor relative min-w-0 max-w-[45%] shrink")}>
        <button disabled={!interactive} aria-expanded={open === 'workspace'} aria-haspopup="menu" className={tw("composer-context__item inline-flex h-control-xs max-w-full min-w-0 cursor-pointer items-center gap-1.5 rounded-md border-0 bg-transparent px-0.5 text-inherit hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)]")} onClick={() => { setQuery(''); setOpen(current => current === 'workspace' ? null : 'workspace') }} title={workspaceLabel} type="button">
          <Icon name={serverLabel ? 'globe' : 'folderOpen'} size={14} /><span className={tw("truncate")}>{workspaceLabel}</span>
        </button>
        {open === 'workspace' ? (
          <div aria-label="选择工作区" className={tw("composer-context__popover absolute [z-index:30] [bottom:calc(100%_+_0.55rem)] [left:0] p-1.5 [border:1px_solid_var(--panel-border)] rounded-xl [background:var(--surface)] [box-shadow:var(--overlay-shadow)] composer-context__popover--workspace [width:12.5rem]")} role="menu">
            <label className={tw("composer-context__search flex h-control-lg items-center gap-2 rounded-lg bg-[var(--surface-secondary)] px-2.5 text-[var(--text-tertiary)]")}><Icon name="search" size={16} /><input className={tw("w-full min-w-0 border-0 bg-transparent p-0 text-compact text-[var(--foreground)] outline-0 placeholder:text-[var(--text-tertiary)]")} aria-label="搜索名称或路径" onChange={event => { setQuery(event.target.value) }} placeholder="搜索名称或路径" ref={searchRef} value={query} /></label>
            <div className={tw("composer-context__workspace-list [max-height:13rem] overflow-y-auto pt-1")}>
              {visibleWorkspaces.map(workspace => (
                <button className={tw("composer-context__option flex w-full [min-height:2rem] items-center gap-2 py-1.5 px-2 border-0 rounded-md bg-transparent [color:var(--foreground)] [font:inherit] text-compact text-left cursor-pointer enabled:hover:[background:var(--surface-secondary)] disabled:[color:var(--text-tertiary)] disabled:cursor-not-allowed")} key={workspace.workspaceId} onClick={() => { onSelectWorkspace(workspace.workspaceId); setOpen(null) }} role="menuitem" title={workspace.locationLabel} type="button"><Icon name="folder" size={17} /><span className={tw("min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap")}>{workspace.label}</span></button>
              ))}
              {visibleWorkspaces.length === 0 ? <p className={tw("composer-context__empty m-0 py-2.5 px-2 [color:var(--text-tertiary)] text-xs text-center")}>没有匹配项</p> : null}
            </div>
            <div className={tw("composer-context__separator [height:1px] my-1.5 mx-1 [background:var(--surface-tertiary)]")} />
            <button className={tw("composer-context__option flex w-full [min-height:2rem] items-center gap-2 py-1.5 px-2 border-0 rounded-md bg-transparent [color:var(--foreground)] [font:inherit] text-compact text-left cursor-pointer enabled:hover:[background:var(--surface-secondary)] disabled:[color:var(--text-tertiary)] disabled:cursor-not-allowed")} onClick={() => { setOpen(null); onCreateWorkspace() }} role="menuitem" type="button"><Icon name="desktop" size={17} /><span className={tw("min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap")}>新建本地工作区</span></button>
            <button className={tw("composer-context__option flex w-full [min-height:2rem] items-center gap-2 py-1.5 px-2 border-0 rounded-md bg-transparent [color:var(--foreground)] [font:inherit] text-compact text-left cursor-pointer enabled:hover:[background:var(--surface-secondary)] disabled:[color:var(--text-tertiary)] disabled:cursor-not-allowed")} onClick={() => { onSelectWithoutWorkspace(); setOpen(null) }} role="menuitem" type="button"><Icon name="folder" size={17} /><span className={tw("min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap")}>不指定工作区</span></button>
          </div>
        ) : null}
      </div>
      {locationControl ?? <span className={tw("inline-flex h-control-xs shrink-0 items-center gap-1.5")}><Icon name={serverLabel ? 'globe' : 'desktop'} size={14} />{serverLabel ? '远端' : '本地'}</span>}
      {operationsControl}
      {(interactive ? branchControl : undefined) ?? (branch ? <button type="button" disabled={!interactive} onClick={onGitOpen} aria-label={`当前分支：${branch}`} className={tw("composer-context__branch inline-flex h-control-xs min-w-0 max-w-[35%] items-center gap-1.5 rounded-md border-0 bg-transparent px-0.5 hover:bg-[var(--surface-hover)]")} title="Git：分支与更改">
        <Icon name="branch" size={14} />
        <span className={tw("truncate font-semibold text-[var(--foreground)]")}>{branch}</span>
      </button> : null)}
      </> : null}
      {agentPresetControl}
      <ContextWindowIndicator breakdown={contextBreakdown} compactDisabled={compactDisabled} onCompact={onCompactContext} pressure={contextPressure} />
    </div>
  )
}
