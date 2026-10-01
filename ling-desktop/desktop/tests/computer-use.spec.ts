import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import ToolRuntime, { defineTool, type PreToolDecision, type ToolExecution, type ToolDispatchExecution, type ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { ComputerUseProviderName } from '@deepseek-ai/dsh-computer-use/brand'
import ComputerUseRegistry from '@deepseek-ai/dsh-computer-use'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { composeEntries, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { fileURLToPath } from 'node:url'
import { computerUseDecision, COMPUTER_USE_PREFIX as prefix } from '../src/computer-use-policy.ts'
import * as ComputerUse from '../src/computer-use.ts'

const fixture = vi.hoisted(() => ({ fail: false, shutdown: vi.fn() }))
vi.mock('@deepseek-ai/dsh-experimental-computer-use-cua-driver-native', () => ({
  Config: undefined,
  name: 'native-test-provider', inject: ['computerUse', 'tools'],
  async apply(ctx: Context) {
    const release = ctx.computerUse.register(ComputerUseProviderName('cua-driver-native'))
    if (fixture.fail) { await release(); throw new Error('native unavailable') }
    ctx.tools.register(defineTool({ name: `${prefix}list_apps`, description: 'inspection fixture', parameters: {},
      output: { schema: { type: 'string' }, render: (_, value) => [{ type: 'text', text: value }] }, execute: async () => 'apps' }))
    ctx.effect(() => fixture.shutdown)
  },
}))
const allow = { kind: 'allow' } as const
const contexts: Context[] = []
afterEach(async () => { await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose())); fixture.fail = false; fixture.shutdown.mockReset() })

describe('desktop permission boundary', () => {
  it.each(['list_apps', 'list_windows', 'get_window_state', 'get_desktop_state', 'get_accessibility_tree'])('allows %s inspection in read-only sessions', raw => {
    expect(computerUseDecision(prefix + raw, {}, 'read-only', allow)).toBe(allow)
  })
  it.each(['click', 'type_text', 'press_key', 'scroll', 'launch_app', 'clipboard_write', 'set_config', 'browser_prepare', 'unknown_new_tool'])('gates %s by the live session mode', raw => {
    expect(computerUseDecision(prefix + raw, {}, 'read-only', allow).kind).toBe('deny')
    expect(computerUseDecision(prefix + raw, {}, 'workspace-write', allow).kind).toBe('ask')
    expect(computerUseDecision(prefix + raw, {}, 'danger-full-access', allow)).toBe(allow)
    expect(computerUseDecision(prefix + raw, {}, undefined, allow).kind).toBe('deny')
  })
  it('does not treat screenshot export or permission prompts as inspection', () => {
    expect(computerUseDecision(prefix + 'get_window_state', { screenshot_out_file: '/outside/screenshot.png' }, 'read-only', allow).kind).toBe('deny')
    expect(computerUseDecision(prefix + 'get_desktop_state', { screenshot_out_file: '/outside/screenshot.png' }, 'workspace-write', allow).kind).toBe('ask')
    for (const args of [{}, { prompt: true }]) expect(computerUseDecision(prefix + 'check_permissions', args, 'danger-full-access', allow).kind).toBe('deny')
    expect(computerUseDecision(prefix + 'check_permissions', { prompt: false }, 'read-only', allow)).toBe(allow)
  })
  it('preserves other policy decisions and unrelated tools', () => {
    for (const decision of [{ kind: 'deny', reason: 'other policy' }, { kind: 'cancel' }, { kind: 'ask', reason: 'other approval' }] as const) {
      expect(computerUseDecision(prefix + 'click', {}, 'danger-full-access', decision)).toBe(decision)
    }
    expect(computerUseDecision('bash', {}, 'read-only', allow)).toBe(allow)
  })
})

async function setup() {
  const ctx = new Context(); contexts.push(ctx)
  await ctx.plugin(ToolRuntime); await ctx.plugin(SystemPrompt)
  await ctx.plugin(ComputerUseRegistry)
  let mode: 'read-only' | 'workspace-write' | 'danger-full-access' = 'workspace-write'
  ctx.provide('sandboxPolicy', { resolve: () => ({ mode }) } as never)
  ctx.provide('sessionProjections', { stateOf: () => ({ openTurnStartSeq: 1 }) } as never)
  ctx.provide('sessions', {} as never)
  let pre!: (exec: ToolExecution, next: () => Promise<PreToolDecision>) => Promise<PreToolDecision>
  let around!: (exec: ToolDispatchExecution, next: () => Promise<ToolExecutionResult>) => Promise<ToolExecutionResult>
  let guard!: (exec: ToolExecution) => string | undefined
  let end!: (session: { id: string }, event: { type: string }) => void
  const on = ctx.on.bind(ctx)
  vi.spyOn(ctx, 'on').mockImplementation(((name: string, callback: unknown, options: unknown) => {
    if (name === 'tools/pre-execute') pre = callback as typeof pre
    if (name === 'tools/execute') around = callback as typeof around
    if (name === 'session/event') end = callback as typeof end
    return on(name as never, callback as never, options as never)
  }) as typeof ctx.on)
  const registerGuard = ctx.tools.guard.bind(ctx.tools)
  vi.spyOn(ctx.tools, 'guard').mockImplementation(callback => { guard = callback; return registerGuard(callback) })
  const fiber = ctx.plugin(ComputerUse); await fiber
  const exec = (taskId: string, raw: string) => ({ name: prefix + raw, arguments: {}, signal: new AbortController().signal,
    agent: { id: taskId, session: { id: taskId } } }) as ToolDispatchExecution
  return { ctx, fiber, exec, pre, around, guard, end, setMode: (value: typeof mode) => { mode = value } }
}
const result: ToolExecutionResult = { content: [{ type: 'text', text: 'ok' }], value: 'ok', isError: false }

describe('opt-in LING provider composition', () => {
  it('ships a disabled addressable Loader entry', () => {
    const entries = composeEntries([loadOverlayPatches('ling-desktop-host', fileURLToPath(new URL('../cordis.patch.yml', import.meta.url)))])
    expect(entries.find(entry => entry.id === 'ling-computer-use')).toMatchObject({ name: 'ling-desktop-host/computer-use', disabled: true })
  })
  it('registers through the ordinary tool runtime and removes all tools on disable', async () => {
    const { ctx, fiber } = await setup()
    const output = await ctx.tools.execute({ name: prefix + 'list_apps', callId: ToolCallId('inspect'), arguments: {}, signal: new AbortController().signal })
    expect(output).toMatchObject({ isError: false, value: 'apps' })
    expect(ctx.computerUse.providerName).toBe('cua-driver-native')
    await fiber.dispose()
    expect(ctx.tools.schemas()).toEqual([])
    expect(ctx.computerUse.providerName).toBeUndefined()
    expect(fixture.shutdown).toHaveBeenCalledOnce()
  })
  it('contains native initialization failure without affecting ordinary tools', async () => {
    fixture.fail = true
    await expect(setup()).rejects.toThrow('native unavailable')
    const ctx = contexts[0]!
    expect(ctx.tools.schemas()).toEqual([])
    expect(ctx.computerUse.providerName).toBeUndefined()
  })
  it('keeps snapshot, actions and verification in one session until turn completion', async () => {
    const { exec, around, guard, end } = await setup()
    await around(exec('first', 'list_apps'), async () => result)
    expect(guard(exec('second', 'list_apps'))).toContain('另一个会话')
    expect(guard(exec('first', 'list_apps'))).toBeUndefined()
    await expect(around(exec('second', 'click'), async () => result)).rejects.toThrow('另一个会话')
    end({ id: 'first' }, { type: 'turn/end' })
    expect(guard(exec('second', 'list_apps'))).toBeUndefined()
  })
  it('serializes same-session calls and releases only after work settles', async () => {
    const { exec, around, guard, end } = await setup()
    const started = Promise.withResolvers<void>(); const finish = Promise.withResolvers<void>()
    const first = around(exec('first', 'list_apps'), async () => { started.resolve(); await finish.promise; return result })
    await started.promise
    const secondBody = vi.fn(async () => result)
    const second = around(exec('first', 'get_window_state'), secondBody)
    await Promise.resolve(); expect(secondBody).not.toHaveBeenCalled()
    end({ id: 'first' }, { type: 'turn/end' })
    expect(guard(exec('other', 'list_apps'))).toContain('另一个会话')
    finish.resolve(); await Promise.all([first, second])
    expect(secondBody).toHaveBeenCalledOnce()
    expect(guard(exec('other', 'list_apps'))).toBeUndefined()
  })
  it('cancels queued input before dispatch and rechecks downgraded permissions', async () => {
    const { exec, pre, around, setMode } = await setup()
    setMode('danger-full-access')
    const click = exec('first', 'click')
    await pre(click, async () => allow)
    setMode('workspace-write')
    const body = vi.fn(async () => result)
    await expect(around(click, body)).rejects.toThrow('权限已变化')
    expect(body).not.toHaveBeenCalled()
    const cancelled = exec('first', 'click'); (cancelled.signal as AbortSignal).throwIfAborted()
    const controller = new AbortController(); controller.abort(); cancelled.signal = controller.signal
    await expect(around(cancelled, body)).rejects.toThrow()
    expect(body).not.toHaveBeenCalled()
  })
  it('does not dispatch input cancelled while waiting behind another call', async () => {
    const { exec, around } = await setup()
    const started = Promise.withResolvers<void>(); const finish = Promise.withResolvers<void>()
    const first = around(exec('first', 'list_apps'), async () => { started.resolve(); await finish.promise; return result })
    await started.promise
    const controller = new AbortController()
    const input = exec('first', 'click'); input.signal = controller.signal
    const body = vi.fn(async () => result)
    const queued = around(input, body)
    const rejected = expect(queued).rejects.toThrow()
    controller.abort()
    finish.resolve(); await first; await rejected
    expect(body).not.toHaveBeenCalled()
    expect(input.signal).toBe(controller.signal)
  })
  it('aborts in-flight work and queued input when the plugin is disabled', async () => {
    const { ctx, fiber, exec, around } = await setup()
    const started = Promise.withResolvers<void>()
    const inspecting = exec('first', 'list_apps')
    const originalSignal = inspecting.signal
    const first = around(inspecting, async () => {
      started.resolve()
      await new Promise<void>(resolve => inspecting.signal.addEventListener('abort', () => resolve(), { once: true }))
      expect(inspecting.signal.aborted).toBe(true)
      return result
    })
    await started.promise
    const body = vi.fn(async () => result)
    const queued = around(exec('first', 'click'), body)
    const rejected = expect(queued).rejects.toThrow()
    await fiber.dispose(); await first; await rejected
    expect(body).not.toHaveBeenCalled()
    expect(inspecting.signal).toBe(originalSignal)
    expect(ctx.tools.schemas()).toEqual([])
    expect(ctx.computerUse.providerName).toBeUndefined()
  })
})
