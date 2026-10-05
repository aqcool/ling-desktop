import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Modal } from '@heroui/react/modal'
import type { LingModelSettings } from '../runtime/contract.js'
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
import { KnowledgeImportDialog } from './KnowledgeImportDialog.js'
import { WikiSetup } from './WikiSetup.js'
import { CodeEditor } from './CodeEditor.js'
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
  models,
  navigation,
  headerActions,
  headerInset = false,
}: {
  service?: LingKnowledgeService
  models?: LingModelSettings
  navigation?: ReactNode
  headerActions?: ReactNode
  headerInset?: boolean
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
    [configure, setConfigure] = useState(true),
    [importing, setImporting] = useState(false)
  const [source, setSource] = useState<{
      source: KnowledgeSource
      text: string
      startLine?: number
      stale?: boolean
      visible?: boolean
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
    reading = useRef(0),
    dirty = useRef(false),
    leaveAction = useRef<(() => void) | undefined>(undefined)
  const [leaving, setLeaving] = useState(false)
  const navigate = (action: () => void) => {
    if (dirty.current || (draft && (draft.title.trim() || draft.body.trim()))) { leaveAction.current = action; setLeaving(true) }
    else action()
  }
  const documents = (snapshot?.documents ?? []).filter(
    (doc) =>
      doc.kind === view &&
      doc.state !== 'archived' &&
      (!library || doc.libraryId === library.id),
  )
  const visibleDocuments = library || !['code', 'graph'].includes(view) ? documents.filter(doc => doc.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) : documents
  const outline = knowledgeOutline(visibleDocuments),
    selectedId = selected?.id
  const readDocument = async (id: string) => {
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
  const open = (id: string) => navigate(() => { void readDocument(id) })
  useEffect(() => {
    if (!initialDocumentId) return
    changeView(initialView)
    void readDocument(initialDocumentId)
    return () => { reading.current++ }
  }, [initialDocumentId, initialView])
  useEffect(() => {
    if (!query.trim() || !['code', 'graph'].includes(view)) {
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
      setSource({ source: value, text: result.text, startLine: result.startLine, stale: result.stale, visible: true })
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
  const changeView = (id: View) => navigate(() => {
    reading.current++
    setConfigure(id === 'wiki' || id === 'card')
    setView(id)
    setSelected(undefined)
    setSource(undefined)
    setDraft(undefined)
    setQuery('')
    setHits(undefined)
  })
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
  const importText = async (file: File): Promise<string> => {
    if (!library) throw new Error('请先选择知识库。')
    if (!/\.(md|markdown|txt)$/i.test(file.name) || file.size > 512000)
      throw new Error('请选择 512 KB 以内的 Markdown 或 TXT 文件。')
    const body = await file.text()
    if (!body.trim() || body.length > 128000 || body.includes('\0'))
      throw new Error('资料为空、不是文本或超过 128,000 字符。')
    const value = await request({ type: 'save', ...scope, document: {
      kind: 'reference', libraryId: library.id, title: file.name.slice(0, 200), body,
      sources: [{ kind: 'manual', label: `导入文件：${file.name}` }], state: 'active',
    } }, true)
    if (!value?.document) throw new Error('资料未能保存，请重试。')
    reload()
    return value.document.id
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
    ? !!documents.length
    : isWiki
      ? !!(wikiDocuments.length || (snapshot?.documents.some(doc => doc.kind === 'card' && doc.state !== 'archived')))
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
          'flex h-11 shrink-0 items-center justify-between gap-3 border-b border-[var(--panel-border)] px-4 select-none [-webkit-app-region:drag]',
          headerInset && 'min-[701px]:pl-20',
        )}
      >
        <div className={tw('flex min-w-0 items-center gap-2 [-webkit-app-region:no-drag]')}>
          {navigation}
          <CompactButton
            variant="tertiary"
            onPress={() => navigate(onBack)}
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
        <div className={tw('flex shrink-0 items-center gap-2 [-webkit-app-region:no-drag]')}>
          {headerActions}
          {library || isProject ? (
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
                      ...projectViews.filter(item => item.id !== 'wiki' && item.id !== 'card').map(item => ({ id: item.id, label: item.label, action: () => changeView(item.id) })),
                      ...(isWiki ? [] : [{ id: 'wiki', label: '返回 Wiki 页面', action: () => changeView('wiki') }]),
                      {
                        id: 'setup',
                        label: '概览与生成',
                        action: () => changeView('wiki'),
                      },
                      {
                        id: 'export',
                        label: view === 'card' ? '导出知识卡片' : view === 'summary' ? '导出会话总结' : '导出 Wiki',
                        action: () => {
                          void request({
                            type: 'export',
                            ...scope,
                            kind: view === 'card' ? 'card' : view === 'summary' ? 'summary' : 'wiki',
                          }).then((value) => {
                            if (value?.text)
                              downloadKnowledge(value.text, `${label}-${view === 'card' ? 'cards' : 'wiki'}`)
                          })
                        },
                      },
                    ].filter(item => item.id !== 'export' || isWiki || view === 'summary')
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
      <div
        className={tw(
          'grid min-h-0 flex-1',
          sidebar && hasDirectory
            ? 'grid-cols-[280px_minmax(0,1fr)] max-[980px]:grid-cols-[220px_minmax(0,1fr)] max-[700px]:grid-cols-1 max-[700px]:grid-rows-[auto_minmax(0,1fr)]'
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
            {isWiki ? <nav aria-label="项目知识视图" className={tw('flex shrink-0 gap-1 rounded-lg bg-[var(--surface-secondary)] p-0.5')}>
              {projectViews.slice(0, 2).map(item => <CompactButton key={item.id} variant="tertiary" aria-current={view === item.id ? 'page' : undefined} className={tw('min-w-0 flex-1', view === item.id && 'bg-[var(--surface)] shadow-sm')} onPress={() => { if (view !== item.id) changeView(item.id) }}>{item.label}</CompactButton>)}
            </nav> : <span className={tw('text-xs font-medium text-[var(--text-secondary)]')}>{directoryLabel}</span>}
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
                      ? '搜索文件名'
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
                      action: () => navigate(() => {
                        setSelected(undefined)
                        setSource(undefined)
                        setDraft({
                          title: '',
                          body: '',
                          sources: [{ kind: 'manual', label: '手工资料' }],
                        })
                      }),
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
              {isWiki ? <button type="button" aria-current={configure ? 'page' : undefined} onClick={() => navigate(() => { setConfigure(true); setSource(undefined); setQuery('') })} className={tw('mb-2 flex w-full items-center gap-2 rounded-lg border-0 bg-transparent px-2.5 py-2 text-left text-xs hover:bg-[var(--surface-hover)]', configure && 'bg-[var(--surface-secondary)] font-medium')}><Icon name="book" size={15} />概览</button> : null}
              {outline.map(({ document: doc, depth }) => (
                <button
                  key={doc.id}
                  type="button"
                  title={doc.title}
                  aria-current={!configure && selectedId === doc.id ? 'page' : undefined}
                  onClick={() => {
                    setQuery('')
                    setHits(undefined)
                    void open(doc.id)
                  }}
                  style={{ paddingLeft: 8 + depth * 12 }}
                  className={tw(
                    'mb-0.5 grid w-full gap-1 rounded-md border-0 bg-transparent py-2 pr-2 text-left text-xs leading-5 hover:bg-[var(--surface-hover)]',
                    !configure && selectedId === doc.id && 'bg-[var(--surface-selected)]',
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
            {!isWiki && activeJobs.length ? (
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
        <div
          aria-busy={pending}
          className={tw('min-h-0 min-w-0 overflow-auto')}
        >
          {error ? (
            <p
              role="alert"
              className={tw('mx-6 my-3 text-xs leading-6 text-[var(--danger)]')}
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
              models={models}
              job={snapshot?.jobs.find(job => job.kind === 'wiki' && ['queued', 'running'].includes(job.status)) ?? snapshot?.jobs.find(job => job.kind === 'wiki')}
              pageCount={wikiDocuments.length}
              cardCount={snapshot?.documents.filter(doc => doc.kind === 'card' && doc.state !== 'archived').length}
              indexedFiles={snapshot?.indexedFiles}
              onModelChange={settings => { void request({ type: 'settings', ...scope, settings }).then(reload) }}
              onJobAction={(type, jobId) => { void request({ type, ...scope, jobId }).then(reload) }}
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
                setConfigure(true)
                void start('wiki')
              }}
              onBack={
                configure && wikiDocuments.length
                  ? () => { const first = outline[0]?.document; if (selected) setConfigure(false); else if (first) open(first.id) }
                  : undefined
              }
            />
          ) : (
            <div className={tw('px-7 py-5 max-[700px]:px-4')}>
              {selected && source ? <nav aria-label="阅读标签" className={tw('mb-5 flex gap-2 border-b border-[var(--panel-border)] pb-2')}>
                <CompactButton variant="tertiary" onPress={() => setSource(current => current ? { ...current, visible: false } : current)} aria-pressed={!source.visible}>{selected.title}</CompactButton>
                <CompactButton variant="tertiary" onPress={() => setSource(current => current ? { ...current, visible: true } : current)} aria-pressed={!!source.visible}>{source.source.label}</CompactButton>
                <CompactButton variant="tertiary" isIconOnly aria-label="关闭来源" onPress={() => setSource(undefined)}><Icon name="close" size={14} /></CompactButton>
              </nav> : null}
              {selected ? <div hidden={!!source?.visible || !!hits || !!draft}>
                {selected.kind === 'card' ? (() => { const parent = wikiDocuments.find(doc => selected.id.startsWith(`${doc.id.replace(/^wiki:/, 'card:')}:`)); return parent ? <CompactButton variant="tertiary" className={tw('mb-4 px-0 text-[var(--text-secondary)]')} onPress={() => navigate(() => { setView('wiki'); setQuery(''); void readDocument(parent.id) })}>所属页面：{parent.title}</CompactButton> : null })() : null}
                <KnowledgeReader
                  key={selected.id}
                  document={selected}
                  revisions={revisions}
                  pending={pending}
                  onSave={saveDocument}
                  onDirtyChange={value => { dirty.current = value }}
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
              </div> : null}
              {source?.visible ? (
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
                  {source.source.kind === 'code' ? <div className={tw('h-[60vh] min-h-64 overflow-hidden rounded-lg border border-[var(--panel-border)]')}><CodeEditor readOnly wrap value={source.text} startLine={source.startLine} path={source.source.path ?? source.source.label} /></div> : <pre className={tw('overflow-auto whitespace-pre-wrap break-words rounded-lg bg-[var(--surface-secondary)] p-4 font-mono text-xs leading-6')}>{source.text}</pre>}
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
              ) : selected ? null : view === 'graph' ? (
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
      {importing ? <KnowledgeImportDialog onImport={importText} onClose={() => { setImporting(false); report('') }} onDone={id => { setImporting(false); report(''); setQuery(''); setHits(undefined); open(id) }} /> : null}
      {leaving ? <Modal.Backdrop isOpen onOpenChange={(open: boolean) => { if (!open) setLeaving(false) }}><Modal.Container size="sm"><Modal.Dialog><Modal.Header><Modal.Heading>有未保存的修改</Modal.Heading></Modal.Header><Modal.Body><p className={tw('m-0 text-sm leading-6')}>离开会丢失当前修改。可以返回保存后再继续。</p></Modal.Body><Modal.Footer><CompactButton variant="tertiary" onPress={() => setLeaving(false)}>继续编辑</CompactButton><CompactButton variant="danger" onPress={() => { dirty.current = false; setDraft(undefined); setLeaving(false); leaveAction.current?.(); leaveAction.current = undefined }}>放弃修改并离开</CompactButton></Modal.Footer></Modal.Dialog></Modal.Container></Modal.Backdrop> : null}
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
