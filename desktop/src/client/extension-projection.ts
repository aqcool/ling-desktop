import { createPluginProjection } from './plugin-projection.js'
import { presetDisplayText, type BuiltInPresetCopyKey } from '@deepseek-ai/dsh-agent-presets/display'
import type { SessionBinding } from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/remote'
import type { ClientRemote } from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-agent-presets/remote'
import type {} from '@deepseek-ai/dsh-host-plugin-inventory/remote'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  LingAgentPreset,
  LingExtensionSettingsService,
  LingCommandRejectionReason,
  LingPluginEntry,
  LingReadResult,
  LingSkill,
} from 'ling-desktop/runtime'

const presetLabels: Record<BuiltInPresetCopyKey, string> = {
  presetStandardName: '标准模式', presetStandardDescription: '编码、检索、技能、计划、目标与子智能体。',
  presetPtcName: 'PTC 模式', presetPtcDescription: '通过 TypeScript 程序组合多步工具操作。',
  presetMinimalName: '极简模式', presetMinimalDescription: '使用持久 Shell 的单工具智能体。',
  presetCordisName: '创造模式', presetCordisDescription: '创建和调整自定义智能体与插件。',
}

function rejected<Value>(
  reason: LingCommandRejectionReason,
  message: string,
  retryable = false,
): LingReadResult<Value> {
  return { ok: false, reason, message, retryable }
}

function remoteFailure<Value>(error: { readonly code: string; readonly message?: string }): LingReadResult<Value> {
  const reason = /permission|denied|forbidden|read-only/i.test(error.code)
    ? 'permission-denied'
    : /not-found|missing/i.test(error.code)
      ? 'task-not-found'
      : /invalid|bad-request|validation|locked/i.test(error.code)
        ? 'invalid-command'
        : 'runtime-unavailable'
  return rejected(
    reason,
    error.message?.trim() || '扩展能力读取失败。',
    /transport|connection|timeout|unavailable/i.test(error.code),
  )
}

function presetView(preset: Parameters<typeof presetDisplayText>[0] & { id: string; trust: 'system' | 'user'; isDefault: boolean; broken?: string }): LingAgentPreset {
  const display = presetDisplayText(preset, key => presetLabels[key])
  return { id: preset.id, label: display.name, description: display.description, trust: preset.trust, isDefault: preset.isDefault, unavailableReason: preset.broken }
}

async function request<T>(call: () => Promise<{ ok: true; value: T } | { ok: false; error: { code: string; message?: string } }>): Promise<LingReadResult<T>> {
  try {
    const result = await call()
    return result.ok ? { ok: true, value: result.value } : remoteFailure(result.error)
  } catch {
    return rejected('runtime-unavailable', '无法连接扩展设置服务，请重试。', true)
  }
}

export function createDshExtensionProjection(remote: ClientRemote, workspaceSkills?: import('../skill-contract.ts').LingSkillsRemote['list']) {
  const settings: LingExtensionSettingsService = {
    async presets() {
      const [roster, metadata] = await Promise.all([
        request(() => remote.agentPresets.list()), request(() => remote.settings.describe()),
      ])
      if (!roster.ok) return roster
      if (!metadata.ok) return metadata
      return { ok: true, value: {
        presets: roster.value.presets.map(presetView), authorable: roster.value.authorable,
        modeSelectionEnabled: roster.value.modeSelectionEnabled,
        writable: metadata.value.writable, hasDocument: metadata.value.hasDocument,
      } }
    },
    async update(patch) {
      const result = await request(() => remote.settings.update('agent-presets', patch, undefined))
      return result.ok ? { ok: true, value: undefined } : result
    },
    read: id => request(() => remote.agentPresets.read(id)),
    async copy(from, id, name) {
      const result = await request(() => remote.agentPresets.copy(from, id, name))
      return result.ok ? { ok: true, value: undefined } : result
    },
    async delete(id) {
      const result = await request(() => remote.agentPresets.deletePreset(id))
      return result.ok ? { ok: true, value: undefined } : result
    },
    openDirectory: id => request(() => remote.settings.openAgentPresetDirectory(id)),
    async openConfig() {
      const result = await request(() => remote.settings.openSettingsDocument())
      return result.ok ? { ok: true, value: undefined } : result
    },
    async inventory() {
      const result = await request(() => remote.pluginInventory.list())
      if (!result.ok) return result
      return { ok: true, value: {
        entries: result.value.entries.map(entry => ({ id: String(entry.entryId), moduleName: entry.moduleName, enabled: entry.enabled, phase: entry.fiberPhase ?? undefined })),
        presets: (result.value.agentPresets ?? []).map(preset => ({ ...presetView(preset), plugins: preset.rows.map(row => ({
          id: row.entryId, moduleName: row.moduleName, enabled: row.enabled, condition: row.condition, phase: row.fiberPhase ?? undefined,
        })) })),
      } }
    },
  }
  return {
    settings,
    manager: createPluginProjection(remote),
    async skills(taskId: string, signal?: AbortSignal): Promise<LingReadResult<readonly LingSkill[]>> {
      try {
        const result = await remote.skills.list({ sessionId: brandString<SessionId>(taskId) }, signal)
        if (!result.ok) return remoteFailure(result.error)
        return {
          ok: true,
          value: result.value.skills.map(skill => ({
            name: skill.name,
            description: skill.description,
            ...(skill.path === undefined ? {} : { path: skill.path }),
            ...(skill.whenToUse === undefined ? {} : { whenToUse: skill.whenToUse }),
            modelInvocable: skill.modelInvocable,
          })),
        }
      } catch {
        return rejected('runtime-unavailable', '技能目录暂时不可用。', true)
      }
    },
    async workspaceSkills(workspaceId: string | undefined, signal?: AbortSignal, agentPreset?: string): Promise<LingReadResult<readonly LingSkill[]>> {
      if (!workspaceSkills) return rejected('runtime-unavailable', '工作区技能目录暂时不可用。', true)
      try {
        const result = await workspaceSkills(workspaceId ?? null, agentPreset ?? null, signal)
        return result.ok ? { ok: true, value: result.value } : remoteFailure(result.error)
      } catch (error) {
        console.error('[ling] workspace skill catalog failed', error)
        return rejected('runtime-unavailable', '工作区技能目录读取失败。', true)
      }
    },
    async presets(): Promise<LingReadResult<readonly LingAgentPreset[]>> {
      try {
        const result = await remote.agentPresets.list()
        if (!result.ok) return remoteFailure(result.error)
        return {
          ok: true,
          value: result.value.presets.map(preset => {
            const display = presetDisplayText(preset, key => presetLabels[key])
            return {
              id: preset.id,
              label: display.name,
              ...(display.description === undefined ? {} : { description: display.description }),
              ...(preset.broken === undefined ? {} : { unavailableReason: preset.broken }),
              isDefault: preset.isDefault,
              trust: preset.trust,
            }
          }),
        }
      } catch {
        return rejected('runtime-unavailable', 'Agent 预设目录暂时不可用。', true)
      }
    },
    currentPreset(binding: SessionBinding): string | undefined {
      try {
        const value = binding.session.projections.faceOf('agentPreset').getSnapshot() as unknown
        return typeof value === 'string' && value.length > 0 ? value : undefined
      } catch {
        return undefined
      }
    },
    async selectPreset(taskId: string, presetId: string): Promise<LingReadResult<void>> {
      try {
        const result = await remote.agentPresets.select(brandString<SessionId>(taskId), presetId)
        return result.ok ? { ok: true, value: undefined } : remoteFailure(result.error)
      } catch {
        return rejected('runtime-unavailable', 'Agent 预设切换暂时不可用。', true)
      }
    },
    async plugins(): Promise<LingReadResult<readonly LingPluginEntry[]>> {
      try {
        const result = await remote.pluginInventory.list()
        if (!result.ok) return remoteFailure(result.error)
        return {
          ok: true,
          value: result.value.entries.map(entry => ({
            id: String(entry.entryId),
            moduleName: entry.moduleName,
            enabled: entry.enabled,
            ...(entry.fiberPhase === null || entry.fiberPhase === undefined
              ? {}
              : { phase: entry.fiberPhase }),
          })),
        }
      } catch {
        return rejected('runtime-unavailable', '插件清单暂时不可用。', true)
      }
    },
  }
}
