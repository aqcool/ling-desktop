import { useEffect, useRef, useState } from 'react'
import type { LingContextBreakdown, LingContextPressure } from '../runtime/contract.js'
import { Icon } from './Icon.js'
import { tw } from './tailwind.js'

const number = new Intl.NumberFormat('zh-CN')

interface ContextWindowIndicatorProps {
  readonly pressure?: LingContextPressure
  readonly breakdown?: LingContextBreakdown
  readonly compactDisabled: boolean
  readonly onCompact: () => void
}

export function ContextWindowIndicator({ pressure, breakdown, compactDisabled, onCompact }: ContextWindowIndicatorProps) {
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

  if (percentage === undefined) return null
  const barWidth = Math.max(0, Math.min(100, percentage))

  return (
    <div
      className={tw("context-window relative ml-auto flex-none")}
      onPointerEnter={() => { if (closeTimerRef.current) clearTimeout(closeTimerRef.current); setOpen(true) }}
      onPointerLeave={() => { closeTimerRef.current = setTimeout(() => { setOpen(false) }, 140) }}
      ref={rootRef}
    >
      <button aria-controls="context-window-popover" aria-expanded={open} aria-label={`上下文窗口已使用 ${String(percentage)}%`} className={tw("context-window__trigger inline-flex items-center [gap:0.35rem] [padding:0.1rem_0.2rem] border-0 [border-radius:0.3rem] bg-transparent [color:#4f4c48] [font:inherit] cursor-pointer hover:[background:#f5f3f1] dark:[color:#c7c3bf] dark:hover:[background:#2b2b2e]")} onClick={() => { setOpen(true) }} type="button">
        <span aria-hidden="true" className={tw("context-window__meter block h-1.5 w-12 overflow-hidden rounded-xs bg-[#e9e7e5] dark:bg-[#414043]")}><span className={tw("block h-full bg-[#c86543]")} style={{ width: `${String(barWidth)}%` }} /></span>
        <span>{percentage}%</span>
      </button>
      {open ? (
        <div aria-label="上下文窗口" className={tw("context-window__popover absolute right-0 bottom-[calc(100%+0.35rem)] z-35 w-[min(18rem,calc(100vw-1.5rem))] rounded-xl border border-[#e8e0d8] bg-white p-3.5 text-[0.8rem] leading-6 text-[#33312f] shadow-[0_16px_42px_rgb(57_41_25_/_0.14)] dark:border-[#34343a] dark:bg-[#232327] dark:text-[#ececee]")} id="context-window-popover" role="dialog">
          <div className={tw("context-window__heading flex justify-between gap-4 text-sm leading-tight")}><strong>上下文窗口</strong><strong className={tw("text-[0.8rem] text-[#56514c] dark:text-[#aaa7a4]")}>{percentage}%</strong></div>
          <p className={tw("mt-1.5 mb-0 text-[#726d67] dark:text-[#aaa7a4]")}>展示当前任务的上下文占用情况；压缩会摘要早期内容，可能需要等待并消耗模型用量。</p>
          <div aria-label="上下文占用" aria-valuemax={100} aria-valuemin={0} aria-valuenow={Math.min(100, percentage)} className={tw("context-window__progress mt-2 h-1.5 overflow-hidden rounded-xs bg-[#eae8e6] dark:bg-[#414043]")} role="progressbar"><span className={tw("block h-full bg-[#c86543]")} style={{ width: `${String(barWidth)}%` }} /></div>
          {breakdown ? (
            <div className={tw("context-window__breakdown mt-1.5 flex flex-wrap gap-x-2.5 gap-y-0.5 text-[0.72rem] text-[#726d67] dark:text-[#aaa7a4]")} title="分类数值为估算，不等于模型实际计费量">
              <span className={tw("w-full")}>估算分类</span><span>系统 {number.format(breakdown.systemTokens)}</span><span>工具 {number.format(breakdown.toolsTokens)}</span><span>消息 {number.format(breakdown.messageTokens)}</span>
            </div>
          ) : <p className={tw("context-window__pending [min-height:1.3rem]")}>分类明细待更新</p>}
          <button className={tw("context-window__compact flex w-full [min-height:2.15rem] items-center justify-center [gap:0.45rem] [margin-top:0.65rem] border-0 [border-radius:0.42rem] [background:#f1f0ee] [color:#2e2e2b] [font:inherit] [font-weight:600] cursor-pointer enabled:hover:[background:#e9e7e4] disabled:[color:#a9a49f] disabled:cursor-not-allowed dark:[background:#333337] dark:[color:#ececee] dark:enabled:hover:[background:#3c3c41]")} disabled={compactDisabled} onClick={() => { setOpen(false); onCompact() }} title={compactDisabled ? '当前无法压缩上下文' : '压缩当前任务的早期上下文'} type="button"><Icon name="compressContext" size={16} />压缩上下文</button>
        </div>
      ) : null}
    </div>
  )
}
