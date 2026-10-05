import { useEffect, useMemo, useState } from 'react'
import type {
  KnowledgeDocument,
  KnowledgeResponse,
  KnowledgeSource,
} from '../runtime/knowledge.js'
import { Markdown } from './Markdown.js'
import { CompactButton, CompactInput } from './SettingsControls.js'
import {
  downloadKnowledge,
  knowledgeCodeLink,
  knowledgeHeadings,
  knowledgeKinds,
  knowledgeStates,
} from './knowledge-view.js'
import { tw } from './tailwind.js'
export function KnowledgeReader({
  document: doc,
  revisions = [],
  pending,
  onSave,
  onArchive,
  onSource,
  onWiki,
  onOpenTask,
  onLinkError,
  onExport,
  onDirtyChange,
}: {
  document: KnowledgeDocument
  onDirtyChange?: (dirty: boolean) => void
  revisions?: KnowledgeDocument[]
  pending: boolean
  onSave: (value: {
    title: string
    body: string
    state?: KnowledgeDocument['state']
  }) => Promise<KnowledgeResponse | undefined>
  onArchive: () => void
  onSource: (source: KnowledgeSource) => void
  onWiki: (key: string) => void
  onOpenTask: (id: string) => void
  onLinkError?: (message: string) => void
  onExport: () => Promise<KnowledgeResponse | undefined>
}) {
  const [editing, setEditing] = useState(false),
    [title, setTitle] = useState(doc.title),
    [body, setBody] = useState(doc.body),
    [version, setVersion] = useState<KnowledgeDocument>()
  const [raw, setRaw] = useState(false)
  const isDirty = editing && (title !== doc.title || body !== doc.body)
  useEffect(() => { onDirtyChange?.(isDirty) }, [isDirty, onDirtyChange])
  useEffect(() => () => onDirtyChange?.(false), [])
  const content = version ?? doc,
    headings = useMemo(() => knowledgeHeadings(content.body), [content.body])
  const headingIds = useMemo(
    () => headings.map((item) => ({ id: item.id, line: item.line })),
    [headings],
  )
  return (
    <div
      className={tw(
        'grid min-w-0 grid-cols-[minmax(0,1fr)_160px] gap-10 max-[1100px]:grid-cols-1',
      )}
    >
      <article className={tw('min-w-0')}>
        <header className={tw('mb-7')}>
          <div
            className={tw(
              'mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--text-tertiary)]',
            )}
          >
            <span>
              {knowledgeKinds[doc.kind]} · {knowledgeStates[doc.state]}
            </span>
            <time>{new Date(doc.updatedAt).toLocaleDateString()}</time>
          </div>
          {editing ? (
            <CompactInput
              aria-label="文档标题"
              value={title}
              maxLength={200}
              onChange={(
                event: import('react').ChangeEvent<HTMLInputElement>,
              ) => setTitle(event.target.value)}
              className={tw('w-full')}
            />
          ) : (
            <h1
              className={tw(
                'm-0 text-xl font-semibold leading-8 [overflow-wrap:anywhere]',
              )}
            >
              {content.title}
            </h1>
          )}
          <div className={tw('mt-3 flex flex-wrap gap-1.5')}>
            {editing ? (
              <>
                <CompactButton
                  isDisabled={pending || !title.trim() || !body.trim()}
                  onPress={() => {
                    void onSave({ title, body }).then((value) => {
                      if (value?.document) {
                        setEditing(false)
                        setVersion(undefined)
                      }
                    })
                  }}
                >
                  保存
                </CompactButton>
                <CompactButton
                  variant="tertiary"
                  isDisabled={pending}
                  onPress={() => setEditing(false)}
                >
                  取消
                </CompactButton>
              </>
            ) : (
              <>
                <CompactButton variant="tertiary" aria-pressed={!raw} onPress={() => setRaw(false)}>预览</CompactButton>
                <CompactButton variant="tertiary" aria-pressed={raw} onPress={() => setRaw(true)}>源文</CompactButton>
                <CompactButton
                  variant="tertiary"
                  isDisabled={pending}
                  onPress={() => {
                    setTitle(content.title)
                    setBody(content.body)
                    setEditing(true)
                  }}
                >
                  编辑
                </CompactButton>
                {doc.state === 'candidate' ? (
                  <CompactButton
                    isDisabled={pending}
                    onPress={() => {
                      void onSave({
                        title: doc.title,
                        body: doc.body,
                        state: 'active',
                      })
                    }}
                  >
                    确认保存
                  </CompactButton>
                ) : null}
                <CompactButton
                  variant="tertiary"
                  isDisabled={pending}
                  onPress={() => {
                    void onExport().then((value) => {
                      if (value?.text) downloadKnowledge(value.text, doc.title)
                    })
                  }}
                >
                  导出文档
                </CompactButton>
                <CompactButton
                  variant="tertiary"
                  isDisabled={pending}
                  onPress={onArchive}
                >
                  归档
                </CompactButton>
              </>
            )}
          </div>
        </header>
        {editing ? (
          <textarea
            aria-label="文档正文"
            value={body}
            maxLength={128000}
            onChange={(
              event: import('react').ChangeEvent<HTMLTextAreaElement>,
            ) => setBody(event.target.value)}
            className={tw(
              'min-h-96 w-full resize-y rounded-lg border border-[var(--panel-border)] bg-[var(--surface)] p-3 font-mono text-xs leading-6 outline-none focus:border-[var(--focus)]',
            )}
          />
        ) : raw ? <pre className={tw('m-0 overflow-x-auto whitespace-pre-wrap break-words rounded-lg bg-[var(--surface-secondary)] p-4 font-mono text-xs leading-6')}>{content.body}</pre> : (
          <Markdown
            source={content.body}
            headingIds={headingIds}
            onKnowledgeLink={(href) => {
              const source = knowledgeCodeLink(href, content.sources)
              if (source) onSource(source)
              else if (href.startsWith('wiki:')) onWiki(href.slice(5))
              else onLinkError?.('此引用未关联有效的源码来源。')
            }}
          />
        )}
        {!editing ? (
          <footer
            className={tw(
              'mt-10 grid gap-4 text-xs text-[var(--text-secondary)]',
            )}
          >
            {content.sources.length ? (
              <details>
                <summary className={tw('cursor-pointer')}>
                  来源（{content.sources.length}）
                </summary>
                <div className={tw('mt-2 grid gap-2')}>
                  {content.sources.map((source, i) => (
                    <div key={i} className={tw('flex min-w-0 gap-2')}>
                      {source.kind === 'manual' ? (
                        <span className={tw('truncate')}>{source.label}</span>
                      ) : (
                        <button
                          type="button"
                          className={tw(
                            'truncate border-0 bg-transparent p-0 text-left text-[var(--link)]',
                          )}
                          onClick={() => onSource(source)}
                        >
                          {source.path
                            ? `${source.path}:${source.line ?? 1}`
                            : source.label}
                        </button>
                      )}
                      {source.sessionId ? (
                        <button
                          type="button"
                          className={tw(
                            'shrink-0 border-0 bg-transparent p-0 text-[var(--link)]',
                          )}
                          onClick={() => onOpenTask(source.sessionId!)}
                        >
                          打开会话
                        </button>
                      ) : null}
                    </div>
                  ))}
                </div>
              </details>
            ) : null}
            {revisions.length > 1 ? (
              <details>
                <summary className={tw('cursor-pointer')}>版本记录</summary>
                <div className={tw('mt-2 flex flex-wrap gap-2')}>
                  {revisions.map((item) => (
                    <button
                      key={item.version}
                      type="button"
                      className={tw(
                        'rounded border border-[var(--panel-border)] bg-transparent px-2 py-1',
                      )}
                      onClick={() =>
                        setVersion(
                          item.version === doc.version ? undefined : item,
                        )
                      }
                    >
                      v{item.version}
                    </button>
                  ))}
                </div>
              </details>
            ) : null}
            {version ? (
              <p className={tw('m-0')}>
                正在查看 v{version.version}。
                <button
                  type="button"
                  className={tw('border-0 bg-transparent text-[var(--link)]')}
                  onClick={() => setVersion(undefined)}
                >
                  返回当前版本
                </button>
              </p>
            ) : null}
          </footer>
        ) : null}
      </article>
      {!editing && headings.length ? (
        <nav
          aria-label="本文目录"
          className={tw(
            'sticky top-0 max-h-[calc(100vh-220px)] self-start overflow-auto max-[1100px]:hidden',
          )}
        >
          <h2
            className={tw(
              'mb-3 mt-0 text-xs font-medium text-[var(--text-secondary)]',
            )}
          >
            本文目录
          </h2>
          <div className={tw('grid gap-2')}>
            {headings.map((item) => (
              <button
                key={item.id}
                type="button"
                style={{ paddingLeft: Math.max(0, item.level - 2) * 8 }}
                onClick={() =>
                  window.document
                    .getElementById(item.id)
                    ?.scrollIntoView({ block: 'start', behavior: 'auto' })
                }
                className={tw(
                  'border-0 bg-transparent p-0 text-left text-xs leading-5 text-[var(--text-tertiary)] hover:text-[var(--foreground)]',
                )}
              >
                {item.title}
              </button>
            ))}
          </div>
        </nav>
      ) : null}
    </div>
  )
}
