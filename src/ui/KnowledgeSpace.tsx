import { useEffect, useRef, useState } from 'react'
import type {
  KnowledgeDocument,
  KnowledgeHit,
  KnowledgeLibrary,
  KnowledgeSource,
  LingKnowledgeService,
} from '../runtime/knowledge.js'
import { CompactButton, CompactInput } from './SettingsControls.js'
import { KnowledgeReader } from './KnowledgeReader.js'
import { KnowledgeGraph } from './KnowledgeGraph.js'
import { useKnowledge, type KnowledgeScopeInput } from './useKnowledge.js'
import {
  downloadKnowledge,
  knowledgeKinds,
  knowledgeOutline,
  knowledgePreview,
  knowledgeStates,
} from './knowledge-view.js'
import { Icon } from './Icon.js'
import { KnowledgeMenu } from './KnowledgeMenu.js'
import { KnowledgeImportDialog } from './KnowledgeDialogs.js'
import { WikiSetup } from './WikiSetup.js'
import { tw } from './tailwind.js'
const projectViews = [
  { id: 'wiki', label: 'Wiki 页面' },
  { id: 'card', label: '知识卡片' },
  { id: 'summary', label: '会话总结' },
  { id: 'code', label: '代码查找' },
  { id: 'graph', label: '代码图谱' },
] as const
type View = (typeof projectViews)[number]['id'] | 'reference' | 'memory'
export function KnowledgeSpace({
  service,
  scope,
  label,
  library,
  personal = false,
  memoryOnly = false,
  initialDocumentId,
  initialKind,
  currentTaskId,
  onBack,
  onSettings,
  onOpenTask,
  onEditLibrary,
  onDeleteLibrary,
  onScopeLibrary,
}: {
  service?: LingKnowledgeService
  scope: KnowledgeScopeInput
  label: string
  library?: KnowledgeLibrary
  personal?: boolean
  memoryOnly?: boolean
  initialDocumentId?: string
  initialKind?: KnowledgeDocument['kind']
  currentTaskId?: string
  onBack: () => void
  onSettings: () => void
  onOpenTask: (id: string) => void
  onEditLibrary?: () => void
  onDeleteLibrary?: () => void
  onScopeLibrary?: () => void
}) {
  const { snapshot, error, pending, request, reload, report } = useKnowledge(
    service,
    scope,
  )
  const initialView: View = library
    ? 'reference'
    : personal || memoryOnly
      ? 'memory'
      : initialKind === 'summary' || initialKind === 'card'
        ? initialKind
        : 'wiki'
  const [view, setView] = useState<View>(initialView)
  const [selected, setSelected] = useState<KnowledgeDocument>(),
    [revisions, setRevisions] = useState<KnowledgeDocument[]>([]),
    [query, setQuery] = useState(''),
    [hits, setHits] = useState<KnowledgeHit[]>(),
    [sidebar, setSidebar] = useState(true),
    [configure, setConfigure] = useState(false),
    [importing, setImporting] = useState(false)
  const [source, setSource] = useState<{
      source: KnowledgeSource
      text: string
      stale?: boolean
    }>(),
    [graph, setGraph] = useState<{
      nodes: import('../runtime/knowledge.js').KnowledgeNode[]
      edges: import('../runtime/knowledge.js').KnowledgeEdge[]
    }>({ nodes: [], edges: [] }),
    [graphPath, setGraphPath] = useState<string[]>([])
  const [draft, setDraft] = useState<{
      title: string
      body: string
      sources: KnowledgeSource[]
    }>(),
    fileInput = useRef<HTMLInputElement>(null),
    reading = useRef(0),
    openingInitial = useRef(!!initialDocumentId),
    autoOpened = useRef<string | undefined>(undefined)
  const documents = (snapshot?.documents ?? []).filter(
    (doc) =>
      doc.kind === view &&
      doc.state !== 'archived' &&
      (!library || doc.libraryId === library.id),
  )
  const outline = knowledgeOutline(documents),
    selectedId = selected?.id
  const open = async (id: string) => {
    const serial = ++reading.current
    const value = await request({ type: 'read', ...scope, id })
    if (serial !== reading.current) return
    if (value?.document) {
      setConfigure(false)
      setSelected(value.document)
      setRevisions(value.revisions ?? [])
      setSource(undefined)
      setDraft(undefined)
    }
  }
  useEffect(() => {
    if (!initialDocumentId) return
    changeView(initialView)
    openingInitial.current = true
    let live = true
    void open(initialDocumentId).finally(() => {
      if (live) openingInitial.current = false
    })
    return () => { live = false }
  }, [initialDocumentId, initialView])
  useEffect(() => {
    if (!query.trim()) {
      setHits(undefined)
      return
    }
    let live = true
    const timer = setTimeout(() => {
      void request({
        type: 'search',
        ...scope,
        query: query.trim(),
        ...(library
          ? { libraryId: library.id }
          : { kind: view === 'graph' ? 'code' : view }),
      }).then((value) => {
        if (live && value?.hits) setHits(value.hits)
      })
    }, 300)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [query, view, library?.id])
  const showSource = async (value: KnowledgeSource) => {
    const serial = ++reading.current
    const result = await request({ type: 'source', ...scope, source: value })
    if (serial === reading.current && result?.text !== undefined)
      setSource({ source: value, text: result.text, stale: result.stale })
  }
  const loadGraph = async (nodeId?: string) => {
    const value = await request({
      type: 'graph',
      ...scope,
      ...(nodeId ? { nodeId } : {}),
    })
    if (value?.nodes) setGraph({ nodes: value.nodes, edges: value.edges ?? [] })
  }
  useEffect(() => {
    if (view === 'graph' && snapshot?.indexedAt)
      void loadGraph(graphPath.at(-1))
  }, [view, graphPath.join('|'), snapshot?.indexedAt])
  const changeView = (id: View) => {
    reading.current++
    openingInitial.current = false
    autoOpened.current = undefined
    setConfigure(false)
    setView(id)
    setSelected(undefined)
    setSource(undefined)
    setDraft(undefined)
    setQuery('')
    setHits(undefined)
  }
  useEffect(() => {
    const first = outline[0]?.document
    if (
      view !== 'wiki' ||
      openingInitial.current ||
      selected ||
      source ||
      draft ||
      query ||
      pending ||
      !first ||
      autoOpened.current === first.id
    )
      return
    autoOpened.current = first.id
    void open(first.id)
  }, [view, snapshot, pending, initialDocumentId])
  const saveDocument = async (value: {
    title: string
    body: string
    state?: KnowledgeDocument['state']
  }) => {
    if (!selected) return
    const result = await request({
      type: 'save',
      ...scope,
      document: {
        id: selected.id,
        version: selected.version,
        kind: selected.kind,
        libraryId: selected.libraryId,
        parentId: selected.parentId,
        position: selected.position,
        title: value.title,
        body: value.body,
        sources: selected.sources,
        state: value.state ?? selected.state,
      },
    })
    if (result?.document) {
      setSelected(result.document)
      setRevisions(result.revisions ?? [])
      reload()
    }
    return result
  }
  const createDocument = async () => {
    if (!draft) return
    const value = await request({
      type: 'save',
      ...scope,
      document: {
        kind: library ? 'reference' : view === 'wiki' ? 'wiki' : 'memory',
        ...(library ? { libraryId: library.id } : {}),
        title: draft.title,
        body: draft.body,
        sources: draft.sources,
        state: 'active',
      },
    })
    if (value?.document) {
      setSelected(value.document)
      setRevisions(value.revisions ?? [])
      setDraft(undefined)
      reload()
    }
  }
  const importText = async (file: File) => {
    if (!/\.(md|markdown|txt)$/i.test(file.name) || file.size > 512000) {
      report('请选择 512 KB 以内的 Markdown 或文本文件。')
      return
    }
    try {
      const body = await file.text()
      if (!body.trim() || body.length > 128000) {
        report('资料为空或超过 128,000 字符。')
        return
      }
      setImporting(false)
      report('')
      setSelected(undefined)
      setSource(undefined)
      setQuery('')
      setDraft({
        title: file.name.replace(/\.(md|markdown|txt)$/i, ''),
        body,
        sources: [{ kind: 'manual', label: `导入文件：${file.name}` }],
      })
    } catch {
      report('文件无法读取，请重新选择。')
    }
  }
  const start = async (type: 'wiki' | 'index' | 'summarize') => {
    const value = await request(
      type === 'summarize'
        ? { type, ...scope, sessionId: currentTaskId ?? '' }
        : { type, ...scope },
    )
    if (value) reload()
  }
  const activeJobs = (snapshot?.jobs ?? []).filter(
    (job) =>
      !library &&
      ['queued', 'running', 'failed', 'cancelled'].includes(job.status) &&
      (view === 'wiki' || view === 'card'
        ? job.kind === 'wiki'
        : view === 'summary'
          ? job.kind === 'summary'
          : view === 'code' || view === 'graph'
            ? job.kind === 'index'
            : false),
  )
  const isProject = !library && !personal && !memoryOnly
  const isWiki = isProject && (view === 'wiki' || view === 'card')
  const directoryLabel = library
    ? '资料目录'
    : view === 'memory'
      ? '记忆目录'
      : view === 'summary'
        ? '会话总结目录'
        : view === 'code' || view === 'graph'
          ? '代码检索'
          : 'Wiki 目录'
  const wikiDocuments = (snapshot?.documents ?? []).filter(
    (doc) => doc.kind === 'wiki' && doc.state !== 'archived',
  )
  const wikiRunning = (snapshot?.jobs ?? []).some(
    (job) => job.kind === 'wiki' && ['queued', 'running'].includes(job.status),
  )
  const modelReady = !!snapshot?.settings.provider && !!snapshot?.settings.model
  const hasDirectory = library
    ? !!(documents.length || draft || selected)
    : isWiki
      ? !!(documents.length || selected || source || activeJobs.length)
      : view === 'summary'
        ? !!(documents.length || currentTaskId || activeJobs.length)
        : true
  return (
    <section
      className={tw('flex min-h-0 flex-1 flex-col overflow-hidden')}
      aria-label={
        personal || memoryOnly
          ? '记忆管理'
          : library
            ? '知识库资料'
            : '项目知识页面'
      }
    >
      <header
        className={tw(
          'flex min-h-14 items-center justify-between gap-3 px-5 py-2 max-[700px]:px-4',
        )}
      >
        <div className={tw('flex min-w-0 items-center gap-2')}>
          <CompactButton
            variant="tertiary"
            onPress={onBack}
            className={tw('px-1 text-sm')}
          >
            {memoryOnly
              ? '返回记忆设置'
              : library
                ? '知识库'
                : 'Repo Wiki'}
          </CompactButton>
          <span className={tw('text-sm text-[var(--text-tertiary)]')}>/</span>
          <strong className={tw('truncate text-sm font-medium')}>
            {label}
          </strong>
        </div>
        <div className={tw('flex shrink-0 items-center gap-2')}>
          {library || isWiki ? (
            <KnowledgeMenu
              items={
                library
                  ? [
                      {
                        id: 'rename',
                        label: '重命名',
                        action: () => onEditLibrary?.(),
                      },
                      {
                        id: 'scope',
                        label: '管理生效范围',
                        action: () => onScopeLibrary?.(),
                      },
                      {
                        id: 'export',
                        label: '导出知识库',
                        action: () => {
                          void request({
                            type: 'export',
                            ...scope,
                            libraryId: library.id,
                          }).then((value) => {
                            if (value?.text)
                              downloadKnowledge(value.text, library.name)
                          })
                        },
                      },
                      {
                        id: 'delete',
                        label: '删除知识库',
                        danger: true,
                        action: () => onDeleteLibrary?.(),
                      },
                    ]
                  : [
                      {
                        id: 'setup',
                        label: '生成设置',
                        action: () => setConfigure(true),
                      },
                      {
                        id: 'export',
                        label: view === 'card' ? '导出知识卡片' : '导出 Wiki',
                        action: () => {
                          void request({
                            type: 'export',
                            ...scope,
                            kind: view === 'card' ? 'card' : 'wiki',
                          }).then((value) => {
                            if (value?.text)
                              downloadKnowledge(value.text, `${label}-${view === 'card' ? 'cards' : 'wiki'}`)
                          })
                        },
                      },
                    ]
              }
            />
          ) : null}
          {hasDirectory ? (
            <CompactButton
              variant="tertiary"
              isIconOnly
              aria-label={sidebar ? '隐藏目录' : '显示目录'}
              aria-pressed={sidebar}
              onPress={() => setSidebar((value) => !value)}
            >
              <Icon name="panelLeft" size={17} />
            </CompactButton>
          ) : null}
        </div>
      </header>
      {isProject ? (
        <nav
          aria-label="项目知识视图"
          className={tw('flex shrink-0 flex-wrap gap-x-5 gap-y-1 border-b border-[var(--panel-border)] px-5 max-[700px]:px-4')}
        >
          {projectViews.map(item => (
            <button
              key={item.id}
              type="button"
              aria-current={view === item.id ? 'page' : undefined}
              onClick={() => { if (view !== item.id) changeView(item.id) }}
              className={tw(
                'border-0 border-b-2 border-solid border-transparent bg-transparent px-0 py-2.5 text-xs text-[var(--text-secondary)] hover:text-[var(--foreground)] focus-visible:outline-2 focus-visible:outline-[var(--focus)]',
                view === item.id && 'border-b-[var(--action)] font-medium text-[var(--foreground)]',
              )}
            >
              {item.label}
            </button>
          ))}
        </nav>
      ) : null}
      <div
        className={tw(
          'grid min-h-0 flex-1',
          sidebar && hasDirectory
            ? 'grid-cols-[260px_minmax(0,1fr)] max-[980px]:grid-cols-[210px_minmax(0,1fr)] max-[700px]:grid-cols-1 max-[700px]:grid-rows-[auto_minmax(0,1fr)]'
            : 'grid-cols-1',
        )}
      >
        {sidebar && hasDirectory ? (
          <aside
            aria-label={directoryLabel}
            className={tw(
              'flex min-h-0 flex-col gap-3 overflow-hidden border-r border-[var(--panel-border)] px-4 py-3 max-[700px]:max-h-48 max-[700px]:border-r-0 max-[700px]:border-b',
            )}
          >
            <div className={tw('flex items-center gap-2')}>
              <CompactInput
                aria-label={
                  library
                    ? '搜索当前知识库'
                    : view === 'code' || view === 'graph'
                      ? '搜索当前项目代码'
                      : view === 'card'
                        ? '搜索知识卡片'
                        : view === 'summary'
                          ? '搜索会话总结'
                          : view === 'memory'
                            ? '搜索记忆'
                            : '搜索 Wiki 页面'
                }
                value={query}
                maxLength={256}
                placeholder={
                  view === 'code' || view === 'graph'
                    ? '文件名、函数名…'
                    : library
                      ? '搜索知识'
                      : view === 'card'
                        ? '搜索知识卡片'
                        : view === 'summary'
                          ? '搜索会话总结'
                          : view === 'memory'
                            ? '搜索记忆'
                            : '搜索 Wiki 页面'
                }
                onChange={(
                  event: import('react').ChangeEvent<HTMLInputElement>,
                ) => {
                  setQuery(event.target.value)
                  setSource(undefined)
                }}
                className={tw('w-full')}
              />
            </div>
            {library ? (
              <div className={tw('flex items-center justify-between gap-1')}>
                <span className={tw('text-xs text-[var(--text-tertiary)]')}>
                  {documents.length} 份知识
                </span>
                <KnowledgeMenu
                  label="添加知识"
                  text="添加知识"
                  items={[
                    {
                      id: 'file',
                      label: '添加本地文件',
                      action: () => {
                        report('')
                        setImporting(true)
                      },
                    },
                    {
                      id: 'text',
                      label: '编写文档',
                      action: () => {
                        setSelected(undefined)
                        setSource(undefined)
                        setDraft({
                          title: '',
                          body: '',
                          sources: [{ kind: 'manual', label: '手工资料' }],
                        })
                      },
                    },
                  ]}
                />
              </div>
            ) : view === 'memory' ? (
              <CompactButton
                variant="tertiary"
                isDisabled={pending}
                onPress={() => {
                  setSelected(undefined)
                  setSource(undefined)
                  setDraft({
                    title: '',
                    body: '',
                    sources: [{ kind: 'manual', label: '手工记忆' }],
                  })
                }}
              >
                添加记忆
              </CompactButton>
            ) : view === 'summary' && currentTaskId ? (
              <CompactButton
                isDisabled={pending || !modelReady}
                onPress={() => {
                  void start('summarize')
                }}
              >
                总结当前会话
              </CompactButton>
            ) : view === 'code' || view === 'graph' ? (
              <CompactButton
                variant="tertiary"
                isDisabled={pending}
                onPress={() => {
                  void start('index')
                }}
              >
                {snapshot?.indexedAt ? '刷新索引' : '建立代码索引'}
              </CompactButton>
            ) : null}
            <nav
              className={tw('min-h-0 flex-1 overflow-auto')}
              aria-label="页面列表"
            >
              {outline.map(({ document: doc, depth }) => (
                <button
                  key={doc.id}
                  type="button"
                  title={doc.title}
                  aria-current={selectedId === doc.id ? 'page' : undefined}
                  onClick={() => {
                    setQuery('')
                    setHits(undefined)
                    void open(doc.id)
                  }}
                  style={{ paddingLeft: 8 + depth * 12 }}
                  className={tw(
                    'mb-0.5 grid w-full gap-1 rounded-md border-0 bg-transparent py-2 pr-2 text-left text-xs leading-5 hover:bg-[var(--surface-hover)]',
                    selectedId === doc.id && 'bg-[var(--surface-selected)]',
                  )}
                >
                  <span className={tw('truncate')}>{doc.title}</span>
                  {doc.state !== 'active' ? (
                    <span className={tw('text-xs text-[var(--text-tertiary)]')}>
                      {knowledgeStates[doc.state]}
                    </span>
                  ) : null}
                </button>
              ))}
              {!outline.length &&
              snapshot &&
              !['code', 'graph'].includes(view) ? (
                <p
                  className={tw(
                    'my-1 text-xs leading-5 text-[var(--text-tertiary)]',
                  )}
                >
                  暂无
                  {
                    knowledgeKinds[
                      view === 'reference'
                        ? 'reference'
                        : (view as 'wiki' | 'summary' | 'memory' | 'card')
                    ]
                  }
                </p>
              ) : null}
            </nav>
            {activeJobs.length ? (
              <details
                className={tw('text-xs leading-5 text-[var(--text-secondary)]')}
                open={activeJobs.some(
                  (job) => job.status === 'queued' || job.status === 'running',
                )}
              >
                <summary className={tw('cursor-pointer')}>
                  整理任务（{activeJobs.length}）
                </summary>
                {activeJobs.map((job) => (
                  <div key={job.id} className={tw('mt-2 grid gap-1')}>
                    <span>
                      {job.kind === 'index'
                        ? '代码索引'
                        : job.kind === 'wiki'
                          ? '项目 Wiki'
                          : '会话总结'}{' '}
                      ·{' '}
                      {
                        {
                          queued: '排队中',
                          running: '整理中',
                          failed: '失败',
                          cancelled: '已取消',
                          completed: '完成',
                        }[job.status]
                      }
                    </span>
                    {job.message ? (
                      <span className={tw('break-words text-[var(--danger)]')}>
                        {job.message}
                      </span>
                    ) : null}
                    <button
                      type="button"
                      className={tw(
                        'justify-self-start border-0 bg-transparent p-0 text-[var(--link)]',
                      )}
                      disabled={pending}
                      onClick={() => {
                        void request({
                          type:
                            job.status === 'queued' || job.status === 'running'
                              ? 'cancel'
                              : 'retry',
                          ...scope,
                          jobId: job.id,
                        }).then(reload)
                      }}
                    >
                      {job.status === 'queued' || job.status === 'running'
                        ? '取消'
                        : '重试'}
                    </button>
                  </div>
                ))}
              </details>
            ) : null}
          </aside>
        ) : null}
        <input
          ref={fileInput}
          type="file"
          accept=".md,.markdown,.txt"
          aria-label="添加 Markdown 或文本文件"
          className={tw('hidden')}
          onChange={(event: import('react').ChangeEvent<HTMLInputElement>) => {
            const file = event.target.files?.[0]
            if (file) void importText(file)
            event.target.value = ''
          }}
        />
        <div
          aria-busy={pending}
          className={tw('min-h-0 min-w-0 overflow-auto')}
        >
          {error ? (
            <p
              role="alert"
              className={tw('mb-4 mt-0 text-xs leading-6 text-[var(--danger)]')}
            >
              {error}
            </p>
          ) : null}
          {!service ? (
            <Empty
              title="知识服务暂不可用"
              description="请重启应用后重新打开。"
            />
          ) : isWiki &&
            (configure ||
              (!wikiDocuments.length && !source && !draft && !hits)) ? (
            <WikiSetup
              options={snapshot?.wikiOptions}
              settings={snapshot?.settings}
              pending={pending}
              running={wikiRunning}
              generated={!!wikiDocuments.length}
              cards={view === 'card'}
              onSettings={onSettings}
              onChange={(options) => {
                void request({ type: 'wikiOptions', ...scope, options }).then(
                  reload,
                )
              }}
              onGenerate={() => {
                setConfigure(false)
                void start('wiki')
              }}
              onBack={
                configure && wikiDocuments.length
                  ? () => setConfigure(false)
                  : undefined
              }
            />
          ) : (
            <div className={tw('px-8 py-6 max-[700px]:px-4')}>
              {source ? (
                <article className={tw('max-w-4xl')}>
                  <CompactButton
                    variant="tertiary"
                    onPress={() => setSource(undefined)}
                  >
                    返回文档
                  </CompactButton>
                  <h2 className={tw('my-4 break-all text-sm font-medium')}>
                    {source.source.label}
                    {source.stale ? ' · 来源已变更' : ''}
                  </h2>
                  {source.source.sessionId ? (
                    <CompactButton
                      variant="tertiary"
                      onPress={() => onOpenTask(source.source.sessionId!)}
                    >
                      打开原会话
                    </CompactButton>
                  ) : null}
                  {source.source.kind === 'code' ? (
                    <div className={tw('mb-3 flex flex-wrap gap-1')}>
                      <CompactButton
                        variant="tertiary"
                        onPress={() => {
                          const path = source.source.path
                          setSource(undefined)
                          setSelected(undefined)
                          changeView('graph')
                          setGraphPath(path ? [`file:${path}`] : [])
                        }}
                      >
                        查看文件关系
                      </CompactButton>
                      {snapshot?.navigation && !scope.taskId
                        ? [
                            { operation: 'goToDefinition', label: '查找定义' },
                            { operation: 'findReferences', label: '查找引用' },
                            {
                              operation: 'goToImplementation',
                              label: '查找实现',
                            },
                          ].map((item) => (
                            <CompactButton
                              key={item.operation}
                              variant="tertiary"
                              isDisabled={pending || source.stale}
                              onPress={() => {
                                void request({
                                  type: 'navigate',
                                  ...scope,
                                  source: source.source,
                                  operation: item.operation as
                                    | 'goToDefinition'
                                    | 'findReferences'
                                    | 'goToImplementation',
                                }).then((value) => {
                                  if (value?.hits) {
                                    setHits(value.hits)
                                    setSource(undefined)
                                    setSelected(undefined)
                                  }
                                })
                              }}
                            >
                              {item.label}
                            </CompactButton>
                          ))
                        : null}
                    </div>
                  ) : null}
                  <pre
                    className={tw(
                      'overflow-auto whitespace-pre-wrap break-words rounded-lg bg-[var(--surface-secondary)] p-4 font-mono text-xs leading-6',
                    )}
                  >
                    {source.text}
                  </pre>
                </article>
              ) : draft ? (
                <article className={tw('grid max-w-3xl gap-4')}>
                  <h1 className={tw('m-0 text-lg font-semibold')}>
                    {library
                      ? '添加资料'
                      : view === 'wiki'
                        ? '新建页面'
                        : '添加记忆'}
                  </h1>
                  <CompactInput
                    aria-label="资料标题"
                    placeholder="标题"
                    value={draft.title}
                    maxLength={200}
                    onChange={(
                      event: import('react').ChangeEvent<HTMLInputElement>,
                    ) => setDraft({ ...draft, title: event.target.value })}
                  />
                  <textarea
                    aria-label="资料正文"
                    placeholder="支持 Markdown"
                    value={draft.body}
                    maxLength={128000}
                    onChange={(
                      event: import('react').ChangeEvent<HTMLTextAreaElement>,
                    ) => setDraft({ ...draft, body: event.target.value })}
                    className={tw(
                      'min-h-80 w-full resize-y rounded-lg border border-[var(--panel-border)] bg-[var(--surface)] p-3 font-mono text-xs leading-6 outline-none focus:border-[var(--focus)]',
                    )}
                  />
                  <div className={tw('flex gap-2')}>
                    <CompactButton
                      isDisabled={
                        pending || !draft.title.trim() || !draft.body.trim()
                      }
                      onPress={() => {
                        void createDocument()
                      }}
                    >
                      保存
                    </CompactButton>
                    <CompactButton
                      variant="tertiary"
                      onPress={() => setDraft(undefined)}
                    >
                      取消
                    </CompactButton>
                  </div>
                </article>
              ) : hits ? (
                <div className={tw('grid max-w-4xl gap-2')}>
                  <h1 className={tw('mb-3 mt-0 text-lg font-semibold')}>
                    搜索结果
                  </h1>
                  {hits.length ? (
                    hits.map((hit) => (
                      <button
                        key={`${hit.kind}:${hit.id}`}
                        type="button"
                        className={tw(
                          'grid gap-2 rounded-lg border-0 bg-transparent p-3 text-left hover:bg-[var(--surface-hover)]',
                        )}
                        onClick={() => {
                          if (hit.kind === 'code' || hit.kind === 'history') {
                            if (hit.source) void showSource(hit.source)
                          } else {
                            setQuery('')
                            setHits(undefined)
                            void open(hit.id)
                          }
                        }}
                      >
                        <span
                          className={tw('text-xs text-[var(--text-tertiary)]')}
                        >
                          {knowledgeKinds[hit.kind]}
                        </span>
                        <strong className={tw('break-all text-sm font-medium')}>
                          {hit.title}
                        </strong>
                        <span
                          className={tw(
                            'line-clamp-3 whitespace-pre-wrap break-words text-xs leading-6 text-[var(--text-secondary)]',
                          )}
                        >
                          {hit.snippet}
                        </span>
                      </button>
                    ))
                  ) : (
                    <Empty
                      title="没有匹配结果"
                      description="尝试文件名、函数名或内容中的关键词。"
                    />
                  )}
                </div>
              ) : selected ? (
                <KnowledgeReader
                  key={selected.id}
                  document={selected}
                  revisions={revisions}
                  pending={pending}
                  onSave={saveDocument}
                  onArchive={() => {
                    void request({
                      type: 'remove',
                      ...scope,
                      id: selected.id,
                      version: selected.version,
                    }).then((value) => {
                      if (value) {
                        setSelected(undefined)
                        reload()
                      }
                    })
                  }}
                  onSource={(source) => {
                    void showSource(source)
                  }}
                  onWiki={(key) => {
                    const doc = snapshot?.documents.find(
                      (item) =>
                        item.kind === 'wiki' &&
                        item.id.endsWith(`:${key}`) &&
                        item.state !== 'archived',
                    )
                    if (doc) void open(doc.id)
                    else report('链接页面尚未生成。')
                  }}
                  onLinkError={report}
                  onOpenTask={onOpenTask}
                  onExport={() =>
                    request({ type: 'export', ...scope, id: selected.id })
                  }
                />
              ) : view === 'graph' ? (
                <div className={tw('grid gap-3')}>
                  <h1 className={tw('m-0 text-lg font-semibold')}>代码图谱</h1>
                  <p
                    className={tw(
                      'm-0 text-xs leading-6 text-[var(--text-secondary)]',
                    )}
                  >
                    点击模块展开文件。虚线表示语法调用候选。
                  </p>
                  {graphPath.length ? (
                    <CompactButton
                      variant="tertiary"
                      className={tw('justify-self-start')}
                      onPress={() => setGraphPath((path) => path.slice(0, -1))}
                    >
                      上一级
                    </CompactButton>
                  ) : null}
                  {graph.nodes.length ? (
                    <KnowledgeGraph
                      nodes={graph.nodes}
                      edges={graph.edges}
                      onSelect={(node) => {
                        if (node.kind === 'symbol' && node.source)
                          void showSource(node.source)
                        else setGraphPath((path) => [...path, node.id])
                      }}
                    />
                  ) : (
                    <Empty
                      title="还没有代码图谱"
                      description="建立代码索引后查看模块、文件与符号的关系。"
                    />
                  )}
                </div>
              ) : view === 'code' ? (
                <Empty
                  title="查找项目代码"
                  description="输入文件名、函数名或代码片段。字面搜索读取当前代码，索引用于结构查找。"
                />
              ) : !snapshot && !error ? (
                <Empty title="正在读取…" />
              ) : documents.length ? (
                <div className={tw('grid max-w-3xl gap-5')}>
                  <h1 className={tw('m-0 text-xl font-semibold')}>
                    {library
                      ? library.name
                      : knowledgeKinds[view as 'wiki' | 'summary' | 'memory']}
                  </h1>
                  {library?.description ? (
                    <p
                      className={tw(
                        'm-0 text-sm leading-6 text-[var(--text-secondary)]',
                      )}
                    >
                      {library.description}
                    </p>
                  ) : null}
                  <p className={tw('m-0 text-xs text-[var(--text-secondary)]')}>
                    从左侧目录选择内容。
                  </p>
                  {outline
                    .filter((item) => item.depth === 0)
                    .map(({ document: doc }) => (
                      <button
                        key={doc.id}
                        type="button"
                        onClick={() => {
                          void open(doc.id)
                        }}
                        className={tw(
                          'grid gap-1 border-0 bg-transparent p-0 text-left',
                        )}
                      >
                        <strong
                          className={tw(
                            'text-sm font-medium text-[var(--link)]',
                          )}
                        >
                          {doc.title}
                        </strong>
                        <span
                          className={tw(
                            'line-clamp-2 text-xs leading-6 text-[var(--text-tertiary)]',
                          )}
                        >
                          {knowledgePreview(doc.body)}
                        </span>
                      </button>
                    ))}
                  {library ? (
                    <CompactButton
                      variant="tertiary"
                      className={tw('justify-self-start')}
                      onPress={() => {
                        void request({
                          type: 'export',
                          ...scope,
                          libraryId: library.id,
                        }).then((value) => {
                          if (value?.text)
                            downloadKnowledge(value.text, library.name)
                        })
                      }}
                    >
                      导出知识库
                    </CompactButton>
                  ) : null}
                </div>
              ) : (
                <Empty
                  title={
                    library
                      ? '暂无知识'
                      : view === 'card'
                        ? '还没有知识卡片'
                        : view === 'wiki'
                          ? '还没有项目 Wiki'
                          : view === 'summary'
                            ? '还没有会话总结'
                            : '还没有记忆'
                  }
                  description={
                    library
                      ? '添加文档后即可开始阅读和检索。'
                      : view === 'wiki'
                        ? '根据项目代码生成有目录和来源的文档。'
                        : view === 'summary'
                          ? '总结会保留需求、决策、验证结果和待办事项，并关联原会话。'
                          : view === 'card'
                            ? '与 Wiki 一起生成，供 Agent 按需检索项目事实。'
                            : '保存长期有效的项目规则；自动提取的内容需要确认。'
                  }
                >
                  {library ? (
                    <CompactButton
                      onPress={() => {
                        report('')
                        setImporting(true)
                      }}
                    >
                      <Icon name="plus" size={16} />
                      添加知识
                    </CompactButton>
                  ) : view === 'card' ? (
                    <CompactButton
                      variant="secondary"
                      onPress={() => setConfigure(true)}
                    >
                      生成知识卡片
                    </CompactButton>
                  ) : null}
                  {!library &&
                  !personal &&
                  !modelReady &&
                  (view === 'wiki' || view === 'summary') ? (
                    <CompactButton variant="secondary" onPress={onSettings}>
                      配置整理模型
                    </CompactButton>
                  ) : null}
                </Empty>
              )}
            </div>
          )}
        </div>
      </div>
      {importing ? (
        <KnowledgeImportDialog
          busy={pending}
          error={error}
          onClose={() => {
            setImporting(false)
            report('')
          }}
          onChoose={() => fileInput.current?.click()}
          onWrite={() => {
            setImporting(false)
            report('')
            setSelected(undefined)
            setSource(undefined)
            setDraft({
              title: '',
              body: '',
              sources: [{ kind: 'manual', label: '手工资料' }],
            })
          }}
        />
      ) : null}
    </section>
  )
}
export function Empty({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children?: import('react').ReactNode
}) {
  return (
    <div
      className={tw(
        'flex min-h-72 flex-col items-center justify-center gap-3 px-6 text-center',
      )}
    >
      <Icon
        name="book"
        size={28}
        className={tw('mb-2 text-[var(--text-tertiary)]')}
      />
      <h2 className={tw('m-0 text-base font-medium')}>{title}</h2>
      {description ? (
        <p
          className={tw(
            'm-0 max-w-lg text-xs leading-6 text-[var(--text-secondary)]',
          )}
        >
          {description}
        </p>
      ) : null}
      {children}
    </div>
  )
}
