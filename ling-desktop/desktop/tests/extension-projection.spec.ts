import { describe, expect, it, vi } from 'vitest'
import { createDshExtensionProjection } from '../src/client/extension-projection.js'

const answer = <Value>(value: Value) => ({ ok: true as const, value })

function projection(remote: Record<string, unknown>) {
  return createDshExtensionProjection(remote as never)
}

function unavailableRemote(namespace: string) {
  return {
    get [namespace](): never { throw new TypeError(`missing namespace: ${namespace}`) },
  }
}

describe('DSH extension projection', () => {
  it('reads the skill catalog for the session and keeps the source path', async () => {
    const list = vi.fn(async () => answer({
      skills: [{
        path: '/work/demo/.agents/skills/report',
        name: 'report',
        description: '生成报告',
        whenToUse: '需要汇总变更时',
        modelInvocable: true,
      }, {
        name: 'notes',
        description: '整理笔记',
        modelInvocable: false,
      }],
    }))
    const signal = new AbortController().signal
    const result = await projection({ skills: { list } }).skills('session-1', signal)

    expect(list).toHaveBeenCalledWith({ sessionId: 'session-1' }, signal)
    expect(result).toEqual({
      ok: true,
      value: [{
        name: 'report',
        description: '生成报告',
        path: '/work/demo/.agents/skills/report',
        whenToUse: '需要汇总变更时',
        modelInvocable: true,
      }, {
        name: 'notes',
        description: '整理笔记',
        modelInvocable: false,
      }],
    })
  })

  it('keeps a broken preset as an option that explains why it cannot be selected', async () => {
    const list = vi.fn(async () => answer({
      presets: [{
        id: 'reviewer',
        name: '评审助手',
        description: '只读审阅',
        trust: 'user',
        isDefault: false,
        broken: '引用的 Agent 文件缺失',
      }, { id: 'default', trust: 'system', isDefault: true }],
    }))
    const result = await projection({ agentPresets: { list } }).presets()

    expect(list).toHaveBeenCalledWith()
    expect(result).toEqual({
      ok: true,
      value: [{
        id: 'reviewer',
        label: '评审助手',
        description: '只读审阅',
        unavailableReason: '引用的 Agent 文件缺失',
        isDefault: false,
        trust: 'user',
      }, {
        id: 'default',
        label: 'default',
        isDefault: true,
        trust: 'system',
      }],
    })
  })

  it('reads the selected preset from the session projection and reports it only when set', () => {
    const extensions = projection({})
    expect(extensions.currentPreset({
      session: { projections: { faceOf: () => ({ getSnapshot: () => 'reviewer' }) } },
    } as never)).toBe('reviewer')
    expect(extensions.currentPreset({
      session: { projections: { faceOf: () => ({ getSnapshot: () => null }) } },
    } as never)).toBeUndefined()
    expect(extensions.currentPreset({ session: {} } as never)).toBeUndefined()
  })

  it('reports a locked session as a rejected switch with the host reason', async () => {
    const select = vi.fn(async () => ({
      ok: false as const,
      error: { code: 'agent-preset/locked', message: '会话已经开始，无法切换预设' },
    }))
    const result = await projection({ agentPresets: { select } }).selectPreset('session-1', 'reviewer')

    expect(select).toHaveBeenCalledWith('session-1', 'reviewer')
    expect(result).toEqual({
      ok: false,
      reason: 'invalid-command',
      message: '会话已经开始，无法切换预设',
      retryable: false,
    })
  })

  it('lists the host plugin inventory without a session argument', async () => {
    const list = vi.fn(async () => answer({
      entries: [
        { entryId: 4, moduleName: '@deepseek-ai/dsh-doc', enabled: true, fiberPhase: 'active' },
        { entryId: 'off-1', moduleName: '@deepseek-ai/dsh-beta', enabled: false, fiberPhase: null },
      ],
    }))
    const result = await projection({ pluginInventory: { list } }).plugins()

    expect(list).toHaveBeenCalledWith()
    expect(result).toEqual({
      ok: true,
      value: [
        { id: '4', moduleName: '@deepseek-ai/dsh-doc', enabled: true, phase: 'active' },
        { id: 'off-1', moduleName: '@deepseek-ai/dsh-beta', enabled: false },
      ],
    })
  })

  it('turns an unavailable transport into a retryable read failure', async () => {
    const list = vi.fn(async () => ({
      ok: false as const,
      error: { code: 'gateway/connection-closed', message: '' },
    }))

    await expect(projection({ skills: { list } }).skills('session-1')).resolves.toEqual({
      ok: false,
      reason: 'runtime-unavailable',
      message: '扩展能力读取失败。',
      retryable: true,
    })
  })

  it('reports unavailable when the host injects no extension remotes', async () => {
    const missingSkills = projection(unavailableRemote('skills'))
    const missingPresets = projection(unavailableRemote('agentPresets'))
    const missingPlugins = projection(unavailableRemote('pluginInventory'))

    await expect(missingSkills.skills('session-1')).resolves.toEqual({
      ok: false, reason: 'runtime-unavailable', message: '技能目录暂时不可用。', retryable: true,
    })
    await expect(missingPresets.presets()).resolves.toEqual({
      ok: false, reason: 'runtime-unavailable', message: 'Agent 预设目录暂时不可用。', retryable: true,
    })
    await expect(missingPlugins.plugins()).resolves.toEqual({
      ok: false, reason: 'runtime-unavailable', message: '插件清单暂时不可用。', retryable: true,
    })
    await expect(missingSkills.selectPreset('session-1', 'reviewer')).resolves.toEqual({
      ok: false, reason: 'runtime-unavailable', message: 'Agent 预设切换暂时不可用。', retryable: true,
    })
  })
})

describe('extension management settings', () => {
  it('keeps authoring policy and host-effective defaults', async () => {
    const view = projection({ agentPresets: { list: async () => answer({
      presets: [{ id: 'standard', trust: 'system', isDefault: true }], authorable: true, modeSelectionEnabled: false,
    }) }, settings: { describe: async () => answer({ writable: true, hasDocument: true }) } })
    expect(await view.settings.presets()).toMatchObject({ ok: true, value: {
      authorable: true, modeSelectionEnabled: false, writable: true, hasDocument: true,
      presets: [{ id: 'standard', isDefault: true, label: '标准模式' }],
    } })
  })

  it('preserves conditional composition rows, failures and null row ids', async () => {
    const view = projection({ pluginInventory: { list: async () => answer({
      entries: [{ entryId: 'global:fs', moduleName: 'tool-fs', enabled: false, fiberPhase: null }],
      agentPresets: [{ id: 'custom', name: '自定义', trust: 'user', isDefault: true, rows: [
        { entryId: null, moduleName: 'tool-fs', enabled: 'conditional', condition: 'env.platform === "win32"', fiberPhase: null },
        { entryId: 'bash', moduleName: 'tool-bash', enabled: true, fiberPhase: 'failed' },
      ] }],
    }) } })
    expect(await view.settings.inventory()).toMatchObject({ ok: true, value: {
      entries: [{ id: 'global:fs', enabled: false }], presets: [{ id: 'custom', label: '自定义', plugins: [
        { id: null, enabled: 'conditional', condition: 'env.platform === "win32"' }, { id: 'bash', phase: 'failed' },
      ] }],
    } })
  })

  it('writes policy and copies through upstream with all declared parameters', async () => {
    const update = vi.fn(async () => answer({}))
    const copy = vi.fn(async () => answer({}))
    const select = vi.fn()
    const view = projection({ settings: { update }, agentPresets: { copy, select } })
    expect(await view.settings.update({ default: 'custom' })).toEqual(answer(undefined))
    expect(update).toHaveBeenCalledWith('agent-presets', { default: 'custom' }, undefined)
    expect(await view.settings.copy('standard', 'custom')).toEqual(answer(undefined))
    expect(copy).toHaveBeenCalledWith('standard', 'custom', undefined)
    expect(select).not.toHaveBeenCalled()
  })

  it('exposes upstream refusal rather than reporting a successful deletion', async () => {
    const view = projection({ agentPresets: { deletePreset: async () => ({ ok: false, error: { code: 'agent-preset/read-only', message: '内置预设不可删除' } }) } })
    expect(await view.settings.delete('standard')).toMatchObject({ ok: false, reason: 'permission-denied', message: '内置预设不可删除' })
    expect(await projection(unavailableRemote('settings')).settings.openConfig()).toMatchObject({ ok: false, reason: 'runtime-unavailable' })
  })

  it('preserves the directory fallback when native opening is unavailable', async () => {
    const view = projection({ settings: { openAgentPresetDirectory: async () => answer({ opened: false, path: '/tmp/presets/custom' }) } })
    expect(await view.settings.openDirectory('custom')).toEqual(answer({ opened: false, path: '/tmp/presets/custom' }))
  })
})
