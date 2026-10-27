import { EventEmitter } from 'node:events'
import { spawn, type ChildProcess } from 'node:child_process'
import { afterEach, expect, it, vi } from 'vitest'
import { DesktopHostProcess } from '../src/host-process.ts'
import { ServerBridge } from '../src/host/server-bridge.ts'

vi.mock('node:child_process', () => ({ spawn: vi.fn() }))

class FakeChild extends EventEmitter {
  connected = true
  stdout = { pipe: vi.fn() }
  stderr = { setEncoding: vi.fn(), on: vi.fn() }
  onSend?: (message: unknown) => void
  send = vi.fn((message: unknown) => { this.onSend?.(message); return true })
  kill = vi.fn(() => true)
}
const children: FakeChild[] = []
afterEach(() => { for (const child of children.splice(0)) child.emit('close', 0); vi.clearAllMocks() })

async function fixture() {
  const child = new FakeChild(); children.push(child)
  vi.mocked(spawn).mockReturnValue(child as unknown as ChildProcess)
  type Arguments = ConstructorParameters<typeof DesktopHostProcess>
  const run = vi.fn<NonNullable<Arguments[11]>>(async () => ({ stdout: 'ok', stderr: '', exitCode: 0 }))
  const file = vi.fn<NonNullable<Arguments[16]>>(async () => ({ path: '/remote/file', text: 'ok', sha256: 'a'.repeat(64), truncated: false }))
  const failure = vi.fn()
  const host = new DesktopHostProcess(process.execPath, '/runtime', '/project', undefined, {}, failure,
    undefined, 'link', undefined, '/host.js', undefined, run, undefined, undefined, undefined, undefined, file)
  const starting = host.start()
  child.emit('message', { type: 'ready', url: 'http://127.0.0.1:12345' })
  await starting
  const bridge = new ServerBridge(message => { child.emit('message', message) })
  child.onSend = message => { bridge.receive(message) }
  return { child, bridge, run, file, failure }
}

it('preserves the admitted endpoint through Bridge IPC to command and file callbacks', async () => {
  const { bridge, run, file, failure } = await fixture()
  const expectedEndpoint = 'example.test:2222:tester'
  const id = '00000000-0000-4000-8000-000000000001'
  const policy = { mode: 'read-only' as const, workspaceRoot: '/remote' }
  const signal = new AbortController().signal
  await expect(bridge.run(id, '/remote', 'pwd', signal, undefined, undefined, policy, expectedEndpoint)).resolves.toMatchObject({ stdout: 'ok' })
  expect(run).toHaveBeenCalledExactlyOnceWith(id, '/remote', 'pwd', expect.any(AbortSignal), undefined, undefined, policy, expectedEndpoint)
  const request = { action: 'read' as const, serverId: id, path: '/remote/file' }
  await expect(bridge.file(request, signal, expectedEndpoint)).resolves.toMatchObject({ text: 'ok' })
  expect(file).toHaveBeenCalledExactlyOnceWith(request, expect.any(AbortSignal), expectedEndpoint)
  expect(failure).not.toHaveBeenCalled()
})

it.each(['server-request', 'server-file-request'])('rejects malformed expectedEndpoint on %s before dispatching it', async type => {
  const { child, run, file, failure } = await fixture()
  const serverId = '00000000-0000-4000-8000-000000000001'
  child.emit('message', { type, requestId: 1, expectedEndpoint: 42, serverId, cwd: '/remote', command: 'pwd', request: { action: 'read', serverId, path: '/remote/file' } })
  await Promise.resolve()
  expect(run).not.toHaveBeenCalled()
  expect(file).not.toHaveBeenCalled()
  expect(failure).toHaveBeenCalledOnce()
  expect(child.kill).toHaveBeenCalledExactlyOnceWith('SIGTERM')
})
