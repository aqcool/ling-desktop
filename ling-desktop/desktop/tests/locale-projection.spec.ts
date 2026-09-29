import { describe, expect, it, vi } from 'vitest'
import { createDshLocaleProjection } from '../src/client/locale-projection.js'

const answer = <Value>(value: Value) => ({ ok: true as const, value })

interface FixtureOptions {
  readonly writable?: boolean
  readonly withNamespace?: boolean
  readonly value?: unknown
  readonly mutateResult?: () => Promise<unknown>
  readonly describeResult?: () => Promise<unknown>
}

function remoteFixture(options: FixtureOptions = {}) {
  const describe = vi.fn(options.describeResult ?? (async () => answer({
    writable: options.writable ?? true,
    hasDocument: true,
    namespaces: options.withNamespace === false ? [] : [{
      ns: 'locale',
      schema: {},
      value: options.value ?? { preference: 'zh' },
      applies: true,
      secrets: [],
      revision: 4,
    }],
  })))
  const mutate = vi.fn(options.mutateResult ?? (async () => answer({
    ns: 'locale',
    schema: {},
    value: {},
    applies: true,
    secrets: [],
    revision: 5,
  })))
  const remote = { settings: { describe, mutate } }
  return {
    projection: createDshLocaleProjection(remote as never),
    describe,
    mutate,
  }
}

describe('DSH locale projection', () => {
  it('reads the stored preference from the locale namespace', async () => {
    const { projection } = remoteFixture()

    await expect(projection.get()).resolves.toEqual({ ok: true, value: { preference: 'zh' } })
  })

  it('follows the browser when no preference is stored or the value is unknown', async () => {
    const empty = remoteFixture({ value: {} })
    await expect(empty.projection.get()).resolves.toEqual({ ok: true, value: {} })

    const invalid = remoteFixture({ value: { preference: 'fr' } })
    await expect(invalid.projection.get()).resolves.toEqual({ ok: true, value: {} })

    const missing = remoteFixture({ withNamespace: false })
    await expect(missing.projection.get()).resolves.toEqual({ ok: true, value: {} })
  })

  it('writes the preference through the settings document revision', async () => {
    const { mutate, projection } = remoteFixture()

    await expect(projection.set('en')).resolves.toEqual({ ok: true, value: undefined })
    expect(mutate).toHaveBeenCalledWith('locale', [{ op: 'set', path: ['preference'], value: 'en' }], 4)
  })

  it('clears the stored preference so the UI follows the browser again', async () => {
    const { mutate, projection } = remoteFixture()

    await expect(projection.set(undefined)).resolves.toEqual({ ok: true, value: undefined })
    expect(mutate).toHaveBeenCalledWith('locale', [{ op: 'unset', path: ['preference'] }], 4)
  })

  it('refuses to write into a read-only configuration', async () => {
    const { mutate, projection } = remoteFixture({ writable: false })

    await expect(projection.set('zh')).resolves.toEqual({
      ok: false,
      reason: 'permission-denied',
      message: '当前设置不可写。',
      retryable: false,
    })
    expect(mutate).not.toHaveBeenCalled()
  })

  it('reports a missing locale namespace as retryable unavailability', async () => {
    const { mutate, projection } = remoteFixture({ withNamespace: false })

    await expect(projection.set('zh')).resolves.toEqual({
      ok: false,
      reason: 'runtime-unavailable',
      message: '语言设置不可用。',
      retryable: true,
    })
    expect(mutate).not.toHaveBeenCalled()
  })

  it('keeps a revision conflict a settings conflict', async () => {
    const { projection } = remoteFixture({
      mutateResult: async () => ({ ok: false as const, error: { code: 'settings/conflict', message: 'stale revision' } }),
    })

    await expect(projection.set('en')).resolves.toMatchObject({
      ok: false,
      reason: 'settings-conflict',
    })
  })

  it('reports a refused write as an invalid command', async () => {
    const { projection } = remoteFixture({
      mutateResult: async () => ({ ok: false as const, error: { code: 'settings/rejected', message: 'refused' } }),
    })

    await expect(projection.set('en')).resolves.toMatchObject({
      ok: false,
      reason: 'invalid-command',
    })
  })

  it('turns a thrown remote failure into a retryable rejection', async () => {
    const { projection } = remoteFixture({
      describeResult: async () => { throw new Error('offline') },
    })

    await expect(projection.get()).resolves.toEqual({
      ok: false,
      reason: 'runtime-unavailable',
      message: '语言设置暂时不可用。',
      retryable: true,
    })
    await expect(projection.set('zh')).resolves.toEqual({
      ok: false,
      reason: 'runtime-unavailable',
      message: '语言设置暂时不可用。',
      retryable: true,
    })
  })
})
