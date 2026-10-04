import { useEffect, useRef } from 'react'
import cytoscape from 'cytoscape'
import type { KnowledgeNode, KnowledgeEdge } from '../runtime/knowledge.js'
import { tw } from './tailwind.js'

export function KnowledgeGraph({ nodes, edges, onSelect }: { nodes: KnowledgeNode[]; edges: KnowledgeEdge[]; onSelect: (node: KnowledgeNode) => void }) {
  const container = useRef<HTMLDivElement>(null)
  const select = useRef(onSelect); select.current = onSelect
  useEffect(() => {
    if (!container.current || !nodes.length) return
    const styles = (): cytoscape.StylesheetJson => {
      const theme = getComputedStyle(container.current!)
      const color = (name: string, fallback: string) => theme.getPropertyValue(name).trim() || fallback
      return [
        { selector: 'node', style: { label: 'data(label)', 'background-color': color('--surface-selected', '#e2e8f0'), color: color('--foreground', '#202020'), 'font-family': theme.fontFamily, 'font-size': 11, shape: 'round-rectangle', width: 86, height: 32, 'text-valign': 'center', 'text-halign': 'center', 'text-max-width': '82px', 'text-wrap': 'ellipsis', 'border-width': 1, 'border-color': color('--panel-border', '#ddd') } },
        { selector: 'node[kind="module"]', style: { width: 106, height: 40, 'font-weight': 600 } },
        { selector: 'edge', style: { width: 1, 'line-color': color('--text-tertiary', '#aaa'), 'target-arrow-color': color('--text-tertiary', '#aaa'), 'target-arrow-shape': 'triangle', 'curve-style': 'bezier', 'font-size': 9, color: color('--text-secondary', '#777'), label: 'data(label)' } },
        { selector: 'edge[kind="calls"]', style: { 'line-style': 'dashed' } },
      ]
    }
    const graph = cytoscape({ container: container.current, elements: [
      ...nodes.map(node => ({ data: { id: node.id, label: node.label, kind: node.kind } })),
      ...edges.map(edge => ({ data: { id: edge.id, source: edge.source, target: edge.target, label: edge.kind === 'imports' ? '导入' : edge.kind === 'calls' ? '调用候选' : '', kind: edge.kind } })),
    ], style: styles(), layout: { name: 'cose', animate: false, nodeDimensionsIncludeLabels: true, fit: true, padding: 30 }, minZoom: 0.2, maxZoom: 2, wheelSensitivity: 0.2 })
    graph.on('tap', 'node', event => { const node = nodes.find(node => node.id === event.target.id()); if (node) select.current(node) })
    const observer = new ResizeObserver(() => graph.resize()); observer.observe(container.current)
    // Canvas renderers do not inherit CSS changes. Restyle the existing graph so
    // light/dark, system theme and theme-pack changes preserve its layout/camera.
    const themeObserver = new MutationObserver(() => { graph.style(styles()).update() })
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-palette', 'class', 'style'] })
    return () => { themeObserver.disconnect(); observer.disconnect(); graph.destroy() }
  }, [nodes, edges])
  return <div className={tw('flex min-h-0 flex-col gap-3')}>
    <div ref={container} role="img" aria-label="代码关系图；下方提供可用键盘操作的节点列表" className={tw('h-80 min-h-64 w-full rounded-xl border border-[var(--panel-border)] bg-[var(--surface)]')} />
    <div className={tw('flex flex-wrap gap-1.5')} aria-label="图谱节点">
      {nodes.map(node => <button key={node.id} type="button" onClick={() => onSelect(node)} className={tw('max-w-full truncate rounded-md border border-[var(--panel-border)] bg-transparent px-2 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] focus-visible:outline-2 focus-visible:outline-[var(--focus)]')}>{node.label}</button>)}
    </div>
  </div>
}
