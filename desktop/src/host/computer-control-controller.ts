import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-settings'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { z } from 'zod'
import { computerControlNamespace, snapshotShortcuts, type LingComputerCapabilities, type LingComputerSnapshot } from 'ling-desktop/runtime'
import { LING_COMPUTER_CONTROL_HOST, snapshotSchema } from '../computer-control-contract.ts'
import { COMPUTER_USE_PREFIX as prefix } from '../computer-use-policy.ts'

declare module '@deepseek-ai/cordis' { interface Context { lingComputerControl: LingComputerControlController } }

function dataOf(value: unknown): unknown {
  const result = value as { structuredContent?: unknown; content?: { type: string; text?: string }[] }
  if (!result || typeof result !== 'object') throw new Error('驱动未返回窗口信息。')
  if (result.structuredContent !== undefined) return result.structuredContent
  for (const block of result.content ?? []) if (block.type === 'text' && block.text) {
    try { return JSON.parse(block.text) } catch {}
  }
  throw new Error('驱动未返回可识别的窗口信息。')
}
const windowSchema = z.object({ pid: z.number().int().positive(), window_id: z.number().int().positive(), z_index: z.number().finite(),
  on_current_space: z.boolean().optional(), is_on_screen: z.boolean().optional(), app_name: z.string().optional(), title: z.string().optional() })

export function frontWindow(value: unknown): z.infer<typeof windowSchema> {
  const data = dataOf(value)
  const windows = Array.isArray(data) ? data : (data as { windows?: unknown[] })?.windows
  const candidates = (windows ?? []).flatMap(value => { const parsed = windowSchema.safeParse(value); return parsed.success && parsed.data.is_on_screen !== false && parsed.data.on_current_space !== false ? [parsed.data] : [] })
    .sort((a, b) => b.z_index - a.z_index)
  if (!candidates[0] || candidates[1]?.z_index === candidates[0].z_index) throw new Error('无法确定前台窗口，请将要截取的窗口置于前台后重试。')
  return candidates[0]
}

/** Uses the same provider and lease as agents; no second driver or generic native RPC. */
export async function captureFrontWindow(ctx: Context): Promise<LingComputerSnapshot> {
  const signal = AbortSignal.timeout(15_000)
  const call = async (raw: string, args: Record<string, unknown>) => {
    const result = await ctx.tools.execute({ name: prefix + raw, arguments: args, signal, callId: ToolCallId(`ling-snapshot-${randomUUID()}`) })
    if (result.isError) throw new Error(result.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n') || '快照失败。')
    return result.value
  }
  const window = frontWindow(await call('list_windows', { on_screen_only: true }))
  const raw = await call('get_window_state', { pid: window.pid, window_id: window.window_id, max_image_dimension: 1600 }) as { content: { type: string; text?: string; mimeType?: string; data?: string }[]; structuredContent?: { tree_markdown?: string } }
  const title = `${window.app_name ?? '应用'}${window.title ? ` · ${window.title}` : ''}`.slice(0, 512)
  const content = raw?.content ?? []
  const images = content.filter(block => block.type === 'image').map((block, index) => ({ name: `窗口快照-${Date.now()}-${index}.${block.mimeType === 'image/jpeg' ? 'jpg' : block.mimeType === 'image/webp' ? 'webp' : 'png'}`, mediaType: block.mimeType, data: block.data }))
  if (!images.length) throw new Error('未能截取窗口，请检查屏幕录制权限。')
  const text = (raw.structuredContent?.tree_markdown ?? content.flatMap(block => block.type === 'text' ? [block.text ?? ''] : []).join('\n')).slice(0, 65536)
  return snapshotSchema.parse({ title, text, images })
}

export class LingComputerControlController extends TypertRemoteService {
  static inject = ['settings', 'tools', 'typert']
  constructor(ctx: Context) {
    super(ctx, 'lingComputerControl')
    ctx.settings.register(computerControlNamespace, Schema.object({ browserEnabled: Schema.boolean().default(false), recordingEnabled: Schema.boolean().default(false), snapshotShortcut: Schema.union(snapshotShortcuts.map(value => Schema.const(value))).default('') }))
    ctx.effect(() => ctx.typert.register(LING_COMPUTER_CONTROL_HOST), 'LING computer control Remote')
  }
  async capabilities(): Promise<LingComputerCapabilities> {
    const names = new Set(this.ctx.tools.schemas().map(tool => tool.name))
    return { browser: names.has(prefix + 'get_browser_state'), recording: ['start_recording', 'stop_recording', 'replay_trajectory'].every(raw => names.has(prefix + raw)), snapshot: ['list_windows', 'get_window_state'].every(raw => names.has(prefix + raw)) }
  }
  async snapshot(): Promise<LingComputerSnapshot> { return await captureFrontWindow(this.ctx) }
}
const prototype = LingComputerControlController.prototype
const receiver = Object.create(prototype) as LingComputerControlController
const decorate = Remote as unknown as (implementation: (...args: never[]) => unknown, context: { name: string; private: boolean; static: boolean; addInitializer(initializer: (this: LingComputerControlController) => void): void }) => void
for (const method of ['capabilities', 'snapshot'] as const) decorate(prototype[method] as (...args: never[]) => unknown, { name: method, private: false, static: false, addInitializer(initializer) { initializer.call(receiver) } })
