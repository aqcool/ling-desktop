import type { LingReadResult } from '../runtime/contract.js'
import type { LingServerService, LingServerTerminalScope } from '../runtime/servers.js'

const pendingByService = new WeakMap<LingServerService, Map<string, Promise<LingReadResult<readonly string[]>>>>()
const pendingScopes = new WeakMap<LingServerService, Map<string, Promise<LingReadResult<{ readonly ownerId: string }>>>>()

/** Scope requests identify one task/server/placement; resolved owner IDs never follow later UI selection. */
export function resolveServerTerminalScope(service: LingServerService, scope: LingServerTerminalScope): Promise<LingReadResult<{ readonly ownerId: string }>> {
  let pending = pendingScopes.get(service)
  if (!pending) { pending = new Map(); pendingScopes.set(service, pending) }
  const key = JSON.stringify([scope.taskId ?? null, scope.serverId, scope.placement])
  const existing = pending.get(key)
  if (existing) return existing
  const request = service.terminalScope(scope).finally(() => { pending.delete(key) })
  pending.set(key, request)
  return request
}

/** React remounts and concurrent views must not allocate two initial SSH shells. */
export function initializeServerTerminals(service: LingServerService, ownerId: string): Promise<LingReadResult<readonly string[]>> {
  let pending = pendingByService.get(service)
  if (!pending) { pending = new Map(); pendingByService.set(service, pending) }
  const existing = pending.get(ownerId)
  if (existing) return existing
  const request = (async (): Promise<LingReadResult<readonly string[]>> => {
    const listed = await service.terminalList(ownerId)
    if (!listed.ok || listed.value.length) return listed
    const opened = await service.terminalOpen(ownerId, 80, 24)
    return opened.ok ? { ok: true, value: [opened.value.terminalId] } : opened
  })().finally(() => { pending.delete(ownerId) })
  pending.set(ownerId, request)
  return request
}
