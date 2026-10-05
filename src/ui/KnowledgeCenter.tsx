import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { LingModelSettings, LingWorkspaceSummary } from '../runtime/contract.js'
import type {
  KnowledgeDocument,
  KnowledgeLibrary,
  LingKnowledgeService,
} from '../runtime/knowledge.js'
import {
  CompactButton,
  CompactInput,
  CompactSelect,
} from './SettingsControls.js'
import { KnowledgeSpace, Empty } from './KnowledgeSpace.js'
import { LibraryDialog, KnowledgeDeleteDialog } from './KnowledgeDialogs.js'
import { KnowledgeMenu } from './KnowledgeMenu.js'
import { Icon } from './Icon.js'
import { tw } from './tailwind.js'
type Project = { workspaceId: string | null; taskId?: string; label: string }
export function KnowledgeCenter({
  service,
  workspaceId,
  workspaces,
  taskId,
  remoteTaskId,
  initialDocumentId,
  initialProject = false,
  onOpenTask,
  onSettings,
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
  workspaceId?: string
  workspaces: readonly LingWorkspaceSummary[]
  taskId?: string
  remoteTaskId?: string
  initialDocumentId?: string
  initialProject?: boolean
  onOpenTask: (id: string) => void
  onSettings: () => void
}) {
  const [tab, setTab] = useState<'libraries' | 'wiki'>('libraries'),
    [libraries, setLibraries] = useState<KnowledgeLibrary[]>(),
    [query, setQuery] = useState(''),
    [filter, setFilter] = useState('all'),
    [layout, setLayout] = useState<'grid' | 'list'>('grid'),
    [wikiFilter, setWikiFilter] = useState('all'),
    [statuses, setStatuses] = useState<
      Record<string, 'ready' | 'empty' | 'busy' | 'error'>
    >({})
  const [project, setProject] = useState<Project | undefined>(
    initialProject
      ? remoteTaskId
        ? { workspaceId: null, taskId: remoteTaskId, label: '当前 SSH 项目' }
        : workspaceId
          ? {
              workspaceId,
              label:
                workspaces.find((w) => w.workspaceId === workspaceId)?.label ??
                '项目',
            }
          : undefined
      : undefined,
  )
  const [library, setLibrary] = useState<KnowledgeLibrary>(),
    [initial, setInitial] = useState<{
      id: string
      kind: KnowledgeDocument['kind']
    }>()
  const [dialog, setDialog] = useState<
      'create' | 'rename' | 'scope' | 'delete'
    >(),
    [managed, setManaged] = useState<KnowledgeLibrary>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [refresh, setRefresh] = useState(0)
  const life = useRef(0)
  const initialRead = useRef<AbortController | undefined>(undefined)
  useEffect(() => {
    const controller = new AbortController(),
      epoch = ++life.current
    if (!service) return
    let loading = false
    const load = async () => {
      if (loading || controller.signal.aborted) return
      loading = true
      try {
        const value = await service.request(
          { type: 'catalog', workspaceId: null },
          controller.signal,
        )
        if (controller.signal.aborted || epoch !== life.current) return
        if (value.ok) {
          setLibraries(value.value.libraries ?? [])
        } else setError(value.message ?? '知识库无法读取。')
      } catch (error) {
        if (!controller.signal.aborted && epoch === life.current)
          setError(error instanceof Error ? error.message : '读取失败。')
      } finally { loading = false }
    }
    void load()
    const timer = setInterval(() => {
      if (!document.hidden) void load()
    }, 3000)
    return () => {
      controller.abort()
      life.current++
      clearInterval(timer)
    }
  }, [service, refresh])
  useEffect(() => {
    if (!service || !initialDocumentId) return
    const controller = new AbortController()
    initialRead.current = controller
    void service
      .request(
        {
          type: 'read',
          workspaceId: remoteTaskId ? null : (workspaceId ?? null),
          ...(remoteTaskId ? { taskId: remoteTaskId } : {}),
          id: initialDocumentId,
        },
        controller.signal,
      )
      .then(async (result) => {
        if (controller.signal.aborted) return
        if (!result.ok) {
          setError(result.message ?? '文档无法读取。')
          return
        }
        const doc = result.value.document
        if (!doc) return
        setInitial({ id: doc.id, kind: doc.kind })
        if (doc.libraryId) {
          const catalog = await service.request(
            { type: 'catalog', workspaceId: null },
            controller.signal,
          )
          if (controller.signal.aborted) return
          const item = catalog.ok
            ? catalog.value.libraries?.find((item) => item.id === doc.libraryId)
            : undefined
          if (item) {
            setLibrary(item)
            setProject(undefined)
          } else setError('所属知识库已不存在。')
        } else
          setProject({
            workspaceId: remoteTaskId ? null : (workspaceId ?? null),
            ...(remoteTaskId ? { taskId: remoteTaskId } : {}),
            label: remoteTaskId
              ? '当前 SSH 项目'
              : (workspaces.find((w) => w.workspaceId === workspaceId)?.label ??
                '项目'),
          })
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setError(error instanceof Error ? error.message : '读取失败。')
      })
    return () => {
      controller.abort()
      if (initialRead.current === controller) initialRead.current = undefined
    }
  }, [service, initialDocumentId, workspaceId, remoteTaskId])
  const projects: Project[] = [
    ...workspaces.map((w) => ({ workspaceId: w.workspaceId, label: w.label })),
    ...(remoteTaskId
      ? [{ workspaceId: null, taskId: remoteTaskId, label: '当前 SSH 项目' }]
      : []),
  ]
  const scopes = projects.map((p) => ({
    value: p.taskId ? `remote:${p.taskId}` : p.workspaceId!,
    label: p.label,
  }))
  useEffect(() => {
    if (!service || tab !== 'wiki') return
    const controller = new AbortController()
    let loading = false
    const load = async () => {
      if (loading || controller.signal.aborted) return
      loading = true
      try {
      const values = await Promise.all(
      projects.map(async (item) => {
        const key = item.taskId ?? item.workspaceId!
        try {
          const result = await service.request(
            {
              type: 'snapshot',
              workspaceId: item.workspaceId,
              ...(item.taskId ? { taskId: item.taskId } : {}),
            },
            controller.signal,
          )
          if (!result.ok || !result.value.snapshot)
            return [key, 'error'] as const
          const snapshot = result.value.snapshot
          return [
            key,
            snapshot.jobs.some(
              (job) =>
                job.kind === 'wiki' &&
                ['queued', 'running'].includes(job.status),
            )
              ? 'busy'
              : snapshot.jobs.find(job => job.kind === 'wiki')?.status === 'failed'
                ? 'error'
                : snapshot.documents.some(
                    (doc) => doc.kind === 'wiki' && doc.state !== 'archived',
                  )
                ? 'ready'
                : 'empty',
          ] as const
        } catch {
          return [key, 'error'] as const
        }
      }),
    )
      if (!controller.signal.aborted) setStatuses(Object.fromEntries(values))
      } finally { loading = false }
    }
    void load()
    const timer = setInterval(() => { if (!document.hidden) void load() }, 3000)
    return () => { controller.abort(); clearInterval(timer) }
  }, [
    service,
    tab,
    refresh,
    workspaces.map((w) => w.workspaceId).join('|'),
    remoteTaskId,
  ])
  const ownerScope = (item: KnowledgeLibrary) => ({
    workspaceId: item.workspaceId,
    ...(item.taskId ? { taskId: item.taskId } : {}),
  })
  const libraryScope = library
    ? {
        workspaceId: library.workspaceId,
        libraryId: library.id,
        ...(library.taskId ? { taskId: library.taskId } : {}),
      }
    : { workspaceId: null }
  const back = () => {
    initialRead.current?.abort()
    if (project) setTab('wiki')
    setLibrary(undefined)
    setProject(undefined)
    setInitial(undefined)
    setQuery('')
    setError('')
    setRefresh((n) => n + 1)
  }
  const mutate = async (
    input: import('../runtime/knowledge.js').KnowledgeRequest,
  ) => {
    if (!service || busy) return
    setBusy(true)
    setError('')
    try {
      const result = await service.request(input)
      if (result.ok) return result.value
      setError(result.message ?? '保存失败。')
    } catch (error) {
      setError(error instanceof Error ? error.message : '操作失败。')
    } finally {
      setBusy(false)
    }
  }
  const manage = (
    item: KnowledgeLibrary,
    action: 'rename' | 'scope' | 'delete',
  ) => {
    setManaged(item)
    setDialog(action)
    setError('')
  }
  const closeDialog = () => {
    setDialog(undefined)
    setManaged(undefined)
    setError('')
  }
  const modal =
    dialog === 'create' || dialog === 'rename' || dialog === 'scope' ? (
      <LibraryDialog
        key={`${dialog}:${managed?.id}`}
        library={managed}
        scopeOnly={dialog === 'scope'}
        scopes={scopes}
        busy={busy}
        error={error}
        onClose={closeDialog}
        onSave={async (name, access, bindings) => {
          const targets = bindings.map((value) =>
            value.startsWith('remote:')
              ? { workspaceId: null, taskId: value.slice(7) }
              : { workspaceId: value },
          )
          const result = await mutate({
            type: 'saveLibrary',
            ...(managed ? ownerScope(managed) : { workspaceId: null }),
            library: {
              ...(managed ? { id: managed.id, version: managed.version } : {}),
              name,
              description: managed?.description ?? '',
              ...(dialog !== 'rename' ? { access, bindings: targets } : {}),
            },
          })
          if (result?.library) {
            if (library?.id === result.library.id || dialog === 'create') {
              setLibrary(result.library)
              setProject(undefined)
            }
            closeDialog()
            setRefresh((n) => n + 1)
          }
        }}
      />
    ) : dialog === 'delete' && managed ? (
      <KnowledgeDeleteDialog
        name={managed.name}
        busy={busy}
        error={error}
        onClose={closeDialog}
        onDelete={() => {
          void mutate({
            type: 'deleteLibrary',
            ...ownerScope(managed),
            id: managed.id,
            version: managed.version,
          }).then((result) => {
            if (result) {
              if (library?.id === managed.id) back()
              closeDialog()
              setRefresh((n) => n + 1)
            }
          })
        }}
      />
    ) : null
  if (library || project)
    return (
      <>
        <KnowledgeSpace
          key={
            library?.id ??
            `${project?.workspaceId ?? ''}:${project?.taskId ?? ''}`
          }
          service={service}
          models={models}
          navigation={navigation}
          headerActions={headerActions}
          headerInset={headerInset}
          scope={
            library
              ? libraryScope
              : {
                  workspaceId: project!.workspaceId,
                  ...(project!.taskId ? { taskId: project!.taskId } : {}),
                }
          }
          label={library?.name ?? project!.label}
          library={library}
          initialDocumentId={initial?.id}
          initialKind={initial?.kind}
          currentTaskId={
            project && (project.taskId || project.workspaceId === workspaceId)
              ? (project.taskId ?? taskId)
              : undefined
          }
          onBack={back}
          onSettings={onSettings}
          onOpenTask={onOpenTask}
          onEditLibrary={() => library && manage(library, 'rename')}
          onScopeLibrary={() => library && manage(library, 'scope')}
          onDeleteLibrary={() => library && manage(library, 'delete')}
        />
        {modal}
      </>
    )
  const shownLibraries = (libraries ?? []).filter(
    (item) =>
      (filter === 'all' ||
        item.access === 'all' ||
        (item.bindings
          ? item.bindings.some(
              (binding) =>
                (binding.taskId
                  ? `remote:${binding.taskId}`
                  : binding.workspaceId) === filter,
            )
          : item.workspaceId === filter)) &&
      `${item.name}\n${item.description}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  )
  const shownProjects = projects.filter(
    (item) =>
      item.label.toLowerCase().includes(query.toLowerCase()) &&
      (wikiFilter === 'all' ||
        statuses[item.taskId ?? item.workspaceId!] === wikiFilter),
  )
  const viewControl = (
    <div
      className={tw(
        'flex shrink-0 gap-0.5 rounded-lg bg-[var(--surface-secondary)] p-0.5',
      )}
      aria-label="显示方式"
    >
      {(
        [
          { id: 'grid', label: '卡片视图', icon: 'grid' },
          { id: 'list', label: '列表视图', icon: 'sort' },
        ] as const
      ).map((item) => (
        <CompactButton
          key={item.id}
          variant="tertiary"
          isIconOnly
          aria-label={item.label}
          aria-pressed={layout === item.id}
          className={tw(layout === item.id && 'bg-[var(--surface)] shadow-sm')}
          onPress={() => setLayout(item.id)}
        >
          <Icon name={item.icon} size={15} />
        </CompactButton>
      ))}
    </div>
  )
  return (
    <section
      aria-label="知识中心主页面"
      className={tw(
        'flex min-h-0 flex-1 flex-col overflow-hidden text-[var(--foreground)]',
      )}
    >
      <header
        className={tw(
          'flex h-11 shrink-0 items-center justify-between gap-3 border-b border-[var(--panel-border)] px-4 select-none [-webkit-app-region:drag]', headerInset && 'min-[701px]:pl-20',
        )}
      >
        <nav aria-label="知识中心视图" className={tw('flex items-center gap-5 [-webkit-app-region:no-drag]')}>
          {navigation}
          {(
            [
              { id: 'libraries', label: '知识库' },
              { id: 'wiki', label: 'Repo Wiki' },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              aria-current={tab === item.id ? 'page' : undefined}
              className={tw(
                'rounded-md border-0 bg-transparent px-0 py-2 text-sm focus-visible:outline-2 focus-visible:outline-[var(--focus)]',
                tab === item.id
                  ? 'font-semibold'
                  : 'text-[var(--text-tertiary)] hover:text-[var(--foreground)]',
              )}
              onClick={() => {
                setTab(item.id)
                setQuery('')
                setFilter('all')
                setError('')
              }}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <div className={tw('flex items-center gap-2 [-webkit-app-region:no-drag]')}>
          {headerActions}
          <CompactButton
            variant="tertiary"
            isIconOnly
            aria-label="刷新知识中心"
            onPress={() => {
              setError('')
              setRefresh((n) => n + 1)
            }}
          >
            <Icon name="refresh" size={16} />
          </CompactButton>
          <CompactInput
            aria-label={
              tab === 'libraries' ? '搜索知识库' : '搜索 Repo Wiki 项目'
            }
            placeholder={
              tab === 'libraries' ? '搜索知识库' : '搜索 Repo Wiki 项目'
            }
            value={query}
            maxLength={256}
            onChange={(event: import('react').ChangeEvent<HTMLInputElement>) =>
              setQuery(event.target.value)
            }
            className={tw('w-56 max-[700px]:w-40')}
          />
        </div>
      </header>
      <main
        className={tw(
          'min-h-0 flex-1 overflow-auto px-8 pb-10 pt-9 max-[700px]:px-4',
        )}
      >
        <div className={tw('mx-auto max-w-[1200px]')}>
          <header
            className={tw('mb-10 flex items-center justify-between gap-4')}
          >
            <div>
              <h1 className={tw('m-0 text-2xl font-semibold leading-relaxed')}>
                {tab === 'libraries' ? (
                  <>
                    集中整理资料，构建{' '}
                    <span className={tw('text-[var(--link)]')}>知识库</span>
                    <br />让 Agent 按需查阅
                  </>
                ) : (
                  <>
                    将代码转化为 Repo Wiki
                    <br />
                    了解技术栈与项目架构
                  </>
                )}
              </h1>
            </div>
            <Icon
              name={tab === 'libraries' ? 'book' : 'code'}
              size={52}
              className={tw(
                'mr-5 shrink-0 text-[var(--panel-border)] max-[700px]:hidden',
              )}
            />
          </header>
          <div
            className={tw(
              'mb-5 flex flex-wrap items-center justify-between gap-3',
            )}
          >
            {tab === 'libraries' ? (
              <CompactSelect
                label="筛选生效工作区"
                value={filter}
                options={[{ value: 'all', label: '全部工作区' }, ...scopes]}
                onChange={setFilter}
                className={tw('w-44')}
              />
            ) : (
              <div className={tw('flex gap-1')} aria-label="Wiki 生成状态">
                {[
                  { id: 'all', label: '全部' },
                  { id: 'ready', label: '已生成' },
                  { id: 'empty', label: '未生成' },
                ].map((item) => (
                  <CompactButton
                    key={item.id}
                    variant="tertiary"
                    aria-pressed={wikiFilter === item.id}
                    className={tw(
                      wikiFilter === item.id && 'bg-[var(--surface-selected)]',
                    )}
                    onPress={() => setWikiFilter(item.id)}
                  >
                    {item.label}
                  </CompactButton>
                ))}
              </div>
            )}
            <div className={tw('flex items-center gap-3')}>
              {viewControl}
              {tab === 'libraries' && libraries?.length ? (
                <CompactButton
                  isDisabled={!service}
                  onPress={() => {
                    setManaged(undefined)
                    setDialog('create')
                  }}
                >
                  <Icon name="plus" size={14} />
                  创建知识库
                </CompactButton>
              ) : null}
            </div>
          </div>
          {error && !dialog ? (
            <p
              role="alert"
              className={tw('text-xs leading-6 text-[var(--danger)]')}
            >
              {error}
            </p>
          ) : null}
          {!service ? (
            <Empty title="知识服务暂不可用" description="请重启应用。" />
          ) : tab === 'libraries' ? (
            !libraries && !error ? (
              <Empty title="正在读取知识库…" />
            ) : shownLibraries.length ? (
              <div
                className={tw(
                  layout === 'grid'
                    ? 'grid grid-cols-[repeat(auto-fill,minmax(min(100%,280px),1fr))] gap-4'
                    : 'grid gap-2',
                )}
              >
                {shownLibraries.map((item) => (
                  <article
                    key={item.id}
                    className={tw(
                      'group relative rounded-xl border border-[var(--panel-border)] bg-[var(--surface)] hover:bg-[var(--surface-hover)]',
                      layout === 'grid'
                        ? 'flex min-h-40 flex-col p-5'
                        : 'flex items-center gap-4 px-4 py-3',
                    )}
                  >
                    <button
                      type="button"
                      className={tw(
                        'flex min-w-0 flex-1 items-start gap-3 rounded-md border-0 bg-transparent p-0 text-left focus-visible:outline-2 focus-visible:outline-[var(--focus)]',
                      )}
                      onClick={() => {
                        setLibrary(item)
                        setError('')
                      }}
                      aria-label={`打开知识库：${item.name}`}
                    >
                      <Icon
                        name="book"
                        size={20}
                        className={tw(
                          'mt-0.5 shrink-0 text-[var(--text-secondary)]',
                        )}
                      />
                      <span className={tw('min-w-0')}>
                        <strong
                          className={tw('block truncate text-sm font-semibold')}
                        >
                          {item.name}
                        </strong>
                        <span
                          className={tw(
                            'mt-2 block text-xs leading-5 text-[var(--text-tertiary)]',
                          )}
                        >
                          {item.documents} 份资料
                        </span>
                      </span>
                    </button>
                    <div
                      className={tw(
                        'flex items-center justify-between gap-2',
                        layout === 'grid' && 'mt-6',
                      )}
                    >
                      <button
                        type="button"
                        aria-label={`管理生效范围：${item.name}`}
                        className={tw(
                          'min-w-0 truncate rounded-md border-0 bg-transparent p-0 text-xs text-[var(--text-secondary)] hover:text-[var(--link)] focus-visible:outline-2 focus-visible:outline-[var(--focus)]',
                        )}
                        onClick={() => manage(item, 'scope')}
                      >
                        {item.access === 'all' ? '全部工作区' : item.scopeLabel}
                      </button>
                      <KnowledgeMenu
                        label={`更多操作：${item.name}`}
                        items={[
                          {
                            id: 'rename',
                            label: '重命名',
                            action: () => manage(item, 'rename'),
                          },
                          {
                            id: 'scope',
                            label: '管理生效范围',
                            action: () => manage(item, 'scope'),
                          },
                          {
                            id: 'delete',
                            label: '删除知识库',
                            danger: true,
                            action: () => manage(item, 'delete'),
                          },
                        ]}
                      />
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div
                className={tw(
                  'rounded-xl border border-dashed border-[var(--panel-border)]',
                )}
              >
                <Empty
                  title={
                    query || filter !== 'all'
                      ? '没有匹配的知识库'
                      : '还没有知识库'
                  }
                  description={
                    query || filter !== 'all'
                      ? '调整搜索或工作区筛选。'
                      : '创建知识库，整理文档，供 Agent 检索和使用。'
                  }
                >
                  {!query && filter === 'all' ? (
                    <CompactButton
                      onPress={() => {
                        setManaged(undefined)
                        setDialog('create')
                      }}
                    >
                      创建知识库
                    </CompactButton>
                  ) : null}
                </Empty>
              </div>
            )
          ) : shownProjects.length ? (
            <div
              className={tw(
                layout === 'grid'
                  ? 'grid grid-cols-[repeat(auto-fill,minmax(min(100%,280px),1fr))] gap-4'
                  : 'grid gap-2',
              )}
            >
              {shownProjects.map((item) => {
                const status = statuses[item.taskId ?? item.workspaceId!]
                return (
                  <article
                    key={item.taskId ?? item.workspaceId}
                    className={tw(
                      'rounded-xl border border-[var(--panel-border)] bg-[var(--surface)] p-5',
                      layout === 'grid'
                        ? 'flex min-h-40 flex-col gap-5'
                        : 'flex items-center justify-between gap-4',
                    )}
                  >
                    <div className={tw('flex min-w-0 items-center gap-3')}>
                      <Icon
                        name="folder"
                        size={20}
                        className={tw('shrink-0 text-[var(--text-secondary)]')}
                      />
                      <div className={tw('min-w-0')}>
                        <h2
                          className={tw('m-0 truncate text-sm font-semibold')}
                        >
                          {item.label}
                        </h2>
                        <p
                          className={tw(
                            'mb-0 mt-1 text-xs text-[var(--text-tertiary)]',
                          )}
                        >
                          {item.taskId ? 'SSH 工作区' : '本机工作区'}
                        </p>
                      </div>
                    </div>
                    <div
                      className={tw(
                        'mt-auto flex items-center justify-between gap-3',
                      )}
                    >
                      <span
                        className={tw('text-xs text-[var(--text-tertiary)]')}
                      >
                        {status === 'ready'
                          ? '已生成'
                          : status === 'busy'
                            ? '生成中'
                            : status === 'error'
                              ? '暂不可用'
                              : status === 'empty'
                                ? '未生成'
                                : '正在读取…'}
                      </span>
                      <CompactButton
                        variant="secondary"
                        onPress={() => {
                          setProject(item)
                          setError('')
                        }}
                      >
                        {status === 'ready'
                          ? '打开 Wiki'
                          : status === 'busy'
                            ? '查看进度'
                            : '去生成'}
                      </CompactButton>
                    </div>
                  </article>
                )
              })}
            </div>
          ) : (
            <Empty
              title="没有匹配的项目"
              description="调整筛选，或在工作区添加项目。"
            />
          )}
        </div>
      </main>
      {modal}
    </section>
  )
}
