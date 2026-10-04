import { useState, type ChangeEvent, type ReactNode } from 'react'
import { Modal } from '@heroui/react/modal'
import type { AutomationPlan, AutomationSpec } from '../runtime/automation.js'
import type { LingModelSettings, LingWorkspaceSummary } from '../runtime/contract.js'
import { CompactButton, CompactInput, CompactSelect, CompactSwitch } from './SettingsControls.js'
import { tw } from './tailwind.js'
const fieldClass = tw(
  'w-full rounded-lg border border-[var(--panel-border)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--foreground)] outline-none focus:border-[var(--focus)]',
)
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={tw('grid gap-2')}>
      <span className={tw('text-xs font-medium')}>{label}</span>
      {children}
    </div>
  )
}
export function AutomationEditor({
  initial,
  plan,
  workspaces,
  models,
  busy,
  error,
  onClose,
  onSave,
}: {
  initial: AutomationSpec
  plan?: AutomationPlan
  workspaces: readonly LingWorkspaceSummary[]
  models?: LingModelSettings
  busy: boolean
  error: string
  onClose: () => void
  onSave: (spec: AutomationSpec) => Promise<void>
}) {
  const [spec, setSpec] = useState<AutomationSpec>({
      ...initial,
      name: initial.name,
      prompt: initial.prompt,
    }),
    [expiry, setExpiry] = useState(initial.expiresAt !== null)
  const patch = (value: Partial<AutomationSpec>) => setSpec((s) => ({ ...s, ...value }))
  const zones = [
    ...new Set([
      Intl.DateTimeFormat().resolvedOptions().timeZone,
      ...(spec.schedule.kind === 'daily' || spec.schedule.kind === 'weekly' ? [spec.schedule.timeZone] : []),
      'Asia/Shanghai',
      'UTC',
      'America/New_York',
      'Europe/London',
    ]),
  ]
  const modelOptions = [
    { value: 'default', label: '跟随默认模型' },
    ...(models?.providers ?? [])
      .filter((p) => p.configured && p.active)
      .flatMap((p) =>
        p.models.map((m) => ({
          value: JSON.stringify({ provider: p.providerId, model: m.id }),
          label: m.name ?? m.id,
        })),
      ),
  ]
  const valid =
    spec.name.trim() &&
    spec.prompt.trim() &&
    (spec.schedule.kind !== 'weekly' || spec.schedule.weekdays.length) &&
    (spec.schedule.kind !== 'once' || Number.isFinite(spec.schedule.at)) &&
    (!expiry || spec.expiresAt !== null)
  return (
    <Modal.Backdrop
      isOpen
      onOpenChange={(open: boolean) => {
        if (!open && !busy) onClose()
      }}
      isDismissable={!busy}
    >
      <Modal.Container size="lg">
        <Modal.Dialog className={tw('w-[900px] max-w-[calc(100vw-48px)]')}>
          <Modal.CloseTrigger aria-label="关闭" isDisabled={busy} />
          <Modal.Header>
            <Modal.Heading>{plan ? '编辑自动化' : '新建自动化'}</Modal.Heading>
            <p className={tw('mb-0 mt-1 text-xs text-[var(--text-secondary)]')}>
              设置工作内容、执行时间与任务输出。计划保存在本机。
            </p>
          </Modal.Header>
          <Modal.Body className={tw('max-h-[calc(100vh-220px)] overflow-y-auto')}>
            <div className={tw('grid min-h-[380px] grid-cols-[1.2fr_1fr] gap-6 max-[700px]:grid-cols-1')}>
              <div className={tw('flex min-w-0 flex-col gap-4')}>
                <CompactInput
                  aria-label="自动化名称"
                  placeholder="自动化任务名称"
                  value={spec.name}
                  maxLength={120}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => patch({ name: e.target.value })}
                />
                <textarea
                  aria-label="自动化工作内容"
                  value={spec.prompt}
                  maxLength={32000}
                  onChange={(e: ChangeEvent<HTMLTextAreaElement>) => patch({ prompt: e.target.value })}
                  placeholder={'# 目标\n希望 Agent 定期完成什么？\n\n# 上下文\n有哪些约束？\n\n# 步骤\n1. …'}
                  className={tw(fieldClass, 'min-h-60 flex-1 resize-none leading-6')}
                />
                <div className={tw('grid grid-cols-2 gap-3')}>
                  <CompactSelect
                    label="工作区"
                    value={spec.workspaceId ?? 'none'}
                    options={[
                      { value: 'none', label: '不指定工作区' },
                      ...workspaces.map((w) => ({ value: w.workspaceId, label: w.label })),
                    ]}
                    className={tw('w-full')}
                    onChange={(v) => patch({ workspaceId: v === 'none' ? null : v })}
                  />
                  <CompactSelect
                    label="执行模型"
                    value={
                      spec.model
                        ? JSON.stringify({ provider: spec.model.provider, model: spec.model.model })
                        : 'default'
                    }
                    options={modelOptions}
                    className={tw('w-full')}
                    onChange={(v) => patch({ model: v === 'default' ? null : JSON.parse(v) })}
                  />
                </div>
                <p className={tw('m-0 text-caption text-[var(--text-tertiary)]')}>
                  创建计划不会创建空会话；开始执行时才生成任务。
                </p>
              </div>
              <div
                className={tw(
                  'grid min-w-0 content-start gap-5 border-l border-[var(--panel-border)] pl-6 max-[700px]:border-l-0 max-[700px]:pl-0',
                )}
              >
                <Field label="计划时间">
                  <CompactSelect
                    label="执行频率"
                    className={tw('w-full')}
                    value={spec.schedule.kind}
                    options={[
                      { value: 'daily', label: '每天' },
                      { value: 'weekly', label: '每周' },
                      { value: 'interval', label: '固定间隔' },
                      { value: 'once', label: '仅一次' },
                    ]}
                    onChange={(kind) =>
                      patch({
                        schedule:
                          kind === 'interval'
                            ? { kind, minutes: 60 }
                            : kind === 'once'
                              ? { kind, at: Date.now() + 3600000 }
                              : {
                                  kind: kind as 'daily' | 'weekly',
                                  time: '09:00',
                                  timeZone: zones[0]!,
                                  weekdays: kind === 'weekly' ? [1] : [],
                                },
                      })
                    }
                  />
                  {spec.schedule.kind === 'interval' ? (
                    <label className={tw('flex items-center gap-2 text-xs')}>
                      <CompactInput
                        aria-label="间隔分钟"
                        type="number"
                        min={5}
                        max={525600}
                        value={spec.schedule.minutes}
                        onChange={(e: ChangeEvent<HTMLInputElement>) =>
                          patch({ schedule: { kind: 'interval', minutes: Number(e.target.value) } })
                        }
                      />
                      分钟（至少 5 分钟）
                    </label>
                  ) : spec.schedule.kind === 'once' ? (
                    <input
                      aria-label="一次执行时间"
                      type="datetime-local"
                      value={localDate(spec.schedule.at)}
                      onChange={(e: ChangeEvent<HTMLInputElement>) =>
                        patch({ schedule: { kind: 'once', at: new Date(e.target.value).getTime() } })
                      }
                      className={tw(fieldClass)}
                    />
                  ) : (
                    <>
                      <input
                        aria-label="执行时刻"
                        type="time"
                        value={spec.schedule.time}
                        onChange={(e: ChangeEvent<HTMLInputElement>) => {
                          if (spec.schedule.kind === 'daily' || spec.schedule.kind === 'weekly')
                            patch({ schedule: { ...spec.schedule, time: e.target.value } })
                        }}
                        className={tw(fieldClass)}
                      />
                      {spec.schedule.kind === 'weekly' ? (
                        <div className={tw('flex flex-wrap gap-1')}>
                          {['日', '一', '二', '三', '四', '五', '六'].map((label, day) => (
                            <button
                              key={day}
                              type="button"
                              aria-label={`星期${label}`}
                              aria-pressed={
                                spec.schedule.kind === 'weekly' && spec.schedule.weekdays.includes(day)
                              }
                              className={tw(
                                'grid size-7 cursor-pointer place-items-center rounded-md border border-[var(--panel-border)] text-xs',
                                spec.schedule.kind === 'weekly' && spec.schedule.weekdays.includes(day)
                                  ? 'bg-[var(--surface-selected)] text-[var(--foreground)]'
                                  : 'bg-transparent text-[var(--text-secondary)]',
                              )}
                              onClick={() => {
                                if (spec.schedule.kind === 'weekly')
                                  patch({
                                    schedule: {
                                      ...spec.schedule,
                                      weekdays: spec.schedule.weekdays.includes(day)
                                        ? spec.schedule.weekdays.filter((d) => d !== day)
                                        : [...spec.schedule.weekdays, day].sort(),
                                    },
                                  })
                              }}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      ) : null}
                      <CompactSelect
                        label="时区"
                        className={tw('w-full')}
                        value={spec.schedule.timeZone}
                        options={zones.map((z) => ({ value: z, label: z }))}
                        onChange={(timeZone) => {
                          if (spec.schedule.kind === 'daily' || spec.schedule.kind === 'weekly')
                            patch({ schedule: { ...spec.schedule, timeZone } })
                        }}
                      />
                    </>
                  )}
                </Field>
                <Field label="到期日期">
                  <div
                    className={tw('flex items-center justify-between text-xs text-[var(--text-secondary)]')}
                  >
                    <span>到期后停止安排新的执行</span>
                    <CompactSwitch
                      label="设置到期日期"
                      selected={expiry}
                      onChange={(v) => {
                        setExpiry(v)
                        patch({ expiresAt: v ? Date.now() + 30 * 86400000 : null })
                      }}
                    />
                  </div>
                  {expiry ? (
                    <input
                      aria-label="到期时间"
                      type="datetime-local"
                      value={localDate(spec.expiresAt ?? Date.now())}
                      className={tw(fieldClass)}
                      onChange={(e: ChangeEvent<HTMLInputElement>) =>
                        patch({ expiresAt: new Date(e.target.value).getTime() })
                      }
                    />
                  ) : null}
                </Field>
                <Field label="任务输出">
                  <CompactSelect
                    label="任务输出方式"
                    className={tw('w-full')}
                    value={spec.output}
                    onChange={(v) => patch({ output: v as AutomationSpec['output'] })}
                    options={[
                      { value: 'separate', label: '每次独立任务' },
                      { value: 'reuse', label: '合并到此计划的专用任务' },
                    ]}
                  />
                </Field>
                <Field label="执行权限">
                  <CompactSelect
                    label="执行权限"
                    className={tw('w-full')}
                    value={spec.permission}
                    onChange={(v) => patch({ permission: v as AutomationSpec['permission'] })}
                    options={[
                      { value: 'read-only', label: '只读 · 写入需要审批' },
                      { value: 'workspace-write', label: '工作区写入 · 按需审批' },
                      { value: 'danger-full-access', label: '完全访问 · 无需审批' },
                    ]}
                  />
                  <p className={tw('m-0 text-caption leading-5 text-[var(--text-secondary)]')}>
                    {spec.permission === 'danger-full-access'
                      ? '允许 Agent 无人值守调用工具，包括修改文件与执行命令。'
                      : '遇到需要审批的操作时，任务会等待你在会话中处理。'}
                  </p>
                </Field>
                <Field label="错过计划时">
                  <CompactSelect
                    label="错过计划时"
                    className={tw('w-full')}
                    value={spec.missed}
                    onChange={(v) => patch({ missed: v as AutomationSpec['missed'] })}
                    options={[
                      { value: 'skip', label: '跳过已错过的执行' },
                      { value: 'latest', label: '只补执行最近一次' },
                    ]}
                  />
                </Field>
              </div>
            </div>
            {error ? (
              <p role="alert" className={tw('mb-0 mt-3 text-xs text-[var(--danger)]')}>
                {error}
              </p>
            ) : null}
          </Modal.Body>
          <Modal.Footer>
            <CompactButton variant="ghost" isDisabled={busy} onPress={onClose}>
              取消
            </CompactButton>
            <CompactButton
              isDisabled={!valid || busy}
              onPress={() => void onSave({ ...spec, expiresAt: expiry ? spec.expiresAt : null })}
            >
              {busy ? '保存中…' : plan ? '保存' : '创建'}
            </CompactButton>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  )
}
function localDate(at: number) {
  if (!Number.isFinite(at)) return ''
  const date = new Date(at - dateOffset(at))
  return date.toISOString().slice(0, 16)
}
function dateOffset(at: number) {
  return new Date(at).getTimezoneOffset() * 60000
}
