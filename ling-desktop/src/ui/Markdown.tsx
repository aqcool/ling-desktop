import { useEffect, useState, type ReactNode } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { tw } from './tailwind.js'

function safeHref(url: string): string | undefined {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : undefined
  } catch { return undefined }
}

function CodeBlock({ code, lang }: { readonly code: string; readonly lang?: string }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => { setCopied(false) }, 1600)
    return () => { clearTimeout(timer) }
  }, [copied])
  return <div className={tw("md__pre-wrap my-3 min-w-0 overflow-hidden rounded-lg border border-[var(--md-border)] bg-[var(--md-pre-bg)] first:mt-0 last:mb-0")}>
    <div data-copy-ignore className={tw("flex h-8 items-center justify-between gap-2 px-3 text-xs text-[var(--md-muted)]")}>
      <span>{lang || 'code'}</span>
      <button className={tw("rounded px-1.5 py-0.5 hover:bg-[var(--md-hover)]")} onClick={() => { void navigator.clipboard.writeText(code).then(() => { setCopied(true) }, () => { setCopied(false) }) }} type="button">{copied ? '已复制' : '复制'}</button>
    </div>
    <pre className={tw("m-0 overflow-x-auto px-3 pb-3 text-[var(--md-pre-text)]")}><code className={tw("block font-mono text-[13px] leading-5")}>{code}</code></pre>
  </div>
}

const headingClass = "md__h mb-2 mt-6 font-semibold leading-6 text-[var(--md-heading)] first:mt-0"

/** Copy content from the parsed Markdown tree, excluding code toolbar controls. */
export function renderedMarkdownText(root: HTMLElement): string {
  const read = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? ''
    if (!(node instanceof HTMLElement)) return ''
    if (node.hasAttribute('data-copy-ignore') || node.tagName === 'BUTTON') return ''
    if (node.tagName === 'PRE') return `${node.textContent ?? ''}\n\n`
    if (node.tagName === 'BR') return '\n'
    if (node.tagName === 'IMG') return node.getAttribute('alt') ?? ''
    if (node.tagName === 'INPUT') return (node as HTMLInputElement).checked ? '[x] ' : '[ ] '
    const text = Array.from(node.childNodes, read).join('')
    if (node.tagName === 'LI') return `• ${text.trim()}\n`
    if (node.tagName === 'TD' || node.tagName === 'TH') return `${text.trim()}\t`
    if (node.tagName === 'TR') return `${text.trimEnd()}\n`
    if (/^(P|H[1-6]|UL|OL|BLOCKQUOTE|TABLE)$/.test(node.tagName)) return `${text}\n\n`
    return text
  }
  return read(root).trim()
}
const cellAlign = (align: string | null | undefined) => align === 'right' ? 'md__cell--right text-right' : align === 'center' ? 'md__cell--center text-center' : 'text-left'

// Render the parsed structure directly. Each element owns its Tailwind styles,
// including nested lists; no descendant-selector stylesheet or raw HTML injection.
const components: Components = {
  h1: ({ children }) => <h1 className={tw(headingClass, "md__h-1 text-xl leading-7")}>{children}</h1>,
  h2: ({ children }) => <h2 className={tw(headingClass, "md__h-2 text-lg")}>{children}</h2>,
  h3: ({ children }) => <h3 className={tw(headingClass, "md__h-3 mt-5 text-base")}>{children}</h3>,
  h4: ({ children }) => <h4 className={tw(headingClass, "mt-4 text-[15px]")}>{children}</h4>,
  h5: ({ children }) => <h5 className={tw(headingClass, "mt-4 text-sm")}>{children}</h5>,
  h6: ({ children }) => <h6 className={tw(headingClass, "mt-4 text-[13px] text-[var(--md-muted)]")}>{children}</h6>,
  p: ({ children }) => <p className={tw("md__p my-3 leading-[var(--md-paragraph-leading)] first:mt-0 last:mb-0")}>{children}</p>,
  strong: ({ children }) => <strong className={tw("font-semibold")}>{children}</strong>,
  em: ({ children }) => <em className={tw("italic")}>{children}</em>,
  del: ({ children }) => <del>{children}</del>,
  ul: ({ children, className }) => <ul className={tw("md__list my-3 list-disc pl-6 first:mt-0 last:mb-0", className === 'contains-task-list' && "list-none pl-0")}>{children}</ul>,
  ol: ({ children, start }) => <ol start={start} className={tw("md__list my-3 list-decimal pl-6 first:mt-0 last:mb-0")}>{children}</ol>,
  li: ({ children, className }) => <li className={tw("mt-1 pl-0 leading-6 first:mt-0", className === 'task-list-item' && "list-none")}>{children}</li>,
  input: ({ checked }) => <input aria-label={checked ? '已完成' : '未完成'} checked={checked} disabled type="checkbox" className={tw("mr-2 align-middle accent-[var(--focus)]")} />,
  blockquote: ({ children }) => <blockquote className={tw("md__quote my-4 border-l-2 border-[var(--md-border)] pl-4 text-[var(--md-muted)] first:mt-0 last:mb-0")}>{children}</blockquote>,
  hr: () => <hr className={tw("md__hr my-6 border-0 border-t border-[var(--md-border)]")} />,
  code: ({ children }) => <code className={tw("md__code rounded bg-[var(--md-code-bg)] px-1 py-0.5 font-mono text-[13px] text-[var(--md-code-text)] [overflow-wrap:anywhere]")}>{children}</code>,
  pre: ({ node }) => {
    const code = node?.children.find(child => child.type === 'element' && child.tagName === 'code')
    if (!code || code.type !== 'element') return null
    const content = code.children.map(child => child.type === 'text' ? child.value : '').join('').replace(/\n$/, '')
    const classes = code.properties.className
    const lang = Array.isArray(classes) ? classes.find(value => typeof value === 'string' && value.startsWith('language-'))?.toString().slice(9) : undefined
    return <CodeBlock code={content} lang={lang} />
  },
  a: ({ href, children }) => {
    const url = safeHref(href ?? '')
    return url ? <a className={tw("md__link text-[var(--md-link)] underline underline-offset-2")} href={url} rel="noreferrer noopener" target="_blank">{children}</a> : <span>{children}</span>
  },
  img: ({ src, alt }) => {
    const url = safeHref(typeof src === 'string' ? src : '')
    return url ? <img alt={alt ?? ''} className={tw("md__img inline-block h-auto max-w-full rounded-lg border border-[var(--md-border)]")} loading="lazy" src={url} /> : <span>{`![${alt ?? ''}]`}</span>
  },
  table: ({ children }) => <div className={tw("md__table-wrap my-3 max-w-full overflow-x-auto rounded-lg border border-[var(--md-border)] first:mt-0 last:mb-0")}><table className={tw("md__table w-full border-collapse text-sm leading-6")}>{children}</table></div>,
  th: ({ children, style }) => <th className={tw(cellAlign(style?.textAlign), "border-b border-[var(--md-border)] bg-[var(--md-table-head-bg)] px-3 py-2 align-top font-semibold")}>{children}</th>,
  td: ({ children, style }) => <td className={tw(cellAlign(style?.textAlign), "border-b border-[var(--md-border)] px-3 py-2 align-top")}>{children}</td>,
}

export function Markdown({ source, inverted = false, chat = false, subdued = false }: { readonly source: string; readonly inverted?: boolean; readonly chat?: boolean; readonly subdued?: boolean }): ReactNode {
  return <div className={tw(
    "md min-w-0 text-sm leading-6 text-[var(--md-text)] [overflow-wrap:anywhere]",
    chat ? "[--md-paragraph-leading:28px]" : "[--md-paragraph-leading:24px]",
      inverted
        ? "[--md-border:#3d3d3b] [--md-code-bg:#34343a] [--md-code-text:#eceae6] [--md-heading:#f4f4f2] [--md-hover:rgb(255_255_255_/_0.09)] [--md-link:#a8c4f0] [--md-muted:#c9c9c4] [--md-pre-bar-bg:#141414] [--md-pre-bg:#141414] [--md-pre-text:#e8e8e6] [--md-table-head-bg:#2a2a29] [--md-text:#f4f4f2]"
        : "[--md-border:#e8e8e6] [--md-code-bg:#f2f2f0] [--md-code-text:inherit] [--md-heading:#1f1f1f] [--md-hover:var(--separator)] [--md-link:#4a6fa5] [--md-muted:#6a6a6a] [--md-pre-bar-bg:#fafaf9] [--md-pre-bg:#fafaf9] [--md-pre-text:inherit] [--md-table-head-bg:#f7f7f5] [--md-text:#353535] dark:[--md-border:#34343a] dark:[--md-code-bg:#2a2a2e] dark:[--md-code-text:#e2e2e5] dark:[--md-heading:#ececee] dark:[--md-hover:#2c2c31] dark:[--md-link:#8ab0e8] dark:[--md-muted:#bcbcc2] dark:[--md-pre-bar-bg:#202024] dark:[--md-pre-bg:#202024] dark:[--md-pre-text:#d8d8da] dark:[--md-table-head-bg:#26262a] dark:[--md-text:#d4d4d7]",
    subdued && "[--md-text:var(--text-secondary)] [--md-heading:var(--text-secondary)] dark:[--md-text:var(--text-secondary)] dark:[--md-heading:var(--text-secondary)]",
  )}>
    <ReactMarkdown components={components} remarkPlugins={[remarkGfm]} urlTransform={url => safeHref(url) ?? ''}>{source}</ReactMarkdown>
  </div>
}
