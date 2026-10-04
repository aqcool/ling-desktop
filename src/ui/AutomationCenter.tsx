import { useCallback, useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import { Modal } from '@heroui/react/modal'
import type {
  AutomationPlan,
  AutomationRun,
  AutomationSpec,
  AutomationSnapshot,
  AutomationRequest,
  LingAutomationService,
} from '../runtime/automation.js'
import { automationActive } from '../runtime/automation.js'
import type { LingModelSettings, LingWorkspaceSummary } from '../runtime/contract.js'
import { CompactButton, CompactInput, CompactSelect, CompactSwitch } from './SettingsControls.js'
import { AutomationEditor } from './AutomationEditor.js'
import { Icon } from './Icon.js'
import { tw } from './tailwind.js'
import {
  automationTemplates,
  automationStatusLabels,
  newAutomation,
  scheduleLabel,
} from './automation-view.js'
interface Props {
  service?: LingAutomationService
  workspaces: readonly LingWorkspaceSummary[]
  models?: LingModelSettings
  workspaceId?: string
  onOpenTask: (id: string) => void
}
const fieldClass = tw(
  'w-full rounded-lg border border-[var(--panel-border)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--foreground)] outline-none focus:border-[var(--focus)]',
)
export function AutomationCenter(props: Props) {
  const [tab, setTab] = useState<'plans' | 'templates' | 'runs'>('plans'),
    [snapshot, setSnapshot] = useState<AutomationSnapshot>(),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  const [editor, setEditor] = useState<{ spec: AutomationSpec; plan?: AutomationPlan }>(),
    [natural, setNatural] = useState(false),
    [description, setDescription] = useState(''),
    [query, setQuery] = useState(''),
    [filter, setFilter] = useState('all'),
    [sort, setSort] = useState('created'),
    [confirmRemove, setConfirmRemove] = useState<string>()
  const live = useRef(true),
    draftAbort = useRef<AbortController | undefined>(undefined)
  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      if (!props.service) {
        setError('自动化服务暂不可用，请重启应用。')
        return
      }
      const result = await props.service.request({ type: 'snapshot' }, signal)
      if (!live.current || signal?.aborted) return
      if (result.ok && result.value.snapshot) {
        setSnapshot(result.value.snapshot)
      } else if (!result.ok) setError(result.message)
    },
    [props.service],
  )
  useEffect(() => {
    live.current = true
    const abort = new AbortController()
    void refresh(abort.signal)
    const timer = setInterval(() => void refresh(abort.signal), 5000)
    return () => {
      live.current = false
      abort.abort()
      draftAbort.current?.abort()
      clearInterval(timer)
    }
  }, [refresh])
  async function action(request: AutomationRequest) {
    if (!props.service || busy) return
    setBusy(true)
    setError('')
    try {
      const result = await props.service.request(request)
      if (!live.current) return
      if (!result.ok) {
        setError(result.message)
        return false
      }
      await refresh()
      return true
    } catch (e) {
      if (live.current) setError(e instanceof Error ? e.message : '操作失败。')
      return false
    } finally {
      if (live.current) setBusy(false)
    }
  }
  function create(spec = newAutomation()) {
    setError('')
    setEditor({ spec: { ...spec, workspaceId: props.workspaceId ?? null } })
  }
  async function draft() {
    if (!props.service || !props.models || !description.trim() || busy) return
    const abort = new AbortController()
    draftAbort.current = abort
    setBusy(true)
    setError('')
    try {
      const result = await props.service.request(
        {
          type: 'draft',
          text: description,
          model: props.models.defaultSelection,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
        abort.signal,
      )
      if (abort.signal.aborted || !live.current) return
      if (result.ok && result.value.draft) {
        setNatural(false)
        create(result.value.draft)
      } else if (!result.ok) setError(result.message)
    } catch (e) {
      if (!abort.signal.aborted) setError(e instanceof Error ? e.message : '草稿生成失败。')
    } finally {
      if (live.current) setBusy(false)
    }
  }
  const plans = (snapshot?.plans ?? [])
    .filter(
      (p) =>
        (filter === 'all' || (filter === 'enabled' ? p.enabled : !p.enabled)) &&
        `${p.name} ${p.prompt}`.toLowerCase().includes(query.toLowerCase()),
    )
    .sort((a, b) =>
      sort === 'next' ? (a.nextAt ?? Infinity) - (b.nextAt ?? Infinity) : b.createdAt - a.createdAt,
    )
  return (
    <section
      aria-label="自动化"
      className={tw('min-h-0 flex-1 overflow-y-auto bg-[var(--surface)] px-8 pb-12 pt-8 max-[700px]:px-4')}
    >
      <div className={tw('mx-auto max-w-[960px]')}>
        <header className={tw('mb-7 flex flex-wrap items-start justify-between gap-4')}>
          <div>
            <h1 className={tw('m-0 text-xl font-semibold')}>自动化</h1>
            <p className={tw('mb-0 mt-2 text-xs leading-5 text-[var(--text-secondary)]')}>
              按计划启动 Agent 工作，在本机集中查看执行结果。
            </p>
          </div>
          <div className={tw('flex items-center gap-2')}>
            <CompactButton variant="ghost" isIconOnly aria-label="刷新自动化" onPress={() => void refresh()}>
              <Icon name="refresh" size={16} />
            </CompactButton>
            <CompactButton
              variant="secondary"
              onPress={() => {
                setError('')
                setNatural(true)
              }}
            >
              用自然语言创建
            </CompactButton>
            <CompactButton onPress={() => create()}>
              <Icon name="plus" size={14} />
              新建自动化
            </CompactButton>
          </div>
        </header>
        <div
          className={tw(
            'mb-7 flex items-center gap-3 rounded-lg bg-[var(--surface-secondary)] px-4 py-3 text-xs',
          )}
        >
          <Icon name="desktop" size={16} />
          <div className={tw('min-w-0 flex-1')}>
            <span className={tw('font-medium')}>保持设备唤醒</span>
            <span className={tw('ml-2 text-[var(--text-secondary)]')}>
              有有效计划或执行中的任务时阻止系统休眠。退出应用后计划暂停执行。
            </span>
          </div>
          <CompactSwitch
            label="保持设备唤醒"
            selected={snapshot?.keepAwake ?? false}
            disabled={!snapshot || busy}
            onChange={(keepAwake) => void action({ type: 'settings', keepAwake })}
          />
        </div>
        <div className={tw('mb-5 flex flex-wrap items-center justify-between gap-3')}>
          <div role="tablist" aria-label="自动化视图" className={tw('flex gap-5')}>
            {(
              [
                ['plans', '自动化'],
                ['templates', '模板'],
                ['runs', '执行记录'],
              ] as const
            ).map(([key, label]) => (
              <button
                type="button"
                role="tab"
                tabIndex={tab === key ? 0 : -1}
                onKeyDown={(event) => {
                  const keys = ['plans', 'templates', 'runs'] as const
                  const index = keys.indexOf(key)
                  const next =
                    event.key === 'ArrowRight'
                      ? (index + 1) % 3
                      : event.key === 'ArrowLeft'
                        ? (index + 2) % 3
                        : event.key === 'Home'
                          ? 0
                          : event.key === 'End'
                            ? 2
                            : undefined
                  if (next === undefined) return
                  event.preventDefault()
                  setTab(keys[next]!)
                  document.getElementById(`automation-tab-${keys[next]}`)?.focus()
                }}
                aria-selected={tab === key}
                id={`automation-tab-${key}`}
                aria-controls={`automation-panel-${key}`}
                key={key}
                onClick={() => setTab(key)}
                className={tw(
                  'cursor-pointer border-0 bg-transparent px-0 py-2 text-sm',
                  tab === key ? 'font-semibold text-[var(--foreground)]' : 'text-[var(--text-tertiary)]',
                )}
              >
                {label}
              </button>
            ))}
          </div>
          {tab === 'plans' ? (
            <div className={tw('flex flex-wrap gap-2')}>
              <CompactInput
                aria-label="搜索自动化"
                placeholder="搜索自动化…"
                value={query}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setQuery(e.target.value)}
                className={tw('w-40')}
              />
              <CompactSelect
                label="计划状态"
                value={filter}
                onChange={setFilter}
                className={tw('w-24')}
                options={[
                  { value: 'all', label: '全部' },
                  { value: 'enabled', label: '已启用' },
                  { value: 'paused', label: '已暂停' },
                ]}
              />
              <CompactSelect
                label="排序"
                value={sort}
                onChange={setSort}
                className={tw('w-28')}
                options={[
                  { value: 'created', label: '最新创建' },
                  { value: 'next', label: '下次执行' },
                ]}
              />
            </div>
          ) : null}
        </div>
        {error ? (
          <div
            role="alert"
            className={tw(
              'mb-4 flex items-center justify-between gap-3 rounded-lg bg-[var(--surface-secondary)] px-3 py-2 text-xs text-[var(--danger)]',
            )}
          >
            {error}
            <CompactButton variant="ghost" onPress={() => void refresh()}>
              刷新
            </CompactButton>
          </div>
        ) : null}
        <div role="tabpanel" id={`automation-panel-${tab}`} aria-labelledby={`automation-tab-${tab}`}>
          {tab === 'templates' ? (
            <div className={tw('grid grid-cols-2 gap-3 max-[700px]:grid-cols-1')}>
              {automationTemplates.map((template) => (
                <article
                  key={template.name}
                  className={tw('flex min-h-40 flex-col rounded-xl border border-[var(--panel-border)] p-5')}
                >
                  <h2 className={tw('m-0 text-sm font-medium')}>{template.name}</h2>
                  <p className={tw('mb-5 mt-2 text-xs leading-5 text-[var(--text-secondary)]')}>
                    {template.description}
                  </p>
                  <footer
                    className={tw(
                      'mt-auto flex items-center justify-between gap-3 border-t border-dashed border-[var(--panel-border)] pt-3',
                    )}
                  >
                    <span className={tw('flex items-center gap-1.5 text-xs text-[var(--text-secondary)]')}>
                      <Icon name="clock" size={14} />
                      {scheduleLabel({
                        ...template.schedule,
                        weekdays: [...template.schedule.weekdays],
                        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                      })}
                    </span>
                    <CompactButton
                      variant="secondary"
                      onPress={() =>
                        create({
                          ...newAutomation(),
                          name: template.name,
                          prompt: template.prompt,
                          schedule: {
                            ...template.schedule,
                            weekdays: [...template.schedule.weekdays],
                            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                          },
                        })
                      }
                    >
                      使用模板
                    </CompactButton>
                  </footer>
                </article>
              ))}
            </div>
          ) : tab === 'plans' ? (
            plans.length ? (
              <div className={tw('grid gap-3')}>
                {plans.map((plan) => (
                  <article
                    key={plan.id}
                    className={tw('rounded-xl border border-[var(--panel-border)] px-5 py-4')}
                  >
                    <div className={tw('flex items-start justify-between gap-4')}>
                      <div className={tw('min-w-0')}>
                        <h2 className={tw('m-0 truncate text-sm font-medium')}>{plan.name}</h2>
                        <p
                          className={tw(
                            'mb-0 mt-2 line-clamp-2 text-xs leading-5 text-[var(--text-secondary)]',
                          )}
                        >
                          {plan.prompt}
                        </p>
                      </div>
                      <CompactSwitch
                        label={`启用 ${plan.name}`}
                        selected={plan.enabled}
                        disabled={busy}
                        onChange={(enabled) =>
                          void action({ type: 'toggle', id: plan.id, version: plan.version, enabled })
                        }
                      />
                    </div>
                    <div className={tw('mt-4 flex flex-wrap items-center justify-between gap-3')}>
                      <div
                        className={tw('flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--text-secondary)]')}
                      >
                        <span>{scheduleLabel(plan.schedule)}</span>
                        <span>
                          {props.workspaces.find((w) => w.workspaceId === plan.workspaceId)?.label ??
                            (plan.workspaceId ? '工作区已移除' : '不指定工作区')}
                        </span>
                        <span>
                          {!plan.enabled
                            ? '已暂停'
                            : plan.nextAt
                              ? `下次 ${new Date(plan.nextAt).toLocaleString()}`
                              : '计划已到期'}
                        </span>
                      </div>
                      <div className={tw('flex gap-1')}>
                        <CompactButton
                          variant="ghost"
                          isDisabled={
                            busy ||
                            snapshot?.runs.some((r) => r.planId === plan.id && automationActive(r.status))
                          }
                          onPress={() => void action({ type: 'run', id: plan.id })}
                        >
                          立即运行
                        </CompactButton>
                        <CompactButton
                          variant="ghost"
                          onPress={() => setEditor({ spec: specOf(plan), plan })}
                        >
                          编辑
                        </CompactButton>
                        {confirmRemove === plan.id ? (
                          <>
                            <CompactButton
                              variant="danger"
                              isDisabled={busy}
                              onPress={() =>
                                void action({ type: 'remove', id: plan.id, version: plan.version }).then(
                                  (ok) => {
                                    if (ok) setConfirmRemove(undefined)
                                  },
                                )
                              }
                            >
                              确认删除
                            </CompactButton>
                            <CompactButton variant="ghost" onPress={() => setConfirmRemove(undefined)}>
                              取消
                            </CompactButton>
                          </>
                        ) : (
                          <CompactButton variant="ghost" onPress={() => setConfirmRemove(plan.id)}>
                            删除
                          </CompactButton>
                        )}
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <Empty
                title={query || filter !== 'all' ? '没有匹配的自动化' : '还没有自动化'}
                description="创建本地执行计划，或从模板开始。"
                action={
                  <CompactButton variant="secondary" onPress={() => create()}>
                    新建自动化
                  </CompactButton>
                }
              />
            )
          ) : snapshot?.runs.length ? (
            <div className={tw('grid gap-3')}>
              {snapshot.runs.map((run) => (
                <RunCard
                  key={run.id}
                  run={run}
                  busy={busy}
                  onOpen={() => props.onOpenTask(run.taskId)}
                  onCancel={() => void action({ type: 'cancel', runId: run.id })}
                  onRetry={() => void action({ type: 'retry', runId: run.id })}
                />
              ))}
            </div>
          ) : (
            <Empty title="还没有执行记录" description="计划触发或立即运行后，执行结果会保存在这里。" />
          )}
        </div>
      </div>
      {editor ? (
        <AutomationEditor
          key={editor.plan?.id ?? 'new'}
          initial={editor.spec}
          plan={editor.plan}
          workspaces={props.workspaces}
          models={props.models}
          busy={busy}
          error={error}
          onClose={() => setEditor(undefined)}
          onSave={async (spec) => {
            if (
              await action({
                type: 'save',
                spec,
                ...(editor.plan ? { id: editor.plan.id, version: editor.plan.version } : {}),
              })
            ) {
              setEditor(undefined)
              setTab('plans')
            }
          }}
        />
      ) : null}
      <Modal.Backdrop
        isOpen={natural}
        onOpenChange={(open: boolean) => {
          if (!open) {
            draftAbort.current?.abort()
            setNatural(false)
          }
        }}
      >
        <Modal.Container size="sm">
          <Modal.Dialog>
            <Modal.CloseTrigger aria-label="关闭" />
            <Modal.Header>
              <Modal.Heading>用自然语言创建</Modal.Heading>
              <p className={tw('mb-0 mt-1 text-xs text-[var(--text-secondary)]')}>
                描述要做的工作与执行时间，生成后仍可编辑。
              </p>
            </Modal.Header>
            <Modal.Body>
              <textarea
                aria-label="自动化需求"
                rows={5}
                value={description}
                onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setDescription(e.target.value)}
                placeholder="例如：每周一早上 9 点，检查当前项目的安全风险，并给出建议。"
                className={tw(fieldClass)}
              />
              {error ? (
                <p role="alert" className={tw('text-xs text-[var(--danger)]')}>
                  {error}
                </p>
              ) : null}
            </Modal.Body>
            <Modal.Footer>
              <CompactButton
                variant="ghost"
                onPress={() => {
                  draftAbort.current?.abort()
                  setNatural(false)
                }}
              >
                取消
              </CompactButton>
              <CompactButton
                isDisabled={!description.trim() || !props.models || busy}
                onPress={() => void draft()}
              >
                {busy ? '生成中…' : '生成草稿'}
              </CompactButton>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </section>
  )
}
function Empty({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <div className={tw('grid min-h-64 justify-items-center content-center gap-3 text-center')}>
      <span
        className={tw(
          'mb-2 grid size-12 place-items-center rounded-xl border border-[var(--panel-border)] text-[var(--text-tertiary)]',
        )}
      >
        <Icon name="calendarClock" size={25} />
      </span>
      <h2 className={tw('m-0 text-sm font-semibold')}>{title}</h2>
      <p className={tw('m-0 text-xs text-[var(--text-secondary)]')}>{description}</p>
      {action}
    </div>
  )
}
function RunCard({
  run,
  busy,
  onOpen,
  onCancel,
  onRetry,
}: {
  run: AutomationRun
  busy: boolean
  onOpen: () => void
  onCancel: () => void
  onRetry: () => void
}) {
  return (
    <article className={tw('rounded-xl border border-[var(--panel-border)] px-5 py-4')}>
      <div className={tw('flex items-center justify-between gap-3')}>
        <h2 className={tw('m-0 truncate text-sm font-medium')}>{run.spec.name}</h2>
        <span
          className={tw(
            'shrink-0 rounded-md bg-[var(--surface-secondary)] px-2 py-1 text-caption text-[var(--text-secondary)]',
          )}
        >
          {automationStatusLabels[run.status]}
        </span>
      </div>
      <p className={tw('my-2 text-xs text-[var(--text-tertiary)]')}>
        {new Date(run.scheduledAt).toLocaleString()}
        {run.retryOf ? ' · 重试执行' : ''}
      </p>
      {run.summary ? (
        <p
          className={tw(
            'mb-3 mt-2 whitespace-pre-wrap break-words text-xs leading-5 text-[var(--text-secondary)]',
          )}
        >
          {run.summary}
        </p>
      ) : null}
      <div className={tw('flex gap-1')}>
        <CompactButton variant="ghost" onPress={onOpen}>
          打开任务
        </CompactButton>
        {automationActive(run.status) ? (
          <CompactButton variant="ghost" isDisabled={busy} onPress={onCancel}>
            取消执行
          </CompactButton>
        ) : ['failed', 'interrupted', 'cancelled'].includes(run.status) ? (
          <CompactButton variant="ghost" isDisabled={busy} onPress={onRetry}>
            重试
          </CompactButton>
        ) : null}
      </div>
    </article>
  )
}
function specOf(p: AutomationPlan): AutomationSpec {
  const { id, version, createdAt, updatedAt, nextAt, taskId, archived, ...spec } = p
  return spec
}
