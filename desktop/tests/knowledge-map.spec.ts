import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { KnowledgeDocument, KnowledgeSource } from 'ling-desktop/runtime'
import { KnowledgeEngine, type KnowledgeAdapters } from '../src/knowledge/engine.ts'
import { KnowledgeStore } from '../src/knowledge/store.ts'
import { knowledgeMap } from '../src/knowledge/knowledge-map.ts'
import { indexLocalWorkspace, listLocalCodePaths, parseCode, searchLocalCode } from '../src/knowledge/code-index.ts'
import { knowledgeRequestSchema } from '../src/knowledge-contract.ts'

const cleanup: (() => void | Promise<void>)[] = []
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn() })
const code: KnowledgeSource = { kind: 'code', label: 'src/main.ts', path: 'src/main.ts', hash: 'hash', line: 8, endLine: 12 }
const session: KnowledgeSource = { kind: 'session', label: '原始会话', sessionId: 'session-a', seq: 2, throughSeq: 10 }
function doc(id: string, kind: KnowledgeDocument['kind'] = 'wiki', extra: Partial<KnowledgeDocument> = {}): KnowledgeDocument {
  return { id, scope: 'a', kind, title: id, body: '正文', sources: [], state: 'active', version: 1, manual: false, updatedAt: 1, ...extra }
}
function engineFixture() {
  const store = new KnowledgeStore(':memory:'); cleanup.push(() => store.close())
  const adapters: KnowledgeAdapters = {
    scope: async workspaceId => ({ id: workspaceId ?? 'global', workspaceId, label: workspaceId ?? '全局', ...(workspaceId ? { root: '/unused' } : {}) }),
    paths: vi.fn(async () => new Set(['src/main.ts'])),
    session: vi.fn(async () => { throw Error('not used') }), history: async () => [], source: async () => ({ text: '原文', stale: false }),
    generate: vi.fn(async () => { throw Error('not used') }), index: vi.fn(async () => { throw Error('not used') }),
  }
  return { store, adapters, engine: new KnowledgeEngine(store, adapters) }
}
describe('knowledge maps and live ignore rules', () => {
  it('filters types before bounding and expands only one additional hop with valid edges', () => {
    const docs = [doc('wiki:a:root'), doc('wiki:a:child', 'wiki', { parentId: 'wiki:a:root' }), doc('card:a:child:fact', 'card', { sources: [code] })]
    const immediate = knowledgeMap(docs, { focusId: 'document:wiki:a:root' })
    expect(immediate.nodes.map(node => node.kind).sort()).toEqual(['wiki', 'wiki'])
    const expanded = knowledgeMap(docs, { focusId: 'document:wiki:a:root', depth: 2 })
    expect(expanded.nodes.map(node => node.kind).sort()).toEqual(['card', 'wiki', 'wiki'])
    const filtered = knowledgeMap(docs, { kinds: ['card'] })
    expect(filtered.nodes.map(node => node.kind)).toEqual(['card'])
    expect(filtered.edges).toEqual([])
    expect(filtered.totalEdges).toBe(0)
    expect(knowledgeRequestSchema.safeParse({ type: 'knowledgeMap', workspaceId: 'a', kinds: ['file'], depth: 2 }).success).toBe(true)
    expect(knowledgeRequestSchema.safeParse({ type: 'knowledgeMap', workspaceId: 'a', kinds: [], depth: 3 }).success).toBe(false)
  })
  it('projects recorded hierarchy, card ownership, links and provenance without adding memory or archived content', () => {
    const map = knowledgeMap([
      doc('wiki:a:overview', 'wiki', { body: '[入口](wiki:entry)', sources: [code] }),
      doc('wiki:a:entry', 'wiki', { parentId: 'wiki:a:overview' }),
      doc('card:a:overview:fact', 'card', { sources: [code] }),
      doc('summary', 'summary', { sources: [session] }), doc('memory', 'memory'), doc('old', 'wiki', { state: 'archived' }),
    ])
    expect(map.nodes.map(node => node.kind).sort()).toEqual(['card', 'file', 'session', 'summary', 'wiki', 'wiki'])
    expect(map.edges.map(edge => edge.kind).sort()).toEqual(['cites', 'cites', 'cites', 'contains', 'derived', 'links'])
    expect(map.edges.find(edge => edge.kind === 'cites')?.citation).toEqual(code)
    expect(map.nodes.find(node => node.kind === 'file')?.source).toMatchObject({ path: code.path, line: 1 })
  })
  it('filters existing ignored citations and keeps equal source names in different scopes separate', () => {
    const documents = [doc('one', 'wiki', { sources: [code, { ...code, path: 'ignored/old.ts' }, { ...code, path: '.git/config.json' }] }),
      doc('two', 'wiki', { scope: 'b', sources: [{ ...code, path: 'src\\main.ts' }] })]
    const map = knowledgeMap(documents, { paths: new Set(['src/main.ts']) })
    expect(map.nodes.filter(node => node.kind === 'file')).toHaveLength(2)
    expect(map.nodes.filter(node => node.kind === 'file').map(node => node.label)).toEqual(['src/main.ts', 'src/main.ts'])
    expect(map.edges).toHaveLength(2)
    expect(map.nodes.some(node => node.label.includes('ignored') || node.label.includes('.git/'))).toBe(false)
  })
  it('searches and focuses immediate neighbors, bounding large maps without dangling edges', () => {
    const docs = Array.from({ length: 220 }, (_, i) => doc(`page-${i}`, 'wiki', { sources: [{ ...code, path: `src/file-${i}.ts` }] }))
    const map = knowledgeMap(docs)
    expect(map.nodes).toHaveLength(200); expect(map.totalNodes).toBe(440); expect(map.truncated).toBe(true)
    expect(map.edges.every(edge => map.nodes.some(node => node.id === edge.source) && map.nodes.some(node => node.id === edge.target))).toBe(true)
    const queried = knowledgeMap(docs, { query: 'file-219.ts' })
    expect(queried.nodes).toHaveLength(2); expect(queried.edges).toHaveLength(1); expect(queried.truncated).toBe(false)
    const focused = knowledgeMap(docs, { focusId: 'document:page-219' })
    expect(focused.nodes.map(node => node.id).sort()).toEqual(queried.nodes.map(node => node.id).sort())
    expect(() => knowledgeMap(docs, { focusId: 'missing' })).toThrow('已不存在')
    expect(knowledgeMap(docs, { query: 'no match' }).nodes).toEqual([])
    expect(knowledgeRequestSchema.safeParse({ type: 'knowledgeMap', workspaceId: 'a', focusId: focused.nodes[0]!.id }).success).toBe(true)
  })
  it('respects project and library boundaries without generating content, and filters an old code index immediately', async () => {
    const { engine, store, adapters } = engineFixture()
    store.put('a', doc('a-wiki', 'wiki', { sources: [code] })); store.put('b', doc('b-wiki', 'wiki'))
    const library = (await engine.request({ type: 'saveLibrary', workspaceId: null, library: { name: '资料', description: '', access: 'all' } })).library!
    const reference = (await engine.request({ type: 'save', workspaceId: null, libraryId: library.id, document: { kind: 'reference', libraryId: library.id, title: '库内资料', body: '资料', sources: [{ kind: 'manual', label: '手工资料' }] } })).document!
    const map = (await engine.request({ type: 'knowledgeMap', workspaceId: 'a' })).map!
    expect(map.nodes.map(node => node.documentId).filter(Boolean)).toEqual(['a-wiki'])
    await expect(engine.request({ type: 'knowledgeMap', workspaceId: 'a', focusId: 'document:b-wiki' })).rejects.toThrow('不存在')
    const libraryMap = (await engine.request({ type: 'knowledgeMap', workspaceId: null, libraryId: library.id })).map!
    expect(libraryMap.nodes.map(node => node.documentId)).toEqual([reference.id])
    store.replaceFiles('a', [await parseCode('src/main.ts', 'export function main() {}'), await parseCode('ignored/old.ts', 'export function old() {}')])
    const graph = await engine.request({ type: 'graph', workspaceId: 'a', nodeId: 'module:src' })
    expect(graph.nodes?.some(node => node.source?.path === 'ignored/old.ts')).toBe(false)
    const searched = await engine.request({ type: 'search', workspaceId: 'a', kind: 'code', query: 'function' })
    expect(searched.hits?.map(hit => hit.source?.path)).toEqual(['src/main.ts'])
    expect(adapters.index).not.toHaveBeenCalled(); expect(adapters.generate).not.toHaveBeenCalled(); expect(store.jobs()).toEqual([])
  })
  it('uses .gitignore without requiring a Git repository, including nested negations and ignored directories', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ling-map-ignore-')); cleanup.push(() => rm(root, { recursive: true, force: true }))
    await mkdir(join(root, 'src')); await mkdir(join(root, 'cache'))
    await writeFile(join(root, '.gitignore'), 'cache/\n*.ts\n!src/\n!src/kept.ts\n')
    await writeFile(join(root, 'src', '.gitignore'), '!nested.ts\n')
    for (const name of ['kept.ts', 'nested.ts', 'ignored.ts']) await writeFile(join(root, 'src', name), 'export const ignoreNeedle = 1')
    await writeFile(join(root, 'cache', '.gitignore'), '!private.ts\n'); await writeFile(join(root, 'cache', 'private.ts'), 'ignoreNeedle')
    await writeFile(join(root, 'readme.md'), 'ignoreNeedle')
    const paths = await listLocalCodePaths(root)
    expect(paths).toEqual(['readme.md', 'src/kept.ts', 'src/nested.ts'])
    expect((await indexLocalWorkspace(root, [], new AbortController().signal)).map(file => file.path)).toEqual(paths)
    expect((await searchLocalCode(root, 'ignoreNeedle')).map(hit => hit.source?.path).sort()).toEqual(paths)
    await writeFile(join(root, '.gitignore'), '*\n')
    expect(await listLocalCodePaths(root)).toEqual([])
  })
  // Win32 does not permit a newline in a real filename; keep the scan above portable.
  it.skipIf(process.platform === 'win32')('preserves real newline filenames in local scans, indexing and search display fields', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ling-map-newline-')); cleanup.push(() => rm(root, { recursive: true, force: true }))
    const path = 'line\nbreak.md'
    await writeFile(join(root, path), 'first line\nnewlineNeedle\nlast line\n')
    expect(await listLocalCodePaths(root)).toEqual([path])
    const files = await indexLocalWorkspace(root, [], new AbortController().signal)
    expect(files.map(file => file.path)).toEqual([path])
    expect(files[0]?.nodes[0]).toMatchObject({ kind: 'file', label: path, source: { path, label: path } })
    const hits = await searchLocalCode(root, 'newlineNeedle')
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({ title: path, source: { path, label: path, line: 2 } })
  })
})
