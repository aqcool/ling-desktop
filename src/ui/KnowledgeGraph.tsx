import { useEffect, useRef } from 'react'
import cytoscape from 'cytoscape'
import type { KnowledgeNode, KnowledgeEdge, KnowledgeMapNode, KnowledgeMapEdge } from '../runtime/knowledge.js'
import { CompactButton } from './SettingsControls.js'
import { Icon } from './Icon.js'
import { tw } from './tailwind.js'

export const graphRelations = { contains: '包含', imports: '导入', calls: '调用候选', derived: '提取', cites: '引用', links: '链接' } as const
export function KnowledgeGraph<Node extends KnowledgeNode | KnowledgeMapNode>({ nodes, edges, onSelect, selectedId, fill = false, collapsedList = false, layered = false }: { nodes: Node[]; edges: (KnowledgeEdge | KnowledgeMapEdge)[]; onSelect: (node: Node) => void; selectedId?: string; fill?: boolean; collapsedList?: boolean; layered?: boolean }) {
  const container = useRef<HTMLDivElement>(null), instance = useRef<cytoscape.Core | null>(null)
  const select = useRef(onSelect); select.current = onSelect
  useEffect(() => {
    if (!container.current || !nodes.length) return
    const styles = (): cytoscape.StylesheetJson => {
      const theme = getComputedStyle(container.current!)
      const color = (name: string, fallback: string) => theme.getPropertyValue(name).trim() || fallback
      return [
        { selector: 'node', style: { label: 'data(label)', 'background-color': color('--surface-secondary', '#f4f4f4'), color: color('--foreground', '#202020'), 'font-family': theme.fontFamily, 'font-size': 11, shape: 'round-rectangle', width: 132, height: 38, 'text-valign': 'center', 'text-halign': 'center', 'text-max-width': '120px', 'text-wrap': 'ellipsis', 'border-width': 1, 'border-color': color('--panel-border', '#ddd') } },
        { selector: 'node[kind="module"], node[kind="wiki"]', style: { height: 44, 'font-weight': 600 } },
        { selector: 'node[kind="card"]', style: { 'border-color': color('--link', '#48735e') } },
        { selector: 'node[kind="file"], node[kind="session"]', style: { 'border-style': 'dashed', 'background-color': color('--surface', '#fff'), color: color('--text-secondary', '#777') } },
        { selector: 'edge', style: { width: 1, 'line-color': color('--text-tertiary', '#aaa'), 'target-arrow-color': color('--text-tertiary', '#aaa'), 'target-arrow-shape': 'triangle', 'curve-style': 'bezier', 'font-size': 9, color: color('--text-secondary', '#777'), label: layered ? '' : 'data(label)', 'text-background-color': color('--surface', '#fff'), 'text-background-opacity': 0.9, 'text-background-padding': '3px' } },
        { selector: 'edge[kind="calls"]', style: { 'line-style': 'dashed' } },
        { selector: '.muted', style: { opacity: 0.2 } },
        { selector: 'edge.related', style: { label: 'data(label)', 'line-color': color('--link', '#48735e'), 'target-arrow-color': color('--link', '#48735e'), width: 1.5 } },
        { selector: 'node.focused', style: { 'border-width': 2, 'border-color': color('--link', '#48735e'), 'background-color': color('--surface-selected', '#e2e8f0') } },
      ]
    }
    const layers = [nodes.filter(node => !['card', 'file', 'session'].includes(node.kind)), nodes.filter(node => node.kind === 'card'), nodes.filter(node => node.kind === 'file' || node.kind === 'session')].filter(layer => layer.length)
    const positions = new Map(layers.flatMap((layer, column) => layer.map((node, row) => [node.id, { x: column * 230, y: (row - (layer.length - 1) / 2) * 64 }] as const)))
    const graph = cytoscape({ container: container.current, elements: [
      ...nodes.map(node => ({ data: { id: node.id, label: node.label, kind: node.kind }, ...(layered ? { position: positions.get(node.id) } : {}) })),
      ...edges.map(edge => ({ data: { id: edge.id, source: edge.source, target: edge.target, label: edge.kind === 'contains' ? '' : graphRelations[edge.kind], kind: edge.kind } })),
    ], style: styles(), layout: layered ? { name: 'preset', fit: true, padding: 45 } : { name: 'cose', animate: false, nodeDimensionsIncludeLabels: true, fit: true, padding: 45, nodeRepulsion: () => 12000 }, minZoom: 0.05, maxZoom: 1.8, wheelSensitivity: 0.2 })
    instance.current = graph
    if (graph.zoom() > 1) { graph.zoom(1); graph.center() }
    graph.on('tap', 'node', event => { const node = nodes.find(node => node.id === event.target.id()); if (node) select.current(node) })
    const observer = new ResizeObserver(() => {
      if (container.current?.clientWidth && container.current.clientHeight) graph.resize()
    }); observer.observe(container.current)
    // Canvas renderers do not inherit CSS changes. Restyle the existing graph so
    // light/dark, system theme and theme-pack changes preserve its layout/camera.
    const themeObserver = new MutationObserver(() => { graph.style(styles()).update() })
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-palette', 'class', 'style'] })
    return () => { instance.current = null; themeObserver.disconnect(); observer.disconnect(); graph.destroy() }
  }, [nodes, edges, layered])
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
  return <div className={tw('flex min-h-0 flex-col gap-3', fill && 'h-full')}>
    <div className={tw('relative min-h-64 w-full overflow-hidden rounded-xl border border-[var(--panel-border)] bg-[var(--surface)]', fill ? 'flex-1' : 'h-80')}>
      {/* Cytoscape sets its container to position:relative. Keep absolute sizing on a separate wrapper. */}
      <div className={tw('absolute inset-0')}><div ref={container} role="img" aria-label="关系图；下方节点列表支持键盘操作" className={tw('relative h-full w-full')} /></div>
      <div className={tw('absolute bottom-3 right-3 flex gap-0.5 rounded-lg border border-[var(--panel-border)] bg-[var(--surface)] p-0.5 shadow-sm')}>
        <CompactButton variant="tertiary" isIconOnly aria-label="缩小关系图" onPress={() => { const graph = instance.current; if (graph) graph.zoom(Math.max(graph.minZoom(), graph.zoom() / 1.25)) }}><Icon name="minus" size={15} /></CompactButton>
        <CompactButton variant="tertiary" isIconOnly aria-label="放大关系图" onPress={() => { const graph = instance.current; if (graph) graph.zoom(Math.min(graph.maxZoom(), graph.zoom() * 1.25)) }}><Icon name="plus" size={15} /></CompactButton>
        <CompactButton variant="tertiary" isIconOnly aria-label="适应关系图" onPress={() => { const graph = instance.current; if (graph) { graph.fit(undefined, 45); if (graph.zoom() > 1) { graph.zoom(1); graph.center() } } }}><Icon name="expand" size={15} /></CompactButton>
      </div>
    </div>
    {collapsedList ? <details className={tw('shrink-0 text-xs text-[var(--text-secondary)]')}><summary className={tw('cursor-pointer py-1')}>节点列表（{nodes.length}）</summary>{nodeList}</details> : nodeList}
  </div>
}
