import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { LingReadResult, LingServerService } from 'ling-desktop/runtime'
import type { LingServersRemote } from '../server-contract.ts'

function unavailable<Value>(message = '服务器服务暂时不可用。'): LingReadResult<Value> {
  return { ok: false, reason: 'runtime-unavailable', message, retryable: true }
}

export function createDshServerProjection(
  remote: () => LingServersRemote | undefined,
  mounted: Promise<unknown>,
): LingServerService {
  async function request<Value>(call: (service: LingServersRemote) => Promise<RemoteResult<Value>>): Promise<LingReadResult<Value>> {
    try { await mounted }
    catch { return unavailable('服务器服务初始化失败，请重启 LING。') }
    try {
      const service = remote()
      if (!service) return unavailable()
      const result = await call(service)
      return result.ok ? result : unavailable(result.error.message || '服务器操作失败。')
    } catch {
      return unavailable('服务器操作失败，请重试。')
    }
  }
  return {
    list: () => request(service => service.list()),
    add: input => request(service => service.add(input)),
    update: (id, input) => request(service => service.configure(id, input)),
    remove: id => request(service => service.forget(id)),
    probe: (id, signal) => request(service => service.probe(id, signal)),
    directories: (id, path, signal) => request(service => service.directories(id, path, signal)),
    bindTask: (taskId, serverId, home) => request(service => service.bindTask(taskId, serverId, home)),
    taskBinding: taskId => request(service => service.taskBinding(taskId)),
    attachOperations: (taskId, serverId, home) => request(service => service.attachOperations(taskId, serverId, home)),
    operationsBinding: taskId => request(service => service.operationsBinding(taskId)),
    takeTerminalUiRequest: taskId => request(service => service.takeTerminalUiRequest(taskId)),
    terminalList: taskId => request(service => service.terminalList(taskId)),
    terminalOpen: (taskId, cols, rows, signal) => request(service => service.terminalOpen(taskId, cols, rows, signal)),
    terminalPoll: (taskId, terminalId, offset, signal) => request(service => service.terminalPoll(taskId, terminalId, offset, signal)),
    terminalWrite: (taskId, terminalId, data, signal) => request(service => service.terminalWrite(taskId, terminalId, data, signal)),
    terminalResize: (taskId, terminalId, cols, rows, signal) => request(service => service.terminalResize(taskId, terminalId, cols, rows, signal)),
    terminalClose: (taskId, terminalId, signal) => request(service => service.terminalClose(taskId, terminalId, signal)),
    filesList: (taskId, path, signal) => request(service => service.filesList(taskId, path, signal)),
    filesRead: (taskId, path, signal) => request(service => service.filesRead(taskId, path, signal)),
    filesSave: (taskId, path, text, expectedSha256, signal) => request(service => service.filesSave(taskId, path, text, expectedSha256, signal)),
    gitRequest: (taskId, action, signal) => request(service => service.gitRequest(taskId, action, signal)),
  }
}
