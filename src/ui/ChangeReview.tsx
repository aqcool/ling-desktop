import { useState } from 'react'
import { Button } from '@heroui/react/button'
import { Spinner } from '@heroui/react/spinner'
import type { LingFileDiff, LingTaskChanges } from '../runtime/contract.js'
import type { LingPresentedFile } from '../runtime/reply-features.js'
import { deliveryForChangedFile } from './conversation-deliveries.js'
import { Icon } from './Icon.js'
import { FileIcon } from './FileIcon.js'
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
  if (loading) return <p className={tw("change-review__state flex [min-height:3.75rem] items-center gap-2 m-0 py-1.5 px-1.5 [color:var(--text-secondary)] text-xs")}><Spinner size="sm" /> 正在读取差异</p>
  if (message) return <p className={tw("change-review__state flex [min-height:3.75rem] items-center gap-2 m-0 py-1.5 px-1.5 [color:var(--text-secondary)] text-xs change-review__state--error [color:var(--danger)]")}>{message}</p>
  if (diff === undefined) return null
  if (diff.kind !== 'text') {
    return <p className={tw("change-review__state flex [min-height:3.75rem] items-center gap-2 m-0 py-1.5 px-1.5 [color:var(--text-secondary)] text-xs")}>{diff.kind === 'binary' ? '这是二进制文件，无法显示文本差异。' : '文件过大，无法显示文本差异。'}</p>
  }
  if (diff.hunks.length === 0) return <p className={tw("change-review__state flex [min-height:3.75rem] items-center gap-2 m-0 py-1.5 px-1.5 [color:var(--text-secondary)] text-xs")}>两个版本没有文本差异。</p>

  return (
    <div className={tw("change-review__diff [max-height:min(28rem,_calc(100vh_-_18rem))] mt-2 overflow-auto [border:1px_solid_var(--panel-border)] rounded-xl [background:var(--surface)] [color:var(--text-tertiary)]")}>
      {diff.hunks.map((hunk, index) => (
        <div className={tw("change-review__hunk bg-[var(--surface)] text-[var(--text-secondary)]", index > 0 && "border-t border-[var(--panel-border)]")} key={`${String(hunk.oldStart)}-${String(hunk.newStart)}-${String(index)}`}>
          <p className={tw("change-review__hunk-label m-0 py-1.5 px-2 [background:var(--surface-secondary)] [color:var(--text-secondary)] [font-family:ui-monospace,_SFMono-Regular,_Menlo,_Monaco,_Consolas,_monospace] text-micro")}>@@ -{String(hunk.oldStart)},{String(hunk.oldLines)} +{String(hunk.newStart)},{String(hunk.newLines)} @@</p>
          <pre className={tw("m-0")}>{hunk.lines.map((line, lineIndex) => (
            <code
              className={tw("block min-w-max px-2 py-px font-mono text-caption leading-[1.55]", line.startsWith('+') ? "change-review__line--added bg-[var(--success-subtle)] text-[var(--success)]!" : line.startsWith('-') ? "change-review__line--deleted bg-[var(--danger-subtle)] text-[var(--danger)]!" : undefined)}
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
        <div className={tw("change-review__toolbar mb-1.5 flex min-h-control items-center justify-between text-xs text-[var(--text-secondary)]")}>
          <Button className={tw("gap-1 text-xs")} onPress={onCloseDiff} size="sm" variant="ghost"><Icon name="arrowLeft" size={16} /> 变更</Button>
          <span>文件差异</span>
        </div>
        <div className={tw("change-review__file-heading grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-xl border border-[var(--panel-border)] bg-[var(--surface-secondary)] px-2.5 py-2 text-[var(--text-secondary)]")}>
          <Icon name="file" size={17} />
          <strong className={tw("overflow-hidden text-ellipsis whitespace-nowrap text-xs font-[570] text-[var(--foreground)]")} title={selectedFile.path}>{selectedFile.display}</strong>
          <span className={tw("change-review__file-tags flex justify-end flex-wrap gap-1.5")}>
            {diffTags(diff).map(tag => (
              <small
                className={tw(
                  "change-review__file-tag whitespace-nowrap text-micro",
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

  if (loading) return <p className={tw("change-review__state flex [min-height:3.75rem] items-center gap-2 m-0 py-1.5 px-1.5 [color:var(--text-secondary)] text-xs")}><Spinner size="sm" /> 正在读取变更</p>
  if (message) return <p className={tw("change-review__state flex [min-height:3.75rem] items-center gap-2 m-0 py-1.5 px-1.5 [color:var(--text-secondary)] text-xs change-review__state--error [color:var(--danger)]")}>{message}</p>
  if (changes.length === 0) return <p className={tw("change-review__state flex [min-height:3.75rem] items-center gap-2 m-0 py-1.5 px-1.5 [color:var(--text-secondary)] text-xs")}>此任务尚未记录文件变更。</p>

  return (
    <section className={tw("change-review min-w-0")}>
      <div className={tw("change-review__summary flex items-center gap-2 rounded-xl border border-[var(--panel-border)] bg-[var(--surface-secondary)] px-2.5 py-2 text-xs text-[var(--text-secondary)]")}>
        <span className={tw("mr-auto")}><strong className={tw("font-[620] text-[var(--foreground)]")}>{String(count(changes, 'total'))}</strong> 个文件</span>
        <span className={tw("change-review__added [color:var(--success)] [font-style:normal]")}>+{String(count(changes, 'added'))}</span>
        <span className={tw("change-review__deleted [color:var(--danger)] [font-style:normal]")}>−{String(count(changes, 'deleted'))}</span>
      </div>
      <div className={tw("change-review__groups grid [max-height:min(28rem,_calc(100vh_-_19rem))] mt-2.5 overflow-auto gap-3")}>
        {changes.map(change => (
          <div className={tw("change-review__group")} key={String(change.seq)}>
            <p className={tw("mt-0 mr-0 mb-0.5 ml-0 px-1.5 text-caption text-[var(--text-tertiary)]")}>第 {String(change.turn)} 轮</p>
            {change.files.map((file, index) => (
              <button
                className={tw("change-review__file grid min-h-9.5 w-full min-w-0 grid-cols-[1.15rem_minmax(0,1fr)_auto] items-center gap-2 rounded-xl border-0 bg-transparent px-2 py-1.5 text-left text-[var(--text-secondary)] hover:bg-[var(--surface-secondary)] hover:outline-0 focus-visible:bg-[var(--surface-secondary)] focus-visible:outline-0 hover:text-[var(--text-tertiary)] focus-visible:text-[var(--text-tertiary)]")}
                key={`${String(change.seq)}-${file.path}`}
                onClick={() => { onSelect({ seq: change.seq, index }) }}
                type="button"
              >
                <FileIcon path={file.path} simpleIcon={file.binary || file.oversized ? 'file' : 'code'} size={16} />
                <span className={tw("overflow-hidden text-ellipsis whitespace-nowrap text-xs")} title={file.path}>{file.display}</span>
                <small className={tw("flex gap-1 font-mono text-micro text-[var(--text-tertiary)]")}>
                  {file.binary ? '二进制' : file.oversized ? '文件过大' : <><i className={tw("not-italic text-[var(--success)]")}>+{String(file.added)}</i><em className={tw("not-italic text-[var(--danger)]")}>−{String(file.deleted)}</em></>}
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
export function ConversationChangeSummary({ change, onSelect, deliveries = [], onPreviewDelivery, inReply = false }: {
  readonly change: LingTaskChanges
  readonly onSelect: (selection: ChangeSelection) => void
  readonly deliveries?: readonly LingPresentedFile[]
  readonly onPreviewDelivery?: (taskId: string, file: LingPresentedFile) => void
  readonly inReply?: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  if (change.files.length === 0) return null
  const visible = expanded ? change.files : change.files.slice(0, 3)
  return <section aria-label={`第 ${String(change.turn)} 轮文件变更`} className={tw("min-w-0 overflow-hidden rounded-lg border border-[var(--panel-border)] text-sm", inReply ? 'mt-4' : 'mx-4')}>
    <div className={tw("flex items-center gap-3 border-b border-[var(--panel-border)] px-4 py-3")}>
      <span className={tw("grid size-10 shrink-0 place-items-center rounded-lg bg-[var(--surface-secondary)] text-[var(--text-tertiary)]")}><Icon name="review" size={20} /></span>
      <div className={tw("min-w-0 flex-1")}><p className={tw("m-0 font-semibold leading-6")}>已编辑 {change.total} 个文件</p><p className={tw("m-0 flex gap-2 text-xs leading-5 tabular-nums")}><span className={tw("text-[var(--success)]")}>+{change.added}</span><span className={tw("text-[var(--danger)]")}>−{change.deleted}</span></p></div>
      <button className={tw("h-control-sm shrink-0 rounded-lg border border-[var(--panel-border)] bg-transparent px-3 text-xs font-medium hover:bg-[var(--surface-hover)]")} onClick={() => { onSelect({ seq: change.seq, index: 0 }) }} type="button">审阅</button>
    </div>
    <div className={tw("px-3 py-2")}>
      {visible.map((file, index) => {
        const delivery = deliveryForChangedFile(file, deliveries, change.workspacePath)
        return <div key={file.path} className={tw('flex min-w-0 items-center gap-2')}><button className={tw("flex min-h-control min-w-0 flex-1 items-center gap-3 rounded-md border-0 bg-transparent px-1 text-left text-compact hover:bg-[var(--surface-hover)]")} onClick={() => { onSelect({ seq: change.seq, index }) }} type="button">
        <span className={tw("min-w-0 flex-1 truncate text-[var(--text-secondary)]")} title={file.path}>{file.display}</span>
        <span className={tw("flex shrink-0 gap-2 text-xs tabular-nums")}>
          {file.binary || file.oversized ? <span className={tw("text-[var(--text-tertiary)]")}>{file.binary ? '二进制' : '文件过大'}</span> : <><span className={tw("text-[var(--success)]")}>+{file.added}</span><span className={tw("text-[var(--danger)]")}>−{file.deleted}</span></>}
        </span>
      </button>{delivery && onPreviewDelivery ? <Button size="sm" variant="ghost" aria-label={`预览 ${file.display}`} className={tw('h-control-xs min-w-0 shrink-0 rounded-md px-2 text-xs font-normal text-[var(--text-secondary)]')} onPress={() => onPreviewDelivery(change.taskId, delivery)}>预览</Button> : null}</div>
      })}
      {change.files.length > 3 ? <button aria-expanded={expanded} className={tw("mt-1 inline-flex h-control-sm items-center gap-1 rounded-md border-0 bg-transparent px-1 text-xs font-medium hover:bg-[var(--surface-hover)]")} onClick={() => { setExpanded(value => !value) }} type="button">{expanded ? '收起' : `再显示 ${String(change.files.length - 3)} 个文件`}<Icon className={tw(expanded && "rotate-180")} name="chevronDown" size={12} /></button> : null}
    </div>
  </section>
}
