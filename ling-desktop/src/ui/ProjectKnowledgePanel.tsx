import { useEffect, useRef, useState } from 'react'
import type {
  KnowledgeDocument,
  KnowledgeHit,
  KnowledgeRequest,
  KnowledgeResponse,
  KnowledgeSource,
  LingKnowledgeService,
} from '../runtime/knowledge.js'
import { Markdown } from './Markdown.js'
import { tw } from './tailwind.js'

const kinds = {
  card: '知识卡片',
  reference: '资料',
  wiki: 'Wiki',
  summary: '会话总结',
  memory: '项目记忆',
  code: '代码',
  history: '会话',
}
const link =
  'rounded-md border-0 bg-transparent px-2 py-1.5 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] focus-visible:outline-2 focus-visible:outline-[var(--focus)]'
type ReadRequest = Extract<
  KnowledgeRequest,
  { type: 'snapshot' | 'search' | 'read' | 'source' }
>

export function projectKnowledgeDocuments(
  documents: readonly KnowledgeDocument[],
): KnowledgeDocument[] {
  return documents
    .filter((doc) => doc.state === 'active' || doc.state === 'stale')
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

/** A project-bound reader. Management and scope selection belong to the main page. */
export function ProjectKnowledgePanel({
  service,
  workspaceId,
  remoteTaskId,
  workspaceLabel,
  onOpenTask,
  onOpenCenter,
}: {
  service?: LingKnowledgeService
  workspaceId?: string
  remoteTaskId?: string
  workspaceLabel: string
  onOpenTask: (id: string) => void
  onOpenCenter: (documentId?: string) => void
}) {
  const [documents, setDocuments] = useState<KnowledgeDocument[]>()
  const [query, setQuery] = useState(''),
    [hits, setHits] = useState<KnowledgeHit[]>()
  const [selected, setSelected] = useState<KnowledgeDocument>()
  const [sourceView, setSourceView] = useState<{
    source: KnowledgeSource
    text: string
    stale?: boolean
  }>()
  const [error, setError] = useState(''),
    [pending, setPending] = useState(false),
    [refresh, setRefresh] = useState(0)
  const epoch = useRef(0),
    operation = useRef<AbortController | undefined>(undefined)
  const available = Boolean(workspaceId || remoteTaskId)
  const scope = remoteTaskId
    ? { workspaceId: null, taskId: remoteTaskId }
    : { workspaceId: workspaceId ?? null }
  useEffect(() => {
    const generation = ++epoch.current,
      controller = new AbortController()
    setDocuments(undefined)
    setSelected(undefined)
    setSourceView(undefined)
    setHits(undefined)
    setQuery('')
    setError('')
    setPending(false)
    if (!service || !available)
      return () => {
        epoch.current++
        controller.abort()
      }
    const load = async () => {
      try {
        const result = await service.request(
          { type: 'snapshot', ...scope },
          controller.signal,
        )
        if (controller.signal.aborted || generation !== epoch.current) return
        if (result.ok) {
          setDocuments(
            projectKnowledgeDocuments(result.value.snapshot?.documents ?? []),
          )
          setError('')
        } else setError(result.message ?? '项目知识暂时无法读取。')
      } catch (error) {
        if (!controller.signal.aborted && generation === epoch.current)
          setError(
            error instanceof Error ? error.message : '项目知识暂时无法读取。',
          )
      }
    }
    void load()
    const timer = setInterval(() => {
      if (!document.hidden) void load()
    }, 3000)
    return () => {
      epoch.current++
      controller.abort()
      operation.current?.abort()
      clearInterval(timer)
    }
  }, [service, workspaceId, remoteTaskId, refresh])
  useEffect(() => {
    if (!service || !available || !query.trim()) {
      setHits(undefined)
      return
    }
    const controller = new AbortController(),
      generation = epoch.current
    const timer = setTimeout(() => {
      void service
        .request(
          { type: 'search', ...scope, query: query.trim() },
          controller.signal,
        )
        .then((result) => {
          if (controller.signal.aborted || generation !== epoch.current) return
          if (result.ok) setHits(result.value.hits ?? [])
          else setError(result.message ?? '搜索失败。')
        })
        .catch((error) => {
          if (!controller.signal.aborted && generation === epoch.current)
            setError(error instanceof Error ? error.message : '搜索失败。')
        })
    }, 300)
    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [service, workspaceId, remoteTaskId, query])
  const read = async (
    request: ReadRequest,
  ): Promise<KnowledgeResponse | undefined> => {
    if (!service || !available) return
    operation.current?.abort()
    const controller = new AbortController(),
      generation = epoch.current
    operation.current = controller
    setPending(true)
    setError('')
    try {
      const result = await service.request(
        { ...request, ...scope },
        controller.signal,
      )
      if (controller.signal.aborted || generation !== epoch.current) return
      if (result.ok) return result.value
      setError(result.message ?? '内容暂时无法读取。')
    } catch (error) {
      if (!controller.signal.aborted && generation === epoch.current)
        setError(error instanceof Error ? error.message : '内容暂时无法读取。')
    } finally {
      if (!controller.signal.aborted && generation === epoch.current)
        setPending(false)
    }
  }
  const open = async (id: string) => {
    const result = await read({ type: 'read', ...scope, id })
    if (result?.document) {
      setSelected(result.document)
      setSourceView(undefined)
    }
  }
  const showSource = async (source: KnowledgeSource) => {
    const result = await read({ type: 'source', ...scope, source })
    if (result?.text !== undefined)
      setSourceView({ source, text: result.text, stale: result.stale })
  }
  return (
    <section
      aria-label="当前项目知识"
      aria-busy={pending}
      className={tw(
        'flex min-h-0 flex-1 flex-col gap-3 overflow-hidden px-4 pb-4 text-[var(--foreground)]',
      )}
    >
      <div className={tw('flex min-w-0 items-center justify-between gap-3')}>
        <span
          title={workspaceLabel}
          className={tw('truncate text-xs text-[var(--text-secondary)]')}
        >
          {available ? workspaceLabel : '未选择项目'}
        </span>
        <button
          type="button"
          className={tw(link, 'shrink-0')}
          onClick={() => onOpenCenter(selected?.id)}
        >
          打开知识中心
        </button>
      </div>
      {!available ? (
        <p className={tw('text-xs leading-6 text-[var(--text-secondary)]')}>
          选择项目后查看相关知识。
        </p>
      ) : !service ? (
        <p className={tw('text-xs leading-6 text-[var(--text-secondary)]')}>
          知识服务暂不可用，请重启应用。
        </p>
      ) : (
        <>
          <input
            aria-label="搜索当前项目知识"
            placeholder="搜索当前项目…"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setSelected(undefined)
              setSourceView(undefined)
            }}
            className={tw(
              'w-full rounded-lg border border-[var(--panel-border)] bg-[var(--surface)] px-3 py-2 text-xs outline-none focus:border-[var(--focus)]',
            )}
          />
          <div className={tw('min-h-0 flex-1 overflow-auto')}>
            {error ? (
              <div
                role="alert"
                className={tw('mb-3 text-xs leading-6 text-[var(--danger)]')}
              >
                {error}
                <button
                  className={tw(link)}
                  type="button"
                  onClick={() => setRefresh((value) => value + 1)}
                >
                  重新读取
                </button>
              </div>
            ) : null}
            {sourceView ? (
              <div className={tw('grid gap-3')}>
                <button
                  className={tw(link, 'justify-self-start')}
                  type="button"
                  onClick={() => setSourceView(undefined)}
                >
                  返回
                </button>
                <p
                  className={tw(
                    'm-0 break-all text-xs text-[var(--text-secondary)]',
                  )}
                >
                  {sourceView.source.label}
                  {sourceView.stale ? ' · 来源已变更' : ''}
                </p>
                {sourceView.source.sessionId ? (
                  <button
                    className={tw(link, 'justify-self-start')}
                    type="button"
                    onClick={() => onOpenTask(sourceView.source.sessionId!)}
                  >
                    打开会话
                  </button>
                ) : null}
                <pre
                  className={tw(
                    'm-0 overflow-x-auto whitespace-pre-wrap break-words rounded-lg bg-[var(--surface-secondary)] p-3 text-xs leading-6',
                  )}
                >
                  {sourceView.text}
                </pre>
              </div>
            ) : selected ? (
              <article className={tw('grid min-w-0 gap-3')}>
                <button
                  className={tw(link, 'justify-self-start')}
                  type="button"
                  onClick={() => setSelected(undefined)}
                >
                  返回列表
                </button>
                <div>
                  <p
                    className={tw(
                      'mb-1 mt-0 text-xs text-[var(--text-tertiary)]',
                    )}
                  >
                    {kinds[selected.kind]}
                    {selected.state === 'stale' ? ' · 来源已变更' : ''}
                  </p>
                  <h2 className={tw('m-0 break-words text-base font-semibold')}>
                    {selected.title}
                  </h2>
                </div>
                <div className={tw('text-sm leading-7')}>
                  <Markdown source={selected.body} />
                </div>
                {selected.sources.length ? (
                  <div className={tw('grid gap-1')} aria-label="知识来源">
                    {selected.sources.map((source, index) => (
                      <button
                        key={index}
                        className={tw(link, 'truncate')}
                        type="button"
                        onClick={() => void showSource(source)}
                      >
                        {source.label}
                      </button>
                    ))}
                  </div>
                ) : null}
              </article>
            ) : hits ? (
              <div className={tw('grid gap-1')}>
                <p
                  className={tw('m-0 py-2 text-xs text-[var(--text-tertiary)]')}
                >
                  {hits.length
                    ? `${hits.length} 个结果`
                    : '当前项目没有匹配结果。'}
                </p>
                {hits.map((hit) => (
                  <button
                    key={`${hit.kind}:${hit.id}`}
                    type="button"
                    className={tw(
                      'grid gap-1 rounded-lg border-0 bg-transparent px-2 py-3 text-left hover:bg-[var(--surface-hover)]',
                    )}
                    onClick={() => {
                      if (hit.kind === 'code' || hit.kind === 'history') {
                        if (hit.source) void showSource(hit.source)
                      } else void open(hit.id)
                    }}
                  >
                    <span className={tw('text-xs text-[var(--text-tertiary)]')}>
                      {kinds[hit.kind]}
                    </span>
                    <strong className={tw('break-all text-sm font-medium')}>
                      {hit.title}
                    </strong>
                    <span
                      className={tw(
                        'line-clamp-2 text-xs leading-5 text-[var(--text-secondary)]',
                      )}
                    >
                      {hit.snippet}
                    </span>
                  </button>
                ))}
              </div>
            ) : documents?.length ? (
              <div className={tw('grid gap-5')}>
                {(
                  ['card', 'wiki', 'reference', 'summary', 'memory'] as const
                ).map((kind) => {
                  const items = documents.filter((doc) => doc.kind === kind)
                  return items.length ? (
                    <section key={kind}>
                      <h3
                        className={tw(
                          'mb-1 mt-0 text-xs font-medium text-[var(--text-secondary)]',
                        )}
                      >
                        {kinds[kind]}
                      </h3>
                      {items.map((doc) => (
                        <button
                          key={doc.id}
                          className={tw(
                            'grid w-full gap-1 rounded-lg border-0 bg-transparent px-2 py-2.5 text-left hover:bg-[var(--surface-hover)]',
                          )}
                          type="button"
                          onClick={() => void open(doc.id)}
                        >
                          <span className={tw('text-sm')}>{doc.title}</span>
                          <span
                            className={tw(
                              'line-clamp-2 text-xs leading-5 text-[var(--text-tertiary)]',
                            )}
                          >
                            {doc.body.slice(0, 160)}
                          </span>
                        </button>
                      ))}
                    </section>
                  ) : null
                })}
              </div>
            ) : (
              <p
                className={tw(
                  'my-4 text-xs leading-6 text-[var(--text-secondary)]',
                )}
              >
                {documents
                  ? '当前项目暂无知识。可在知识中心整理。'
                  : error
                    ? ''
                    : '正在读取项目知识…'}
              </p>
            )}
          </div>
        </>
      )}
    </section>
  )
}
