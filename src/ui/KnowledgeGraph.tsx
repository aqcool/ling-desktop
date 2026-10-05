import { useEffect, useRef } from 'react'
import cytoscape from 'cytoscape'
import type { KnowledgeNode, KnowledgeEdge, KnowledgeMapNode, KnowledgeMapEdge } from '../runtime/knowledge.js'
import { CompactButton } from './SettingsControls.js'
import { Icon, iconDataUri } from './Icon.js'
import { tw } from './tailwind.js'

export const graphRelations = { contains: '包含', imports: '导入', calls: '调用候选', derived: '提取', cites: '引用', links: '链接' } as const
export function KnowledgeGraph<Node extends KnowledgeNode | KnowledgeMapNode>({ nodes, edges, onSelect, selectedId, fill = false, collapsedList = false, network = false, framed = true }: { nodes: Node[]; edges: (KnowledgeEdge | KnowledgeMapEdge)[]; onSelect: (node: Node) => void; selectedId?: string; fill?: boolean; collapsedList?: boolean; network?: boolean; framed?: boolean }) {
  const container = useRef<HTMLDivElement>(null), instance = useRef<cytoscape.Core | null>(null)
  const select = useRef(onSelect); select.current = onSelect
  useEffect(() => {
    if (!container.current || !nodes.length) return
    const styles = (): cytoscape.StylesheetJson => {
      const theme = getComputedStyle(container.current!)
      const color = (name: string, fallback: string) => theme.getPropertyValue(name).trim() || fallback
      const icon = (name: import('./Icon.js').IconName, accent = false) => iconDataUri(name, color(accent ? '--link' : '--text-secondary', '#777'))
      return [
        { selector: 'node', style: { label: 'data(label)', 'background-color': color('--surface-secondary', '#f4f4f4'), color: color('--foreground', '#202020'), 'font-family': theme.fontFamily, 'font-size': 11, shape: 'round-rectangle', width: 132, height: 38, 'text-valign': 'center', 'text-halign': 'center', 'text-max-width': '120px', 'text-wrap': 'ellipsis', 'border-width': 1, 'border-color': color('--panel-border', '#ddd') } },
        { selector: 'node[kind="module"], node[kind="wiki"]', style: { height: 44, 'font-weight': 600 } },
        { selector: 'node[kind="card"]', style: { 'border-color': color('--link', '#48735e') } },
        { selector: 'node[kind="file"], node[kind="session"]', style: { 'border-style': 'dashed', 'background-color': color('--surface', '#fff'), color: color('--text-secondary', '#777') } },
        { selector: 'edge', style: { width: 1, 'line-color': color('--text-tertiary', '#aaa'), 'target-arrow-color': color('--text-tertiary', '#aaa'), 'target-arrow-shape': 'triangle', 'curve-style': 'bezier', 'font-size': 9, color: color('--text-secondary', '#777'), label: network ? '' : 'data(label)', 'text-background-color': color('--surface', '#fff'), 'text-background-opacity': 0.9, 'text-background-padding': '3px' } },
        { selector: 'edge[kind="calls"]', style: { 'line-style': 'dashed' } },
        { selector: '.muted', style: { opacity: 0.2 } },
        { selector: 'edge.related', style: { label: 'data(label)', 'line-color': color('--link', '#48735e'), 'target-arrow-color': color('--link', '#48735e'), width: 1.5 } },
        { selector: 'node.focused', style: { 'border-width': 2, 'border-color': color('--link', '#48735e'), 'background-color': color('--surface-selected', '#e2e8f0') } },
        ...(network ? [
          { selector: 'node', style: { shape: 'ellipse', width: 32, height: 32, 'font-size': 10.5, 'font-weight': 400, 'text-max-width': '116px', 'text-valign': 'bottom', 'text-margin-y': 8, 'background-color': color('--surface-secondary', '#f4f4f4'), 'background-image': icon('file'), 'background-width': 15, 'background-height': 15, 'background-position-x': '50%', 'background-position-y': '50%', 'background-image-opacity': 0.8, 'border-color': color('--panel-border', '#ddd'), 'border-style': 'solid', 'border-opacity': 0.7, 'text-background-color': color('--surface', '#fff'), 'text-background-opacity': 0.9, 'text-background-padding': '2px', 'text-background-shape': 'roundrectangle' } },
          { selector: 'node[kind="wiki"]', style: { width: 48, height: 48, 'background-image': icon('book', true), 'background-width': 21, 'background-height': 21, 'background-color': color('--surface-selected', '#e2e8f0'), 'border-color': color('--link', '#48735e'), 'border-opacity': 0.45, 'font-weight': 600, 'font-size': 12 } },
          { selector: 'node[kind="card"]', style: { width: 30, height: 30, 'background-image': icon('grid', true), 'background-color': color('--surface', '#fff'), 'border-color': color('--link', '#48735e'), 'border-opacity': 0.35 } },
          { selector: 'node[kind="summary"], node[kind="reference"]', style: { width: 40, height: 40, 'background-color': color('--surface-selected', '#e2e8f0') } },
          { selector: 'node[kind="summary"]', style: { 'background-image': icon('quote', true) } },
          { selector: 'node[kind="reference"]', style: { 'background-image': icon('file', true) } },
          { selector: 'node[kind="session"]', style: { 'background-image': icon('sideChat') } },
          { selector: 'node[kind="file"], node[kind="session"]', style: { color: color('--text-secondary', '#777') } },
          { selector: 'edge', style: { 'arrow-scale': 0.6, 'line-opacity': 0.4, 'target-arrow-fill': 'hollow', 'text-background-padding': '4px' } },
          { selector: 'node.hovered', style: { 'border-color': color('--link', '#48735e'), 'border-opacity': 0.7 } },
          { selector: 'node.focused', style: { 'border-width': 2.5, 'background-color': color('--surface-selected', '#e2e8f0'), 'background-opacity': 1, 'border-opacity': 1, 'font-weight': 600 } },
          { selector: 'edge.related', style: { 'line-opacity': 1, 'target-arrow-fill': 'filled' } },
        ] as cytoscape.StylesheetJson : []),
      ]
    }
    const graph = cytoscape({ container: container.current, elements: [
      // A deterministic spiral seeds the force layout; avoid reshuffling on every visit.
      ...nodes.map((node, index) => ({ data: { id: node.id, label: node.label, kind: node.kind }, ...(network ? { position: { x: Math.cos(index * 2.4) * 70 * Math.sqrt(index), y: Math.sin(index * 2.4) * 70 * Math.sqrt(index) } } : {}) })),
      ...edges.map(edge => ({ data: { id: edge.id, source: edge.source, target: edge.target, label: edge.kind === 'contains' ? '' : graphRelations[edge.kind], kind: edge.kind } })),
    ], style: styles(), layout: { name: 'cose', animate: false, nodeDimensionsIncludeLabels: true, fit: true, padding: network ? 60 : 45, ...(network ? { randomize: false, componentSpacing: 100, idealEdgeLength: () => 100, gravity: 0.35 } : {}), nodeRepulsion: () => 12000 }, minZoom: 0.05, maxZoom: 1.8, wheelSensitivity: 0.2 })
    instance.current = graph
    if (graph.zoom() > 1) { graph.zoom(1); graph.center() }
    graph.on('tap', 'node', event => { const node = nodes.find(node => node.id === event.target.id()); if (node) select.current(node) })
    graph.on('mouseover', 'node', event => { event.target.addClass('hovered'); if (container.current) container.current.style.cursor = 'pointer' })
    graph.on('mouseout', 'node', event => { event.target.removeClass('hovered'); if (container.current) container.current.style.cursor = '' })
    const observer = new ResizeObserver(() => {
      if (container.current?.clientWidth && container.current.clientHeight) graph.resize()
    }); observer.observe(container.current)
    // Canvas renderers do not inherit CSS changes. Restyle the existing graph so
    // light/dark, system theme and theme-pack changes preserve its layout/camera.
    const themeObserver = new MutationObserver(() => { graph.style(styles()).update() })
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-palette', 'class', 'style'] })
    return () => { instance.current = null; themeObserver.disconnect(); observer.disconnect(); graph.destroy() }
  }, [nodes, edges, network])
  useEffect(() => {
    const graph = instance.current
    if (!graph) return
    graph.elements().removeClass('focused muted related')
    if (!selectedId) return
    const node = graph.getElementById(selectedId)
    if (node.empty()) return
    graph.elements().difference(node.closedNeighborhood()).addClass('muted')
    node.connectedEdges().addClass('related')
    node.addClass('focused')
  }, [selectedId, nodes, edges])
  const nodeList = <div className={tw('flex max-h-32 flex-wrap gap-1.5 overflow-auto py-1')} aria-label="图谱节点">
    {nodes.map(node => <button key={node.id} type="button" aria-pressed={selectedId === node.id} title={node.label} onClick={() => onSelect(node)} className={tw('max-w-full truncate rounded-md border border-[var(--panel-border)] bg-transparent px-2 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] focus-visible:outline-2 focus-visible:outline-[var(--focus)]', selectedId === node.id && 'bg-[var(--surface-selected)]')}>{node.label}</button>)}
  </div>
  return <div className={tw('flex min-h-0 flex-col', fill && 'h-full', framed && 'gap-3')}>
    <div className={tw('relative min-h-64 w-full overflow-hidden bg-[var(--surface)]', framed && 'rounded-xl border border-[var(--panel-border)]', network && '[background-image:radial-gradient(circle,color-mix(in_srgb,var(--panel-border)_55%,transparent)_0.7px,transparent_0.7px)] [background-size:20px_20px]', fill ? 'flex-1' : 'h-80')}>
      {/* Cytoscape sets its container to position:relative. Keep absolute sizing on a separate wrapper. */}
      <div className={tw('absolute inset-0')}><div ref={container} role="img" aria-label="关系图；下方节点列表支持键盘操作" className={tw('relative h-full w-full')} /></div>
      {network ? <div aria-label="节点类型" className={tw('pointer-events-none absolute left-4 top-3 flex flex-wrap gap-x-4 gap-y-1 rounded-lg bg-[var(--surface)] px-2 py-1.5 text-caption text-[var(--text-secondary)]')}>
        <span className={tw('flex items-center gap-1.5')}><Icon name="book" size={13} className={tw('text-[var(--link)]')} />页面与总结</span><span className={tw('flex items-center gap-1.5')}><Icon name="grid" size={13} />知识卡片</span><span className={tw('flex items-center gap-1.5')}><Icon name="file" size={13} />引用来源</span>
      </div> : null}
      <div className={tw('absolute bottom-3 right-3 flex gap-0.5 rounded-lg border border-[var(--panel-border)] bg-[var(--surface)] p-0.5 shadow-sm')}>
        <CompactButton variant="tertiary" isIconOnly className={tw('bg-transparent')} aria-label="缩小关系图" onPress={() => { const graph = instance.current; if (graph) graph.zoom(Math.max(graph.minZoom(), graph.zoom() / 1.25)) }}><Icon name="minus" size={15} /></CompactButton>
        <CompactButton variant="tertiary" isIconOnly className={tw('bg-transparent')} aria-label="放大关系图" onPress={() => { const graph = instance.current; if (graph) graph.zoom(Math.min(graph.maxZoom(), graph.zoom() * 1.25)) }}><Icon name="plus" size={15} /></CompactButton>
        <CompactButton variant="tertiary" isIconOnly className={tw('bg-transparent')} aria-label="适应关系图" onPress={() => { const graph = instance.current; if (graph) { graph.fit(undefined, 45); if (graph.zoom() > 1) { graph.zoom(1); graph.center() } } }}><Icon name="expand" size={15} /></CompactButton>
      </div>
    </div>
    {collapsedList ? <details className={tw('shrink-0 text-caption text-[var(--text-secondary)]', !framed && 'border-t border-[var(--panel-border)] bg-[var(--surface)] px-4')}><summary className={tw('cursor-pointer py-2.5')}>节点列表（{nodes.length}）</summary>{nodeList}</details> : nodeList}
  </div>
}
