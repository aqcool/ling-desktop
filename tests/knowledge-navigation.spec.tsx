// @vitest-environment jsdom
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { KnowledgeCenter } from '../src/ui/KnowledgeCenter.js'
import { KnowledgeSpace } from '../src/ui/KnowledgeSpace.js'
import { KnowledgeReader } from '../src/ui/KnowledgeReader.js'
import { knowledgeDefaults, type KnowledgeDocument, type KnowledgeLibrary, type KnowledgeRequest, type LingKnowledgeService } from '../src/runtime/knowledge.js'

const roots = new Set<Root>()
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('CSS', { escape: (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, char => `\\${char}`) })
  Element.prototype.scrollIntoView = vi.fn()
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
    if (input.type === 'status') return { ok: true, value: { status: { state: 'ready', pages: 1, cards: 0, updatedAt: 1 } } }
    if (input.type === 'search') return { ok: true, value: { hits: documents.filter(doc => doc.kind === (input.libraryId ? 'reference' : input.kind) && (input.libraryId ? doc.libraryId === input.libraryId : doc.scope === input.workspaceId) && `${doc.title} ${doc.body}`.includes(input.query)).map(doc => ({ id: doc.id, kind: doc.kind, title: doc.title, snippet: doc.body })) } }
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
  const found = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(item => item.getAttribute('aria-label') === label || item.textContent?.trim() === label)
  expect(found, label).toBeDefined()
  return found!
}
async function click(element: HTMLElement) {
  await act(async () => { element.click() })
}

async function projectView(container: HTMLElement, label: string) {
  await click(container.querySelector<HTMLButtonElement>('button[aria-label="更多操作"]')!)
  const item = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(item => item.textContent?.trim() === label)
  expect(item, label).toBeDefined()
  await click(item!)
}
describe('knowledge navigation and project boundaries', () => {
  it('opens the article directory on demand and preserves it when switching between source and preview', async () => {
    const doc = { ...documents[0]!, title: '页面文件名', body: '# 页面正文标题\n\n## 入口\n正文\n\n## 使用方式\n运行方法。' }
    const container = await mount(<KnowledgeReader document={doc} pending={false} onSave={async () => undefined} onArchive={vi.fn()} onSource={vi.fn()} onWiki={vi.fn()} onOpenTask={vi.fn()} onExport={async () => undefined} />)
    const directory = container.querySelector<HTMLElement>('nav[aria-label="本文目录"]')!
    expect(directory.hidden).toBe(true)
    expect(container.querySelectorAll('h1')).toHaveLength(1)
    expect(container.querySelector('h1')?.textContent).toBe('页面正文标题')
    await click(button(container, '显示页内目录'))
    expect(directory.hidden).toBe(false)
    await click(button(directory, '入口'))
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled()
    await click(button(container, '源文'))
    expect(directory.hidden).toBe(true)
    expect(container.querySelector('pre')?.textContent).toBe(doc.body)
    await click(button(container, '预览'))
    expect(directory.hidden).toBe(false)
    await click(button(container, '隐藏页内目录'))
    expect(directory.hidden).toBe(true)
  })

  it('keeps project operations in the selected project while returning to the Wiki shelf', async () => {
    const service = fixture(), onSettings = vi.fn(), onOpenTask = vi.fn()
    const container = await mount(<KnowledgeCenter service={service} workspaces={workspaces} workspaceId="b" taskId="session-b" onSettings={onSettings} onOpenTask={onOpenTask} />)
    await click(button(container, 'Repo Wiki'))
    const project = Array.from(container.querySelectorAll('article')).find(item => item.querySelector('h2')?.textContent === '项目 A')!
    await click(button(project, '打开 Wiki'))
    expect(container.textContent).toContain('概览')
    await click(button(container, 'A Wiki'))
    expect(container.textContent).toContain('正文 A Wiki')
    await projectView(container, '会话总结')
    expect(container.querySelector('aside[aria-label="会话总结目录"]')).not.toBeNull()
    expect(Array.from(container.querySelectorAll('button')).some(item => item.textContent === '总结当前会话')).toBe(false)
    await click(button(container, 'A 总结'))
    expect(container.textContent).toContain('正文 A 总结')
    await projectView(container, '代码查找')
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
    expect(container.querySelector('aside[aria-label="会话总结目录"]')).not.toBeNull()
    expect(container.textContent).toContain('正文 A 总结')
    await projectView(container, '返回 Wiki 页面')
    await click(button(container, 'A Wiki'))
    expect(container.textContent).toContain('正文 A Wiki')
    expect(container.textContent).not.toContain('正文 A 总结')
    await projectView(container, '会话总结')
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
    await projectView(container, '代码查找')
    await act(async () => { resolve({ ok: true, value: { document: documents[1] } }) })
    expect(container.textContent).not.toContain('正文 A 总结')
    expect(container.querySelector('aside[aria-label="代码检索"]')).not.toBeNull()
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
  it('keeps generation failures visible in the overview without an empty sidebar', async () => {
    const service = fixture(), original = service.request.getMockImplementation()!
    service.request.mockImplementation(async (input, signal) => input.type === 'snapshot' ? { ok: true, value: { snapshot: { documents: [], jobs: [{ id: 'failed', scope: 'a', kind: 'wiki', status: 'failed', message: '模型连接失败', createdAt: 1, updatedAt: 1 }], settings: { ...knowledgeDefaults, provider: 'test', model: 'test' }, indexedFiles: 2000, indexedAt: 1 } } } : original(input, signal))
    const container = await mount(<KnowledgeSpace service={service} scope={{ workspaceId: 'a' }} label="项目 A" onBack={vi.fn()} onSettings={vi.fn()} onOpenTask={vi.fn()} />)
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('模型连接失败')
    expect(container.querySelector('aside')).toBeNull()
    await click(button(container, '重试生成'))
    expect(service.request).toHaveBeenCalledWith(expect.objectContaining({ type: 'retry', jobId: 'failed', workspaceId: 'a' }), expect.any(AbortSignal))
  })

  it('searches library bodies without replacing the current reader and locates a selected match', async () => {
    const service = fixture()
    const container = await mount(<KnowledgeSpace service={service} scope={{ workspaceId: null, libraryId: 'library' }} library={library} label="参考资料" onBack={vi.fn()} onSettings={vi.fn()} onOpenTask={vi.fn()} />)
    expect(container.querySelector('article')?.textContent).toContain('正文 库内资料')
    const input = container.querySelector<HTMLInputElement>('input[aria-label="搜索当前知识库"]')!
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '正文'); input.dispatchEvent(new Event('input', { bubbles: true })) })
    await act(async () => { await new Promise(done => setTimeout(done, 330)) })
    expect(service.request).toHaveBeenCalledWith(expect.objectContaining({ type: 'search', workspaceId: null, libraryId: 'library', query: '正文' }), expect.any(AbortSignal))
    const results = container.querySelector<HTMLElement>('[aria-label="正文搜索结果"]')!
    expect(results.textContent).toContain('库内资料')
    expect(results.querySelector('mark')?.textContent).toBe('正文')
    expect(container.querySelector('article')?.textContent).toContain('正文 库内资料')
    await click(results.querySelector('button')!)
    expect(input.value).toBe('')
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'auto' })
    vi.mocked(Element.prototype.scrollIntoView).mockClear()
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '正文'); input.dispatchEvent(new Event('input', { bubbles: true })) })
    await act(async () => { await new Promise(done => setTimeout(done, 330)) })
    await click(container.querySelector<HTMLElement>('[aria-label="正文搜索结果"] button')!)
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'auto' })
  })
  it('restores the last library document and its scroll position after returning to the shelf', async () => {
    const service = fixture()
    const container = await mount(<KnowledgeCenter service={service} workspaces={workspaces} onSettings={vi.fn()} onOpenTask={vi.fn()} />)
    await click(container.querySelector<HTMLButtonElement>('button[aria-label="打开知识库：参考资料"]')!)
    const pane = container.querySelector<HTMLDivElement>('[aria-label="知识阅读区域"]')!
    pane.scrollTop = 480; await act(async () => pane.dispatchEvent(new Event('scroll', { bubbles: true })))
    await click(button(container, '知识库'))
    await click(container.querySelector<HTMLButtonElement>('button[aria-label="打开知识库：参考资料"]')!)
    expect(container.querySelector('article')?.textContent).toContain('正文 库内资料')
    expect(container.querySelector<HTMLDivElement>('[aria-label="知识阅读区域"]')?.scrollTop).toBe(480)
  })
  it('restores each project view independently', async () => {
    const service = fixture()
    const container = await mount(<KnowledgeSpace service={service} scope={{ workspaceId: 'a' }} label="项目 A" onBack={vi.fn()} onSettings={vi.fn()} onOpenTask={vi.fn()} />)
    await click(button(container, 'A Wiki'))
    const pane = container.querySelector<HTMLDivElement>('[aria-label="知识阅读区域"]')!
    pane.scrollTop = 260; await act(async () => pane.dispatchEvent(new Event('scroll', { bubbles: true })))
    await projectView(container, '会话总结'); await click(button(container, 'A 总结'))
    pane.scrollTop = 130; await act(async () => pane.dispatchEvent(new Event('scroll', { bubbles: true })))
    await projectView(container, '返回 Wiki 页面')
    expect(container.querySelector('article')?.textContent).toContain('正文 A Wiki')
    expect(pane.scrollTop).toBe(260)
    await projectView(container, '会话总结')
    expect(container.querySelector('article')?.textContent).toContain('正文 A 总结')
    expect(pane.scrollTop).toBe(130)
  })
  it('reopens a Repo Wiki card in Wiki while restoring that page instead of the last utility view', async () => {
    const service = fixture()
    const container = await mount(<KnowledgeCenter service={service} workspaces={workspaces} onSettings={vi.fn()} onOpenTask={vi.fn()} />)
    await click(button(container, 'Repo Wiki'))
    await click(container.querySelector<HTMLButtonElement>('button[aria-label="打开 Repo Wiki：项目 A"]')!)
    await click(button(container, 'A Wiki'))
    await projectView(container, '会话总结'); await click(button(container, 'A 总结'))
    await click(button(container, 'Repo Wiki'))
    await click(container.querySelector<HTMLButtonElement>('button[aria-label="打开 Repo Wiki：项目 A"]')!)
    expect(container.querySelector('article')?.textContent).toContain('正文 A Wiki')
    expect(container.querySelector('article')?.textContent).not.toContain('正文 A 总结')
  })

  it('imports a batch directly, retries only failures and opens the saved document', async () => {
    const service = fixture(), original = service.request.getMockImplementation()!
    const saved: KnowledgeDocument[] = []
    let fail = true
    service.request.mockImplementation(async (input, signal) => {
      if (input.type === 'save') {
        if (input.document.title === 'second.md' && fail) { fail = false; return { ok: false, reason: 'runtime-unavailable', retryable: true, message: '写入失败' } }
        const doc = { ...knowledgeDocument(input.document.title, 'global', 'reference'), libraryId: 'library', body: input.document.body }
        saved.push(doc)
        return { ok: true, value: { document: doc } }
      }
      if (input.type === 'read') return { ok: true, value: { document: saved.find(doc => doc.id === input.id) ?? documents.find(doc => doc.id === input.id) } }
      return original(input, signal)
    })
    const container = await mount(<KnowledgeSpace service={service} scope={{ workspaceId: null, libraryId: 'library' }} library={library} label="参考资料" onBack={vi.fn()} onSettings={vi.fn()} onOpenTask={vi.fn()} />)
    await click(container.querySelector<HTMLButtonElement>('button[aria-label="添加知识"]')!)
    await click(Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(item => item.textContent === '添加本地文件')!)
    const files = ['first', 'second'].map(name => { const file = new File(['资料正文'], `${name}.md`); Object.defineProperty(file, 'text', { value: async () => '资料正文' }); return file })
    const picker = document.querySelector<HTMLInputElement>('input[aria-label="选择知识库文件"]')!
    await act(async () => { Object.defineProperty(picker, 'files', { configurable: true, value: files }); picker.dispatchEvent(new Event('change', { bubbles: true })) })
    await click(button(document.querySelector<HTMLElement>('[role="dialog"]')!, '添加知识'))
    expect(saved.map(doc => doc.title)).toEqual(['first.md'])
    expect(document.body.textContent).toContain('重试未完成文件')
    await click(button(document.body, '重试未完成文件'))
    expect(saved.map(doc => doc.title)).toEqual(['first.md', 'second.md'])
    expect(container.querySelector('h1')?.textContent).toBe('first.md')
    expect(service.request.mock.calls.filter(([input]) => input.type === 'save')).toHaveLength(3)
    expect(service.request.mock.calls.filter(([input]) => input.type === 'save').every(([input]) => input.workspaceId === null && input.libraryId === 'library')).toBe(true)
  })

  it('preserves edits when leaving is cancelled and requires an explicit discard', async () => {
    const service = fixture(), onBack = vi.fn()
    const container = await mount(<KnowledgeSpace service={service} scope={{ workspaceId: null, libraryId: 'library' }} library={library} label="参考资料" onBack={onBack} onSettings={vi.fn()} onOpenTask={vi.fn()} />)
    await click(button(container, '库内资料'))
    await click(button(container, '编辑'))
    const editor = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="文档正文"]')!
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(editor, '尚未保存'); editor.dispatchEvent(new Event('input', { bubbles: true })) })
    await click(button(container, '知识库'))
    expect(onBack).not.toHaveBeenCalled()
    await click(button(document.body, '继续编辑'))
    expect(editor.value).toBe('尚未保存')
    await click(button(container, '知识库'))
    await click(button(document.body, '放弃修改并离开'))
    expect(onBack).toHaveBeenCalledOnce()
    expect(service.request.mock.calls.some(([input]) => input.type === 'save')).toBe(false)
  })

})
