import { describe, expect, it, vi } from 'vitest'
import { LingServersController } from '../src/host/server-controller.ts'
import { probeServer } from '../src/server-ssh.ts'

vi.mock('../src/server-ssh.ts', async importOriginal => ({
  ...await importOriginal<typeof import('../src/server-ssh.ts')>(),
  probeServer: vi.fn(async () => ({ home: '/home/developer' })),
}))

function controller() {
  const service = Object.create(LingServersController.prototype) as LingServersController
  const sessions = { get: vi.fn(async () => undefined), bind: vi.fn() }
  Object.assign(service, { sessions, operations: sessions,
    store: { list: async () => [{ id: 'server-a', name: 'A' }, { id: 'server-b', name: 'B' }] },
    draftTerminalBindings: new Map(), draftTerminalScopes: new Map(), taskTerminals: new Map() })
  return { service, sessions }
}

describe('server terminals before creating a task', () => {
  it('reuses each server/placement owner without creating a task binding', async () => {
    const { service, sessions } = controller()
    const signal = new AbortController().signal
    const [first, duplicate] = await Promise.all([
      service.terminalScope('server-a', 'bottom', signal), service.terminalScope('server-a', 'bottom', signal),
    ])
    expect(first).toEqual(duplicate)
    expect(await service.terminalList(first.ownerId)).toEqual([])
    expect((await service.terminalScope('server-a', 'side', signal)).ownerId).not.toBe(first.ownerId)
    expect((await service.terminalScope('server-b', 'bottom', signal)).ownerId).not.toBe(first.ownerId)
    expect(sessions.get).not.toHaveBeenCalled()
    expect(sessions.bind).not.toHaveBeenCalled()
    await expect(service.terminalWrite(first.ownerId, 'foreign-terminal', 'input', signal)).rejects.toThrow('此终端不属于当前任务')
  })

  it('rejects removed servers and allows retry after SSH connection failure', async () => {
    const { service } = controller()
    const signal = new AbortController().signal
    await expect(service.terminalScope('missing', 'bottom', signal)).rejects.toThrow('服务器已不存在')
    vi.mocked(probeServer).mockRejectedValueOnce(new Error('SSH disconnected'))
    await expect(service.terminalScope('server-a', 'bottom', signal)).rejects.toThrow('SSH disconnected')
    const result = await service.terminalScope('server-a', 'bottom', signal)
    expect(await service.terminalList(result.ownerId)).toEqual([])
  })
})
