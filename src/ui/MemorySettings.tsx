import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Modal } from '@heroui/react/modal'
import type {
  KnowledgeDocument,
  KnowledgeSettings,
  LingKnowledgeService,
} from '../runtime/knowledge.js'
import { knowledgeDefaults } from '../runtime/knowledge.js'
import type {
  LingModelSettings,
  LingWorkspaceSummary,
} from '../runtime/contract.js'
import {
  CompactButton,
  CompactSelect,
  CompactSwitch,
  SettingsGroup,
  SettingsRow,
} from './SettingsControls.js'
import { KnowledgeSpace } from './KnowledgeSpace.js'
import type { KnowledgeScopeInput } from './useKnowledge.js'
import { clearMemoryCollection, memoryDocuments } from './memory-collections.js'
import { Icon } from './Icon.js'
import { tw } from './tailwind.js'

type Collection = {
  label: string
  scope: KnowledgeScopeInput
  documents?: KnowledgeDocument[]
  error?: string
}

function MemoryGroup({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  return (
    <section className={tw('mt-8')}>
      <h2
        className={tw(
          'mb-3 mt-0 px-4 text-xs font-normal text-[var(--text-tertiary)]',
        )}
      >
        {title}
      </h2>
      <div
        className={tw(
          'rounded-xl border border-[var(--panel-border)] bg-[var(--surface)] px-4',
        )}
      >
        {children}
      </div>
    </section>
  )
}
function MemoryRow({
  title,
  description,
  icon,
  children,
}: {
  title: string
  description: ReactNode
  icon: 'globe' | 'folder'
  children?: ReactNode
}) {
  return (
    <div
      className={tw(
        'flex min-h-17 items-center gap-3 py-3.5 [&+&]:border-t [&+&]:border-dashed [&+&]:border-[var(--panel-border)]',
      )}
    >
      <span
        className={tw(
          'grid size-8 shrink-0 place-items-center rounded-lg border border-[var(--panel-border)] bg-[var(--surface-secondary)] text-[var(--text-secondary)]',
        )}
      >
        <Icon name={icon} size={16} />
      </span>
      <div className={tw('min-w-0 flex-1')}>
        <h3 className={tw('m-0 truncate text-compact font-medium')}>{title}</h3>
        <p
          className={tw(
            'mb-0 mt-1 text-xs leading-5 text-[var(--text-secondary)]',
          )}
        >
          {description}
        </p>
      </div>
      {children ? (
        <div className={tw('flex shrink-0 items-center gap-2')}>{children}</div>
      ) : null}
    </div>
  )
}
function collectionDescription(collection: Collection) {
  if (collection.error) return collection.error
  if (!collection.documents) return '正在读取…'
  const updated = Math.max(
    0,
    ...collection.documents.map((doc) => doc.updatedAt),
  )
  const candidates = collection.documents.filter(
    (doc) => doc.state === 'candidate',
  ).length
  return (
    <>
      {collection.documents.length} 条记忆
      {candidates ? ` · ${candidates} 条待确认` : ''}
      {updated ? (
        <>
          {' '}
          · 更新于{' '}
          <time dateTime={new Date(updated).toISOString()}>
            {new Date(updated).toLocaleString([], {
              month: 'numeric',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
              hour12: false,
            })}
          </time>
        </>
      ) : null}
    </>
  )
}

export function MemorySettings({
  service,
  models,
  workspaces = [],
  remoteTaskId,
  remoteLabel,
  initialRecapSettings = false,
  onOpenTask,
}: {
  service?: LingKnowledgeService
  models?: LingModelSettings
  workspaces?: readonly LingWorkspaceSummary[]
  remoteTaskId?: string
  remoteLabel?: string
  initialRecapSettings?: boolean
  onOpenTask: (id: string) => void
}) {
  const [settings, setSettings] = useState<KnowledgeSettings>(knowledgeDefaults)
  const [ready, setReady] = useState(false),
    [loading, setLoading] = useState(true),
    [pending, setPending] = useState(false),
    [error, setError] = useState('')
  const [collections, setCollections] = useState<Collection[]>([]),
    [opened, setOpened] = useState<Collection>(),
    [clearing, setClearing] = useState<Collection>()
  const [recapSettingsOpen, setRecapSettingsOpen] =
    useState(initialRecapSettings)
  const life = useRef(0),
    changing = useRef(false),
    operation = useRef<AbortController | undefined>(undefined)
  // Stable across unrelated shell updates; a changed project set reloads its own scope.
  const projectKey = JSON.stringify(
    workspaces.map((w) => [w.workspaceId, w.label]),
  )
  const refresh = useCallback(
    async (signal: AbortSignal, epoch: number) => {
      if (!service) {
        setLoading(false)
        return
      }
      setLoading(true)
      const projects: [string, string][] = JSON.parse(projectKey)
      const targets: Collection[] = [
        { label: '全局记忆', scope: { workspaceId: null } },
        ...projects.map(([workspaceId, label]) => ({
          label,
          scope: { workspaceId },
        })),
        ...(remoteTaskId
          ? [
              {
                label: remoteLabel || '当前 SSH 项目',
                scope: { workspaceId: null, taskId: remoteTaskId },
              },
            ]
          : []),
      ]
      const results = await Promise.allSettled(
        targets.map((target) =>
          service.request({ type: 'snapshot', ...target.scope }, signal),
        ),
      )
      if (signal.aborted || epoch !== life.current) return
      const next = targets.map((target, index): Collection => {
        const result = results[index]!
        if (
          result.status === 'fulfilled' &&
          result.value.ok &&
          result.value.value.snapshot
        ) {
          return {
            ...target,
            documents: memoryDocuments(result.value.value.snapshot.documents),
          }
        }
        return {
          ...target,
          error:
            result.status === 'rejected'
              ? result.reason instanceof Error
                ? result.reason.message
                : '记忆无法读取，请刷新重试。'
              : !result.value.ok
                ? (result.value.message ?? '记忆无法读取，请刷新重试。')
                : '记忆无法读取，请刷新重试。',
        }
      })
      setCollections(next)
      const global = results[0]!
      if (
        global.status === 'fulfilled' &&
        global.value.ok &&
        global.value.value.snapshot
      ) {
        setSettings(global.value.value.snapshot.settings)
        setReady(true)
      } else setReady(false)
      setLoading(false)
    },
    [service, projectKey, remoteTaskId, remoteLabel],
  )
  useEffect(() => {
    const controller = new AbortController(),
      epoch = ++life.current
    setCollections([])
    setReady(false)
    setOpened(undefined)
    setClearing(undefined)
    setError('')
    setPending(false)
    changing.current = false
    void refresh(controller.signal, epoch)
    return () => {
      life.current++
      controller.abort()
      operation.current?.abort()
    }
  }, [refresh])
  const reload = () => {
    operation.current?.abort()
    const controller = new AbortController()
    operation.current = controller
    void refresh(controller.signal, life.current)
  }
  const update = async (patch: Partial<KnowledgeSettings>) => {
    if (!service || !ready || loading || changing.current) return
    const value = { ...settings, ...patch },
      epoch = life.current,
      controller = new AbortController()
    operation.current = controller
    changing.current = true
    setPending(true)
    setError('')
    try {
      const result = await service.request(
        { type: 'settings', workspaceId: null, settings: value },
        controller.signal,
      )
      if (controller.signal.aborted || epoch !== life.current) return
      if (result.ok) setSettings(value)
      else setError(result.message ?? '设置未保存。')
    } catch (cause) {
      if (!controller.signal.aborted && epoch === life.current)
        setError(cause instanceof Error ? cause.message : '设置未保存。')
    } finally {
      if (epoch === life.current) {
        changing.current = false
        setPending(false)
      }
    }
  }
  const clear = async () => {
    if (!service || !clearing?.documents || changing.current) return
    const controller = new AbortController(),
      epoch = life.current
    operation.current = controller
    changing.current = true
    setPending(true)
    setError('')
    try {
      await clearMemoryCollection(
        service,
        clearing.scope,
        clearing.documents,
        controller.signal,
      )
      if (!controller.signal.aborted && epoch === life.current)
        setClearing(undefined)
    } catch (cause) {
      if (!controller.signal.aborted && epoch === life.current) {
        setError(
          cause instanceof Error ? cause.message : '清空失败，请刷新重试。',
        )
        // Some records may already have been removed. Never offer stale versions again.
        setClearing(undefined)
      }
    } finally {
      if (epoch === life.current) {
        changing.current = false
        setPending(false)
        if (!controller.signal.aborted) await refresh(controller.signal, epoch)
      }
    }
  }
  const disabled = !ready || pending || loading
  const providers =
    models?.providers.filter((provider) => provider.active) ?? []
  const provider = providers.find(
    (provider) => provider.providerId === settings.provider,
  )
  const global = collections[0] ?? {
    label: '全局记忆',
    scope: { workspaceId: null },
    ...(!service ? { error: '知识服务暂不可用，请重启应用。' } : {}),
  }
  const projects = collections
    .slice(1)
    .filter((collection) => collection.error || collection.documents?.length)
  const actions = (collection: Collection) => (
    <>
      <CompactButton
        variant="ghost"
        isIconOnly
        aria-label={`管理${collection.label}${collection.scope.workspaceId || collection.scope.taskId ? '记忆' : ''}`}
        title="查看与管理记忆"
        isDisabled={!collection.documents || pending || loading}
        onPress={() => setOpened(collection)}
      >
        <Icon name="folder" size={17} />
      </CompactButton>
      <CompactButton
        variant="ghost"
        isIconOnly
        aria-label={`清空${collection.label}${collection.scope.workspaceId || collection.scope.taskId ? '记忆' : ''}`}
        title="清空记忆"
        className={tw('text-[var(--danger)]')}
        isDisabled={!collection.documents?.length || pending || loading}
        onPress={() => {
          setError('')
          setClearing(collection)
        }}
      >
        <Icon name="trash" size={16} />
      </CompactButton>
    </>
  )
  if (opened)
    return (
      <div className={tw('flex h-[calc(100dvh-7rem)] min-h-96 flex-col')}>
        <KnowledgeSpace
          service={service}
          scope={opened.scope}
          label={opened.label}
          personal={!opened.scope.workspaceId && !opened.scope.taskId}
          memoryOnly
          onBack={() => {
            setOpened(undefined)
            reload()
          }}
          onSettings={() => {
            setOpened(undefined)
            reload()
          }}
          onOpenTask={onOpenTask}
        />
      </div>
    )
  return (
    <section aria-label="记忆设置" className={tw('w-full min-w-0 pb-8')}>
      <header
        className={tw('mb-7 flex items-start justify-between gap-3 px-4')}
      >
        <div>
          <h1 className={tw('m-0 text-xl font-semibold')}>记忆</h1>
          <p
            className={tw(
              'mb-0 mt-1.5 text-xs leading-5 text-[var(--text-secondary)]',
            )}
          >
            查看和管理 LING 在本机保存的长期记忆。
          </p>
        </div>
        <CompactButton
          variant="ghost"
          isIconOnly
          aria-label="刷新记忆"
          title="刷新记忆"
          isDisabled={!service || loading || pending}
          onPress={reload}
        >
          <Icon name="refresh" size={17} />
        </CompactButton>
      </header>
      {error ? (
        <p role="alert" className={tw('px-4 text-xs text-[var(--danger)]')}>
          {error}
        </p>
      ) : null}
      <MemoryGroup title="记忆行为">
        <MemoryRow
          icon="globe"
          title="全局记忆"
          description="开启后，在所有项目中使用已保存的个人偏好和长期上下文；关闭后保留已有记忆。"
        >
          <CompactSwitch
            label="全局记忆"
            selected={settings.globalMemory}
            disabled={disabled}
            onChange={(value) => void update({ globalMemory: value })}
          />
        </MemoryRow>
        <MemoryRow
          icon="folder"
          title="项目记忆"
          description="开启后，按项目使用已确认的代码库规则与经验；自动提取的内容确认后生效。关闭后保留已有记忆。"
        >
          <CompactSwitch
            label="项目记忆"
            selected={settings.projectMemory}
            disabled={disabled}
            onChange={(value) => void update({ projectMemory: value })}
          />
        </MemoryRow>
      </MemoryGroup>
      <MemoryGroup title="全局记忆">
        <MemoryRow
          icon="globe"
          title="全局记忆"
          description={collectionDescription(global)}
        >
          {actions(global)}
        </MemoryRow>
      </MemoryGroup>
      <MemoryGroup title="项目记忆">
        {projects.length ? (
          projects.map((collection) => (
            <MemoryRow
              key={collection.scope.taskId ?? collection.scope.workspaceId}
              icon="folder"
              title={collection.label}
              description={collectionDescription(collection)}
            >
              {actions(collection)}
            </MemoryRow>
          ))
        ) : (
          <MemoryRow
            icon="folder"
            title={
              loading
                ? '正在读取项目记忆…'
                : !service
                  ? '项目记忆暂不可用。'
                  : '尚无项目记忆。'
            }
            description={
              !service
                ? '知识服务暂不可用，请重启应用。'
                : '保存项目规则，或确认会话中提取的记忆后，会在这里显示。'
            }
          />
        )}
      </MemoryGroup>
      <details
        open={recapSettingsOpen}
        onToggle={(event) => setRecapSettingsOpen(event.currentTarget.open)}
        className={tw('mt-8')}
      >
        <summary
          className={tw(
            'cursor-pointer px-4 text-xs text-[var(--text-tertiary)]',
          )}
        >
          任务回顾与整理模型
        </summary>
        <div className={tw('mt-3')}>
          <SettingsGroup>
            <SettingsRow
              title="整理模型"
              description="用于会话总结、任务回顾和项目知识整理。"
            >
              <div className={tw('flex flex-wrap justify-end gap-2')}>
                <CompactSelect
                  label="知识整理提供商"
                  value={settings.provider}
                  disabled={disabled}
                  options={providers.map((item) => ({
                    value: item.providerId,
                    label: item.displayName,
                  }))}
                  onChange={(value) =>
                    void update({
                      provider: value,
                      model:
                        providers
                          .find((item) => item.providerId === value)
                          ?.models.find((model) => model.enabled !== false)
                          ?.id ?? '',
                    })
                  }
                />
                <CompactSelect
                  label="知识整理模型"
                  value={settings.model}
                  disabled={disabled}
                  options={(provider?.models ?? [])
                    .filter((model) => model.enabled !== false)
                    .map((model) => ({ value: model.id, label: model.name }))}
                  onChange={(value) => void update({ model: value })}
                />
              </div>
            </SettingsRow>
            <SettingsRow
              title="自动总结会话"
              description="回合结束后整理需求、决策、验证结果和未完成事项；摘要用于任务监控中的任务回顾。"
            >
              <CompactSwitch
                label="自动总结会话"
                selected={settings.autoSummary}
                disabled={disabled || !settings.provider || !settings.model}
                onChange={(value) => void update({ autoSummary: value })}
              />
            </SettingsRow>
          </SettingsGroup>
        </div>
      </details>
      {clearing ? (
        <Modal.Backdrop
          isOpen
          isDismissable={!pending}
          onOpenChange={(open: boolean) => {
            if (!open && !pending) setClearing(undefined)
          }}
        >
          <Modal.Container size="sm">
            <Modal.Dialog>
              <Modal.Header>
                <Modal.Heading>清空记忆？</Modal.Heading>
              </Modal.Header>
              <Modal.Body>
                <p className={tw('m-0 text-sm leading-6')}>
                  将「{clearing.label}」的 {clearing.documents?.length ?? 0}{' '}
                  条记忆移出可用列表，不再供 Agent
                  引用。历史版本会保留；项目文件、Wiki、会话总结和其他项目的记忆不受影响。
                </p>
              </Modal.Body>
              <Modal.Footer>
                <CompactButton
                  variant="tertiary"
                  isDisabled={pending}
                  onPress={() => setClearing(undefined)}
                >
                  取消
                </CompactButton>
                <CompactButton
                  variant="danger"
                  isDisabled={pending}
                  onPress={() => void clear()}
                >
                  清空记忆
                </CompactButton>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      ) : null}
    </section>
  )
}
