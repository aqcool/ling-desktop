import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type {
  KnowledgeDocument,
  KnowledgeResponse,
  KnowledgeSource,
} from '../runtime/knowledge.js'
import { Markdown } from './Markdown.js'
import { CompactButton, CompactInput } from './SettingsControls.js'
import { Icon } from './Icon.js'
import { KnowledgeMenu } from './KnowledgeMenu.js'
import {
  downloadKnowledge,
  knowledgeCodeLink,
  knowledgeHeadings,
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
  searchQuery = '',
  searchVisit = 0,
  tabbed = false,
  initialDirectory = false,
  onDirectoryChange,
}: {
  document: KnowledgeDocument
  tabbed?: boolean
  initialDirectory?: boolean
  onDirectoryChange?: (open: boolean) => void
  searchQuery?: string
  searchVisit?: number
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
  const [raw, setRaw] = useState(false), [directory, setDirectory] = useState(initialDirectory), [activeHeading, setActiveHeading] = useState('')
  const directoryId = useId()
  const article = useRef<HTMLElement>(null), highlightName = `knowledge-search-${useId().replace(/[^a-z0-9]/gi, '')}`
  const isDirty = editing && (title !== doc.title || body !== doc.body)
  useEffect(() => { onDirtyChange?.(isDirty) }, [isDirty, onDirtyChange])
  useEffect(() => () => onDirtyChange?.(false), [])
  const content = version ?? doc,
    headings = useMemo(() => knowledgeHeadings(content.body), [content.body])
  const headingIds = useMemo(
    () => headings.map((item) => ({ id: item.id, line: item.line })),
    [headings],
  )
  const bodyHasTitle = headings[0]?.level === 1 && !content.body.split('\n').slice(0, headings[0].line - 1).join('\n').trim()
  const directoryHeadings = useMemo(() => bodyHasTitle ? headings : [{ id: 'knowledge-document-title', title: content.title, level: 1 }, ...headings], [bodyHasTitle, headings, content.title])
  useEffect(() => {
    if (!directory || raw || editing || !article.current) return
    const pane = article.current.closest<HTMLElement>('[aria-label="知识阅读区域"]')
    if (!pane) return
    const update = () => {
      const top = pane.getBoundingClientRect().top + (tabbed ? 88 : 44) + 32
      let current = directoryHeadings[0]?.id ?? ''
      for (const heading of directoryHeadings) {
        const element = article.current?.querySelector<HTMLElement>(`[id="${heading.id}"]`)
        if (element && element.getBoundingClientRect().top <= top) current = heading.id
      }
      setActiveHeading(current)
    }
    update(); pane.addEventListener('scroll', update, { passive: true })
    return () => pane.removeEventListener('scroll', update)
  }, [directory, raw, editing, directoryHeadings, tabbed])
  useEffect(() => {
    if (!searchQuery.trim() || !article.current || editing) return
    const terms = searchQuery.trim().split(/\s+/).filter(Boolean).sort((a, b) => b.length - a.length)
    const pattern = new RegExp(terms.map(term => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'gi')
    const walker = window.document.createTreeWalker(article.current, NodeFilter.SHOW_TEXT), ranges: Range[] = []
    while (walker.nextNode()) {
      const node = walker.currentNode
      if (!node.parentElement?.closest('[data-knowledge-body]')) continue
      for (const match of (node.textContent ?? '').matchAll(pattern)) {
        const range = window.document.createRange()
        range.setStart(node, match.index); range.setEnd(node, match.index + match[0].length)
        ranges.push(range)
        if (ranges.length >= 500) break
      }
      if (ranges.length >= 500) break
    }
    if (typeof Highlight !== 'undefined' && typeof CSS !== 'undefined' && CSS.highlights) {
      CSS.highlights.set(highlightName, new Highlight(...ranges))
    }
    ranges[0]?.startContainer.parentElement?.scrollIntoView({ block: 'center', behavior: 'auto' })
    return () => { if (typeof CSS !== 'undefined') CSS.highlights?.delete(highlightName) }
  }, [searchQuery, searchVisit, content.body, editing, raw, highlightName])
  const exportDocument = () => {
    void onExport().then(value => { if (value?.text) downloadKnowledge(value.text, doc.title) })
  }
  const copyDocument = async () => {
    try {
      if (!navigator.clipboard) throw new Error('Clipboard unavailable')
      await navigator.clipboard.writeText(content.body)
    } catch { onLinkError?.('无法复制文档，请检查剪贴板权限。') }
  }
  return (
    <div className={tw('@container min-w-0', tabbed ? '[--knowledge-anchor-offset:7rem]' : '[--knowledge-anchor-offset:4.25rem]')}>
      <header aria-label="文档工具栏" className={tw('sticky z-10 flex min-h-11 items-center justify-between gap-3 border-b border-[var(--panel-border)] bg-[var(--surface)] px-7 py-1.5 @max-[500px]:px-4', tabbed ? 'top-11' : 'top-0')}>
        <div className={tw('flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-caption text-[var(--text-tertiary)]')}>
          <time dateTime={new Date(content.updatedAt).toISOString()}>最近更新：{new Date(content.updatedAt).toLocaleString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })}</time>
          {doc.state !== 'active' ? <span className={tw(doc.state === 'stale' && 'text-[var(--warning)]')}>{knowledgeStates[doc.state]}</span> : null}
        </div>
        <div className={tw('flex items-center gap-1')}>
          {editing ? <>
            <CompactButton isDisabled={pending || !title.trim() || !body.trim()} onPress={() => {
              void onSave({ title, body }).then(value => { if (value?.document) { setEditing(false); setVersion(undefined) } })
            }}>保存</CompactButton>
            <CompactButton variant="tertiary" isDisabled={pending} onPress={() => setEditing(false)}>取消</CompactButton>
          </> : <>
            <div role="group" aria-label="文档视角" className={tw('mr-1 flex gap-0.5 rounded-lg bg-[var(--surface-secondary)] p-0.5')}>
              <CompactButton variant="tertiary" isIconOnly aria-label="预览" title="预览" aria-pressed={!raw} onPress={() => setRaw(false)} className={tw(!raw ? 'bg-[var(--surface)] shadow-sm' : 'bg-transparent')}><Icon name="eye" size={16} /></CompactButton>
              <CompactButton variant="tertiary" isIconOnly aria-label="源文" title="Markdown 源文" aria-pressed={raw} onPress={() => setRaw(true)} className={tw(raw ? 'bg-[var(--surface)] shadow-sm' : 'bg-transparent')}><Icon name="code" size={16} /></CompactButton>
            </div>
            <KnowledgeMenu label="文档更多操作" disabled={pending} items={[
              { id: 'edit', label: '编辑文档', action: () => { setTitle(content.title); setBody(content.body); setEditing(true) } },
              { id: 'copy', label: '复制 Markdown', action: () => { void copyDocument() } },
              { id: 'export', label: '导出文档', action: exportDocument },
              { id: 'archive', label: '归档', action: onArchive },
            ]} />
          </>}
        </div>
      </header>
      <div className={tw('relative grid min-w-0 grid-cols-1 items-start gap-8 px-7 py-6 @max-[500px]:px-4', directory && !raw && !editing && '@min-[800px]:grid-cols-[minmax(0,1fr)_216px]')}>
      <article ref={article} className={tw('col-start-1 row-start-1 mx-auto w-full min-w-0 max-w-[960px]', !!headings.length && !editing && !raw && '@max-[800px]:pr-8', !!headings.length && !directory && !editing && !raw && '@min-[800px]:pr-10')}>
        <style>{`::highlight(${highlightName}) { background-color: color-mix(in srgb, var(--link) 22%, transparent); color: var(--foreground); }`}</style>
        {editing || (!bodyHasTitle && !raw) || doc.state === 'candidate' ? <header className={tw('mb-6')}>
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
          ) : !bodyHasTitle && !raw ? (
            <h1
              id="knowledge-document-title"
              className={tw(
                'm-0 text-xl font-semibold leading-8 scroll-mt-[var(--knowledge-anchor-offset)] [overflow-wrap:anywhere]',
              )}
            >
              {content.title}
            </h1>
          ) : null}
                {!editing && doc.state === 'candidate' ? (
                  <CompactButton
                    isDisabled={pending}
                    onPress={() => {
                      void onSave({
                        title: doc.title,
                        body: doc.body,
                        state: 'active',
                      })
                    }} className={tw('mt-3')}
                  >
                    确认保存
                  </CompactButton>
                ) : null}
        </header> : null}
        <div data-knowledge-body>
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
        </div>
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
      {headings.length ? <aside hidden={raw || editing} className={tw('sticky z-5 col-start-1 row-start-1 ml-auto w-8', tabbed ? 'top-[104px]' : 'top-[60px]', directory && '@min-[800px]:col-start-2 @min-[800px]:w-full')}>
        <div className={tw('mb-2 flex justify-end')}><CompactButton variant="tertiary" isIconOnly className={tw('size-7 rounded-md border border-[var(--panel-border)] bg-[var(--surface-secondary)]')} aria-label={directory ? '隐藏页内目录' : '显示页内目录'} title={directory ? '隐藏页内目录' : '显示页内目录'} aria-expanded={directory} aria-controls={directoryId} onPress={() => { setDirectory(!directory); onDirectoryChange?.(!directory) }}><Icon name="sort" size={15} /></CompactButton></div>
        <nav
          id={directoryId}
          aria-label="页内目录"
          hidden={!directory || raw || editing}
          className={tw(
            'max-h-[calc(100vh-240px)] overflow-y-auto overscroll-contain rounded-lg border border-[var(--panel-border)] bg-[var(--surface)] p-3 @max-[800px]:absolute @max-[800px]:right-0 @max-[800px]:w-56 @max-[800px]:shadow-[var(--overlay-shadow)]',
          )}
        >
          <h2
            className={tw(
              'mb-3 mt-0 text-xs font-medium text-[var(--foreground)]',
            )}
          >
            页内目录
          </h2>
          <div className={tw('grid gap-1')}>
            {directoryHeadings.map((item) => (
              <button
                key={item.id}
                type="button"
                style={{ paddingLeft: 4 + Math.max(0, item.level - directoryHeadings[0]!.level) * 10 }}
                aria-current={activeHeading === item.id ? 'location' : undefined}
                onClick={() => {
                  article.current?.querySelector<HTMLElement>(`[id="${item.id}"]`)?.scrollIntoView({ block: 'start', behavior: 'auto' })
                  setActiveHeading(item.id)
                }}
                className={tw(
                  'rounded border-0 bg-transparent py-1 pr-1 text-left text-xs leading-5 text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)] [overflow-wrap:anywhere]', activeHeading === item.id && 'bg-[var(--surface-secondary)] text-[var(--link)]',
                )}
              >
                {item.title}
              </button>
            ))}
          </div>
        </nav>
      </aside> : <nav id={directoryId} aria-label="页内目录" hidden />}
      </div>
    </div>
  )
}
