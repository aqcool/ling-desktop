import * as cordis from '@deepseek-ai/cordis'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import TypertGatewayService from '@deepseek-ai/dsh-api-gateway'
import {
  LING_KNOWLEDGE_REMOTE,
  type LingKnowledgeRemote,
} from '../src/knowledge-contract.ts'
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LingKnowledgeController } from '../src/host/knowledge-controller.ts'
import type { Agent } from '@deepseek-ai/dsh-agent'
const disposers: (() => void | Promise<void>)[] = []
afterEach(async () => {
  for (const dispose of disposers.splice(0).reverse()) await dispose()
  vi.unstubAllEnvs()
})
async function fixture(gateway = false) {
  const home = await mkdtemp(join(tmpdir(), 'ling-knowledge-controller-'))
  disposers.push(() => rm(home, { recursive: true, force: true }))
  vi.stubEnv('DSH_HOME', home)
  const ctx = new Context()
  const events = [
    {
      seq: 0,
      time: 1,
      type: 'user/message',
      data: {
        content: [{ type: 'text', text: 'inherited private context' }],
        source: { kind: 'user' },
      },
    },
    {
      seq: 1,
      time: 2,
      type: 'turn/end',
      data: { turn: 0, reason: { kind: 'completed' } },
    },
    {
      seq: 2,
      time: 3,
      type: 'user/message',
      data: {
        content: [{ type: 'text', text: '请用 pnpm' }],
        source: { kind: 'user' },
      },
    },
    {
      seq: 3,
      time: 4,
      type: 'turn/end',
      data: {
        turn: 1,
        reason: { kind: 'error', error: { message: 'fetch failed' } },
      },
    },
  ]
  const bindings = new Map<string, { serverId: string; cwd: string }>([
    ['remote', { serverId: 'server-a', cwd: '/project' }],
  ])
  const generate = vi.fn(async function* (_options: {
    messages: { content: { text: string }[] }[]
  }) {
    yield {
      type: 'text-delta',
      index: 0,
      text: JSON.stringify({
        title: '总结',
        summary: '请求失败，尚未完成。',
        memories: [],
      }),
    }
    yield { type: 'finish', reason: { kind: 'stop' } }
  })
  ctx.provide('workspaceRegistry', {
    get: (id: string) =>
      id === 'a'
        ? { id, path: '/project', title: 'same' }
        : id === 'b'
          ? { id, path: '/other', title: 'same' }
          : undefined,
    list: () => [
      { id: 'a', path: '/project', title: 'same' },
      { id: 'b', path: '/other', title: 'same' },
    ],
  } as never)
  ctx.provide('sessionQuery', {
    readSession: async (id: string) => ({
      session: { id, cwd: id === 'other' ? '/other' : '/project' },
      inheritedEventCount: 2,
      events,
    }),
    readTitleSnapshots: async () => [],
    readEvent: async ({
      sessionId,
      seq,
    }: {
      sessionId: string
      seq: number
    }) => ({
      session: {
        id: sessionId,
        cwd: sessionId === 'other' ? '/other' : '/project',
      },
      target: events[seq],
    }),
    filterSessions: async () => [],
    listSessions: async () => [],
  } as never)
  ctx.provide('lingServers', {
    taskBinding: async (id: string) => bindings.get(id) ?? null,
  } as never)
  ctx.provide('llm', { stream: generate } as never)
  if (gateway) {
    await ctx.plugin(TypertRegistry)
    await ctx.plugin(TypertGatewayService)
  } else ctx.provide('typert', { register: () => () => {} } as never)
  const controller = new LingKnowledgeController(ctx)
  disposers.push(() => controller.engine.close())
  return { controller, generate, bindings, ctx }
}
describe('knowledge host scope and session evidence', () => {
  it('enforces Wiki reference settings on the actual Agent tools while leaving user reading available', async () => {
    const { controller } = await fixture()
    const document = (
      await controller.request({
        type: 'save',
        workspaceId: 'a',
        document: {
          kind: 'card',
          title: '认证事实',
          body: '认证约定',
          sources: [{ kind: 'manual', label: '测试' }],
        },
      })
    ).document!
    type Tool = {
      name: string
      execute(
        args: Record<string, string>,
        context: { signal: AbortSignal },
      ): Promise<string>
    }
    const tools = new Map<string, Tool>()
    const agent = {
      id: 'agent',
      session: { id: 'agent', header: { cwd: '/project' } },
      ctx: {
        tools: {
          register: (tool: Tool) => {
            tools.set(tool.name, tool)
            return () => {
              tools.delete(tool.name)
            }
          },
        },
        systemPrompt: { context: () => () => {} },
      },
    } as unknown as Agent
    await (
      controller as unknown as { install(agent: Agent): Promise<void> }
    ).install(agent)
    const exec = { signal: new AbortController().signal }
    const search = tools.get('knowledge_search')!,
      read = tools.get('knowledge_read')!
    expect(
      JSON.parse(await search.execute({ query: '认证' }, exec)).hits.map(
        (hit: { id: string }) => hit.id,
      ),
    ).toContain(document.id)
    await controller.request({
      type: 'wikiOptions',
      workspaceId: 'a',
      options: { language: 'zh-CN', autoUpdate: false, agentReference: false },
    })
    expect(
      JSON.parse(await search.execute({ query: '认证' }, exec)).hits,
    ).toEqual([])
    await expect(read.execute({ id: document.id }, exec)).rejects.toThrow(
      '引用已关闭',
    )
    expect(
      (
        await controller.request({
          type: 'read',
          workspaceId: 'a',
          id: document.id,
        })
      ).document?.id,
    ).toBe(document.id)
  })
  it('round trips validated content through the published browser Remote and Host Gateway', async () => {
    const { controller, ctx: host, generate } = await fixture(true),
      client = new Context()
    disposers.push(async () => {
      await client.fiber.dispose()
      await host.fiber.dispose()
    })
    await client.plugin(TypertRegistry)
    client.provide('connection', {
      rpc: {
        call: async (
          _base: string,
          endpoint: string,
          payload: { args: Record<string, unknown> },
          signal: AbortSignal,
        ) => {
          const [namespace, method] = endpoint.split('/')
          return {
            ok: true,
            value: await host.typertGateway.invoke({
              namespace: namespace!,
              method: method!,
              args: payload.args,
              signal,
            }),
          }
        },
      },
      registerGenerationSource: () => () => {},
      start: () => ({ stop() {} }),
    } as never)
    const source = await readFile(
      createRequire(import.meta.url).resolve(
        '@deepseek-ai/dsh-api-gateway/client',
      ),
      'utf8',
    )
    let browser: { apply(ctx: Context): void; inject: string[] } | undefined
    new Function('window', source)({
      __ModuleLoader__: {
        load: ({
          factory,
        }: {
          factory(require: (id: string) => unknown): unknown
        }) => {
          browser = factory(() => cordis) as typeof browser
        },
      },
    })
    await client.plugin(browser!)
    await client.remote.$mount(LING_KNOWLEDGE_REMOTE)
    const remote = client.get(
      'remote.lingKnowledge',
    ) as unknown as LingKnowledgeRemote
    const saved = await remote.request({
      type: 'save',
      workspaceId: 'a',
      document: {
        kind: 'memory',
        title: '来自 UI',
        body: '事实',
        sources: [{ kind: 'manual', label: '用户记录' }],
      },
    })
    expect(saved).toMatchObject({
      ok: true,
      value: { document: { title: '来自 UI', version: 1 } },
    })
    const snapshot = await remote.request({
      type: 'snapshot',
      workspaceId: 'a',
    })
    expect(snapshot).toMatchObject({
      ok: true,
      value: {
        snapshot: { indexedFiles: 0, documents: [{ title: '来自 UI' }] },
      },
    })
    const library = await remote.request({
      type: 'saveLibrary',
      workspaceId: 'a',
      library: { name: '接口资料', description: '本机资料库' },
    })
    expect(library).toMatchObject({
      ok: true,
      value: { library: { name: '接口资料', documents: 0 } },
    })
    const libraryId = library.ok ? library.value.library!.id : 'missing'
    const reference = await remote.request({
      type: 'save',
      workspaceId: 'a',
      document: {
        kind: 'reference',
        libraryId,
        title: '认证约定',
        body: '令牌认证',
        sources: [{ kind: 'manual', label: '资料' }],
      },
    })
    expect(reference).toMatchObject({
      ok: true,
      value: { document: { kind: 'reference', libraryId } },
    })
    expect(
      await remote.request({
        type: 'search',
        workspaceId: 'a',
        query: '认证',
        libraryId,
      }),
    ).toMatchObject({ ok: true, value: { hits: [{ title: '认证约定' }] } })
    expect(
      await remote.request({ type: 'export', workspaceId: 'a', libraryId }),
    ).toMatchObject({
      ok: true,
      value: { text: expect.stringContaining('认证约定') },
    })
    expect(
      await remote.request({ type: 'catalog', workspaceId: null }),
    ).toMatchObject({
      ok: true,
      value: { libraries: [{ name: '接口资料', documents: 1 }] },
    })
    const shared = await remote.request({
      type: 'saveLibrary',
      workspaceId: null,
      library: {
        name: '共享手册',
        description: '',
        access: 'selected',
        bindings: [{ workspaceId: 'a' }, { workspaceId: 'b' }],
      },
    })
    expect(shared).toMatchObject({
      ok: true,
      value: {
        library: {
          access: 'selected',
          bindings: [{ workspaceId: 'a' }, { workspaceId: 'b' }],
        },
      },
    })
    const sharedId = shared.ok ? shared.value.library!.id : 'missing'
    const sharedDoc = await remote.request({
      type: 'save',
      workspaceId: null,
      libraryId: sharedId,
      document: {
        kind: 'reference',
        libraryId: sharedId,
        title: '共享约定',
        body: '共享认证',
        sources: [{ kind: 'manual', label: '资料' }],
      },
    })
    const sharedDocId = sharedDoc.ok ? sharedDoc.value.document!.id : 'missing'
    expect(
      await remote.request({ type: 'read', workspaceId: 'b', id: sharedDocId }),
    ).toMatchObject({ ok: true, value: { document: { title: '共享约定' } } })
    expect(
      await remote.request({
        type: 'wikiOptions',
        workspaceId: 'a',
        options: { language: 'en', autoUpdate: false, agentReference: false },
      }),
    ).toMatchObject({ ok: true })
    expect(
      await remote.request({ type: 'snapshot', workspaceId: 'a' }),
    ).toMatchObject({
      ok: true,
      value: {
        snapshot: { wikiOptions: { language: 'en', agentReference: false } },
      },
    })
    expect(generate).not.toHaveBeenCalled()
    const unrelated = await remote.request({
      type: 'read',
      workspaceId: 'b',
      id: saved.ok ? saved.value.document!.id : 'missing',
    })
    expect(unrelated.ok).toBe(false)
    expect(
      controller.engine.store.list(
        snapshot.ok ? snapshot.value.snapshot!.documents[0]!.scope : '',
      ),
    ).toHaveLength(2)
  })
  it('uses canonical ids and paths, never workspace display titles as identity', async () => {
    const { controller } = await fixture()
    const added = await controller.request({
      type: 'save',
      workspaceId: 'a',
      document: {
        kind: 'memory',
        title: 'rule',
        body: 'local',
        sources: [{ kind: 'manual', label: 'user' }],
      },
    })
    await expect(
      controller.request({
        type: 'read',
        workspaceId: 'b',
        id: added.document!.id,
      }),
    ).rejects.toThrow('不属于')
    await expect(
      controller.request({
        type: 'source',
        workspaceId: 'a',
        source: { kind: 'session', label: 'other', sessionId: 'other', seq: 2 },
      }),
    ).rejects.toThrow('不属于')
    await expect(
      controller.request({ type: 'snapshot', workspaceId: 'missing' }),
    ).rejects.toThrow('不存在')
  })
  it('isolates remote sessions from identical-looking local paths and other servers', async () => {
    const { controller, bindings } = await fixture()
    await expect(
      controller.request({
        type: 'source',
        workspaceId: 'a',
        source: {
          kind: 'session',
          label: 'remote',
          sessionId: 'remote',
          seq: 2,
        },
      }),
    ).rejects.toThrow('不属于')
    const remote = await controller.request({
      type: 'save',
      workspaceId: null,
      taskId: 'remote',
      document: {
        kind: 'memory',
        title: 'remote',
        body: 'server fact',
        sources: [
          { kind: 'session', label: 'remote', sessionId: 'remote', seq: 2 },
        ],
      },
    })
    await expect(
      controller.request({
        type: 'read',
        workspaceId: 'a',
        id: remote.document!.id,
      }),
    ).rejects.toThrow('不属于')
    bindings.set('remote-b', { serverId: 'server-b', cwd: '/project' })
    await expect(
      controller.request({
        type: 'read',
        workspaceId: null,
        taskId: 'remote-b',
        id: remote.document!.id,
      }),
    ).rejects.toThrow('不属于')
    await expect(
      controller.request({
        type: 'source',
        workspaceId: null,
        taskId: 'remote',
        source: { kind: 'session', label: 'local', sessionId: 'local', seq: 2 },
      }),
    ).rejects.toThrow('不属于')
  })
  it('summarizes only owned complete events and preserves failure outcome without creating an agent', async () => {
    const { controller, generate } = await fixture()
    const settings = controller.engine.store.settings()
    await controller.request({
      type: 'settings',
      workspaceId: null,
      settings: { ...settings, provider: 'test', model: 'test' },
    })
    const queued = await controller.request({
      type: 'summarize',
      workspaceId: 'a',
      sessionId: 'fork',
    })
    for (let i = 0; i < 100; i++) {
      const job = controller.engine.store.job(queued.job!.scope, queued.job!.id)
      if (job?.status === 'completed' || job?.status === 'failed') break
      await new Promise((done) => setTimeout(done, 5))
    }
    expect(
      controller.engine.store.job(queued.job!.scope, queued.job!.id)?.status,
    ).toBe('completed')
    expect(generate).toHaveBeenCalledOnce()
    const options = generate.mock.calls[0]?.[0] as unknown as {
      messages: { content: { text: string }[] }[]
    }
    expect(options.messages[0]?.content[0]?.text).toContain('outcome=error')
    expect(options.messages[0]?.content[0]?.text).not.toContain(
      'inherited private context',
    )
    expect(
      controller.engine.store
        .list(queued.job!.scope)[0]
        ?.sources.map((source) => source.seq),
    ).toEqual([2, 3])
  })
})
