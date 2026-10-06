import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import TypertGatewayService from '@deepseek-ai/dsh-api-gateway'
import { SessionController, type SessionPromptRequest, type SessionRequestId } from '@deepseek-ai/dsh-api-session-controller'
import LlmRuntime, { LlmAdapter, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LingSessionController } from '../src/session-controller.ts'
import { LingSessionLifecycle } from '../src/session-lifecycle.ts'

const contexts: Context[] = []
const directories: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose()
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true })
})

async function fixture() {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(LingSessionLifecycle, { agents: [] })
  await ctx.plugin(TypertRegistry)
  await ctx.plugin(TypertGatewayService)
  // No disk, credentials, model calls or user workspaces participate in dispatch tests.
  ctx.provide('agentDefaultModel', { currentSelection: () => ({ provider: 'fixture', model: 'fixture' }) } as never)
  ctx.provide('attachments', { admitPromptContent: async (content: unknown[]) => content } as never)
  ctx.provide('fileUploads', {
    registerAgentResolver: () => () => {},
    bindPrompt: () => ({ commit() {}, [Symbol.dispose]() {} }),
  } as never)
  ctx.provide('sessionQuery', {} as never)
  ctx.provide('workspaceRegistry', { list: () => [], get: () => undefined } as never)
  await ctx.plugin(LingSessionController, { nativeOpen: false })
  return ctx
}

const sessionId = SessionId('isolated-gateway-session')
const mutations = ['create', 'prompt', 'rename', 'fork', 'selectModel', 'updateQueue'] as const
class FixtureModel extends LlmAdapter {
  readonly requests: GenerateOptions[] = []
  constructor(private readonly holdFirst?: Promise<void>) { super() }
  async resolveModel(provider: string, model: string) { return { provider, id: model, name: model } }
  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    if (this.requests.length === 1) await this.holdFirst
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: 'isolated reply' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'isolated reply' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}
describe('LING session controller through the published SRC gateway', () => {
  it.each(['queue', 'steer', 'promote'] as const)('admits %s input while the real Agent is generating', async delivery => {
    const ctx = await fixture()
    let release!: () => void
    const model = new FixtureModel(new Promise<void>(resolve => { release = resolve }))
    ctx.llm.registerAdapter(['fixture'], model)
    const cwd = await mkdtemp(join(tmpdir(), 'ling-running-send-')); directories.push(cwd)
    const created = await ctx.typertGateway.invoke({ namespace: 'session', method: 'create', args: { request: { cwd } } }) as { sessionId: SessionId }
    const prompt = (requestId: string, text: string, mode: 'queue' | 'steer') => ctx.typertGateway.invoke({ namespace: 'session', method: 'prompt', args: { request: {
      sessionId: created.sessionId, requestId, mode, content: [{ type: 'text', text }],
    } } })
    const agent = ctx.agents.get(created.sessionId)!
    try {
      await prompt('initial', 'initial work', 'queue')
      await vi.waitFor(() => expect(model.requests).toHaveLength(1))
      const mode = delivery === 'steer' ? 'steer' : 'queue'
      await expect(prompt('during-run', 'followup while running', mode)).resolves.toEqual({ accepted: true })
      expect(agent.status).toBe('running')
      const pending = mode === 'steer' ? agent.inbox.nextStep : agent.inbox.nextTurn
      expect(pending).toHaveLength(1)
      await prompt('during-run', 'followup while running', mode)
      expect(pending).toHaveLength(1)
      if (delivery === 'promote') {
        await expect(ctx.typertGateway.invoke({ namespace: 'session', method: 'updateQueue', args: { request: {
          sessionId: created.sessionId, itemId: pending[0]!.id, action: { kind: 'steer' },
        } } })).resolves.toEqual({ accepted: true })
        expect(agent.inbox.nextTurn).toHaveLength(0)
        expect(agent.inbox.nextStep).toHaveLength(1)
      }
      release()
      await agent.whenIdle()
      expect(model.requests).toHaveLength(2)
      expect(JSON.stringify(model.requests[1]?.messages)).toContain('followup while running')
      expect(agent.session.snapshotEvents().filter(event => event.type === 'user/message')).toHaveLength(2)
      expect(agent.inbox.nextTurn.length + agent.inbox.nextStep.length).toBe(0)
    } finally { release(); await agent.whenIdle() }
  })
  it('creates and sends through the real upstream controller and Agent loop using an isolated model', async () => {
    const ctx = await fixture()
    const model = new FixtureModel()
    ctx.llm.registerAdapter(['fixture'], model)
    const cwd = await mkdtemp(join(tmpdir(), 'ling-session-gateway-'))
    directories.push(cwd)
    const created = await ctx.typertGateway.invoke({ namespace: 'session', method: 'create', args: { request: { cwd } } }) as { sessionId: SessionId }
    const request: SessionPromptRequest = { sessionId: created.sessionId, requestId: 'isolated-send' as SessionRequestId, mode: 'queue', content: [{ type: 'text', text: 'isolated question' }] }
    await expect(ctx.typertGateway.invoke({ namespace: 'session', method: 'prompt', args: { request } })).resolves.toEqual({ accepted: true })
    const agent = ctx.agents.get(created.sessionId)!
    await agent.whenIdle()
    expect(model.requests).toHaveLength(1)
    expect(JSON.stringify(model.requests[0]?.messages)).toContain('isolated question')
    const events = agent.session.snapshotEvents()
    expect(events.filter(event => event.type === 'user/message')).toHaveLength(1)
    expect(JSON.stringify(events.filter(event => event.type === 'assistant/message'))).toContain('isolated reply')
    // Retrying the same transport request does not send another turn.
    await expect(ctx.typertGateway.invoke({ namespace: 'session', method: 'prompt', args: { request } })).resolves.toEqual({ accepted: true })
    expect(model.requests).toHaveLength(1)
    expect(agent.session.snapshotEvents().filter(event => event.type === 'user/message')).toHaveLength(1)
  })

  it.each(mutations)('dispatches %s with the upstream request field and retains the deletion reservation', async method => {
    const ctx = await fixture()
    const result = { accepted: true }
    const base = vi.spyOn(SessionController.prototype, method).mockResolvedValue(result as never)
    const guard = vi.spyOn(ctx.lingSessionLifecycle, 'withSessionOperation')
    const request = { sessionId }
    const signal = new AbortController().signal
    await expect(ctx.typertGateway.invoke({ namespace: 'session', method, args: { request }, signal })).resolves.toEqual(result)
    expect(base.mock.calls).toEqual([method === 'prompt' ? [request, signal] : [request]])
    expect(guard).toHaveBeenCalledWith(sessionId, expect.any(Function))
    expect(ctx.typert.local.get(`session/${method}`)).toBeUndefined()
  })

  it('supports creation without a client-supplied identity', async () => {
    const ctx = await fixture()
    const base = vi.spyOn(SessionController.prototype, 'create').mockResolvedValue({ sessionId })
    const guard = vi.spyOn(ctx.lingSessionLifecycle, 'withSessionOperation')
    await expect(ctx.typertGateway.invoke({ namespace: 'session', method: 'create', args: { request: {} } })).resolves.toEqual({ sessionId })
    expect(base).toHaveBeenCalledWith({})
    expect(guard).not.toHaveBeenCalled()
  })

  it('supplies the upstream prompt cancellation signal without requiring it on the wire', async () => {
    const ctx = await fixture()
    // Exercise the real upstream method: empty content is rejected before Agent activation.
    const request: SessionPromptRequest = { sessionId, requestId: 'isolated-prompt' as SessionRequestId, mode: 'queue', content: [] }
    await expect(ctx.typertGateway.invoke({ namespace: 'session', method: 'prompt', args: { request } })).rejects.toThrow('prompt content')
    const aborted = new AbortController()
    aborted.abort(new Error('isolated cancellation'))
    await expect(ctx.sessionController.prompt(request, aborted.signal)).rejects.toThrow('isolated cancellation')
    await expect(ctx.typertGateway.invoke({ namespace: 'session', method: 'prompt', args: { request }, signal: aborted.signal })).rejects.toMatchObject({ code: 'gateway/cancelled' })
    await expect(ctx.typertGateway.invoke({ namespace: 'session', method: 'prompt', args: { request, signal: {} } })).rejects.toMatchObject({ code: 'gateway/arguments-invalid' })
    await expect(ctx.lingSessionLifecycle.deletingSession(sessionId, async () => true)).resolves.toBe(true)
  })

  it('blocks mutations while deletion holds the identity and deletion while a prompt is pending', async () => {
    const ctx = await fixture()
    const base = vi.spyOn(SessionController.prototype, 'prompt').mockResolvedValue({ accepted: true })
    await ctx.lingSessionLifecycle.deletingSession(sessionId, async () => {
      await expect(ctx.typertGateway.invoke({ namespace: 'session', method: 'prompt', args: { request: { sessionId } } })).rejects.toThrow('会话正在删除')
    })
    expect(base).not.toHaveBeenCalled()
    let finish!: () => void
    base.mockImplementation(() => new Promise(resolve => { finish = () => resolve({ accepted: true }) }))
    const prompt = ctx.typertGateway.invoke({ namespace: 'session', method: 'prompt', args: { request: { sessionId } } })
    await vi.waitFor(() => expect(base).toHaveBeenCalledOnce())
    await expect(ctx.lingSessionLifecycle.deletingSession(sessionId, async () => true)).rejects.toThrow('其他操作')
    finish()
    await expect(prompt).resolves.toEqual({ accepted: true })
    await expect(ctx.lingSessionLifecycle.deletingSession(sessionId, async () => true)).resolves.toBe(true)
  })

  it('keeps host-only agent resolution behind the same deletion reservation', async () => {
    const ctx = await fixture()
    const guard = vi.spyOn(ctx.lingSessionLifecycle, 'withSessionOperation')
    const result = { error: new RemoteError('session/not-found', 'isolated missing session', { sessionId }) }
    const base = vi.spyOn(SessionController.prototype, 'resolveAgent').mockResolvedValue(result)
    await expect(ctx.sessionController.resolveAgent(sessionId)).resolves.toBe(result)
    expect(base).toHaveBeenCalledWith(sessionId)
    expect(guard).toHaveBeenCalledWith(sessionId, expect.any(Function))
  })
})
