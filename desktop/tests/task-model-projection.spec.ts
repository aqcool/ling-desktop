import { describe, expect, it, vi } from 'vitest'
import { createDshTaskModelProjection } from '../src/client/task-model-projection.js'

function fixture(modelSelection: unknown) {
  const selectModel = vi.fn(async () => ({ ok: true as const, value: { selected: true } }))
  const face = {
    getSnapshot: vi.fn(() => modelSelection),
    subscribe: vi.fn(() => () => {}),
  }
  const remote = { session: { selectModel } }
  const subagentAddress = vi.fn(() => undefined)
  const sessions = { subagentAddress }
  const binding = { session: { projections: { faceOf: vi.fn(() => face) } } }
  return {
    projection: createDshTaskModelProjection(remote as never, sessions as never),
    binding,
    face,
    selectModel,
    subagentAddress,
  }
}

describe('DSH task model projection', () => {
  it('does not send an unsupported effort to the session wire API', async () => {
    const selectModel = vi.fn()
    const projection = createDshTaskModelProjection(
      { session: { selectModel } } as never, {} as never,
      async () => ({ ok: false, reason: 'invalid-command', message: 'unsupported effort', retryable: false }),
    )
    await expect(projection.select('session-1', { provider: 'p', model: 'm', reasoningEffort: 'max' })).resolves.toMatchObject({ ok: false })
    expect(selectModel).not.toHaveBeenCalled()
  })

  it('selects through the session wire face with the given selection', async () => {
    const { projection, selectModel } = fixture(undefined)

    await expect(projection.select('session-1', {
      provider: 'openai',
      model: 'gpt-5',
      reasoningEffort: 'high',
    })).resolves.toEqual({ ok: true, value: undefined })
    expect(selectModel).toHaveBeenCalledWith({
      sessionId: 'session-1',
      provider: 'openai',
      model: 'gpt-5',
      reasoningEffort: 'high',
    })
  })

  it('rejects with a mapped reason when the host refuses the selection', async () => {
    const { projection } = fixture(undefined)
    const refused = createDshTaskModelProjection(
      { session: { selectModel: async () => ({ ok: false as const, error: { code: 'session-not-found' } }) } } as never,
      { subagentAddress: () => undefined } as never,
    )

    await expect(refused.select('missing', { provider: 'p', model: 'm' })).resolves.toEqual({
      ok: false,
      reason: 'task-not-found',
      message: '操作未能完成。',
      retryable: false,
    })
    expect(projection.canSelect('session-1')).toBe(true)
  })

  it('blocks selection for subagent sessions', () => {
    const remote = { session: { selectModel: vi.fn() } }
    const projection = createDshTaskModelProjection(remote as never, {
      subagentAddress: (id: string) => id === 'sub-1' ? { taskId: 'parent' } : undefined,
    } as never)

    expect(projection.canSelect('sub-1')).toBe(false)
    expect(projection.canSelect('session-1')).toBe(true)
  })

  it('watches the durable projection and prefers the pending selection', () => {
    const { projection, binding, face } = fixture({
      lastUsed: { provider: 'a', model: 'one' },
      next: { provider: 'b', model: 'two', reasoningEffort: 'low' },
    })

    expect(projection.watch(binding as never).getSnapshot()).toEqual({
      provider: 'b',
      model: 'two',
      reasoningEffort: 'low',
    })
    expect(binding.session.projections.faceOf).toHaveBeenCalledWith('modelSelection')

    const unsubscribe = projection.watch(binding as never).subscribe(() => {})
    face.subscribe.mockReturnValue(unsubscribe)
    expect(face.subscribe).toHaveBeenCalledTimes(1)
  })

  it('falls back to the last used selection and reports nothing when unselected', () => {
    const withLastUsed = fixture({ lastUsed: { provider: 'a', model: 'one' } })
    expect(withLastUsed.projection.watch(withLastUsed.binding as never).getSnapshot()).toEqual({
      provider: 'a',
      model: 'one',
    })

    const empty = fixture(null)
    expect(empty.projection.watch(empty.binding as never).getSnapshot()).toBeUndefined()
  })
})
