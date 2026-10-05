import { afterEach, describe, expect, it, vi } from 'vitest'
import { KnowledgeEngine, type KnowledgeAdapters } from '../src/knowledge/engine.ts'
import { KnowledgeStore } from '../src/knowledge/store.ts'
import { parseCode } from '../src/knowledge/code-index.ts'
import { knowledgeRequestSchema } from '../src/knowledge-contract.ts'
const stores: KnowledgeStore[] = []
afterEach(() => { for (const store of stores.splice(0)) store.close() })
function fixture() {
  const store = new KnowledgeStore(':memory:'); stores.push(store)
  const adapters: KnowledgeAdapters = { scope: async workspaceId => ({ id: workspaceId ?? 'global', workspaceId, label: '项目', root: '/unused' }), index: vi.fn(async (_scope, files) => files), session: async () => { throw Error('unused') }, history: async () => [], source: async () => ({ text: '', stale: false }), generate: vi.fn(async () => { throw Error('unused') }) }
  return { store, adapters, engine: new KnowledgeEngine(store, adapters) }
}
const page = { id: 'page', kind: 'wiki' as const, title: '项目概览', body: '原文', sources: [{ kind: 'manual' as const, label: '资料' }], state: 'active' as const, manual: true }
describe('lightweight knowledge refresh and updates', () => {
  it('returns only a revision when unchanged, and invalidates document, job and settings changes', async () => {
    const { engine, store } = fixture(); store.put('a', page)
    const first = await engine.request({ type: 'snapshot', workspaceId: 'a' })
    const list = vi.spyOn(store, 'list')
    expect(await engine.request({ type: 'snapshot', workspaceId: 'a', revision: first.revision })).toEqual({ revision: first.revision, unchanged: true })
    expect(list).not.toHaveBeenCalled()
    store.put('b', { ...page, id: 'other' })
    expect((await engine.request({ type: 'snapshot', workspaceId: 'a', revision: first.revision })).unchanged).toBe(true)
    store.put('a', { ...page, version: 1, body: '修改' })
    const changed = await engine.request({ type: 'snapshot', workspaceId: 'a', revision: first.revision })
    expect(changed.snapshot?.documents[0]?.body).toBe('修改')
    const job = store.enqueue('a', 'wiki', {}, 'job')
    const working = await engine.request({ type: 'snapshot', workspaceId: 'a', revision: changed.revision })
    expect(working.snapshot?.jobs[0]?.status).toBe('queued')
    store.updateJob(job.id, 'completed')
    expect((await engine.request({ type: 'snapshot', workspaceId: 'a', revision: working.revision })).snapshot?.jobs[0]?.status).toBe('completed')
    store.setMeta('settings', { ...store.settings(), projectMemory: false })
    expect((await engine.request({ type: 'snapshot', workspaceId: 'a', revision: working.revision })).snapshot?.settings.projectMemory).toBe(false)
    expect(knowledgeRequestSchema.safeParse({ type: 'snapshot', workspaceId: 'a', revision: first.revision }).success).toBe(true)
  })
  it('updates accessible library revisions and excludes another project from status queries', async () => {
    const { engine, store } = fixture()
    const library = (await engine.request({ type: 'saveLibrary', workspaceId: null, library: { name: '公共资料', description: '', access: 'all' } })).library!
    const first = await engine.request({ type: 'snapshot', workspaceId: 'a' })
    store.put('global', { ...page, id: 'reference', kind: 'reference', libraryId: library.id })
    expect((await engine.request({ type: 'snapshot', workspaceId: 'a', revision: first.revision })).snapshot?.documents.some(doc => doc.id === 'reference')).toBe(true)
    store.put('a', page); store.put('b', { ...page, id: 'b-page' })
    const list = vi.spyOn(store, 'list')
    expect(await engine.request({ type: 'status', workspaceId: 'a' })).toEqual({ status: { state: 'ready', pages: 1, cards: 0, updatedAt: expect.any(Number) } })
    expect(list).not.toHaveBeenCalled()
  })
  it('checks changed, added and removed evidence without modifying the index, text or job queue', async () => {
    const { engine, store, adapters } = fixture()
    const original = await parseCode('src/main.ts', 'export function main() {}'), removed = await parseCode('old.ts', 'export const old = 1')
    store.replaceFiles('a', [original, removed])
    store.put('a', { ...page, sources: [original.nodes[0]!.source!] })
    const index = store.meta('indexedAt:a', null), version = store.read('a', 'page')!.version
    vi.mocked(adapters.index!).mockResolvedValue([await parseCode('src/main.ts', 'export function main() { return 1 }'), await parseCode('new.ts', 'export const next = 1')])
    const value = (await engine.request({ type: 'wikiChanges', workspaceId: 'a' })).wikiChanges!
    expect(value.files).toEqual([{ path: 'src/main.ts', change: 'changed' }, { path: 'new.ts', change: 'added' }, { path: 'old.ts', change: 'removed' }])
    expect(value.pages).toEqual([{ id: 'page', title: '项目概览', manual: true, paths: ['src/main.ts'] }])
    expect(store.meta('indexedAt:a', null)).toBe(index)
    expect(store.read('a', 'page')).toMatchObject({ version, body: '原文' })
    expect(store.jobs('a')).toEqual([])
    expect(adapters.generate).not.toHaveBeenCalled()
  })
  it('returns the paragraph around a body match far beyond the opening text', () => {
    const { store } = fixture()
    store.put('a', { ...page, body: `${'开篇说明。'.repeat(150)}\n认证机制使用 getUserToken 获取身份。\n结束。` })
    const hit = store.search('a', 'getUserToken', 'wiki')[0]!
    expect(hit.snippet).toContain('认证机制使用 getUserToken')
    expect(hit.snippet.startsWith('…')).toBe(true)
    expect(hit.snippet.length).toBeLessThanOrEqual(322)
  })
})
