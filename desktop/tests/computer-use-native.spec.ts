import { Context } from '@deepseek-ai/cordis'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ComputerUseRegistry from '@deepseek-ai/dsh-computer-use'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { expect, it } from 'vitest'
import * as ComputerUse from '../src/computer-use.ts'

// Explicit opt-in: importing/testing the package never operates the desktop.
it.skipIf(process.env.LING_COMPUTER_USE_NATIVE_SMOKE !== '1')('discovers native tools and checks permissions without prompting', { timeout: 30_000 }, async ({ signal }) => {
  const ctx = new Context()
  try {
    await ctx.plugin(ToolRuntime); await ctx.plugin(SystemPrompt)
    await ctx.plugin(ComputerUseRegistry)
    ctx.provide('sandboxPolicy', { resolve: () => ({ mode: 'read-only' }) } as never)
    ctx.provide('sessionProjections', { stateOf: () => undefined } as never)
    ctx.provide('sessions', {} as never)
    const fiber = ctx.plugin(ComputerUse); await fiber
    expect(ctx.computerUse.providerName).toBe('cua-driver-native')
    expect(ctx.tools.schemas().map(tool => tool.name)).toContain('cua_driver_native__get_window_state')
    const result = await ctx.tools.execute({ name: 'cua_driver_native__check_permissions', arguments: { prompt: false }, callId: ToolCallId('ling-native-permissions'), signal })
    expect(result.isError).toBe(false)
    expect(result.content.every(block => block.type === 'text')).toBe(true)
    await fiber.dispose()
    expect(ctx.tools.schemas()).toEqual([])
  } finally { await ctx.fiber.dispose() }
})
