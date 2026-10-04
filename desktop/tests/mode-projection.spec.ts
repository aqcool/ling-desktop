import { describe, expect, it, vi } from 'vitest'
import type { ClientRemote } from '@deepseek-ai/dsh-api-remotes/client'
import { createDshModeProjection } from '../src/client/mode-projection.js'

describe('goal creation projection', () => {
  it('preserves the objective and requested round limit in the official API', async () => {
    const create = vi.fn(async () => ({ ok: true, value: {} }))
    const projection = createDshModeProjection({ goals: { create } } as unknown as ClientRemote)
    await expect(projection.createGoal('session', '修复所有错误', 10)).resolves.toEqual({ ok: true, value: undefined })
    expect(create).toHaveBeenCalledExactlyOnceWith('session', { objective: '修复所有错误', maxGoalRounds: 10 })
  })
  it('propagates authorization failures and transport errors without claiming success', async () => {
    const create = vi.fn().mockResolvedValueOnce({ ok: false, error: { code: 'permission-denied', message: '禁止创建目标' } }).mockRejectedValueOnce(new Error('offline'))
    const projection = createDshModeProjection({ goals: { create } } as unknown as ClientRemote)
    await expect(projection.createGoal('session', 'Fix', 5)).resolves.toMatchObject({ ok: false, reason: 'permission-denied', message: '禁止创建目标', retryable: false })
    await expect(projection.createGoal('session', 'Fix', 5)).resolves.toMatchObject({ ok: false, reason: 'runtime-unavailable', retryable: true })
  })
})
