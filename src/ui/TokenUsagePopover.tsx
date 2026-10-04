import { Button } from '@heroui/react/button'
import { Popover } from '@heroui/react/popover'
import type { LingTaskSummary } from '../runtime/contract.js'
import { Icon } from './Icon.js'
import { sumTokenUsage, totalTokenUsage } from './token-usage.js'
import { tw } from './tailwind.js'

const number = new Intl.NumberFormat('zh-CN')

export function TokenUsagePopover({ tasks, selectedTask }: {
  readonly tasks: readonly LingTaskSummary[]
  readonly selectedTask?: LingTaskSummary
}) {
  const reported = tasks.flatMap(task => task.tokenUsage === undefined ? [] : [task.tokenUsage])
  const usage = sumTokenUsage(reported)

  return (
    <Popover>
      <Button aria-label="Token 用量" className={tw("sidebar-footer__tool grid size-control min-w-0 shrink-0 place-items-center rounded-md border-0 bg-transparent p-0 text-[var(--text-secondary)] shadow-none hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)] focus-visible:ring-2 focus-visible:ring-[var(--focus)] max-[700px]:size-10")} isIconOnly size="sm" title="Token 用量" variant="ghost">
        <Icon name="gauge" size={18} />
      </Button>
      <Popover.Content className={tw("token-usage-popover w-66 max-w-[calc(100vw-1.5rem)] rounded-xl border border-[var(--panel-border)] bg-[var(--surface)] p-0 shadow-[var(--overlay-shadow)]")} offset={10} placement="top start">
        <Popover.Dialog className={tw("px-4 py-3.5")}>
          <Popover.Heading className={tw("text-sm font-[650] text-[var(--foreground)]")}>Token 用量</Popover.Heading>
          {reported.length === 0 ? (
            <p className={tw("token-usage-popover__empty mt-3.5 mx-0 mb-0.5 [color:var(--text-secondary)] text-xs [line-height:1.5]")}>暂无模型报告的用量。</p>
          ) : (
            <>
              <div className={tw("token-usage-popover__total grid gap-0.5 py-3.5 pb-3 text-xs text-[var(--text-secondary)]")}>
                <span>已记录任务累计</span>
                <strong className={tw("text-2xl leading-tight font-[650] text-[var(--foreground)]")}>{number.format(totalTokenUsage(usage))} <small className={tw("text-xs font-[450]")}>tokens</small></strong>
                <span>{number.format(reported.length)} 个任务</span>
              </div>
              <dl className={tw("token-usage-popover__breakdown m-0 grid gap-2 border-t border-[var(--separator)] py-3 text-xs")}>
                <div className={tw("flex justify-between gap-4")}><dt className={tw("text-[var(--text-secondary)]")}>输入</dt><dd className={tw("m-0 tabular-nums")}>{number.format(usage.uncachedInputTokens)}</dd></div>
                <div className={tw("flex justify-between gap-4")}><dt className={tw("text-[var(--text-secondary)]")}>缓存读取</dt><dd className={tw("m-0 tabular-nums")}>{number.format(usage.cacheReadTokens)}</dd></div>
                <div className={tw("flex justify-between gap-4")}><dt className={tw("text-[var(--text-secondary)]")}>缓存写入</dt><dd className={tw("m-0 tabular-nums")}>{number.format(usage.cacheWriteTokens)}</dd></div>
                <div className={tw("flex justify-between gap-4")}><dt className={tw("text-[var(--text-secondary)]")}>输出</dt><dd className={tw("m-0 tabular-nums")}>{number.format(usage.outputTokens)}</dd></div>
              </dl>
            </>
          )}
          {selectedTask ? (
            <div className={tw("token-usage-popover__current flex justify-between gap-3 border-t border-[var(--separator)] pt-3 text-xs")}>
              <span className={tw("text-[var(--text-secondary)]")}>当前任务</span>
              <strong className={tw("font-[590] tabular-nums")}>{selectedTask.tokenUsage === undefined ? '暂无记录' : `${number.format(totalTokenUsage(selectedTask.tokenUsage))} tokens`}</strong>
            </div>
          ) : null}
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  )
}
