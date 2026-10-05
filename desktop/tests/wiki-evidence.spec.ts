import { afterEach, describe, expect, it } from 'vitest'
import { KnowledgeEngine, type KnowledgeAdapters } from '../src/knowledge/engine.ts'
import { KnowledgeStore, type IndexedFile } from '../src/knowledge/store.ts'
import { wikiEvidence, wikiInventory } from '../src/knowledge/wiki-evidence.ts'
import { sha256 } from '../src/knowledge/code-index.ts'

function file(path: string, body = 'export const value = 1'): IndexedFile {
  return { path, body, hash: sha256(body), imports: [], edges: [], nodes: [{ id: `file:${path}`, kind: 'file', label: path, source: { kind: 'code', path, label: path, line: 1, hash: sha256(body) } }] }
}
const stores: KnowledgeStore[] = []
afterEach(() => { for (const store of stores.splice(0)) store.close() })

describe('bounded Wiki evidence', () => {
  it('samples large inventories across modules and retains complete real paths', () => {
    const files = Array.from({ length: 3000 }, (_, n) => file(`src/module-${n % 40}/feature-${n}.ts`))
    files.push(file('README.md'), file('package.json'), file('src/last-module/main.ts'))
    const input = wikiInventory(files), inventory = JSON.parse(input)
    expect(input.length).toBeLessThan(64000)
    expect(inventory.totalFiles).toBe(3003)
    expect(inventory.sampled).toBe(true)
    expect(inventory.files.some((entry: { path: string }) => entry.path === 'README.md')).toBe(true)
    expect(inventory.files.some((entry: { path: string }) => entry.path === 'src/last-module/main.ts')).toBe(true)
    expect(new Set(inventory.files.map((entry: { path: string }) => entry.path.split('/')[1])).size).toBeGreaterThan(40)
    expect(inventory.files.every((entry: { path: string }) => files.some(file => file.path === entry.path))).toBe(true)
  })

  it('keeps original line numbers and makes omitted or truncated content explicit', () => {
    const body = Array.from({ length: 5000 }, (_, n) => `const line${n + 1} = '${'x'.repeat(90)}'`).join('\n')
    const long = file('src/long.ts', body)
    long.nodes.push({ id: 'symbol:important', kind: 'symbol', label: 'important', source: { ...long.nodes[0]!.source!, line: 2500 } })
    const text = wikiEvidence([long, file('settings.json', JSON.stringify({ value: 'x'.repeat(150000) }))])
    const evidence = JSON.parse(text)
    expect(text.length).toBeLessThan(64000)
    expect(evidence[0].text).toContain("2500: const line2500")
    expect(evidence[0].excerpted).toBe(true)
    expect(evidence[0].totalLines).toBe(5000)
    expect(evidence[1].text).toContain('1: {')
    expect(evidence[1].text).toContain('此行已截断')
    expect(evidence[1].excerpted).toBe(true)
  })

  it('generates from a large project, persists progress and refreshes sources before updating', async () => {
    const store = new KnowledgeStore(':memory:'); stores.push(store)
    store.setMeta('settings', { ...store.settings(), provider: 'test', model: 'test' })
    const files = Array.from({ length: 1600 }, (_, n) => file(`src/module-${n % 30}/feature-${n}.ts`))
    files.push(file('main.ts', Array.from({ length: 4000 }, (_, n) => `export const feature${n} = '${'x'.repeat(70)}'`).join('\n')))
    let reads = 0
    const observed: string[] = [], prompts: string[] = []
    const adapters: KnowledgeAdapters = {
      scope: async workspaceId => ({ id: 'large', workspaceId, root: '/isolated-fixture', label: '大型测试项目' }),
      index: async () => { reads++; return files },
      source: async () => ({ text: '', stale: false }), history: async () => [],
      session: async () => { throw Error('unused') },
      generate: async (_settings, prompt) => {
        prompts.push(prompt)
        observed.push(store.jobs('large')[0]!.message ?? '')
        return prompt.startsWith('Design') ? JSON.stringify({ pages: [{ key: 'overview', title: '项目概览', purpose: '入口', files: ['main.ts'] }] }) : JSON.stringify({ body: '## 入口\n[main](code:main.ts#L1)', cards: [{ key: 'entry', title: '入口', body: '[main.ts:1](code:main.ts#L1)' }] })
      },
    }
    const engine = new KnowledgeEngine(store, adapters)
    const run = async () => {
      const job = (await engine.request({ type: 'wiki', workspaceId: 'large' })).job!
      for (let n = 0; n < 200; n++) {
        const current = store.job('large', job.id)!
        if (current.status !== 'queued' && current.status !== 'running') return current
        await new Promise(done => setTimeout(done, 5))
      }
      throw Error('timeout')
    }
    expect(await run()).toMatchObject({ status: 'completed', message: '完成 · 1 个页面 · 1 张知识卡片' })
    expect(observed).toEqual(['正在规划目录 · 已索引 1601 个文件', '正在生成 1/1 · 项目概览'])
    expect(prompts.every(prompt => prompt.length < 68000)).toBe(true)
    expect(store.list('large')).toHaveLength(2)
    expect((await run()).status).toBe('completed')
    expect(reads).toBe(2)
    expect(prompts).toHaveLength(2)
    files[files.length - 1] = file('main.ts', 'export const changed = true')
    expect((await run()).status).toBe('completed')
    expect(prompts).toHaveLength(4)
    expect(store.read('large', 'wiki:large:overview')?.version).toBeGreaterThan(1)
    expect(store.read('large', 'wiki:large:overview')?.sources[0]?.hash).toBe(sha256('export const changed = true'))
  })
})
