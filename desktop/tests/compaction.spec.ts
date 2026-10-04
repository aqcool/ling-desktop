import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createScope } from '@deepseek-ai/dsh-scope'
import { Loader, EntryTree } from '@deepseek-ai/cordis-plugin-loader'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import FileSettingsProvider from '@deepseek-ai/dsh-settings-file'
import BasicCompactionEngine, { type BasicCompactionConfig } from '@deepseek-ai/dsh-compaction-basic'
import { afterEach, describe, expect, it } from 'vitest'
import * as compaction from '../src/compaction.ts'

const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose() })

async function host(path: string, base: BasicCompactionConfig = {}) {
  const ctx = new Context()
  cleanup.push(() => ctx.fiber.dispose())
  await ctx.plugin(Loader)
  await ctx.plugin(FileSettingsProvider, { path, watch: false })
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(TokenMeter)
  await ctx.plugin(compaction)
  await ctx.plugin({ inject: ['loader'], async apply(owner: Context) {
    const scoped = createScope(owner, {})
    class PresetTree extends EntryTree {
      override import() { return BasicCompactionEngine }
      write() {}
    }
    const tree = new PresetTree(scoped.ctx)
    await tree.create({ name: '@deepseek-ai/dsh-compaction-basic', config: base })
    await tree.await()
  } })
  return ctx
}

describe('LING settings with the real DSH compaction engine', () => {
  it('preserves defaults, persists accepted changes and applies them only after restart', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ling-compact-settings-'))
    cleanup.push(() => rm(directory, { recursive: true, force: true }))
    const path = join(directory, 'settings.yaml')
    const ctx = await host(path)
    expect(ctx.compaction).toBeInstanceOf(BasicCompactionEngine)
    const engine = ctx.compaction as BasicCompactionEngine
    expect(engine.config).toMatchObject({ auto: true, thresholdRatio: 0.8, retainRatio: 0.16, maxTokens: 8192, compactionRetries: 1, maxOverflowRetries: 1, summarizationProvider: '', summarizationModel: '' })
    const view = ctx.settings.describe().find(ns => ns.ns === 'ling-compaction')!
    expect(view.applies).toBe('restart')
    await ctx.settings.update('ling-compaction', { auto: false, thresholdRatio: 0.7, retainRatio: 0.12, summarizationProvider: 'test', summarizationModel: 'summary' }, view.revision)
    expect(await readFile(path, 'utf8')).toContain('ling-compaction:')
    expect(engine.config).toMatchObject({ auto: true, thresholdRatio: 0.8 })
    await expect(ctx.settings.update('ling-compaction', { auto: true }, view.revision)).rejects.toThrow(/changed since/)
    await expect(ctx.settings.update('ling-compaction', { retainRatio: 0.8 })).rejects.toThrow('保留比例')
    await expect(ctx.settings.update('ling-compaction', { summarizationModel: '' })).rejects.toThrow('同时选择')
    await ctx.fiber.dispose()
    const restarted = await host(path)
    expect((restarted.compaction as BasicCompactionEngine).config).toMatchObject({ auto: false, thresholdRatio: 0.7, retainRatio: 0.12, summarizationProvider: 'test', summarizationModel: 'summary', maxTokens: 8192 })
    // Disabling automatic compaction does not remove the manual engine.
    expect(typeof restarted.compaction.compactNow).toBe('function')
  })
  it('preserves preset configuration unless the user overrides that field', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ling-compact-preset-'))
    cleanup.push(() => rm(directory, { recursive: true, force: true }))
    const path = join(directory, 'settings.yaml')
    const base = { thresholdRatio: 0.6, retainTokens: 4096, summarizationProvider: 'preset', summarizationModel: 'summary' }
    const ctx = await host(path, base)
    expect((ctx.compaction as BasicCompactionEngine).config).toMatchObject(base)
    await ctx.settings.update('ling-compaction', { thresholdRatio: 0.7, retainRatio: 0.1 })
    await ctx.fiber.dispose()
    const restarted = await host(path, base)
    expect((restarted.compaction as BasicCompactionEngine).config).toMatchObject({ thresholdRatio: 0.7, retainRatio: 0.1, summarizationProvider: 'preset' })
    expect((restarted.compaction as BasicCompactionEngine).config.retainTokens).toBeUndefined()
  })

})
