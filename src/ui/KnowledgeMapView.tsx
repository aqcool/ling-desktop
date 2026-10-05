import { useEffect, useState } from 'react'
import type { KnowledgeMap, KnowledgeMapNode, KnowledgeRequest, KnowledgeResponse, KnowledgeSource } from '../runtime/knowledge.js'
import type { KnowledgeScopeInput } from './useKnowledge.js'
import { KnowledgeGraph, graphRelations } from './KnowledgeGraph.js'
import { CompactButton, CompactInput } from './SettingsControls.js'
import { knowledgeStates } from './knowledge-view.js'
import { Icon, type IconName } from './Icon.js'
import { tw } from './tailwind.js'

const kinds = { wiki: 'Wiki 页面', card: '知识卡片', summary: '会话总结', reference: '资料', file: '源码文件', session: '会话来源' } as const
const kindIcons: Record<KnowledgeMapNode['kind'], IconName> = { wiki: 'book', card: 'grid', summary: 'quote', reference: 'file', file: 'code', session: 'sideChat' }
export function KnowledgeMapView({ request, scope, revision, library = false, onDocument, onSource, onBack, onCodeGraph }: {
  request: (input: KnowledgeRequest) => Promise<KnowledgeResponse | undefined>
  scope: KnowledgeScopeInput
  revision: string
  library?: boolean
  onDocument: (node: KnowledgeMapNode) => void
  onSource: (source: KnowledgeSource) => void
  onBack: () => void
  onCodeGraph?: () => void
}) {
  const [map, setMap] = useState<KnowledgeMap>(), [query, setQuery] = useState(''), [focusId, setFocusId] = useState<string>(), [selectedId, setSelectedId] = useState<string>(), [loading, setLoading] = useState(false)
  useEffect(() => {
    let live = true
    setLoading(true)
    const timer = setTimeout(() => { void request({ type: 'knowledgeMap', ...scope, ...(query.trim() ? { query: query.trim() } : {}), ...(focusId ? { focusId } : {}) }).then(value => {
      if (live) { setMap(value?.map); setLoading(false) }
    }) }, query ? 250 : 0)
    return () => { live = false; clearTimeout(timer) }
  }, [request, scope.workspaceId, scope.taskId, scope.libraryId, revision, query, focusId])
  const selected = map?.nodes.find(node => node.id === selectedId)
  const relations = selected ? map?.edges.filter(edge => edge.source === selected.id || edge.target === selected.id) ?? [] : []
  return <section aria-label="知识图谱" aria-busy={loading} className={tw('flex h-full min-h-[480px] flex-col gap-4 px-6 py-5 max-[700px]:px-4')}>
    <header className={tw('flex shrink-0 flex-wrap items-start justify-between gap-3')}>
      <div><h1 className={tw('m-0 text-lg font-semibold')}>知识图谱</h1><p className={tw('mb-0 mt-1 text-xs leading-5 text-[var(--text-secondary)]')}>{library ? '从资料追溯来源。' : '连接项目知识，追溯内容来源。'}</p></div>
      <div className={tw('flex items-center gap-1')}><CompactButton variant="tertiary" onPress={onBack}><Icon name="arrowLeft" size={14} />返回阅读</CompactButton>{onCodeGraph ? <CompactButton variant="tertiary" onPress={onCodeGraph}><Icon name="code" size={14} />代码关系</CompactButton> : null}</div>
    </header>
    <div className={tw('flex shrink-0 flex-wrap items-center justify-between gap-3')}>
      <div className={tw('relative w-72 max-w-full')}><Icon name="search" size={14} className={tw('pointer-events-none absolute left-2.5 top-1/2 z-10 -translate-y-1/2 text-[var(--text-tertiary)]')} /><CompactInput aria-label="搜索知识节点" placeholder="搜索标题、文件或会话…" value={query} maxLength={256} onChange={(event: import('react').ChangeEvent<HTMLInputElement>) => { setFocusId(undefined); setQuery(event.target.value) }} className={tw('w-full pl-8')} /></div>
      <div className={tw('flex items-center gap-3 text-caption tabular-nums text-[var(--text-tertiary)]')}>{map ? <span>{map.nodes.length}{map.nodes.length !== map.totalNodes ? ` / ${map.totalNodes}` : ''} 节点 · {map.edges.length} 条关系</span> : null}{focusId || query ? <CompactButton variant="tertiary" onPress={() => { setFocusId(undefined); setQuery(''); setSelectedId(undefined) }}>全部关系</CompactButton> : null}</div>
    </div>
    {map?.truncated ? <p role="status" className={tw('m-0 shrink-0 text-xs leading-5 text-[var(--text-secondary)]')}>当前展示部分关系，搜索或选择节点后聚焦查看。</p> : null}
    <div className={tw('grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_260px] overflow-hidden rounded-xl border border-[var(--panel-border)] max-[900px]:grid-cols-1 max-[900px]:overflow-auto')}>
      {map?.nodes.length ? <KnowledgeGraph nodes={map.nodes} edges={map.edges} selectedId={selected?.id} onSelect={node => setSelectedId(node.id)} fill collapsedList network framed={false} /> : <div role="status" className={tw('flex min-h-64 flex-col items-center justify-center gap-2 px-6 text-center')}><Icon name="agentPreset" size={28} /><strong className={tw('text-sm font-medium')}>{loading ? '正在读取关系…' : query ? '没有匹配的知识节点' : map ? '还没有知识内容' : '图谱暂不可用'}</strong><span className={tw('max-w-xs text-xs leading-6 text-[var(--text-secondary)]')}>{loading ? '' : query ? '尝试其他标题或文件名。' : map ? library ? '添加资料后即可查看，无需另外生成图谱。' : '生成 Wiki 或保存会话总结后即可查看。' : '可返回阅读，再重新打开图谱。'}</span></div>}
      <aside aria-label="知识节点详情" className={tw('flex min-h-0 flex-col overflow-auto border-l border-[var(--panel-border)] bg-[color-mix(in_srgb,var(--surface-secondary)_35%,var(--surface))] p-5 text-xs leading-5 max-[900px]:border-l-0 max-[900px]:border-t')}>
        <div className={tw('mb-5 flex items-center justify-between text-caption text-[var(--text-tertiary)]')}><span>节点详情</span>{selected ? <button type="button" aria-label="取消选择节点" onClick={() => setSelectedId(undefined)} className={tw('rounded-md border-0 bg-transparent p-1 text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] focus-visible:outline-2 focus-visible:outline-[var(--focus)]')}><Icon name="close" size={13} /></button> : null}</div>
        {selected ? <>
          <div className={tw('mb-3 flex size-9 shrink-0 items-center justify-center rounded-full border border-[var(--panel-border)] bg-[var(--surface)] text-[var(--link)]')}><Icon name={kindIcons[selected.kind]} size={18} /></div>
          <div className={tw('flex flex-wrap items-center gap-2 text-caption text-[var(--text-secondary)]')}><span>{kinds[selected.kind]}</span>{selected.state ? <span className={tw('rounded-md bg-[var(--surface-secondary)] px-1.5 py-0.5', selected.state === 'stale' && 'text-[var(--warning)]')}>{knowledgeStates[selected.state]}</span> : null}</div>
          <h2 className={tw('mb-4 mt-2 text-sm font-semibold leading-6 [overflow-wrap:anywhere]')}>{selected.label}</h2>
          <div className={tw('mb-5 flex flex-wrap gap-1')}>
            {selected.documentId ? <CompactButton variant="secondary" onPress={() => onDocument(selected)}>打开内容<Icon name="arrowRight" size={13} /></CompactButton> : selected.source ? <CompactButton variant="secondary" onPress={() => onSource(selected.source!)}>{selected.kind === 'file' ? '查看源码' : '查看会话来源'}<Icon name="arrowRight" size={13} /></CompactButton> : null}
            <CompactButton variant="tertiary" onPress={() => { setQuery(''); setFocusId(selected.id) }}><Icon name="target" size={13} />聚焦关系</CompactButton>
          </div>
          <h3 className={tw('m-0 text-xs font-medium')}>关联内容（{relations.length}）</h3>
          {relations.length ? <ul className={tw('mt-2 list-none space-y-1 p-0')}>{relations.map(edge => {
            const outgoing = edge.source === selected.id
            const other = map!.nodes.find(node => node.id === (outgoing ? edge.target : edge.source))!
            const relation = edge.kind === 'derived' ? outgoing ? '提取的卡片' : '所属 Wiki' : edge.kind === 'contains' ? outgoing ? '子页面' : '上级页面' : edge.kind === 'cites' ? outgoing ? '引用来源' : '被引用于' : outgoing ? '链接到' : '被链接于'
            return <li key={edge.id}><button type="button" onClick={() => setSelectedId(other.id)} className={tw('flex w-full items-start gap-2.5 rounded-lg border-0 bg-transparent px-2 py-2.5 text-left hover:bg-[var(--surface-hover)] focus-visible:outline-2 focus-visible:outline-[var(--focus)]')}><Icon name={kindIcons[other.kind]} size={14} className={tw('mt-1 text-[var(--text-tertiary)]')} /><span className={tw('min-w-0 flex-1')}><span className={tw('block text-caption text-[var(--text-tertiary)]')}>{relation}{edge.citation?.line ? ` · ${edge.citation.line}${edge.citation.endLine ? `–${edge.citation.endLine}` : ''} 行` : ''}</span><span className={tw('mt-0.5 block text-xs leading-5 text-[var(--foreground)] [overflow-wrap:anywhere]')}>{other.label}</span></span><Icon name="chevronRight" size={12} className={tw('mt-1 text-[var(--text-tertiary)]')} /></button></li>
          })}</ul> : <p className={tw('text-[var(--text-secondary)]')}>这项内容尚未记录关联来源。</p>}
        </> : <div className={tw('py-6')}><Icon name="agentPreset" size={32} className={tw('mb-4 text-[var(--text-tertiary)]')} /><h2 className={tw('mb-2 mt-0 text-sm font-medium')}>选择节点查看关联</h2><p className={tw('m-0 leading-6 text-[var(--text-secondary)]')}>选中圆形节点，查看关联内容与引用来源。</p></div>}
        <details className={tw('mt-auto border-t border-[var(--panel-border)] pt-3 text-caption text-[var(--text-secondary)]')}>
          <summary className={tw('cursor-pointer py-1')}>关系说明</summary>
          <p className={tw('mb-0 mt-2 leading-6')}>{graphRelations.contains}：文档目录归属<br />{graphRelations.derived}：卡片与 Wiki 页面<br />{graphRelations.cites}：源码或会话引用<br />{graphRelations.links}：正文中的 Wiki 链接</p>
          <p className={tw('mb-1 mt-2 text-[var(--text-tertiary)]')}>仅展示已记录的关系。</p>
        </details>
      </aside>
    </div>
  </section>
}
