import { Context } from '@deepseek-ai/cordis'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import TypertGatewayService from '@deepseek-ai/dsh-api-gateway'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LingReplyController, parseSuggestions } from '../src/host/reply-controller.ts'
import { createReplyFeaturesProjection } from '../src/client/reply-features-projection.ts'

const contexts: Context[] = []
afterEach(async () => { for (const ctx of contexts.splice(0)) await ctx.fiber.dispose() })
async function fixture() {
  const ctx = new Context(); contexts.push(ctx)
  const events = [
    {seq: 0, type: 'user/message', data: {source: {kind: 'user'}, content: [{type: 'text', text: '查找认证入口'}]}},
    {seq: 1, type: 'turn/start', data: {turn: 1}},
    {seq: 2, type: 'request/header', data: {header: {config: {provider: 'fixture', model: 'fixture-model'}}}},
    {seq: 3, type: 'assistant/message', data: {turn: 1, message: {role: 'assistant', content: [{type: 'text', text: '入口是 auth.ts。'}]}}},
    {seq: 4, type: 'turn/end', data: {turn: 1, reason: {kind: 'completed'}}},
  ]
  const stream = vi.fn(async function* (_options: unknown) {
    yield {type: 'text-delta', text: '["认证调用链是什么？","认证调用链是什么？","有哪些测试？"]'}
    yield {type: 'finish', reason: {kind: 'stop'}}
  })
  ctx.provide('sessionQuery', {readSession: async () => ({events})} as never)
  ctx.provide('llm', {stream} as never)
  await ctx.plugin(TypertRegistry); await ctx.plugin(TypertGatewayService)
  const controller = new LingReplyController(ctx)
  const invoke = (signal = new AbortController().signal) => ctx.typertGateway.invoke({namespace: 'lingReply', method: 'suggestions', args: {request: {taskId: 'test', seq: 3}}, signal})
  return {ctx, controller, events, stream, invoke}
}
describe('optional next-question suggestions', () => {
  it('uses the completed reply model in an isolated tool-free request through the Host gateway, and caches it', async () => {
    const {stream, invoke} = await fixture()
    expect(await invoke()).toEqual(['认证调用链是什么？', '有哪些测试？'])
    expect(await invoke()).toEqual(['认证调用链是什么？', '有哪些测试？'])
    expect(stream).toHaveBeenCalledOnce()
    const options = stream.mock.calls[0]![0] as {provider: string; model: string; messages: {content: {text: string}[]}[]; maxTokens: number; tools?: unknown}
    expect(options).toMatchObject({provider: 'fixture', model: 'fixture-model', maxTokens: 600})
    expect(options.tools).toBeUndefined()
    expect(options.messages).toHaveLength(1)
    expect(options.messages[0]!.content[0]!.text).toContain('入口是 auth.ts')
  })
  it('does not generate for failed, ongoing or superseded replies, including cached old replies', async () => {
    const {stream, invoke, events} = await fixture()
    events[4]!.data.reason = {kind: 'error'}
    expect(await invoke()).toEqual([]); expect(stream).not.toHaveBeenCalled()
    events[4]!.data.reason = {kind: 'completed'}
    await invoke()
    events.push({seq: 5, type: 'turn/start', data: {turn: 2}})
    expect(await invoke()).toEqual([]); expect(stream).toHaveBeenCalledOnce()
  })
  it('propagates cancellation to the model and does not cache failed generations', async () => {
    const {stream, controller} = await fixture()
    stream.mockImplementationOnce(async function* (options: unknown) {
      const signal = (options as {signal: AbortSignal}).signal
      await new Promise<void>((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), {once: true}))
      yield {type: 'finish', reason: {kind: 'stop'}}
    })
    const abort = new AbortController()
    const pending = controller.suggestions({taskId: 'test', seq: 3}, abort.signal)
    await vi.waitFor(() => expect(stream).toHaveBeenCalledOnce())
    abort.abort()
    await expect(pending).rejects.toThrow()
    expect(await controller.suggestions({taskId: 'test', seq: 3})).toHaveLength(2)
    expect(stream).toHaveBeenCalledTimes(2)
  })
  it('filters malformed or excessive suggestions without displaying prose as a suggestion', () => {
    expect(parseSuggestions('```json\n["a","a","b","c","d","多行\\n问题"]\n```')).toEqual(['a','b','c'])
    expect(() => parseSuggestions('This is not JSON')).toThrow()
    expect(() => parseSuggestions('["a", 4]')).toThrow()
  })
})
describe('declared file native opening', () => {
  it('uses durable session/seq/index coordinates and never accepts a renderer-supplied path', async () => {
    const fetcher = vi.fn(async () => new Response(null, {status: 204}))
    const service = createReplyFeaturesProjection(() => undefined, Promise.resolve(), fetcher)
    expect(await service.openFile('test & task', {seq: 4, index: 2, path: '/never-send-this'}, new AbortController().signal)).toMatchObject({ok: true})
    expect(fetcher.mock.calls[0]).toEqual(['/api/present.open?sessionId=test+%26+task&seq=4&index=2', expect.objectContaining({method: 'POST'})])
  })
  it.each([404, 409, 422, 500])('returns actionable errors for status %i', async status => {
    const service = createReplyFeaturesProjection(() => undefined, Promise.resolve(), async () => new Response(null, {status}))
    const result = await service.openFile('test', {seq: 1, index: 0, path: 'file'}, new AbortController().signal)
    expect(result).toMatchObject({ok: false, retryable: status >= 500})
    if (!result.ok) expect(result.message).not.toContain('HTTP')
  })
})
