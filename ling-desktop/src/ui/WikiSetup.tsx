import type { KnowledgeSettings, WikiOptions } from '../runtime/knowledge.js'
import { wikiDefaults } from '../runtime/knowledge.js'
import { CompactButton, CompactSwitch } from './SettingsControls.js'
import { Icon } from './Icon.js'
import { tw } from './tailwind.js'
export function WikiSetup({
  options = wikiDefaults,
  settings,
  pending,
  running,
  generated,
  cards,
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
  onChange: (options: WikiOptions) => void
  onGenerate: () => void
  onSettings: () => void
  onBack?: () => void
}) {
  const ready = !!settings?.provider && !!settings?.model
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
          'mx-auto flex w-full max-w-[450px] flex-1 flex-col justify-center px-6 py-10 max-[700px]:py-6',
        )}
      >
        <div
          className={tw('mb-7 flex flex-col items-center gap-4 text-center')}
        >
          <div
            className={tw(
              'flex size-16 items-center justify-center rounded-2xl border border-[var(--panel-border)] bg-[var(--surface)] text-[var(--text-secondary)]',
            )}
          >
            <Icon name={cards ? 'agentPreset' : 'book'} size={30} />
          </div>
          <h1 className={tw('m-0 text-xl font-semibold')}>
            {generated ? '更新' : '生成'}
            {!cards ? ' ' : ''}
            {cards ? '知识卡片' : 'Repo Wiki'}
          </h1>
        </div>
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
        {!ready ? (
          <div
            className={tw(
              'my-3 flex items-center justify-between gap-3 text-xs leading-6 text-[var(--text-secondary)]',
            )}
          >
            <span>先选择用于生成的模型。</span>
            <CompactButton variant="tertiary" onPress={onSettings}>
              选择模型
            </CompactButton>
          </div>
        ) : (
          <p
            className={tw(
              'my-3 text-center text-xs leading-6 text-[var(--text-tertiary)]',
            )}
          >
            使用已连接的模型生成，结果保存在本机。
          </p>
        )}
        <CompactButton
          isDisabled={pending || running || !ready}
          onPress={onGenerate}
          className={tw('w-full')}
        >
          {running
            ? '正在生成…'
            : generated
              ? '更新 Wiki 与知识卡片'
              : '生成 Wiki 与知识卡片'}
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
