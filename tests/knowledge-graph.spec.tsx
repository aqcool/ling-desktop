// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Core } from 'cytoscape'
import { KnowledgeGraph } from '../src/ui/KnowledgeGraph.js'
import type { KnowledgeMapNode, KnowledgeMapEdge } from '../src/runtime/knowledge.js'
const instances: Core[] = []
vi.mock('cytoscape', async () => {
  const actual = await vi.importActual<{ default: typeof import('cytoscape') }>('cytoscape')
  return { default: (options: object) => { const graph = actual.default({ ...options, container: undefined, headless: true, styleEnabled: true }); instances.push(graph); return graph } }
})
let root: Root | undefined
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} }); vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} })) })
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; document.body.replaceChildren(); instances.length = 0; vi.restoreAllMocks(); vi.unstubAllGlobals() })
describe('stable knowledge graph updates', () => {
  it('preserves positions, camera and selection across metadata refreshes and neighbor expansion', async () => {
    const nodes: KnowledgeMapNode[] = [{ id: 'page', kind: 'wiki', label: '页面' }, { id: 'file', kind: 'file', label: 'main.ts' }]
    const edges: KnowledgeMapEdge[] = [{ id: 'citation', source: 'page', target: 'file', kind: 'cites' }]
    const onSelect = vi.fn(), container = document.createElement('div'); document.body.append(container); root = createRoot(container)
    const render = (items: KnowledgeMapNode[], relations: KnowledgeMapEdge[] = edges) => <KnowledgeGraph network nodes={items} edges={relations} selectedId="page" onSelect={onSelect} />
    await act(async () => root!.render(render(nodes)))
    const graph = instances[0]!, layout = vi.spyOn(graph, 'layout')
    graph.getElementById('page').position({ x: 51, y: 93 }); graph.zoom(0.7); graph.pan({ x: 40, y: 70 })
    await act(async () => root!.render(render(nodes.map(node => ({ ...node, label: `${node.label}更新` })))))
    expect(instances).toHaveLength(1); expect(layout).not.toHaveBeenCalled()
    expect(graph.getElementById('page').position()).toEqual({ x: 51, y: 93 })
    expect(graph.zoom()).toBe(0.7); expect(graph.pan()).toEqual({ x: 40, y: 70 })
    expect(graph.getElementById('page').hasClass('focused')).toBe(true)
    graph.getElementById('page').emit('tap'); expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({ label: '页面更新' }))
    await act(async () => root!.render(render([...nodes, { id: 'card', kind: 'card', label: '卡片' }], [...edges, { id: 'derived', source: 'page', target: 'card', kind: 'derived' }])))
    expect(graph.nodes()).toHaveLength(3); expect(layout).not.toHaveBeenCalled()
    expect(graph.getElementById('page').position()).toEqual({ x: 51, y: 93 })
    expect(graph.pan()).toEqual({ x: 40, y: 70 })
    await act(async () => root!.render(render([nodes[0]!], [])))
    expect(graph.edges()).toHaveLength(0); expect(graph.nodes()).toHaveLength(1)
  })
})
