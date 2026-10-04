import { useEffect, useRef, useState } from 'react'
import type { LingTimelineItem, LingContextBreakdown, LingContextPressure } from '../runtime/contract.js'
import { Icon } from './Icon.js'
import { tw } from './tailwind.js'

const number = new Intl.NumberFormat('zh-CN')

interface ContextWindowIndicatorProps {
  readonly compaction?: LingTimelineItem
  readonly pressure?: LingContextPressure
  readonly breakdown?: LingContextBreakdown
  readonly compactDisabled: boolean
  readonly onCompact: () => void
}

export function ContextWindowIndicator({ pressure, compaction, breakdown, compactDisabled, onCompact }: ContextWindowIndicatorProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const capacity = pressure?.contextWindow
  const used = pressure?.projectedTokens ?? pressure?.pressureTokens
  const percentage = capacity && used !== undefined ? Math.round(used / capacity * 100) : undefined

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  useEffect(() => () => { if (closeTimerRef.current) clearTimeout(closeTimerRef.current) }, [])

  const organizing = compaction?.status === 'running'
  if (percentage === undefined && !organizing) return null
  const barWidth = Math.max(0, Math.min(100, percentage ?? 0))

  return (
    <div
      className={tw("context-window relative ml-auto flex-none")}
      onPointerEnter={() => { if (closeTimerRef.current) clearTimeout(closeTimerRef.current); setOpen(true) }}
      onPointerLeave={() => { closeTimerRef.current = setTimeout(() => { setOpen(false) }, 140) }}
      ref={rootRef}
    >
      <button aria-controls="context-window-popover" aria-expanded={open} aria-label={organizing ? '正在整理上下文' : `上下文窗口已使用 ${String(percentage)}%`} className={tw("context-window__trigger inline-flex items-center gap-1.5 py-0.5 px-1 border-0 rounded-sm bg-transparent [color:var(--foreground)] [font:inherit] cursor-pointer hover:[background:var(--surface-secondary)]")} onClick={() => { setOpen(true) }} type="button">
        <span aria-hidden="true" className={tw("context-window__meter block h-1.5 w-12 overflow-hidden rounded-xs bg-[var(--surface-tertiary)]")}><span className={tw("block h-full bg-[var(--action)]")} style={{ width: `${String(barWidth)}%` }} /></span>
        <span role={organizing ? 'status' : undefined}>{organizing ? '正在整理' : `${String(percentage)}%`}</span>
      </button>
      {open ? (
        <div aria-label="上下文窗口" className={tw("context-window__popover absolute right-0 bottom-[calc(100%+0.35rem)] z-35 w-[min(18rem,calc(100vw-1.5rem))] rounded-xl border border-[var(--panel-border)] bg-[var(--surface)] p-3.5 text-compact leading-6 text-[var(--foreground)] shadow-[var(--overlay-shadow)] bg-[var(--surface)]")} id="context-window-popover" role="dialog">
          <div className={tw("context-window__heading flex justify-between gap-4 text-sm leading-tight")}><strong>上下文窗口</strong><strong className={tw("text-compact text-[var(--text-secondary)]")}>{organizing ? '正在整理' : `${String(percentage)}%`}</strong></div>
          <p className={tw("mt-1.5 mb-0 text-[var(--text-secondary)]")}>展示当前任务的上下文占用情况；压缩会摘要早期内容，可能需要等待并消耗模型用量。</p>
          <div aria-label="上下文占用" aria-valuemax={100} aria-valuemin={0} aria-valuenow={Math.min(100, percentage ?? 0)} className={tw("context-window__progress mt-2 h-1.5 overflow-hidden rounded-xs bg-[var(--surface-tertiary)]")} role="progressbar"><span className={tw("block h-full bg-[var(--action)]")} style={{ width: `${String(barWidth)}%` }} /></div>
          {breakdown ? (
            <div className={tw("context-window__breakdown mt-1.5 flex flex-wrap gap-x-2.5 gap-y-0.5 text-xs text-[var(--text-secondary)]")} title="分类数值为估算，不等于模型实际计费量">
              <span className={tw("w-full")}>估算分类</span><span>系统 {number.format(breakdown.systemTokens)}</span><span>工具 {number.format(breakdown.toolsTokens)}</span><span>消息 {number.format(breakdown.messageTokens)}</span>
            </div>
          ) : <p className={tw("context-window__pending [min-height:1.3rem]")}>分类明细待更新</p>}
          <button className={tw("context-window__compact flex w-full [min-height:2.15rem] items-center justify-center gap-2 mt-2.5 border-0 rounded-md [background:var(--surface-secondary)] [color:var(--foreground)] [font:inherit] [font-weight:600] cursor-pointer enabled:hover:[background:var(--surface-tertiary)] disabled:[color:var(--text-tertiary)] disabled:cursor-not-allowed")} disabled={compactDisabled || organizing} onClick={() => { setOpen(false); onCompact() }} title={compactDisabled ? '当前无法压缩上下文' : '压缩当前任务的早期上下文'} type="button"><Icon name="compressContext" size={16} />压缩上下文</button>
        </div>
      ) : null}
    </div>
  )
}
