import type { LingTaskSummary } from '../runtime/contract.js'
import { Icon } from './Icon.js'
import { sumTokenUsage, totalTokenUsage } from './token-usage.js'
import { tw } from './tailwind.js'

const number = new Intl.NumberFormat('zh-CN')

interface UsageSettingsProps {
  readonly tasks: readonly LingTaskSummary[]
  readonly selectedTask?: LingTaskSummary
}

export function UsageSettings({ tasks, selectedTask }: UsageSettingsProps) {
  const reported = tasks.flatMap(task => task.tokenUsage === undefined ? [] : [task.tokenUsage])
  const usage = sumTokenUsage(reported)
  const total = totalTokenUsage(usage)
  const breakdown = [
    { label: '输入', value: usage.uncachedInputTokens, color: 'bg-[#b66b53]' },
    { label: '缓存读取', value: usage.cacheReadTokens, color: 'bg-[#8796a7]' },
    { label: '缓存写入', value: usage.cacheWriteTokens, color: 'bg-[#a99a7d]' },
    { label: '输出', value: usage.outputTokens, color: 'bg-[#5e8d78]' },
  ]

  return (
    <section aria-label="使用统计" className={tw("usage-settings grid w-full min-w-0 max-w-3xl content-start [gap:1rem]")}>
      <header className={tw("usage-settings__heading mb-1 grid gap-1")}>
        <h1 className={tw("m-0 text-xl font-semibold")}>使用统计</h1>
        <p className={tw("m-0 text-xs text-[var(--text-secondary)]")}>本地任务中模型报告的 Token 用量。</p>
      </header>
      {reported.length === 0 ? (
        <div className={tw("usage-settings__empty grid justify-items-center gap-1.5 rounded-xl border border-[var(--panel-border)] bg-[var(--surface)] px-4 py-10 text-center text-[var(--text-secondary)]")}>
          <Icon name="gauge" size={24} />
          <strong className={tw("text-sm font-semibold text-[var(--foreground)]")}>暂无使用记录</strong>
        </div>
      ) : (
        <>
          <div className={tw("usage-settings__summary grid [grid-template-columns:repeat(auto-fit,_minmax(13rem,_1fr))] [gap:0.7rem]")}>
            <div className={tw("usage-settings__metric grid min-h-28 content-start gap-1.5 rounded-xl border border-[var(--panel-border)] bg-[var(--surface)] px-4.5 py-4")}>
              <span className={tw("text-[0.78rem] text-[var(--text-secondary)]")}>累计 Token</span>
              <strong className={tw("text-[1.7rem] leading-tight font-[650] tabular-nums")}>{number.format(total)}</strong>
            </div>
            <div className={tw("usage-settings__metric grid min-h-28 content-start gap-1.5 rounded-xl border border-[var(--panel-border)] bg-[var(--surface)] px-4.5 py-4")}>
              <span className={tw("text-[0.78rem] text-[var(--text-secondary)]")}>已报告任务</span>
              <strong className={tw("text-[1.7rem] leading-tight font-[650] tabular-nums")}>{number.format(reported.length)}</strong>
              <small className={tw("text-[0.73rem] text-[var(--text-tertiary)]")}>共 {number.format(tasks.length)} 个本地任务</small>
            </div>
          </div>
          <div className={tw("usage-settings__details rounded-xl border border-[var(--panel-border)] bg-[var(--surface)] px-4.5 py-4")}>
            <h2 className={tw("mt-0 mb-3.5 text-sm font-[620]")}>用量构成</h2>
            <dl className={tw("m-0 grid gap-3")}>
              {breakdown.map(item => (
                <div className={tw("usage-settings__detail grid grid-cols-[minmax(5rem,1fr)_auto] gap-x-4 gap-y-1 text-[0.78rem]")} key={item.label}>
                  <dt className={tw("text-[var(--text-secondary)]")}>{item.label}</dt>
                  <dd className={tw("m-0 tabular-nums")}>{number.format(item.value)}</dd>
                  <span aria-hidden="true" className={tw("usage-settings__bar col-span-full h-1 overflow-hidden rounded-full bg-[var(--surface-tertiary)]")}><span className={tw("block h-full rounded-[inherit]", item.color)} style={{ width: `${String(total === 0 ? 0 : item.value / total * 100)}%` }} /></span>
                </div>
              ))}
            </dl>
          </div>
        </>
      )}
      {selectedTask ? (
        <div className={tw("usage-settings__current flex min-w-0 items-center gap-3 rounded-xl border border-[var(--panel-border)] bg-[var(--surface)] px-4.5 py-3.5 text-[0.78rem]")}>
          <span className={tw("flex-none text-[var(--text-secondary)]")}>当前任务</span>
          <strong className={tw("min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap font-semibold")}>{selectedTask.title}</strong>
          <span className={tw("flex-none tabular-nums text-[var(--text-secondary)]")}>{selectedTask.tokenUsage === undefined ? '暂无记录' : `${number.format(totalTokenUsage(selectedTask.tokenUsage))} tokens`}</span>
        </div>
      ) : null}
    </section>
  )
}
