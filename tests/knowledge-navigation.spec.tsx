// @vitest-environment jsdom
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { KnowledgeCenter } from '../src/ui/KnowledgeCenter.js'
import { KnowledgeSpace } from '../src/ui/KnowledgeSpace.js'
import { knowledgeDefaults, type KnowledgeDocument, type KnowledgeLibrary, type KnowledgeRequest, type LingKnowledgeService } from '../src/runtime/knowledge.js'

const roots = new Set<Root>()
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
})
afterEach(async () => {
  await act(async () => { for (const root of roots) root.unmount() })
  roots.clear()
  document.body.replaceChildren()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const workspaces = [{ workspaceId: 'a', label: '项目 A' }, { workspaceId: 'b', label: '项目 B' }]
const library: KnowledgeLibrary = { id: 'library', scope: 'global', name: '参考资料', description: '', workspaceId: null, scopeLabel: '全部工作区', access: 'all', version: 1, updatedAt: 1, documents: 1 }
function knowledgeDocument(id: string, scope: string, kind: KnowledgeDocument['kind']): KnowledgeDocument {
  return { id, scope, kind, title: id, body: `正文 ${id}`, sources: [], state: 'active', version: 1, manual: true, updatedAt: 1 }
}
const documents = [knowledgeDocument('A Wiki', 'a', 'wiki'), knowledgeDocument('A 总结', 'a', 'summary'), knowledgeDocument('B Wiki', 'b', 'wiki'), { ...knowledgeDocument('库内资料', 'global', 'reference'), libraryId: 'library' }]
function fixture() {
  const request = vi.fn<LingKnowledgeService['request']>(async input => {
    if (input.type === 'catalog') return { ok: true, value: { libraries: [library] } }
    if (input.type === 'snapshot') return { ok: true, value: { snapshot: {
      documents: documents.filter(doc => input.libraryId ? doc.libraryId === input.libraryId : doc.scope === input.workspaceId),
      jobs: [], indexedFiles: 0, indexedAt: null,
      settings: { ...knowledgeDefaults, provider: 'test', model: 'test' },
    } } }
    if (input.type === 'read') return { ok: true, value: { document: documents.find(doc => doc.id === input.id) } }
    return { ok: true, value: {} }
  })
  return { request }
}
async function mount(element: ReactNode) {
  const container = window.document.createElement('div')
  window.document.body.append(container)
  const root = createRoot(container)
  roots.add(root)
  await act(async () => { root.render(element) })
  return container
}
function button(container: HTMLElement, label: string) {
  const found = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(item => item.textContent?.trim() === label)
  expect(found, label).toBeDefined()
  return found!
}
async function click(element: HTMLElement) {
  await act(async () => { element.click() })
}

describe('knowledge navigation and project boundaries', () => {
  it('keeps project operations in the selected project while returning to the Wiki shelf', async () => {
    const service = fixture(), onSettings = vi.fn(), onOpenTask = vi.fn()
    const container = await mount(<KnowledgeCenter service={service} workspaces={workspaces} workspaceId="b" taskId="session-b" onSettings={onSettings} onOpenTask={onOpenTask} />)
    await click(button(container, 'Repo Wiki'))
    const project = Array.from(container.querySelectorAll('article')).find(item => item.querySelector('h2')?.textContent === '项目 A')!
    await click(button(project, '打开 Wiki'))
    expect(container.textContent).toContain('正文 A Wiki')
    await click(button(container, '会话总结'))
    expect(container.querySelector('nav[aria-label="项目知识视图"] button[aria-current="page"]')?.textContent).toBe('会话总结')
    expect(Array.from(container.querySelectorAll('button')).some(item => item.textContent === '总结当前会话')).toBe(false)
    await click(button(container, 'A 总结'))
    expect(container.textContent).toContain('正文 A 总结')
    await click(button(container, '代码查找'))
    await click(button(container, '建立代码索引'))
    expect(service.request).toHaveBeenCalledWith(expect.objectContaining({ type: 'index', workspaceId: 'a' }), expect.any(AbortSignal))
    await click(button(container, 'Repo Wiki'))
    expect(container.querySelector('nav[aria-label="知识中心视图"] button[aria-current="page"]')?.textContent).toBe('Repo Wiki')
    expect(container.querySelector('section[aria-label="知识中心主页面"]')).not.toBeNull()
    expect(onSettings).not.toHaveBeenCalled()
    expect(onOpenTask).not.toHaveBeenCalled()
  })

  it('opens a task recap in summaries and can return to the first Wiki page in the same project', async () => {
    const service = fixture()
    const container = await mount(<KnowledgeCenter service={service} workspaces={workspaces} initialProject workspaceId="a" taskId="session-a" initialDocumentId="A 总结" onSettings={vi.fn()} onOpenTask={vi.fn()} />)
    expect(container.querySelector('nav[aria-label="项目知识视图"] button[aria-current="page"]')?.textContent).toBe('会话总结')
    expect(container.textContent).toContain('正文 A 总结')
    await click(button(container, 'Wiki 页面'))
    expect(container.textContent).toContain('正文 A Wiki')
    expect(container.textContent).not.toContain('正文 A 总结')
    await click(button(container, '会话总结'))
    await click(button(container, '总结当前会话'))
    expect(service.request).toHaveBeenCalledWith(expect.objectContaining({ type: 'summarize', workspaceId: 'a', sessionId: 'session-a' }), expect.any(AbortSignal))
  })

  it('reads a library by its own identity and returns to the library shelf without a project jump', async () => {
    const service = fixture(), onSettings = vi.fn(), onOpenTask = vi.fn()
    const container = await mount(<KnowledgeCenter service={service} workspaces={workspaces} workspaceId="b" onSettings={onSettings} onOpenTask={onOpenTask} />)
    await click(container.querySelector<HTMLButtonElement>('button[aria-label="打开知识库：参考资料"]')!)
    expect(container.querySelector('nav[aria-label="项目知识视图"]')).toBeNull()
    await click(button(container, '库内资料'))
    expect(container.textContent).toContain('正文 库内资料')
    expect(service.request).toHaveBeenCalledWith(expect.objectContaining({ type: 'read', workspaceId: null, libraryId: 'library', id: '库内资料' }), expect.any(AbortSignal))
    await click(button(container, '知识库'))
    expect(container.querySelector('nav[aria-label="知识中心视图"] button[aria-current="page"]')?.textContent).toBe('知识库')
    expect(onSettings).not.toHaveBeenCalled()
    expect(onOpenTask).not.toHaveBeenCalled()
  })

  it('ignores a late document response after changing the project view', async () => {
    const service = fixture()
    let resolve!: (value: Awaited<ReturnType<LingKnowledgeService['request']>>) => void
    const reading = new Promise<Awaited<ReturnType<LingKnowledgeService['request']>>>(finish => { resolve = finish })
    const original = service.request.getMockImplementation()!
    service.request.mockImplementation((input: KnowledgeRequest, signal) => input.type === 'read' ? reading : original(input, signal))
    const container = await mount(<KnowledgeSpace service={service} scope={{ workspaceId: 'a' }} label="项目 A" initialDocumentId="A 总结" initialKind="summary" onBack={vi.fn()} onSettings={vi.fn()} onOpenTask={vi.fn()} />)
    await click(button(container, '代码查找'))
    await act(async () => { resolve({ ok: true, value: { document: documents[1] } }) })
    expect(container.textContent).not.toContain('正文 A 总结')
    expect(container.querySelector('nav[aria-label="项目知识视图"] button[aria-current="page"]')?.textContent).toBe('代码查找')
  })

  it('does not reopen a recap project after the user has returned to the shelf', async () => {
    const service = fixture()
    let resolve!: (value: Awaited<ReturnType<LingKnowledgeService['request']>>) => void
    const reading = new Promise<Awaited<ReturnType<LingKnowledgeService['request']>>>(finish => { resolve = finish })
    const original = service.request.getMockImplementation()!
    service.request.mockImplementation((input, signal) => input.type === 'read' && input.id === 'A 总结' ? reading : original(input, signal))
    const container = await mount(<KnowledgeCenter service={service} workspaces={workspaces} initialProject workspaceId="a" initialDocumentId="A 总结" onSettings={vi.fn()} onOpenTask={vi.fn()} />)
    await click(button(container, 'Repo Wiki'))
    await act(async () => { resolve({ ok: true, value: { document: documents[1] } }) })
    expect(container.querySelector('section[aria-label="知识中心主页面"]')).not.toBeNull()
    expect(container.querySelector('section[aria-label="项目知识页面"]')).toBeNull()
  })
})
