import { describe, expect, it, vi } from 'vitest'
import { createDshSubagentProjection } from '../src/client/subagent-projection.js'

const answer = <Value>(value: Value) => ({ ok: true as const, value })

interface FixtureOptions {
  readonly promptResult?: () => Promise<unknown>
  readonly interruptResult?: () => Promise<unknown>
}

function remoteFixture(options: FixtureOptions = {}) {
  const prompt = vi.fn(options.promptResult ?? (async () => answer({ messageId: 'message-1' })))
  const interruptByParent = vi.fn(options.interruptResult ?? (async () => answer({ accepted: true })))
  const remote = { subagents: { prompt, interruptByParent } }
  return {
    projection: createDshSubagentProjection(remote as never),
    interruptByParent,
    prompt,
  }
}

describe('DSH subagent projection', () => {
  it('queues a continuable text prompt from the parent session', async () => {
    const { projection, prompt } = remoteFixture()

    await expect(projection.prompt('session-1', 'session-2', '  补充测试要点  ')).resolves.toEqual({
      ok: true,
      value: undefined,
    })
    expect(prompt).toHaveBeenCalledWith(expect.objectContaining({
      requestId: expect.any(String),
      parentSessionId: 'session-1',
      childSessionId: 'session-2',
      mode: 'continuable',
      delivery: 'queue',
      content: [{ type: 'text', text: '补充测试要点' }],
    }))
  })

  it('refuses an empty prompt before reaching the remote', async () => {
    const { projection, prompt } = remoteFixture()

    await expect(projection.prompt('session-1', 'session-2', '   ')).resolves.toEqual({
      ok: false,
      reason: 'invalid-command',
      message: '请输入要追加的指令。',
      retryable: false,
    })
    expect(prompt).not.toHaveBeenCalled()
  })

  it('keeps a remote prompt rejection with its reason', async () => {
    const { projection } = remoteFixture({
      promptResult: async () => ({
        ok: false as const,
        error: { code: 'session/not-resumable', message: '该子任务不支持追加指令。' },
      }),
    })

    await expect(projection.prompt('session-1', 'session-2', '继续')).resolves.toEqual({
      ok: false,
      reason: 'invalid-command',
      message: '该子任务不支持追加指令。',
      retryable: false,
    })
  })

  it('turns a thrown prompt failure into a retryable rejection', async () => {
    const { projection } = remoteFixture({
      promptResult: async () => { throw new Error('offline') },
    })

    await expect(projection.prompt('session-1', 'session-2', '继续')).resolves.toEqual({
      ok: false,
      reason: 'runtime-unavailable',
      message: '追加指令暂时无法发送。',
      retryable: true,
    })
  })

  it('interrupts one continuable subagent on behalf of its parent', async () => {
    const { interruptByParent, projection } = remoteFixture()

    await expect(projection.interrupt('session-1', 'session-2')).resolves.toEqual({
      ok: true,
      value: undefined,
    })
    expect(interruptByParent).toHaveBeenCalledWith('session-2', 'session-1', 'continuable')
  })

  it('keeps a remote interrupt rejection with its reason', async () => {
    const { projection } = remoteFixture({
      interruptResult: async () => ({
        ok: false as const,
        error: { code: 'session/not-found', message: '子任务不存在。' },
      }),
    })

    await expect(projection.interrupt('session-1', 'session-9')).resolves.toEqual({
      ok: false,
      reason: 'task-not-found',
      message: '子任务不存在。',
      retryable: false,
    })
  })

  it('turns a thrown interrupt failure into a retryable rejection', async () => {
    const { projection } = remoteFixture({
      interruptResult: async () => { throw new Error('offline') },
    })

    await expect(projection.interrupt('session-1', 'session-2')).resolves.toEqual({
      ok: false,
      reason: 'runtime-unavailable',
      message: '中断子任务暂时不可用。',
      retryable: true,
    })
  })
})
