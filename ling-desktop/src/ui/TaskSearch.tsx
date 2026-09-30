import { Button } from '@heroui/react/button'
import { InputGroup } from '@heroui/react/input-group'
import { ListBox } from '@heroui/react/list-box'
import { Spinner } from '@heroui/react/spinner'
import { TextField } from '@heroui/react/textfield'
import type { ChangeEvent } from 'react'
import type { LingTaskSearchMatch, LingWorkspaceSummary } from '../runtime/contract.js'
import { Icon } from './Icon.js'
import { tw } from './tailwind.js'

interface TaskSearchProps {
  readonly hasMore: boolean
  readonly isLoading: boolean
  readonly message?: string
  readonly onClose: () => void
  readonly onQueryChange: (value: string) => void
  readonly onSelect: (taskId: string) => void
  readonly open: boolean
  readonly query: string
  readonly results: readonly LingTaskSearchMatch[]
  readonly workspaces: readonly LingWorkspaceSummary[]
}

export function TaskSearch({
  hasMore,
  isLoading,
  message,
  onClose,
  onQueryChange,
  onSelect,
  open,
  query,
  results,
  workspaces,
}: TaskSearchProps) {
  if (!open) return null

  const hasQuery = query.trim().length > 0
  const workspaceNames = new Map(workspaces.map(workspace => [workspace.workspaceId, workspace.label]))

  return (
    <div className={tw("task-search-layer fixed [z-index:30] [inset:0] grid [padding:min(14vh,_calc(var(--space-unit)*32))_calc(var(--space-unit)*5)_calc(var(--space-unit)*5)] [background:var(--overlay-scrim)] [place-items:start_center] [backdrop-filter:blur(3px)] max-[700px]:pt-18")} role="presentation" onMouseDown={onClose}>
      <section
        aria-label="搜索任务"
        aria-modal="true"
        className={tw("task-search [width:min(38rem,_100%)] overflow-hidden [border:1px_solid_var(--panel-border)] rounded-2xl [background:var(--surface)] [box-shadow:var(--overlay-shadow)]")}
        onMouseDown={event => { event.stopPropagation() }}
        role="dialog"
      >
        <div className={tw("task-search__topline flex [min-height:2.8rem] items-center justify-between pt-1.5 pr-2 pb-0.5 pl-4 [color:var(--text-secondary)] text-xs [font-weight:590]")}>
          <span>任务搜索</span>
          <Button aria-label="关闭搜索" isIconOnly onPress={onClose} size="sm" variant="ghost">
            <Icon name="close" size={17} />
          </Button>
        </div>
        <TextField aria-label="搜索任务" fullWidth name="task-search">
          <InputGroup className={tw("task-search__input mx-3 w-[calc(100%-1.5rem)] rounded-xl border border-[var(--panel-border)] bg-[var(--surface-secondary)]")} fullWidth variant="secondary">
            <InputGroup.Prefix><Icon name="search" size={18} /></InputGroup.Prefix>
            <InputGroup.Input
              autoFocus
              className={tw("text-sm")}
              onChange={(event: ChangeEvent<HTMLInputElement>) => { onQueryChange(event.target.value) }}
              placeholder="搜索任务、消息或工作区"
              value={query}
            />
            <InputGroup.Suffix>
              {isLoading ? <Spinner color="current" size="sm" /> : <kbd className={tw("rounded border border-[var(--panel-border)] bg-[var(--surface)] px-1 py-px font-[inherit] text-micro text-[var(--text-secondary)]")}>Esc</kbd>}
            </InputGroup.Suffix>
          </InputGroup>
        </TextField>
        <div className={tw("task-search__body [min-height:8rem] pt-2 px-2 pb-2.5")}>
          {isLoading ? <p className={tw("task-search__state flex [min-height:7rem] items-center justify-center gap-2 m-0 [color:var(--text-tertiary)] text-xs")}><Spinner size="sm" /> 正在搜索</p> : null}
          {!isLoading && message ? <p className={tw("task-search__state flex [min-height:7rem] items-center justify-center gap-2 m-0 [color:var(--text-tertiary)] text-xs task-search__state--error [color:var(--danger)]")}>{message}</p> : null}
          {!isLoading && !message && !hasQuery ? <p className={tw("task-search__state flex [min-height:7rem] items-center justify-center gap-2 m-0 [color:var(--text-tertiary)] text-xs")}>输入关键词，搜索任务、消息或工作区。</p> : null}
          {!isLoading && !message && hasQuery && results.length === 0 ? <p className={tw("task-search__state flex [min-height:7rem] items-center justify-center gap-2 m-0 [color:var(--text-tertiary)] text-xs")}>没有匹配的任务。</p> : null}
          {!isLoading && !message && results.length > 0 ? (
            <ListBox
              aria-label="搜索结果"
              className={tw("task-search__results grid [max-height:min(24rem,_52vh)] overflow-auto gap-0.5")}
              onAction={(key: string | number) => { onSelect(String(key)) }}
              selectionMode="none"
            >
              {results.map(result => (
                <ListBox.Item
                  className={tw("task-search__result grid min-w-0 [grid-template-columns:1.2rem_minmax(0,_1fr)_auto] items-center gap-2 py-2.5 px-2.5 rounded-xl [color:var(--text-secondary)] [&[data-focused='true']]:[background:var(--surface-secondary)] [&[data-focused='true']]:[color:var(--foreground)] hover:[background:var(--surface-secondary)] hover:[color:var(--foreground)]")}
                  id={result.taskId}
                  key={result.taskId}
                  textValue={result.title ?? result.snippet}
                >
                  <Icon name="compose" size={16} />
                  <span className={tw("task-search__result-copy grid min-w-0 gap-0.5")}>
                    <strong className={tw("overflow-hidden text-ellipsis whitespace-nowrap text-compact font-[580]")} title={result.title}>{result.title ?? '未命名任务'}</strong>
                    <small className={tw("overflow-hidden text-ellipsis whitespace-nowrap text-caption text-[var(--text-tertiary)]")} title={result.snippet}>{result.snippet}</small>
                  </span>
                  {workspaceNames.get(result.workspaceId ?? '')
                    ? <span className={tw("task-search__result-workspace [max-width:9rem] overflow-hidden text-ellipsis whitespace-nowrap [color:var(--text-tertiary)] text-caption")} title={workspaceNames.get(result.workspaceId ?? '')}>{workspaceNames.get(result.workspaceId ?? '')}</span>
                    : null}
                </ListBox.Item>
              ))}
            </ListBox>
          ) : null}
          {!isLoading && !message && hasMore ? <p className={tw("task-search__more mt-1.5 mx-1 mb-0 [color:var(--text-tertiary)] text-caption")}>结果较多，请补充关键词。</p> : null}
        </div>
      </section>
    </div>
  )
}
