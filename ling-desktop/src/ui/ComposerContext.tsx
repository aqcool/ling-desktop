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
    <div aria-label="当前工作区" className={tw("composer-context relative flex min-h-8 min-w-0 items-center gap-3 px-1 pt-0.5 text-xs leading-4 text-[var(--text-secondary)]")} ref={rootRef}>
      {showEnvironment ? <>
      <div className={tw("composer-context__anchor relative min-w-0 max-w-[45%] shrink")}>
        <button disabled={!interactive} aria-expanded={open === 'workspace'} aria-haspopup="menu" className={tw("composer-context__item inline-flex h-6 max-w-full min-w-0 cursor-pointer items-center gap-1.5 rounded-md border-0 bg-transparent px-0.5 text-inherit hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)]")} onClick={() => { setQuery(''); setOpen(current => current === 'workspace' ? null : 'workspace') }} title={workspaceLabel} type="button">
          <Icon name={serverLabel ? 'globe' : 'folderOpen'} size={14} /><span className={tw("truncate")}>{workspaceLabel}</span>
        </button>
        {open === 'workspace' ? (
          <div aria-label="选择工作区" className={tw("composer-context__popover absolute [z-index:30] [bottom:calc(100%_+_0.55rem)] [left:0] [padding:0.35rem] [border:1px_solid_#e8e0d8] [border-radius:0.65rem] [background:#fff] [box-shadow:0_16px_42px_rgb(57_41_25_/_0.14)] dark:[border-color:#34343a] dark:[background:#232327] composer-context__popover--workspace [width:12.5rem]")} role="menu">
            <label className={tw("composer-context__search flex h-9 items-center gap-2 rounded-lg bg-[#f1f0ee] px-2.5 text-[#97938c] dark:bg-[#303035]")}><Icon name="search" size={16} /><input className={tw("w-full min-w-0 border-0 bg-transparent p-0 text-[0.8rem] text-[#333] outline-0 placeholder:text-[#9b9892] dark:text-[#ededee]")} aria-label="搜索名称或路径" onChange={event => { setQuery(event.target.value) }} placeholder="搜索名称或路径" ref={searchRef} value={query} /></label>
            <div className={tw("composer-context__workspace-list [max-height:13rem] overflow-y-auto [padding-top:0.3rem]")}>
              {visibleWorkspaces.map(workspace => (
                <button className={tw("composer-context__option flex w-full [min-height:2rem] items-center [gap:0.55rem] [padding:0.35rem_0.55rem] border-0 [border-radius:0.4rem] bg-transparent [color:#33312f] [font:inherit] [font-size:0.8rem] text-left cursor-pointer enabled:hover:[background:#f4f3f1] disabled:[color:#a8a49d] disabled:cursor-not-allowed dark:[color:#e1e1e3] dark:enabled:hover:[background:#303035] dark:disabled:[color:#77777d]")} key={workspace.workspaceId} onClick={() => { onSelectWorkspace(workspace.workspaceId); setOpen(null) }} role="menuitem" title={workspace.locationLabel} type="button"><Icon name="folder" size={17} /><span className={tw("min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap")}>{workspace.label}</span></button>
              ))}
              {visibleWorkspaces.length === 0 ? <p className={tw("composer-context__empty m-0 [padding:0.65rem_0.5rem] [color:#98948d] [font-size:0.75rem] text-center")}>没有匹配项</p> : null}
            </div>
            <div className={tw("composer-context__separator [height:1px] [margin:0.35rem_0.3rem] [background:#e9e4dd] dark:[background:#34343a]")} />
            <button className={tw("composer-context__option flex w-full [min-height:2rem] items-center [gap:0.55rem] [padding:0.35rem_0.55rem] border-0 [border-radius:0.4rem] bg-transparent [color:#33312f] [font:inherit] [font-size:0.8rem] text-left cursor-pointer enabled:hover:[background:#f4f3f1] disabled:[color:#a8a49d] disabled:cursor-not-allowed dark:[color:#e1e1e3] dark:enabled:hover:[background:#303035] dark:disabled:[color:#77777d]")} onClick={() => { setOpen(null); onCreateWorkspace() }} role="menuitem" type="button"><Icon name="desktop" size={17} /><span className={tw("min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap")}>新建本地工作区</span></button>
            <button className={tw("composer-context__option flex w-full [min-height:2rem] items-center [gap:0.55rem] [padding:0.35rem_0.55rem] border-0 [border-radius:0.4rem] bg-transparent [color:#33312f] [font:inherit] [font-size:0.8rem] text-left cursor-pointer enabled:hover:[background:#f4f3f1] disabled:[color:#a8a49d] disabled:cursor-not-allowed dark:[color:#e1e1e3] dark:enabled:hover:[background:#303035] dark:disabled:[color:#77777d]")} onClick={() => { onSelectWithoutWorkspace(); setOpen(null) }} role="menuitem" type="button"><Icon name="folder" size={17} /><span className={tw("min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap")}>不指定工作区</span></button>
          </div>
        ) : null}
      </div>
      {locationControl ?? <span className={tw('inline-flex h-6 shrink-0 items-center gap-1.5')}><Icon name={serverLabel ? 'globe' : 'desktop'} size={14} />{serverLabel ? '远端' : '本地'}</span>}
      {operationsControl}
      {(interactive ? branchControl : undefined) ?? (branch ? <button type="button" disabled={!interactive} onClick={onGitOpen} aria-label={`当前分支：${branch}`} className={tw("composer-context__branch inline-flex h-6 min-w-0 max-w-[35%] items-center gap-1.5 rounded-md border-0 bg-transparent px-0.5 hover:bg-[var(--surface-hover)]")} title="Git：分支与更改">
        <Icon name="branch" size={14} />
        <span className={tw("truncate font-semibold text-[var(--foreground)]")}>{branch}</span>
      </button> : null)}
      </> : null}
      {agentPresetControl}
      <ContextWindowIndicator breakdown={contextBreakdown} compactDisabled={compactDisabled} onCompact={onCompactContext} pressure={contextPressure} />
    </div>
  )
}
