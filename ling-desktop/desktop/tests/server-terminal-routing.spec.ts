import { describe, expect, it } from 'vitest'
import { LingServersController } from '../src/host/server-controller.ts'

function controller(direct: boolean, operations: boolean) {
  const binding = { serverId: 'server-id', cwd: '/srv/app' }
  const service = Object.create(LingServersController.prototype) as LingServersController
  Object.assign(service, {
    sessions: { get: async () => direct ? binding : null },
    operations: { get: async () => operations ? binding : null },
    taskTerminals: new Map(),
    terminalUiRequests: new Set(['task']),
  })
  return service
}

describe('server terminal task routing', () => {
  it('accepts both direct remote tasks and local tasks with an operations server', async () => {
    for (const [direct, operations] of [[true, false], [false, true]] as const) {
      const service = controller(direct, operations)
      expect(await service.terminalList('task')).toEqual([])
      expect(await service.takeTerminalUiRequest('task')).toEqual({ open: true })
      expect(await service.takeTerminalUiRequest('task')).toEqual({ open: false })
    }
  })

  it('rejects terminal access from a task with no server binding', async () => {
    const service = controller(false, false)
    await expect(service.terminalList('task')).rejects.toThrow('此任务未绑定远端服务器')
    await expect(service.takeTerminalUiRequest('task')).rejects.toThrow('此任务未绑定远端服务器')
  })
})
