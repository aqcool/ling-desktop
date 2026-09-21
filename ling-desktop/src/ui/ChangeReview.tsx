import { Button } from '@heroui/react/button'
import { Spinner } from '@heroui/react/spinner'
import type { LingFileDiff, LingTaskChanges } from '../runtime/contract.js'
import { Icon } from './Icon.js'

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

function count(changes: readonly LingTaskChanges[], field: 'added' | 'deleted' | 'total'): number {
  return changes.reduce((total, change) => total + change[field], 0)
}

function DiffContent({
  diff,
  diffLoading: loading,
  diffMessage: message,
}: Pick<ChangeReviewProps, 'diff' | 'diffLoading' | 'diffMessage'>) {
  if (loading) return <p className="change-review__state"><Spinner size="sm" /> 正在读取差异</p>
  if (message) return <p className="change-review__state change-review__state--error">{message}</p>
  if (diff === undefined) return null
  if (diff.kind !== 'text') {
    return <p className="change-review__state">{diff.kind === 'binary' ? '这是二进制文件，无法显示文本差异。' : '文件过大，无法显示文本差异。'}</p>
  }
  if (diff.hunks.length === 0) return <p className="change-review__state">两个版本没有文本差异。</p>

  return (
    <div className="change-review__diff" data-coarse={diff.coarse || undefined}>
      {diff.hunks.map((hunk, index) => (
        <div className="change-review__hunk" key={`${String(hunk.oldStart)}-${String(hunk.newStart)}-${String(index)}`}>
          <p className="change-review__hunk-label">@@ -{String(hunk.oldStart)},{String(hunk.oldLines)} +{String(hunk.newStart)},{String(hunk.newLines)} @@</p>
          <pre>{hunk.lines.map((line, lineIndex) => (
            <code
              className={line.startsWith('+') ? 'change-review__line--added' : line.startsWith('-') ? 'change-review__line--deleted' : undefined}
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
      <section className="change-review change-review--detail">
        <div className="change-review__toolbar">
          <Button onPress={onCloseDiff} size="sm" variant="ghost"><Icon name="arrowLeft" size={16} /> 变更</Button>
          <span>文件差异</span>
        </div>
        <div className="change-review__file-heading">
          <Icon name="file" size={17} />
          <strong>{selectedFile.display}</strong>
          {diff?.kind === 'text' && diff.coarse ? <small>简化比较</small> : null}
        </div>
        <DiffContent diff={diff} diffLoading={diffLoading} diffMessage={diffMessage} />
      </section>
    )
  }

  if (loading) return <p className="change-review__state"><Spinner size="sm" /> 正在读取变更</p>
  if (message) return <p className="change-review__state change-review__state--error">{message}</p>
  if (changes.length === 0) return <p className="change-review__state">此任务尚未记录文件变更。</p>

  return (
    <section className="change-review">
      <div className="change-review__summary">
        <span><strong>{String(count(changes, 'total'))}</strong> 个文件</span>
        <span className="change-review__added">+{String(count(changes, 'added'))}</span>
        <span className="change-review__deleted">−{String(count(changes, 'deleted'))}</span>
      </div>
      <div className="change-review__groups">
        {changes.map(change => (
          <div className="change-review__group" key={String(change.seq)}>
            <p>第 {String(change.turn)} 轮</p>
            {change.files.map((file, index) => (
              <button
                className="change-review__file"
                key={`${String(change.seq)}-${file.path}`}
                onClick={() => { onSelect({ seq: change.seq, index }) }}
                type="button"
              >
                <Icon name={file.binary || file.oversized ? 'file' : 'code'} size={16} />
                <span>{file.display}</span>
                <small>
                  {file.binary ? '二进制' : file.oversized ? '文件过大' : <><i>+{String(file.added)}</i><em>−{String(file.deleted)}</em></>}
                </small>
              </button>
            ))}
          </div>
        ))}
      </div>
    </section>
  )
}
