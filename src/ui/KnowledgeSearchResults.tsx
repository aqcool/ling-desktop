import type { KnowledgeHit } from '../runtime/knowledge.js'
import { tw } from './tailwind.js'

export function HighlightText({ text, query }: { text: string; query: string }) {
  const terms = query.trim().split(/\s+/).filter(Boolean).sort((a, b) => b.length - a.length)
  if (!terms.length) return text
  const pattern = new RegExp(`(${terms.map(term => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi')
  return text.split(pattern).map((part, index) => index % 2 ? <mark key={index} className={tw('rounded-sm bg-[color-mix(in_srgb,var(--link)_16%,transparent)] text-inherit')}>{part}</mark> : part)
}
export function KnowledgeSearchResults({ hits, query, loading, onOpen }: { hits?: KnowledgeHit[]; query: string; loading: boolean; onOpen: (hit: KnowledgeHit) => void }) {
  return <div aria-label="正文搜索结果" aria-busy={loading} className={tw('grid gap-1')}>
    <p role="status" className={tw('mx-2 my-2 text-caption text-[var(--text-tertiary)]')}>{loading ? '正在搜索正文…' : hits?.length ? `${hits.length} 项匹配` : '没有匹配内容'}</p>
    {!loading ? hits?.map(hit => <button key={hit.id} type="button" onClick={() => onOpen(hit)} className={tw('grid gap-1.5 rounded-lg border-0 bg-transparent px-2.5 py-2.5 text-left hover:bg-[var(--surface-hover)] focus-visible:outline-2 focus-visible:outline-[var(--focus)]')}>
      <strong className={tw('text-xs font-medium leading-5 [overflow-wrap:anywhere]')}><HighlightText text={hit.title} query={query} /></strong>
      <span className={tw('line-clamp-3 whitespace-pre-wrap break-words text-caption leading-5 text-[var(--text-secondary)]')}><HighlightText text={hit.snippet} query={query} /></span>
    </button>) : null}
  </div>
}
