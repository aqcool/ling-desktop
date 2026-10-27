import { expect, it, vi } from 'vitest'
import type { LingServerService, LingServerTerminalScope } from '../src/runtime/servers.js'
import { initializeServerTerminals, resolveServerTerminalScope } from '../src/ui/server-terminal-initialization.js'

it('shares initial SSH allocation across remounts and recovers the same shell afterwards', async () => {
  let terminals: string[] = []
  const terminalList = vi.fn(async () => ({ ok: true, value: terminals }))
  const terminalOpen = vi.fn(async () => { terminals = ['pty']; return { ok: true, value: { terminalId: 'pty' } } })
  const service = { terminalList, terminalOpen } as unknown as LingServerService
  const first = initializeServerTerminals(service, 'draft-server')
  const second = initializeServerTerminals(service, 'draft-server')
  expect(first).toBe(second)
  expect(await first).toEqual({ ok: true, value: ['pty'] })
  expect(terminalOpen).toHaveBeenCalledOnce()
  expect(await initializeServerTerminals(service, 'draft-server')).toEqual({ ok: true, value: ['pty'] })
  expect(terminalOpen).toHaveBeenCalledOnce()
})

it('preserves connection errors and retries rather than caching a failed allocation', async () => {
  const error = { ok: false, reason: 'runtime-unavailable', message: 'SSH unavailable', retryable: true } as const
  const terminalList = vi.fn().mockResolvedValueOnce(error).mockResolvedValue({ ok: true, value: [] })
  const terminalOpen = vi.fn().mockResolvedValue({ ok: true, value: { terminalId: 'retry' } })
  const service = { terminalList, terminalOpen } as unknown as LingServerService
  expect(await initializeServerTerminals(service, 'server')).toEqual(error)
  expect(terminalOpen).not.toHaveBeenCalled()
  expect(await initializeServerTerminals(service, 'server')).toEqual({ ok: true, value: ['retry'] })
})

it('resolves concurrent task/server/placement requests once without mixing independent owners', async () => {
  const terminalScope = vi.fn(async ({ taskId, serverId, placement }: LingServerTerminalScope) => ({ ok: true as const, value: { ownerId: `${taskId}:${serverId}:${placement}` } }))
  const service = { terminalScope } as unknown as LingServerService
  const request = { taskId: 'task', serverId: 'a', placement: 'side' } as const
  const first = resolveServerTerminalScope(service, request)
  expect(resolveServerTerminalScope(service, { ...request })).toBe(first)
  const otherServer = resolveServerTerminalScope(service, { ...request, serverId: 'b' })
  const otherTask = resolveServerTerminalScope(service, { ...request, taskId: 'other-task' })
  const otherPlacement = resolveServerTerminalScope(service, { ...request, placement: 'bottom' })
  expect(await Promise.all([first, otherServer, otherTask, otherPlacement])).toEqual([
    { ok: true, value: { ownerId: 'task:a:side' } }, { ok: true, value: { ownerId: 'task:b:side' } },
    { ok: true, value: { ownerId: 'other-task:a:side' } }, { ok: true, value: { ownerId: 'task:a:bottom' } },
  ])
  expect(terminalScope).toHaveBeenCalledTimes(4)
})
