import { describe, expect, it, vi } from 'vitest'
import { LingServersController } from '../src/host/server-controller.ts'

function controller() {
  const service = Object.create(LingServersController.prototype) as LingServersController
  const sessions = { get: vi.fn(async () => ({ revision: 1, servers: [{ serverId: 'server-a', cwd: '/a' }, { serverId: 'server-b', cwd: '/b' }] })) }
  Object.assign(service, { sessions, taskStates: new Map(), serverLabels: new Map(),
    store: { list: async () => [{ id: 'server-a', name: 'A' }, { id: 'server-b', name: 'B' }] },
    draftTerminalBindings: new Map(), draftTerminalScopes: new Map(), taskTerminals: new Map() })
  vi.spyOn(service, 'probe').mockResolvedValue({ home: '/home/developer' })
  return { service, sessions }
}

describe('server terminals before creating a task', () => {
  it('reuses each server/placement owner without creating a task binding', async () => {
    const { service, sessions } = controller()
    const signal = new AbortController().signal
    const [first, duplicate] = await Promise.all([
      service.terminalScope({ serverId: 'server-a', placement: 'bottom' }, signal), service.terminalScope({ serverId: 'server-a', placement: 'bottom' }, signal),
    ])
    expect(first).toEqual(duplicate)
    expect(await service.terminalList(first.ownerId)).toEqual([])
    expect((await service.terminalScope({ serverId: 'server-a', placement: 'side' }, signal)).ownerId).not.toBe(first.ownerId)
    expect((await service.terminalScope({ serverId: 'server-b', placement: 'bottom' }, signal)).ownerId).not.toBe(first.ownerId)
    expect(sessions.get).not.toHaveBeenCalled()
    await expect(service.terminalWrite(first.ownerId, 'foreign-terminal', 'input', signal)).rejects.toThrow('此终端不属于当前范围')
  })

  it('rejects removed servers and allows retry after SSH connection failure', async () => {
    const { service } = controller()
    const signal = new AbortController().signal
    await expect(service.terminalScope({ serverId: 'missing', placement: 'bottom' }, signal)).rejects.toThrow('服务器已不存在')
    vi.mocked(service.probe).mockRejectedValueOnce(new Error('SSH disconnected'))
    await expect(service.terminalScope({ serverId: 'server-a', placement: 'bottom' }, signal)).rejects.toThrow('SSH disconnected')
    const result = await service.terminalScope({ serverId: 'server-a', placement: 'bottom' }, signal)
    expect(await service.terminalList(result.ownerId)).toEqual([])
  })
})
