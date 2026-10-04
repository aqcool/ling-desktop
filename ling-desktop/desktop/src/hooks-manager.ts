import { randomUUID } from 'node:crypto'
import { constants, lstatSync, mkdirSync, openSync, closeSync, fstatSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { matcherDiagnostic } from '@deepseek-ai/dsh-hook-protocol'
import { hooksForDialect, type LingHookDialect, type LingHookEntry, type LingHookSettings } from 'ling-desktop/runtime'
import { hookSettingsSchema } from './hooks-contract.ts'

const MAX_BYTES = 1024 * 1024
const defaults = (): LingHookSettings => ({ enabled: false, dialect: 'claude-code', entries: [] })
function object(value: unknown): Record<string, unknown> | undefined { return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined }
function readJson(path: string): unknown {
  if (!isAbsolute(path)) throw new Error('请选择 JSON 文件的绝对路径。')
  const fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK | (constants.O_NOFOLLOW ?? 0))
  try {
    const stat = fstatSync(fd)
    if (!stat.isFile() || stat.size > MAX_BYTES) throw new Error('配置必须是小于 1 MB 的普通 JSON 文件。')
    const bytes = readFileSync(fd)
    if (bytes.byteLength > MAX_BYTES) throw new Error('配置文件超过 1 MB。')
    return JSON.parse(bytes.toString('utf8'))
  } finally { closeSync(fd) }
}
export function validateHookSettings(input: unknown): LingHookSettings {
  const settings = hookSettingsSchema.parse(input), ids = new Set<string>()
  for (const entry of settings.entries) {
    if (ids.has(entry.id)) throw new Error('Hook 标识重复，请重新添加。')
    ids.add(entry.id)
    if (!hooksForDialect(settings.dialect).includes(entry.event)) throw new Error(`${settings.dialect} 不支持 ${entry.event}。`)
    if (entry.command.includes('\0')) throw new Error('命令不能包含空字符。')
    if (entry.command.includes('${CLAUDE_PLUGIN_ROOT}')) throw new Error('LING 未配置 CLAUDE_PLUGIN_ROOT，请将脚本改为绝对路径。')
    if (entry.event === 'UserPromptSubmit' || entry.event === 'Stop') entry.matcher = ''
    const diagnostic = matcherDiagnostic(entry.matcher, settings.dialect)
    if (diagnostic) throw new Error(`${entry.event}: ${diagnostic}`)
  }
  return settings
}
export function importHooks(path: string, dialect: LingHookDialect): LingHookEntry[] {
  const root = object(readJson(path)), hooks = root ? object(root.hooks) ?? root : undefined
  if (!hooks) throw new Error('配置应包含 Hooks 事件对象。')
  const entries: LingHookEntry[] = []
  const events = hooksForDialect(dialect)
  for (const [event, groups] of Object.entries(hooks)) {
    // Settings files may carry unrelated settings beside their hooks wrapper.
    if (!events.includes(event as LingHookEntry['event'])) throw new Error(`不支持事件 ${event}，请使用所选格式支持的事件。`)
    if (!Array.isArray(groups)) throw new Error(`${event} 必须是 matcher 分组数组。`)
    for (const raw of groups) {
      const group = object(raw)
      if (!group || !Array.isArray(group.hooks)) throw new Error(`${event} 分组缺少 hooks 数组。`)
      for (const rawHook of group.hooks) {
        const hook = object(rawHook)
        if (!hook || (hook.type !== undefined && hook.type !== 'command') || hook.async === true) throw new Error('仅支持同步 command Hooks，不能导入其他类型。')
        entries.push({ id: randomUUID(), event: event as LingHookEntry['event'], command: hook.command as string, matcher: (group.matcher ?? '') as string, timeoutSec: (hook.timeout ?? (dialect === 'codex' ? hook.timeoutSec : undefined) ?? 600) as number, enabled: true })
      }
    }
  }
  return validateHookSettings({ enabled: false, dialect, entries }).entries
}
export function bridgeConfig(settings: LingHookSettings): { hooks: Record<string, { matcher?: string; hooks: { type: 'command'; command: string; timeout: number }[] }[]> } {
  const hooks: ReturnType<typeof bridgeConfig>['hooks'] = {}
  for (const entry of settings.entries.filter(entry => entry.enabled)) (hooks[entry.event] ??= []).push({ ...(entry.matcher ? { matcher: entry.matcher } : {}), hooks: [{ type: 'command', command: entry.command, timeout: entry.timeoutSec }] })
  return { hooks }
}
/** Fixed, profile-owned targets; import never writes to the supplied source. */
export class HooksStore {
  readonly configPath: string
  readonly runtimePath: string
  settings = defaults()
  revision = 0
  error: string | undefined
  constructor(home: string) {
    mkdirSync(home, { recursive: true })
    const root = realpathSync(home)
    this.configPath = join(root, 'ling-hooks.json')
    this.runtimePath = join(root, 'ling-hooks.runtime.json')
    try {
      const raw = object(readJson(this.configPath))
      if (!raw || raw.version !== 1 || !Number.isSafeInteger(raw.revision) || (raw.revision as number) < 0) throw new Error('LING Hooks 配置版本无效。')
      this.settings = validateHookSettings(raw.settings)
      this.revision = raw.revision as number
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.error = error instanceof Error ? error.message : String(error)
    }
  }
  private write(path: string, value: unknown): void {
    try { if (!lstatSync(path).isFile()) throw new Error('Hooks 配置目标不是普通文件。') } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    const temp = `${path}.${randomUUID()}.tmp`
    try { writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); renameSync(temp, path) } finally { rmSync(temp, { force: true }) }
  }
  prepare(settings: LingHookSettings): void { this.write(this.runtimePath, bridgeConfig(settings)) }
  commit(settings: LingHookSettings): void {
    this.write(this.configPath, { version: 1, revision: this.revision + 1, settings })
    this.settings = settings; this.revision++; this.error = undefined
  }
}
