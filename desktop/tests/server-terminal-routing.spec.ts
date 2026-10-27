import { describe, expect, it } from 'vitest'
import { LingServersController } from '../src/host/server-controller.ts'

function controller() {
  const service = Object.create(LingServersController.prototype) as LingServersController
  Object.assign(service, {
    draftTerminalBindings: new Map([
      ['owner-a', { taskId: 'task', serverId: 'server-a', cwd: '/srv/a' }],
      ['owner-b', { taskId: 'task', serverId: 'server-b', cwd: '/srv/b' }],
    ]),
    taskTerminals: new Map([['owner-a', new Set(['terminal-a'])]]),
    terminalUiRequests: new Map([['task', 'server-b']]),
  })
  return service
}

describe('server terminal owner routing', () => {
  it('keeps terminal ownership and UI requests tied to the selected server', async () => {
    const service = controller()
    expect(await service.terminalList('owner-a')).toEqual(['terminal-a'])
    expect(await service.terminalList('owner-b')).toEqual([])
    expect(await service.takeTerminalUiRequest('task')).toEqual({ open: true, serverId: 'server-b' })
    expect(await service.takeTerminalUiRequest('task')).toEqual({ open: false })
  })

  it('rejects task IDs and unknown scopes as terminal owner IDs', async () => {
    const service = controller()
    await expect(service.terminalList('task')).rejects.toThrow('终端范围已不存在')
    await expect(service.terminalList('missing')).rejects.toThrow('终端范围已不存在')
    expect(await service.takeTerminalUiRequest('missing')).toEqual({ open: false })
  })
})
