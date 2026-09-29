import { useState } from 'react'
import { Button } from '@heroui/react/button'
import { Spinner } from '@heroui/react/spinner'
import type { LingFileDiff, LingTaskChanges } from '../runtime/contract.js'
import { Icon } from './Icon.js'
import { tw } from './tailwind.js'

export interface ChangeSelection {
  readonly index: number
  readonly seq: number
}

interface ChangeReviewProps {
  readonly changes: readonly LingTaskChanges[]
  readonly diff?: LingFileDiff
  readonly diffLoading: boolean
  readonly diffMessage?: string
  readonly loading: boolean
  readonly message?: string
  readonly onCloseDiff: () => void
  readonly onSelect: (selection: ChangeSelection) => void
  readonly selection?: ChangeSelection
}

interface DiffTag {
  readonly kind: 'added' | 'deleted' | 'coarse'
  readonly text: string
}

function diffTags(diff: LingFileDiff | undefined): readonly DiffTag[] {
  if (diff === undefined || diff.kind !== 'text') return []
  const tags: DiffTag[] = []
  if (!diff.before) tags.push({ kind: 'added', text: '本轮新增' })
  if (!diff.after) tags.push({ kind: 'deleted', text: '本轮删除' })
  if (diff.coarse) tags.push({ kind: 'coarse', text: '简化比较' })
  return tags
}

function count(changes: readonly LingTaskChanges[], field: 'added' | 'deleted' | 'total'): number {
  return changes.reduce((total, change) => total + change[field], 0)
}

function DiffContent({
  diff,
  diffLoading: loading,
  diffMessage: message,
}: Pick<ChangeReviewProps, 'diff' | 'diffLoading' | 'diffMessage'>) {
  if (loading) return <p className={tw("change-review__state flex [min-height:3.75rem] items-center [gap:0.45rem] m-0 [padding:0.4rem_0.35rem] [color:#6b6b6b] [font-size:0.75rem] dark:[color:#a3a3a8]")}><Spinner size="sm" /> 正在读取差异</p>
  if (message) return <p className={tw("change-review__state flex [min-height:3.75rem] items-center [gap:0.45rem] m-0 [padding:0.4rem_0.35rem] [color:#6b6b6b] [font-size:0.75rem] dark:[color:#a3a3a8] change-review__state--error [color:#b04c43] dark:[color:#e08a80]")}>{message}</p>
  if (diff === undefined) return null
  if (diff.kind !== 'text') {
    return <p className={tw("change-review__state flex [min-height:3.75rem] items-center [gap:0.45rem] m-0 [padding:0.4rem_0.35rem] [color:#6b6b6b] [font-size:0.75rem] dark:[color:#a3a3a8]")}>{diff.kind === 'binary' ? '这是二进制文件，无法显示文本差异。' : '文件过大，无法显示文本差异。'}</p>
  }
  if (diff.hunks.length === 0) return <p className={tw("change-review__state flex [min-height:3.75rem] items-center [gap:0.45rem] m-0 [padding:0.4rem_0.35rem] [color:#6b6b6b] [font-size:0.75rem] dark:[color:#a3a3a8]")}>两个版本没有文本差异。</p>

  return (
    <div className={tw("change-review__diff [max-height:min(28rem,_calc(100vh_-_18rem))] [margin-top:0.55rem] overflow-auto [border:1px_solid_#e9e9e9] [border-radius:0.7rem] [background:#fbfbfb] dark:[background:#202024] dark:[color:#d8d8da]")}>
      {diff.hunks.map((hunk, index) => (
        <div className={tw("change-review__hunk bg-[#fbfbfb] text-[#666] dark:bg-[#202024] dark:text-[#d8d8da]", index > 0 && "border-t border-[#eeeeee] dark:border-[#2e2e33]")} key={`${String(hunk.oldStart)}-${String(hunk.newStart)}-${String(index)}`}>
          <p className={tw("change-review__hunk-label m-0 [padding:0.35rem_0.55rem] [background:#f1f4f7] [color:#4f5b6a] [font-family:ui-monospace,_SFMono-Regular,_Menlo,_Monaco,_Consolas,_monospace] [font-size:0.64rem] dark:[background:#262b31] dark:[color:#97a3b0]")}>@@ -{String(hunk.oldStart)},{String(hunk.oldLines)} +{String(hunk.newStart)},{String(hunk.newLines)} @@</p>
          <pre className={tw("m-0")}>{hunk.lines.map((line, lineIndex) => (
            <code
              className={tw("block min-w-max px-2 py-px font-mono text-[0.67rem] leading-[1.55]", line.startsWith('+') ? "change-review__line--added bg-[#eaf7ee] text-[#267a43]! dark:bg-[#17301f] dark:text-[#7fd39a]!" : line.startsWith('-') ? "change-review__line--deleted bg-[#fdf0ee] text-[#a94c42]! dark:bg-[#33191a] dark:text-[#f09b93]!" : undefined)}
              key={`${line}-${String(lineIndex)}`}
            >{line}</code>
          ))}</pre>
        </div>
      ))}
    </div>
  )
}

export function ChangeReview({
  changes,
  diff,
  diffLoading,
  diffMessage,
  loading,
  message,
  onCloseDiff,
  onSelect,
  selection,
}: ChangeReviewProps) {
  const selectedFile = selection === undefined
    ? undefined
    : changes.find(change => change.seq === selection.seq)?.files[selection.index]

  if (selectedFile !== undefined) {
    return (
      <section className={tw("change-review min-w-0 change-review--detail min-w-0")}>
        <div className={tw("change-review__toolbar mb-1.5 flex min-h-8 items-center justify-between text-xs text-[var(--text-secondary)]")}>
          <Button className={tw("gap-1 text-xs")} onPress={onCloseDiff} size="sm" variant="ghost"><Icon name="arrowLeft" size={16} /> 变更</Button>
          <span>文件差异</span>
        </div>
        <div className={tw("change-review__file-heading grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-xl border border-[#e9e9e9] bg-[#fafafa] px-2.5 py-2 text-[var(--text-secondary)] dark:border-[#303035] dark:bg-[#1d1d20] dark:text-[#a3a3a8]")}>
          <Icon name="file" size={17} />
          <strong className={tw("overflow-hidden text-ellipsis whitespace-nowrap text-[0.74rem] font-[570] text-[var(--foreground)]")} title={selectedFile.path}>{selectedFile.display}</strong>
          <span className={tw("change-review__file-tags flex justify-end flex-wrap [gap:0.35rem]")}>
            {diffTags(diff).map(tag => (
              <small
                className={tw(
                  "change-review__file-tag whitespace-nowrap text-[0.65rem]",
                  tag.kind === 'added' && "change-review__file-tag--added text-[var(--success)]",
                  tag.kind === 'deleted' && "change-review__file-tag--deleted text-[var(--danger)]",
                  tag.kind === 'coarse' && "text-[var(--warning)]",
                )}
                key={tag.kind}
              >
                {tag.text}
              </small>
            ))}
          </span>
        </div>
        <DiffContent diff={diff} diffLoading={diffLoading} diffMessage={diffMessage} />
      </section>
    )
  }

  if (loading) return <p className={tw("change-review__state flex [min-height:3.75rem] items-center [gap:0.45rem] m-0 [padding:0.4rem_0.35rem] [color:#6b6b6b] [font-size:0.75rem] dark:[color:#a3a3a8]")}><Spinner size="sm" /> 正在读取变更</p>
  if (message) return <p className={tw("change-review__state flex [min-height:3.75rem] items-center [gap:0.45rem] m-0 [padding:0.4rem_0.35rem] [color:#6b6b6b] [font-size:0.75rem] dark:[color:#a3a3a8] change-review__state--error [color:#b04c43] dark:[color:#e08a80]")}>{message}</p>
  if (changes.length === 0) return <p className={tw("change-review__state flex [min-height:3.75rem] items-center [gap:0.45rem] m-0 [padding:0.4rem_0.35rem] [color:#6b6b6b] [font-size:0.75rem] dark:[color:#a3a3a8]")}>此任务尚未记录文件变更。</p>

  return (
    <section className={tw("change-review min-w-0")}>
      <div className={tw("change-review__summary flex items-center gap-2 rounded-xl border border-[#ececec] bg-[#fafafa] px-2.5 py-2 text-[0.72rem] text-[#676767] dark:border-[#303035] dark:bg-[#1d1d20] dark:text-[#a3a3a8]")}>
        <span className={tw("mr-auto")}><strong className={tw("font-[620] text-[#3b3b3b] dark:text-[#dcdcde]")}>{String(count(changes, 'total'))}</strong> 个文件</span>
        <span className={tw("change-review__added [color:#1f7a43] [font-style:normal] dark:[color:#6ec98c]")}>+{String(count(changes, 'added'))}</span>
        <span className={tw("change-review__deleted [color:#b0413a] [font-style:normal] dark:[color:#ef968d]")}>−{String(count(changes, 'deleted'))}</span>
      </div>
      <div className={tw("change-review__groups grid [max-height:min(28rem,_calc(100vh_-_19rem))] [margin-top:0.6rem] overflow-auto [gap:0.8rem]")}>
        {changes.map(change => (
          <div className={tw("change-review__group")} key={String(change.seq)}>
            <p className={tw("mt-0 mr-0 mb-0.5 ml-0 px-1.5 text-[0.68rem] text-[var(--text-tertiary)]")}>第 {String(change.turn)} 轮</p>
            {change.files.map((file, index) => (
              <button
                className={tw("change-review__file grid min-h-9.5 w-full min-w-0 grid-cols-[1.15rem_minmax(0,1fr)_auto] items-center gap-2 rounded-xl border-0 bg-transparent px-2 py-1.5 text-left text-[#555] hover:bg-[#f1f1f1] hover:outline-0 focus-visible:bg-[#f1f1f1] focus-visible:outline-0 dark:text-[#c2c2c6] dark:hover:bg-[#2a2a2e] dark:hover:text-[#e8e8e9] dark:focus-visible:bg-[#2a2a2e] dark:focus-visible:text-[#e8e8e9]")}
                key={`${String(change.seq)}-${file.path}`}
                onClick={() => { onSelect({ seq: change.seq, index }) }}
                type="button"
              >
                <Icon name={file.binary || file.oversized ? 'file' : 'code'} size={16} />
                <span className={tw("overflow-hidden text-ellipsis whitespace-nowrap text-[0.74rem]")} title={file.path}>{file.display}</span>
                <small className={tw("flex gap-1 font-mono text-[0.65rem] text-[var(--text-tertiary)]")}>
                  {file.binary ? '二进制' : file.oversized ? '文件过大' : <><i className={tw("not-italic text-[#1f7a43] dark:text-[#6ec98c]")}>+{String(file.added)}</i><em className={tw("not-italic text-[#b0413a] dark:text-[#ef968d]")}>−{String(file.deleted)}</em></>}
                </small>
              </button>
            ))}
          </div>
        ))}
      </div>
    </section>
  )
}

/** Compact conversation summary; file clicks use the same diff selection as the review panel. */
export function ConversationChangeSummary({ change, onSelect }: {
  readonly change: LingTaskChanges
  readonly onSelect: (selection: ChangeSelection) => void
}) {
  const [expanded, setExpanded] = useState(false)
  if (change.files.length === 0) return null
  const visible = expanded ? change.files : change.files.slice(0, 3)
  return <section aria-label={`第 ${String(change.turn)} 轮文件变更`} className={tw("mx-2 min-w-0 overflow-hidden rounded-lg border border-[var(--panel-border)] text-sm")}>
    <div className={tw("flex items-center gap-3 border-b border-[var(--panel-border)] px-4 py-3")}>
      <span className={tw("grid size-10 shrink-0 place-items-center rounded-lg bg-[var(--surface-secondary)] text-[var(--text-tertiary)]")}><Icon name="review" size={20} /></span>
      <div className={tw("min-w-0 flex-1")}><p className={tw("m-0 font-semibold leading-6")}>已编辑 {change.total} 个文件</p><p className={tw("m-0 flex gap-2 text-xs leading-5 tabular-nums")}><span className={tw("text-[#59a476]")}>+{change.added}</span><span className={tw("text-[#ee6262]")}>−{change.deleted}</span></p></div>
      <button className={tw("h-7 shrink-0 rounded-lg border border-[var(--panel-border)] bg-transparent px-3 text-xs font-medium hover:bg-[var(--surface-hover)]")} onClick={() => { onSelect({ seq: change.seq, index: 0 }) }} type="button">审阅</button>
    </div>
    <div className={tw("px-3 py-2")}>
      {visible.map((file, index) => <button className={tw("flex min-h-8 w-full min-w-0 items-center gap-3 rounded-md border-0 bg-transparent px-1 text-left text-[13px] hover:bg-[var(--surface-hover)]")} key={file.path} onClick={() => { onSelect({ seq: change.seq, index }) }} type="button">
        <span className={tw("min-w-0 flex-1 truncate text-[var(--text-secondary)]")} title={file.path}>{file.display}</span>
        <span className={tw("flex shrink-0 gap-2 text-xs tabular-nums")}>
          {file.binary || file.oversized ? <span className={tw("text-[var(--text-tertiary)]")}>{file.binary ? '二进制' : '文件过大'}</span> : <><span className={tw("text-[#59a476]")}>+{file.added}</span><span className={tw("text-[#ee6262]")}>−{file.deleted}</span></>}
        </span>
      </button>)}
      {change.files.length > 3 ? <button aria-expanded={expanded} className={tw("mt-1 inline-flex h-7 items-center gap-1 rounded-md border-0 bg-transparent px-1 text-xs font-medium hover:bg-[var(--surface-hover)]")} onClick={() => { setExpanded(value => !value) }} type="button">{expanded ? '收起' : `再显示 ${String(change.files.length - 3)} 个文件`}<Icon className={tw(expanded && "rotate-180")} name="chevronDown" size={12} /></button> : null}
    </div>
  </section>
}
