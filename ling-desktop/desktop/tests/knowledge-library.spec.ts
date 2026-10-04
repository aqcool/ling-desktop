import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { KnowledgeStore } from '../src/knowledge/store.ts'
import {
  KnowledgeEngine,
  type KnowledgeAdapters,
} from '../src/knowledge/engine.ts'
const clean: (() => void | Promise<void>)[] = []
afterEach(async () => {
  for (const fn of clean.splice(0).reverse()) await fn()
})
const manual = { kind: 'manual' as const, label: '测试资料' }
function setup(root = '/unused') {
  const store = new KnowledgeStore(':memory:')
  clean.push(() => store.close())
  const adapters: KnowledgeAdapters = {
    scope: async (workspaceId) => ({
      id: workspaceId ?? 'global',
      workspaceId,
      ...(workspaceId ? { root } : {}),
      label: workspaceId ?? '通用资料',
    }),
    session: async () => {
      throw Error('not used')
    },
    source: async () => ({ text: 'source', stale: false }),
    history: async () => [],
    generate: async () => {
      throw Error('not used')
    },
  }
  return { store, adapters, engine: new KnowledgeEngine(store, adapters) }
}
async function wait(engine: KnowledgeEngine, id: string) {
  for (let n = 0; n < 300; n++) {
    const job = engine.store.job('project', id)
    if (job && !['queued', 'running'].includes(job.status)) return job
    await new Promise((done) => setTimeout(done, 10))
  }
  throw Error('timeout')
}
describe('local knowledge libraries', () => {
  it('changes selected-workspace access without moving, copying or injecting reference documents', async () => {
    const { engine, store } = setup()
    const library = (
      await engine.request({
        type: 'saveLibrary',
        workspaceId: null,
        library: {
          name: '认证资料',
          description: '',
          access: 'selected',
          bindings: [{ workspaceId: 'a' }, { workspaceId: 'b' }],
        },
      })
    ).library!
    expect(library.bindings?.map((binding) => binding.scope)).toEqual([
      'a',
      'b',
    ])
    const scope = { workspaceId: null, libraryId: library.id }
    const document = (
      await engine.request({
        type: 'save',
        ...scope,
        document: {
          kind: 'reference',
          libraryId: library.id,
          title: '共享认证',
          body: '认证约定',
          sources: [manual],
        },
      })
    ).document!
    for (const workspaceId of ['a', 'b']) {
      expect(
        (
          await engine.request({ type: 'search', workspaceId, query: '认证' })
        ).hits?.map((hit) => hit.id),
      ).toContain(document.id)
      expect(
        (await engine.request({ type: 'read', workspaceId, id: document.id }))
          .document?.body,
      ).toBe('认证约定')
      expect(store.rules(workspaceId)).toEqual([])
    }
    expect(
      (await engine.request({ type: 'snapshot', workspaceId: 'c' })).snapshot
        ?.documents,
    ).toEqual([])
    await expect(
      engine.request({ type: 'read', workspaceId: 'c', id: document.id }),
    ).rejects.toThrow('不属于')
    await engine.request({
      type: 'saveLibrary',
      workspaceId: null,
      library: {
        id: library.id,
        version: library.version,
        name: library.name,
        description: '',
        access: 'selected',
        bindings: [{ workspaceId: 'b' }],
      },
    })
    expect(
      (
        await engine.request({
          type: 'search',
          workspaceId: 'a',
          query: '认证',
        })
      ).hits,
    ).toEqual([])
    await expect(
      engine.request({ type: 'read', workspaceId: 'a', id: document.id }),
    ).rejects.toThrow('不属于')
    expect(
      (await engine.request({ type: 'read', ...scope, id: document.id }))
        .document?.version,
    ).toBe(1)
    expect(
      (
        await engine.request({
          type: 'read',
          workspaceId: 'b',
          id: document.id,
        })
      ).document?.version,
    ).toBe(1)
    expect(store.list('a')).toEqual([])
    expect(store.list('b')).toEqual([])
    await expect(
      engine.request({
        type: 'saveLibrary',
        workspaceId: null,
        library: {
          id: library.id,
          version: 1,
          name: '冲突',
          description: '',
          access: 'all',
        },
      }),
    ).rejects.toThrow('已更新')
  })
  it('allows all-workspace libraries in future projects and rejects empty or unresolved selected scopes', async () => {
    const { engine, adapters } = setup()
    const library = (
      await engine.request({
        type: 'saveLibrary',
        workspaceId: null,
        library: { name: '手册', description: '', access: 'all' },
      })
    ).library!
    const doc = (
      await engine.request({
        type: 'save',
        workspaceId: null,
        libraryId: library.id,
        document: {
          kind: 'reference',
          libraryId: library.id,
          title: '认证流程',
          body: '认证步骤',
          sources: [manual],
        },
      })
    ).document!
    await expect(
      engine.request({
        type: 'save',
        workspaceId: null,
        libraryId: library.id,
        document: {
          kind: 'reference',
          libraryId: library.id,
          title: '错误跨项目引用',
          body: '正文',
          sources: [
            { kind: 'code', label: 'main.ts', path: 'main.ts', line: 1 },
          ],
        },
      }),
    ).rejects.toThrow('共享资料')
    expect(
      (
        await engine.request({
          type: 'read',
          workspaceId: 'future',
          id: doc.id,
        })
      ).document?.id,
    ).toBe(doc.id)
    expect(
      (
        await engine.request({
          type: 'search',
          workspaceId: 'future',
          query: '认证',
        })
      ).hits?.map((hit) => hit.id),
    ).toContain(doc.id)
    await expect(
      engine.request({
        type: 'saveLibrary',
        workspaceId: null,
        library: {
          name: '空范围',
          description: '',
          access: 'selected',
          bindings: [],
        },
      }),
    ).rejects.toThrow()
    adapters.scope = async (workspaceId) => ({
      id: workspaceId ?? 'global',
      workspaceId,
      label: '不存在',
    })
    await expect(
      engine.request({
        type: 'saveLibrary',
        workspaceId: null,
        library: {
          name: '无目录',
          description: '',
          access: 'selected',
          bindings: [{ workspaceId: 'missing' }],
        },
      }),
    ).rejects.toThrow()
  })
  it('keeps Wiki generation and Agent-reference options per project', async () => {
    const { engine } = setup()
    const options = {
      language: 'en' as const,
      autoUpdate: true,
      agentReference: false,
    }
    await engine.request({ type: 'wikiOptions', workspaceId: 'a', options })
    expect(
      (await engine.request({ type: 'snapshot', workspaceId: 'a' })).snapshot
        ?.wikiOptions,
    ).toEqual(options)
    expect(
      (await engine.request({ type: 'snapshot', workspaceId: 'b' })).snapshot
        ?.wikiOptions,
    ).toEqual({ language: 'zh-CN', autoUpdate: false, agentReference: true })
    await expect(
      engine.request({ type: 'wikiOptions', workspaceId: null, options }),
    ).rejects.toThrow()
  })

  it('requires library membership, keeps references out of rules, and isolates search/export', async () => {
    const { store, engine } = setup()
    const one = (
      await engine.request({
        type: 'saveLibrary',
        workspaceId: 'a',
        library: { name: '产品', description: '说明' },
      })
    ).library!
    const two = (
      await engine.request({
        type: 'saveLibrary',
        workspaceId: 'a',
        library: { name: '接口', description: '' },
      })
    ).library!
    const save = (libraryId: string, title: string) =>
      engine.request({
        type: 'save',
        workspaceId: 'a',
        document: {
          kind: 'reference',
          libraryId,
          title,
          body: '认证说明',
          sources: [manual],
        },
      })
    const doc = (await save(one.id, '产品认证')).document!
    await save(two.id, '接口认证')
    await expect(save('missing', '失败')).rejects.toThrow('所属知识库')
    expect(store.rules('a')).toEqual([])
    expect(
      (
        await engine.request({ type: 'catalog', workspaceId: null })
      ).libraries?.map((lib) => lib.documents),
    ).toEqual([1, 1])
    const hits = (
      await engine.request({
        type: 'search',
        workspaceId: 'a',
        query: '认证',
        libraryId: one.id,
      })
    ).hits!
    expect(hits.map((hit) => hit.id)).toEqual([doc.id])
    const text = (
      await engine.request({
        type: 'export',
        workspaceId: 'a',
        libraryId: one.id,
      })
    ).text!
    expect(text).toContain('产品认证')
    expect(text).not.toContain('接口认证')
    await expect(
      engine.request({ type: 'export', workspaceId: 'a' }),
    ).rejects.toThrow('请选择')
    await expect(
      engine.request({ type: 'read', workspaceId: 'b', id: doc.id }),
    ).rejects.toThrow('不属于')
    await expect(
      engine.request({
        type: 'save',
        workspaceId: 'a',
        document: {
          id: doc.id,
          version: 1,
          kind: 'memory',
          title: doc.title,
          body: doc.body,
          sources: doc.sources,
        },
      }),
    ).rejects.toThrow('类型')
    await engine.request({
      type: 'deleteLibrary',
      workspaceId: 'a',
      id: one.id,
      version: one.version,
    })
    expect(store.read('a', doc.id)).toBeUndefined()
    expect(store.versions('a', doc.id)).toEqual([])
    expect(store.search('a', '认证').map((hit) => hit.title)).toEqual([
      '接口认证',
    ])
  })
  it('stores unbound libraries locally and rejects foreign or stale mutations', async () => {
    const { engine } = setup()
    const library = (
      await engine.request({
        type: 'saveLibrary',
        workspaceId: null,
        library: { name: '资料', description: '' },
      })
    ).library!
    expect(library.workspaceId).toBeNull()
    await engine.request({
      type: 'save',
      workspaceId: null,
      document: {
        kind: 'reference',
        libraryId: library.id,
        title: '资料',
        body: '正文',
        sources: [manual],
      },
    })
    await expect(
      engine.request({
        type: 'deleteLibrary',
        workspaceId: 'foreign',
        id: library.id,
        version: 1,
      }),
    ).rejects.toThrow('不属于')
    await engine.request({
      type: 'saveLibrary',
      workspaceId: null,
      library: { id: library.id, version: 1, name: '改名', description: '' },
    })
    await expect(
      engine.request({
        type: 'saveLibrary',
        workspaceId: null,
        library: {
          id: library.id,
          version: 1,
          name: '旧版本',
          description: '',
        },
      }),
    ).rejects.toThrow('已更新')
  })
  it('discards version 1 content, revisions, jobs, settings and indexes exactly once', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ling-knowledge-reset-'))
    clean.push(() => rm(dir, { recursive: true, force: true }))
    const path = join(dir, 'knowledge.sqlite')
    const old = new KnowledgeStore(path)
    old.put('old', {
      id: 'old',
      kind: 'memory',
      title: '旧数据',
      body: '旧正文',
      manual: true,
      sources: [manual],
      state: 'active',
    })
    old.enqueue('old', 'wiki', {}, 'old-job')
    old.setMeta('settings', { provider: 'old' })
    old.db.exec('PRAGMA user_version=1')
    old.close()
    const fresh = new KnowledgeStore(path)
    expect(fresh.list('old')).toEqual([])
    expect(fresh.jobs('old')).toEqual([])
    expect(fresh.versions('old', 'old')).toEqual([])
    expect(fresh.settings().provider).toBe('')
    expect(fresh.search('old', '正文')).toEqual([])
    fresh.put('new', {
      id: 'new',
      kind: 'memory',
      title: '新数据',
      body: '保留',
      manual: true,
      sources: [manual],
      state: 'active',
    })
    fresh.close()
    const reopened = new KnowledgeStore(path)
    expect(reopened.list('new')).toHaveLength(1)
    expect(reopened.db.prepare('PRAGMA user_version').get()?.user_version).toBe(
      2,
    )
    reopened.close()
  })
  it('rejects Wiki directory cycles and cross-project parents', async () => {
    const { engine, store } = setup()
    const create = async (title: string, parentId?: string) =>
      (
        await engine.request({
          type: 'save',
          workspaceId: 'project',
          document: {
            kind: 'wiki',
            title,
            body: '正文',
            parentId,
            sources: [manual],
          },
        })
      ).document!
    const parent = await create('入口'),
      child = await create('子系统', parent.id)
    await expect(
      engine.request({
        type: 'save',
        workspaceId: 'project',
        document: { ...parent, parentId: child.id },
      }),
    ).rejects.toThrow('循环')
    const proposal = store.generated('project', {
      id: parent.id,
      kind: 'wiki',
      title: parent.title,
      body: '生成的修改',
      parentId: child.id,
      state: 'active',
      sources: [manual],
    })
    await expect(
      engine.request({
        type: 'save',
        workspaceId: 'project',
        document: {
          id: proposal.id,
          version: proposal.version,
          kind: 'wiki',
          title: proposal.title,
          body: proposal.body,
          parentId: proposal.parentId,
          sources: proposal.sources,
          state: 'active',
        },
      }),
    ).rejects.toThrow('循环')
    expect(store.read('project', parent.id)?.parentId).toBeUndefined()
    await expect(create('错误', 'foreign')).rejects.toThrow('上级')
  })
})
describe('Wiki reading structure', () => {
  it('indexes on first generation, plans semantic pages, then writes ordered pages with cited evidence', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ling-wiki-plan-'))
    clean.push(() => rm(dir, { recursive: true, force: true }))
    await writeFile(
      join(dir, 'main.ts'),
      'export function start() { return 1 }',
    )
    const { engine, store, adapters } = setup(dir)
    store.setMeta('settings', {
      ...store.settings(),
      provider: 'test',
      model: 'test',
    })
    const prompts: string[] = []
    adapters.generate = async (_settings, prompt) => {
      prompts.push(prompt)
      return prompt.startsWith('Design')
        ? JSON.stringify({
            pages: [
              {
                key: 'overview',
                title: '项目概览',
                purpose: '解释入口',
                files: ['main.ts'],
              },
              {
                key: 'execution',
                title: '执行流程',
                parent: 'overview',
                purpose: '解释 start',
                files: ['main.ts'],
              },
            ],
          })
        : JSON.stringify({
            body: '## 入口\n[start](code:main.ts#L1)',
            cards: [
              {
                key: 'start',
                title: '程序入口',
                body: 'start 位于 [main.ts:1](code:main.ts#L1)',
              },
            ],
          })
    }
    const job = (await engine.request({ type: 'wiki', workspaceId: 'project' }))
      .job!
    expect((await wait(engine, job.id)).status).toBe('completed')
    const docs = store.list('project')
    expect(docs).toHaveLength(4)
    expect(docs.find((doc) => doc.title === '执行流程')).toMatchObject({
      parentId: 'wiki:project:overview',
      position: 1,
    })
    expect(docs.filter((doc) => doc.kind === 'card')).toHaveLength(2)
    expect(store.rules('project')).toEqual([])
    expect(store.fileCount('project')).toBe(1)
    expect(prompts).toHaveLength(3)
    expect(prompts[1]).toContain('1: export function start')
    expect(docs.every((doc) => doc.sources[0]?.path === 'main.ts')).toBe(true)
    const next = (
      await engine.request({ type: 'wiki', workspaceId: 'project' })
    ).job!
    expect((await wait(engine, next.id)).status).toBe('completed')
    expect(prompts).toHaveLength(3)
  })
  it('does not publish a plan that invents source paths', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ling-wiki-invalid-'))
    clean.push(() => rm(dir, { recursive: true, force: true }))
    await writeFile(join(dir, 'main.ts'), 'export const a=1')
    const { engine, store, adapters } = setup(dir)
    store.setMeta('settings', {
      ...store.settings(),
      provider: 'test',
      model: 'test',
    })
    adapters.generate = async () =>
      JSON.stringify({
        pages: [
          {
            key: 'overview',
            title: '概览',
            purpose: '错误',
            files: ['not-real.ts'],
          },
        ],
      })
    const job = (await engine.request({ type: 'wiki', workspaceId: 'project' }))
      .job!
    expect((await wait(engine, job.id)).status).toBe('failed')
    expect(store.list('project')).toEqual([])
  })
})
