import { useId, useState } from 'react'
import type {
  KnowledgeDocument,
  LingKnowledgeService,
} from '../runtime/knowledge.js'
import { useKnowledge } from './useKnowledge.js'
import { Icon } from './Icon.js'
import { tw } from './tailwind.js'

export function latestTaskRecap(
  documents: readonly KnowledgeDocument[],
  taskId: string,
) {
  return documents
    .filter(
      (doc) =>
        doc.kind === 'summary' &&
        doc.state === 'active' &&
        doc.sources.some(
          (source) => source.kind === 'session' && source.sessionId === taskId,
        ),
    )
    .sort((a, b) => b.updatedAt - a.updatedAt)[0]
}

export function recapText(body: string) {
  return body
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+.*(?:\r?\n|$)/gm, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/```[^\n]*\n|```|\*\*|`/g, '')
    .replace(/^\s*(?:[-*+] |\d+[.)] )/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function TaskRecapCard({
  document,
  onOpen,
}: {
  document: KnowledgeDocument
  onOpen: (id: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const previewId = useId()
  const date = new Date(document.updatedAt)
  return (
    <section
      aria-label="当前会话摘要"
      className={tw(
        'mb-4 grid w-full min-w-0 gap-2 rounded-xl border border-[var(--panel-border)] bg-[var(--field-background)] p-3.5 text-left shadow-[var(--field-shadow)]',
      )}
    >
      <Icon
        name="feather"
        size={22}
        className={tw('text-[var(--plan-mode-foreground)]')}
      />
      <span className={tw('text-caption text-[var(--text-tertiary)]')}>
        更新于{' '}
        <time dateTime={date.toISOString()} title={date.toLocaleString()}>
          {date.toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
          })}
        </time>
      </span>
      <div
        id={previewId}
        className={tw(
          'relative break-words text-compact leading-[var(--line-copy)] text-[var(--text-secondary)]',
          !expanded && 'h-36 overflow-hidden',
        )}
      >
        <p className={tw('m-0')}>{recapText(document.body) || document.title}</p>
        {!expanded ? (
          <span
            aria-hidden="true"
            className={tw('pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-[linear-gradient(to_bottom,transparent,var(--field-background))]')}
          />
        ) : null}
      </div>
      <div className={tw('flex items-center justify-between gap-2 text-caption text-[var(--text-tertiary)]')}>
        <button
          type="button"
          aria-label={expanded ? '收起摘要' : '展开摘要'}
          aria-controls={previewId}
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
          className={tw('flex items-center gap-1 rounded px-1 py-0.5 transition-colors hover:text-[var(--foreground)] focus-visible:outline-2 focus-visible:outline-[var(--focus)]')}
        >
          {expanded ? '收起' : '展开'}
          <Icon name="chevronDown" size={12} className={tw(expanded && 'rotate-180')} />
        </button>
        <button
          type="button"
          aria-label="查看当前会话摘要"
          onClick={() => onOpen(document.id)}
          className={tw('rounded px-1 py-0.5 transition-colors hover:text-[var(--foreground)] focus-visible:outline-2 focus-visible:outline-[var(--focus)]')}
        >
          完整摘要
        </button>
      </div>
    </section>
  )
}

/** A read-only view of an existing summary; rendering never schedules generation. */
export function TaskRecap({
  service,
  workspaceId,
  remoteTaskId,
  taskId,
  onOpen,
}: {
  service?: LingKnowledgeService
  workspaceId?: string
  remoteTaskId?: string
  taskId: string
  onOpen: (id: string) => void
}) {
  const { snapshot } = useKnowledge(
    workspaceId || remoteTaskId ? service : undefined,
    remoteTaskId
      ? { workspaceId: null, taskId: remoteTaskId }
      : { workspaceId: workspaceId ?? null },
  )
  const summary = latestTaskRecap(snapshot?.documents ?? [], taskId)
  return summary ? <TaskRecapCard document={summary} onOpen={onOpen} /> : null
}
