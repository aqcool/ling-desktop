import type { PreToolDecision } from '@deepseek-ai/dsh-tools'

export const COMPUTER_USE_PREFIX = 'cua_driver_native__'
export const isComputerUseTool = (name: string) => name.startsWith(COMPUTER_USE_PREFIX)

// Documented inspection tools in the pinned 0.28.0 API; unknown tools require approval.
const inspections = new Set([
  'list_apps', 'list_windows', 'get_window_state', 'get_accessibility_tree',
  'get_desktop_state', 'get_screen_size', 'get_cursor_position', 'get_config',
  'get_recording_state', 'get_agent_cursor_state', 'list_sessions',
])
const record = (args: unknown): Record<string, unknown> => args !== null && typeof args === 'object' && !Array.isArray(args) ? args as Record<string, unknown> : {}

export function isComputerUseInspection(name: string, args: unknown): boolean {
  if (!isComputerUseTool(name)) return false
  const raw = name.slice(COMPUTER_USE_PREFIX.length)
  const values = record(args)
  // Screenshot export writes outside the filesystem tools' sandbox.
  if (values.screenshot_out_file !== undefined && values.screenshot_out_file !== null) return false
  return inspections.has(raw) || (raw === 'check_permissions' && values.prompt === false)
}

export function computerUseDecision(name: string, args: unknown,
  mode: 'read-only' | 'workspace-write' | 'danger-full-access' | undefined,
  previous: PreToolDecision): PreToolDecision {
  if (!isComputerUseTool(name) || previous.kind === 'deny' || previous.kind === 'cancel') return previous
  // System grants belong to trusted user setup, never to an agent tool call.
  if (name === `${COMPUTER_USE_PREFIX}check_permissions` && record(args).prompt !== false) {
    return { kind: 'deny', reason: '请使用 prompt:false 检查权限；系统权限需要用户在系统设置中授予。' }
  }
  if (isComputerUseInspection(name, args)) return previous
  if (mode === undefined) return { kind: 'deny', reason: '电脑操作需要当前会话的权限信息。' }
  if (mode === 'read-only') return { kind: 'deny', reason: '当前会话为只读，不能点击、输入或修改电脑状态。请先切换会话权限。' }
  if (mode === 'danger-full-access' || previous.kind !== 'allow') return previous
  return { kind: 'ask', reason: `此操作会控制本机应用或修改桌面状态，需要确认后执行。\n\n操作：${name.slice(COMPUTER_USE_PREFIX.length)}\n${JSON.stringify(record(args), null, 2)}` }
}
