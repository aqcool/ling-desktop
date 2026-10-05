import type { KnowledgeJob, KnowledgeSettings, WikiOptions } from '../runtime/knowledge.js'
import { wikiDefaults } from '../runtime/knowledge.js'
import type { LingModelSettings } from '../runtime/contract.js'
import { CompactButton, CompactSwitch, CompactSelect } from './SettingsControls.js'
import { Icon } from './Icon.js'
import { tw } from './tailwind.js'
export function WikiSetup({
  options = wikiDefaults,
  settings,
  pending,
  running,
  generated,
  cards,
  job,
  pageCount = 0,
  cardCount = 0,
  indexedFiles = 0,
  models,
  onModelChange,
  onJobAction,
  onChange,
  onGenerate,
  onSettings,
  onBack,
}: {
  options?: WikiOptions
  settings?: KnowledgeSettings
  pending: boolean
  running: boolean
  generated: boolean
  cards: boolean
  job?: KnowledgeJob
  pageCount?: number
  cardCount?: number
  indexedFiles?: number
  models?: LingModelSettings
  onModelChange?: (settings: KnowledgeSettings) => void
  onJobAction?: (type: 'retry' | 'cancel', id: string) => void
  onChange: (options: WikiOptions) => void
  onGenerate: () => void
  onSettings: () => void
  onBack?: () => void
}) {
  const providers = models?.providers.filter(provider => provider.active) ?? []
  const provider = providers.find(provider => provider.providerId === settings?.provider)
  const ready = !!settings?.provider && !!settings?.model && (!models || !!provider?.models.some(model => model.id === settings.model && model.enabled !== false))
  return (
    <div className={tw('flex min-h-full flex-col')}>
      {!cards ? (
        <p
          className={tw(
            'm-0 flex items-start gap-2 bg-[color-mix(in_srgb,var(--link)_8%,var(--surface))] px-6 py-3 text-xs leading-6 text-[var(--link)]',
          )}
        >
          <Icon name="info" size={16} className={tw('mt-1 shrink-0')} />
          Wiki 供你阅读，知识卡片供 Agent 按需检索，两者基于项目代码一同生成。
        </p>
      ) : null}
      <div
        className={tw(
          'mx-auto flex w-full max-w-[640px] flex-1 flex-col px-6 py-10 max-[700px]:py-6',
        )}
      >
        <div
          className={tw('mb-6 flex flex-col items-start gap-3')}
        >
          <div
            className={tw(
              'flex size-10 items-center justify-center rounded-xl border border-[var(--panel-border)] bg-[var(--surface)] text-[var(--text-secondary)]',
            )}
          >
            <Icon name={cards ? 'agentPreset' : 'book'} size={22} />
          </div>
          <h1 className={tw('m-0 text-xl font-semibold')}>概览</h1>
          <p className={tw('m-0 text-xs leading-6 text-[var(--text-secondary)]')}>查看生成状态，选择模型与更新策略。</p>
        </div>
        {job ? <section aria-label="Wiki 生成状态" aria-live="polite" className={tw('mb-5 rounded-xl border border-[var(--panel-border)] p-4')}>
          <div className={tw('flex items-center justify-between gap-3')}>
            <strong className={tw('text-sm font-medium')}>{{ queued: '等待生成', running: '正在生成', completed: '生成完成', failed: '生成失败', cancelled: '已取消' }[job.status]}</strong>
            {job.status === 'running' || job.status === 'queued' ? <CompactButton variant="tertiary" isDisabled={pending} onPress={() => onJobAction?.('cancel', job.id)}>取消生成</CompactButton> : job.status === 'failed' || job.status === 'cancelled' ? <CompactButton variant="secondary" isDisabled={pending || !ready} onPress={() => onJobAction?.('retry', job.id)}>重试生成</CompactButton> : null}
          </div>
          {job.message ? <p role={job.status === 'failed' ? 'alert' : undefined} className={tw('mb-0 mt-2 whitespace-pre-wrap break-words text-xs leading-6', job.status === 'failed' ? 'text-[var(--danger)]' : 'text-[var(--text-secondary)]')}>{job.message}</p> : null}
          {job.status === 'failed' || job.status === 'cancelled' ? <p className={tw('mb-0 mt-1 text-xs leading-5 text-[var(--text-secondary)]')}>已生成的页面保留在目录中，可以继续阅读。重试会复用未变更的页面。</p> : null}
        </section> : null}
        {generated || indexedFiles ? <p className={tw('mb-5 mt-0 text-xs leading-6 text-[var(--text-secondary)]')}>{pageCount} 个 Wiki 页面 · {cardCount} 张知识卡片 · 已索引 {indexedFiles} 个文件</p> : null}
        <section
          aria-label="Wiki 生成配置"
          className={tw(
            'overflow-hidden rounded-xl border border-[var(--panel-border)] bg-[var(--surface)]',
          )}
        >
          <div
            className={tw(
              'flex min-h-16 items-center justify-between gap-4 px-4 py-3',
            )}
          >
            <span className={tw('text-sm font-medium')}>语言</span>
            <div
              className={tw(
                'flex gap-0.5 rounded-lg bg-[var(--surface-secondary)] p-0.5',
              )}
            >
              {(
                [
                  { id: 'en', label: 'English' },
                  { id: 'zh-CN', label: '简体中文' },
                ] as const
              ).map((item) => (
                <CompactButton
                  key={item.id}
                  variant="tertiary"
                  isDisabled={pending || running}
                  aria-pressed={options.language === item.id}
                  className={tw(
                    options.language === item.id &&
                      'bg-[var(--surface)] shadow-sm',
                  )}
                  onPress={() => onChange({ ...options, language: item.id })}
                >
                  {item.label}
                </CompactButton>
              ))}
            </div>
          </div>
          <div
            className={tw(
              'flex min-h-20 items-center justify-between gap-5 border-t border-[var(--panel-border)] px-4 py-3',
            )}
          >
            <div>
              <h2 className={tw('m-0 text-sm font-medium')}>自动更新</h2>
              <p
                className={tw(
                  'mb-0 mt-1 text-xs leading-5 text-[var(--text-secondary)]',
                )}
              >
                源码索引变化后更新相关页面，保留手工编辑。
              </p>
            </div>
            <CompactSwitch
              label="自动更新 Wiki"
              selected={options.autoUpdate}
              disabled={pending || running || !ready}
              onChange={(value) => onChange({ ...options, autoUpdate: value })}
            />
          </div>
          <div
            className={tw(
              'flex min-h-20 items-center justify-between gap-5 border-t border-[var(--panel-border)] px-4 py-3',
            )}
          >
            <div>
              <h2 className={tw('m-0 text-sm font-medium')}>智能体引用</h2>
              <p
                className={tw(
                  'mb-0 mt-1 text-xs leading-5 text-[var(--text-secondary)]',
                )}
              >
                允许当前项目的 Agent 检索 Wiki 与知识卡片。
              </p>
            </div>
            <CompactSwitch
              label="Wiki 智能体引用"
              selected={options.agentReference}
              disabled={pending || running}
              onChange={(value) =>
                onChange({ ...options, agentReference: value })
              }
            />
          </div>
        </section>
        {settings && providers.length ? <div className={tw('my-4 grid gap-2')}>
          <span className={tw('text-xs text-[var(--text-secondary)]')}>生成模型</span>
          <div className={tw('flex flex-wrap gap-2')}>
            <CompactSelect label="Wiki 模型提供商" value={settings.provider} disabled={pending || running} options={providers.map(item => ({ value: item.providerId, label: item.displayName }))} onChange={value => onModelChange?.({ ...settings, provider: value, model: providers.find(item => item.providerId === value)?.models.find(item => item.enabled !== false)?.id ?? '' })} />
            <CompactSelect label="Wiki 生成模型" value={settings.model} disabled={pending || running} options={(provider?.models ?? []).filter(item => item.enabled !== false).map(item => ({ value: item.id, label: item.name }))} onChange={value => onModelChange?.({ ...settings, model: value })} className={tw('w-56')} />
          </div>
        </div> : !ready ? <div className={tw('my-3 flex items-center justify-between gap-3 text-xs leading-6 text-[var(--text-secondary)]')}><span>尚未连接可用的生成模型。</span><CompactButton variant="tertiary" onPress={onSettings}>配置模型</CompactButton></div> : <p className={tw('my-3 text-xs leading-6 text-[var(--text-tertiary)]')}>生成模型：{settings?.model}</p>}
        <CompactButton
          isDisabled={pending || running || !ready}
          onPress={onGenerate}
          className={tw('w-full')}
        >
          {running
            ? '正在生成…'
            : generated
              ? '更新 Repo Wiki'
              : '生成 Repo Wiki'}
        </CompactButton>
        {onBack ? (
          <CompactButton
            variant="tertiary"
            className={tw('mt-2')}
            onPress={onBack}
          >
            返回阅读
          </CompactButton>
        ) : null}
      </div>
    </div>
  )
}
