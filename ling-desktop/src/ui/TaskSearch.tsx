import { Button } from '@heroui/react/button'
import { InputGroup } from '@heroui/react/input-group'
import { ListBox } from '@heroui/react/list-box'
import { Spinner } from '@heroui/react/spinner'
import { TextField } from '@heroui/react/textfield'
import type { ChangeEvent } from 'react'
import type { LingTaskSearchMatch } from '../runtime/contract.js'
import { Icon } from './Icon.js'

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
}: TaskSearchProps) {
  if (!open) return null

  const hasQuery = query.trim().length > 0

  return (
    <div className="task-search-layer" role="presentation" onMouseDown={onClose}>
      <section
        aria-label="搜索任务"
        aria-modal="true"
        className="task-search"
        onMouseDown={event => { event.stopPropagation() }}
        role="dialog"
      >
        <div className="task-search__topline">
          <span>任务搜索</span>
          <Button aria-label="关闭搜索" isIconOnly onPress={onClose} size="sm" variant="ghost">
            <Icon name="close" size={17} />
          </Button>
        </div>
        <TextField aria-label="搜索任务" fullWidth name="task-search">
          <InputGroup className="task-search__input" fullWidth variant="secondary">
            <InputGroup.Prefix><Icon name="search" size={18} /></InputGroup.Prefix>
            <InputGroup.Input
              autoFocus
              onChange={(event: ChangeEvent<HTMLInputElement>) => { onQueryChange(event.target.value) }}
              placeholder="搜索任务中的消息和标题"
              value={query}
            />
            <InputGroup.Suffix>
              {isLoading ? <Spinner color="current" size="sm" /> : <kbd>Esc</kbd>}
            </InputGroup.Suffix>
          </InputGroup>
        </TextField>
        <div className="task-search__body">
          {isLoading ? <p className="task-search__state"><Spinner size="sm" /> 正在搜索</p> : null}
          {!isLoading && message ? <p className="task-search__state task-search__state--error">{message}</p> : null}
          {!isLoading && !message && !hasQuery ? <p className="task-search__state">输入关键词，在任务记录中查找。</p> : null}
          {!isLoading && !message && hasQuery && results.length === 0 ? <p className="task-search__state">没有匹配的任务。</p> : null}
          {!isLoading && !message && results.length > 0 ? (
            <ListBox
              aria-label="搜索结果"
              className="task-search__results"
              onAction={(key: string | number) => { onSelect(String(key)) }}
              selectionMode="none"
            >
              {results.map(result => (
                <ListBox.Item
                  className="task-search__result"
                  id={result.taskId}
                  key={result.taskId}
                  textValue={result.title ?? result.snippet}
                >
                  <Icon name="compose" size={16} />
                  <span className="task-search__result-copy">
                    <strong>{result.title ?? '未命名任务'}</strong>
                    <small>{result.snippet}</small>
                  </span>
                  {result.workspaceId ? <Icon name="folder" size={15} /> : null}
                </ListBox.Item>
              ))}
            </ListBox>
          ) : null}
          {!isLoading && !message && hasMore ? <p className="task-search__more">结果较多，请补充关键词。</p> : null}
        </div>
      </section>
    </div>
  )
}
