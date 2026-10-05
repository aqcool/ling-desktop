// @vitest-environment jsdom
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { KnowledgeMapView } from '../src/ui/KnowledgeMapView.js'
import { KnowledgeSpace } from '../src/ui/KnowledgeSpace.js'
import { knowledgeDefaults, type KnowledgeDocument, type KnowledgeMap, type KnowledgeResponse, type LingKnowledgeService } from '../src/runtime/knowledge.js'
vi.mock('../src/ui/KnowledgeGraph.js', () => ({
  graphRelations: { contains: '包含', derived: '提取', cites: '引用', links: '链接' },
  KnowledgeGraph: ({ nodes, onSelect }: { nodes: KnowledgeMap['nodes']; onSelect: (node: KnowledgeMap['nodes'][number]) => void }) => <div aria-label="测试图谱节点">{nodes.map(node => <button key={node.id} onClick={() => onSelect(node)}>{node.label}</button>)}</div>,
}))
const roots = new Set<Root>()
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('CSS', { escape: (value: string) => value })
  Element.prototype.scrollIntoView = vi.fn()
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
})
afterEach(async () => {
  await act(async () => { for (const root of roots) root.unmount() })
  roots.clear(); document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals()
})
const source = { kind: 'code' as const, label: 'src/main.ts', path: 'src/main.ts', line: 1, hash: 'hash' }
const map: KnowledgeMap = {
  nodes: [{ id: 'document:wiki', label: '入口说明', kind: 'wiki', documentId: 'wiki', state: 'active' }, { id: 'file', label: 'src/main.ts', kind: 'file', source }],
  edges: [{ id: 'citation', source: 'document:wiki', target: 'file', kind: 'cites', citation: { ...source, line: 8, endLine: 12 } }], totalNodes: 2, totalEdges: 1, truncated: false,
}
async function mount(element: ReactNode) {
  const container = document.createElement('div'); document.body.append(container)
  const root = createRoot(container); roots.add(root)
  await act(async () => root.render(element)); return container
}
async function settle() { await act(async () => { await new Promise(done => setTimeout(done, 20)) }) }
async function click(container: HTMLElement, text: string) {
  const button = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(button => button.getAttribute('aria-label') === text || button.textContent?.trim() === text)
  expect(button, text).toBeDefined(); await act(async () => button!.click())
}
describe('knowledge map reading workflow', () => {
  it('opens graph documents and returns with selection preserved in the same project', async () => {
    const document: KnowledgeDocument = { id: 'wiki', scope: 'a', kind: 'wiki', title: '入口说明', body: '这是原文', sources: [source], state: 'active', version: 1, manual: false, updatedAt: 1 }
    const service: LingKnowledgeService = { request: vi.fn<LingKnowledgeService['request']>(async input => ({ ok: true, value: input.type === 'snapshot' ? { snapshot: { documents: [document], jobs: [], indexedFiles: 1, indexedAt: 1, settings: knowledgeDefaults } } : input.type === 'knowledgeMap' ? { map } : input.type === 'read' ? { document } : {} })) }
    const container = await mount(<KnowledgeSpace service={service} scope={{ workspaceId: 'a' }} label="项目 A" onBack={vi.fn()} onSettings={vi.fn()} onOpenTask={vi.fn()} />)
    await click(container, '知识图谱'); await settle()
    expect(container.querySelector('aside[aria-label="Wiki 页面目录"]')).toBeNull()
    await click(container.querySelector('[aria-label="测试图谱节点"]')!, '入口说明')
    const details = container.querySelector('[aria-label="知识节点详情"]')!
    expect(details.textContent).toContain('8–12 行')
    await click(details as HTMLElement, '打开内容')
    expect(container.textContent).toContain('这是原文')
    expect(container.querySelector('[hidden] [aria-label="知识图谱"]')).not.toBeNull()
    await click(container, '返回图谱')
    expect(container.querySelector('[hidden] [aria-label="知识图谱"]')).toBeNull()
    expect(container.querySelector('[aria-label="知识节点详情"]')?.textContent).toContain('入口说明')
    expect(service.request).toHaveBeenCalledWith(expect.objectContaining({ type: 'knowledgeMap', workspaceId: 'a' }), expect.any(AbortSignal))
    expect(service.request).toHaveBeenCalledWith(expect.objectContaining({ type: 'read', workspaceId: 'a', id: 'wiki' }), expect.any(AbortSignal))
  })
  it('uses a library identity, opens recorded sources and focuses without creating content', async () => {
    const request = vi.fn(async () => ({ map })), onSource = vi.fn(), onBack = vi.fn()
    const container = await mount(<KnowledgeMapView request={request} scope={{ workspaceId: null, libraryId: 'library' }} revision="1" library onDocument={vi.fn()} onSource={onSource} onBack={onBack} />)
    await settle(); await click(container.querySelector('[aria-label="测试图谱节点"]')!, 'src/main.ts')
    await click(container, '查看源码'); expect(onSource).toHaveBeenCalledWith(source)
    await click(container, '聚焦关系'); await settle()
    expect(request).toHaveBeenLastCalledWith({ type: 'knowledgeMap', workspaceId: null, libraryId: 'library', focusId: 'file' })
    await click(container, '全部关系'); await settle()
    expect(request).toHaveBeenLastCalledWith({ type: 'knowledgeMap', workspaceId: null, libraryId: 'library' })
    expect(container.textContent).not.toContain('代码关系')
    await click(container, '返回阅读'); expect(onBack).toHaveBeenCalledOnce()
  })
  it('discards a late map response after switching project scope', async () => {
    let finish: (response: KnowledgeResponse) => void = () => {}
    const request = vi.fn(async (input: import('../src/runtime/knowledge.js').KnowledgeRequest) => input.workspaceId === 'a' ? new Promise<KnowledgeResponse>(resolve => { finish = resolve }) : { map: { ...map, nodes: [{ ...map.nodes[0]!, label: '项目 B 的资料' }], edges: [], totalNodes: 1, totalEdges: 0 } })
    const container = document.createElement('div'); document.body.append(container)
    const root = createRoot(container); roots.add(root)
    const render = (workspaceId: string) => <KnowledgeMapView request={request} scope={{ workspaceId }} revision="1" onDocument={vi.fn()} onSource={vi.fn()} onBack={vi.fn()} />
    await act(async () => root.render(render('a'))); await settle()
    await act(async () => root.render(render('b'))); await settle()
    await act(async () => finish({ map })); await settle()
    expect(container.textContent).toContain('项目 B 的资料')
    expect(container.textContent).not.toContain('入口说明')
  })
})
