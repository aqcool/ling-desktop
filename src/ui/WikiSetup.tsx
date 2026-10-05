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
  updatedAt,
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
  updatedAt?: number
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
  const generationState = running ? '正在生成' : job?.status === 'failed' ? generated ? '部分生成' : '生成失败' : job?.status === 'cancelled' ? '已取消' : generated ? '已生成' : '尚未生成'
  return (
    <div className={tw('flex min-h-full flex-col')}>
      <div
        className={tw(
          'mx-auto flex w-full max-w-[540px] flex-1 flex-col px-6 py-12 max-[700px]:py-6',
        )}
      >
        <div
          className={tw('mb-8 flex flex-col items-center gap-4 text-center')}
        >
          <div
            className={tw(
              'flex size-14 items-center justify-center rounded-2xl bg-[color-mix(in_srgb,var(--link)_7%,var(--surface))] text-[var(--link)]',
            )}
          >
            <Icon name={cards ? 'grid' : 'agentPreset'} size={28} />
          </div>
          <h1 className={tw('m-0 text-xl font-semibold')}>{cards ? '知识卡片概览' : 'Repo Wiki 概览'}</h1>
          <p className={tw('m-0 text-xs leading-6 text-[var(--text-secondary)]')}>{generated ? '查看项目知识的生成状态与更新设置。' : '从项目代码生成 Wiki 与知识卡片。'}</p>
        </div>
        <section aria-label="Wiki 概览" className={tw('mb-5 grid gap-4 rounded-xl border border-[var(--panel-border)] bg-[var(--surface)] p-5 text-xs')}>
          <div className={tw('flex items-center justify-between gap-3')}><span className={tw('text-[var(--text-secondary)]')}>生成状态</span><span className={tw(running ? 'text-[var(--link)]' : job?.status === 'failed' ? 'text-[var(--warning)]' : generated ? 'text-[var(--success)]' : 'text-[var(--text-tertiary)]')}>{generationState}</span></div>
          <div className={tw('flex items-center justify-between gap-3')}><span className={tw('text-[var(--text-secondary)]')}>知识内容</span><span>{pageCount} 个页面 · {cardCount} 张卡片</span></div>
          <div className={tw('flex items-center justify-between gap-3')}><span className={tw('text-[var(--text-secondary)]')}>代码索引</span><span>{indexedFiles} 个文件</span></div>
          {updatedAt ? <div className={tw('flex items-center justify-between gap-3')}><span className={tw('text-[var(--text-secondary)]')}>最近更新</span><time dateTime={new Date(updatedAt).toISOString()}>{new Date(updatedAt).toLocaleString(undefined, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</time></div> : null}
        </section>
        {job && job.status !== 'completed' ? <section aria-label="Wiki 生成状态" aria-live="polite" className={tw('mb-5 rounded-xl border border-[var(--panel-border)] p-4')}>
          <div className={tw('flex items-center justify-between gap-3')}>
            <strong className={tw('text-sm font-medium')}>{{ queued: '等待生成', running: '正在生成', completed: '生成完成', failed: '生成失败', cancelled: '已取消' }[job.status]}</strong>
            {job.status === 'running' || job.status === 'queued' ? <CompactButton variant="tertiary" isDisabled={pending} onPress={() => onJobAction?.('cancel', job.id)}>取消生成</CompactButton> : job.status === 'failed' || job.status === 'cancelled' ? <CompactButton variant="secondary" isDisabled={pending || !ready} onPress={() => onJobAction?.('retry', job.id)}>重试生成</CompactButton> : null}
          </div>
          {job.message ? <p role={job.status === 'failed' ? 'alert' : undefined} className={tw('mb-0 mt-2 whitespace-pre-wrap break-words text-xs leading-6', job.status === 'failed' ? 'text-[var(--danger)]' : 'text-[var(--text-secondary)]')}>{job.message}</p> : null}
          {job.status === 'failed' || job.status === 'cancelled' ? <p className={tw('mb-0 mt-1 text-xs leading-5 text-[var(--text-secondary)]')}>已生成的页面保留在目录中，可以继续阅读。重试会复用未变更的页面。</p> : null}
        </section> : null}
        <details key={generated ? 'generated' : 'empty'} open={generated ? undefined : true} className={tw('mb-5 rounded-xl border border-[var(--panel-border)]')}>
          <summary className={tw('cursor-pointer px-4 py-3 text-xs font-medium')}>生成与更新设置<span className={tw('ml-3 font-normal text-[var(--text-tertiary)]')}>{options.language === 'en' ? 'English' : '简体中文'}</span></summary>
        <section
          aria-label="Wiki 生成配置"
          className={tw(
            'overflow-hidden border-t border-[var(--panel-border)] bg-[var(--surface)]',
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
        {settings && providers.length ? <div className={tw('grid gap-2 border-t border-[var(--panel-border)] px-4 py-4')}>
          <span className={tw('text-xs text-[var(--text-secondary)]')}>生成模型</span>
          <div className={tw('flex flex-wrap gap-2')}>
            <CompactSelect label="Wiki 模型提供商" value={settings.provider} disabled={pending || running} options={providers.map(item => ({ value: item.providerId, label: item.displayName }))} onChange={value => onModelChange?.({ ...settings, provider: value, model: providers.find(item => item.providerId === value)?.models.find(item => item.enabled !== false)?.id ?? '' })} />
            <CompactSelect label="Wiki 生成模型" value={settings.model} disabled={pending || running} options={(provider?.models ?? []).filter(item => item.enabled !== false).map(item => ({ value: item.id, label: item.name }))} onChange={value => onModelChange?.({ ...settings, model: value })} className={tw('w-56')} />
          </div>
        </div> : !ready ? <div className={tw('flex items-center justify-between gap-3 px-4 py-3 text-xs leading-6 text-[var(--text-secondary)]')}><span>尚未连接可用的生成模型。</span><CompactButton variant="tertiary" onPress={onSettings}>配置模型</CompactButton></div> : <p className={tw('m-0 px-4 py-3 text-xs leading-6 text-[var(--text-tertiary)]')}>生成模型：{settings?.model}</p>}
        </details>
        {!ready && generated ? <p className={tw('mt-0 text-xs text-[var(--text-secondary)]')}>连接生成模型后可更新 Wiki。<button type="button" className={tw('border-0 bg-transparent text-[var(--link)]')} onClick={onSettings}>配置模型</button></p> : null}
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
