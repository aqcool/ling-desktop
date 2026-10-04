import { describe, expect, it } from 'vitest'
import { ServerBridge } from '../src/host/server-bridge.ts'

describe('server bridge', () => {
  it('carries resolved session policy to file and process providers and validates file results', async () => {
    const sent: object[] = []
    const bridge = new ServerBridge(message => { sent.push(message) })
    const policy = { mode: 'read-only' as const, workspaceRoot: '/remote' }
    const signal = new AbortController().signal
    const command = bridge.run('server', '/remote', 'pwd', signal, undefined, undefined, policy)
    expect(sent[0]).toMatchObject({ policy })
    bridge.receive({ type: 'server-response', requestId: 1, result: { stdout: '/remote', stderr: '', exitCode: 0 } })
    await command
    const request = { action: 'write' as const, serverId: 'server', path: '/remote/a', text: 'text', expected: null, policy }
    const writing = bridge.file(request, signal)
    expect(sent[1]).toMatchObject({ type: 'server-file-request', request })
    bridge.receive({ type: 'server-response', requestId: 2, result: { path: '/remote/a', sha256: 'a'.repeat(64) } })
    await expect(writing).resolves.toMatchObject({ sha256: 'a'.repeat(64) })
    const reading = bridge.file({ action: 'read', serverId: 'server', path: '/remote/a' }, signal)
    bridge.receive({ type: 'server-response', requestId: 3, result: { path: '/remote/a', text: 'partial' } })
    await expect(reading).rejects.toThrow('无效结果')
  })
  it('streams correlated output before completion, and ignores late or private terminal output', async () => {
    const sent: object[] = []
    const output: string[] = []
    const bridge = new ServerBridge(message => { sent.push(message) })
    const controller = new AbortController()
    const request = bridge.run('server', '/srv', 'make', controller.signal, undefined, chunk => output.push(chunk.data))
    expect(sent[0]).toMatchObject({ stream: true })
    bridge.receive({ type: 'server-output', requestId: 1, stream: 'stdout', data: 'building\n' })
    bridge.receive({ type: 'server-output', requestId: 9, stream: 'stderr', data: 'other request' })
    expect(output).toEqual(['building\n'])
    controller.abort()
    await expect(request).rejects.toThrow('取消')
    bridge.receive({ type: 'server-output', requestId: 1, stream: 'stdout', data: 'late' })
    expect(output).toEqual(['building\n'])
    const terminal = bridge.terminalPoll('private-terminal', 0, new AbortController().signal)
    bridge.receive({ type: 'server-output', requestId: 2, stream: 'stdout', data: 'private input' })
    bridge.receive({ type: 'server-response', requestId: 2, result: { terminalId: 'private-terminal', offset: 0, data: '', closed: false } })
    await terminal
    expect(output).toEqual(['building\n'])
  })
  it('correlates command results and cancels an aborted request without replaying it', async () => {
    const sent: object[] = []
    const bridge = new ServerBridge(message => { sent.push(message) })
    const first = bridge.run('server-1', '/home/tester', 'pwd', new AbortController().signal)
    expect(sent[0]).toMatchObject({ type: 'server-request', serverId: 'server-1', cwd: '/home/tester', command: 'pwd' })
    expect(bridge.receive({ type: 'server-response', requestId: 1, result: { stdout: '/home/tester\n', stderr: '', exitCode: 0 } })).toBe(true)
    await expect(first).resolves.toMatchObject({ exitCode: 0 })
    const controller = new AbortController()
    const second = bridge.run('server-1', '/home/tester', 'touch file', controller.signal)
    controller.abort()
    await expect(second).rejects.toThrow('已取消')
    expect(sent.at(-1)).toEqual({ type: 'server-cancel', requestId: 2 })
    expect(bridge.receive({ type: 'server-response', requestId: 2, result: { stdout: '', stderr: '', exitCode: 0 } })).toBe(true)
    bridge.close()
  })

  it('correlates a planned upload result and rejects a response of the wrong kind', async () => {
    const sent: object[] = []
    const bridge = new ServerBridge(message => { sent.push(message) })
    const upload = bridge.upload('server-1', '/work', 'app.txt', '/srv/app.txt', 'a'.repeat(64), null, new AbortController().signal)
    expect(sent[0]).toMatchObject({ type: 'server-upload-request', root: '/work', source: 'app.txt', destination: '/srv/app.txt' })
    bridge.receive({ type: 'server-response', requestId: 1, result: { destination: '/srv/app.txt', bytes: 10, sha256: 'a'.repeat(64) } })
    await expect(upload).resolves.toMatchObject({ bytes: 10 })
    const wrong = bridge.upload('server-1', '/work', 'app.txt', '/srv/app.txt', 'a'.repeat(64), null, new AbortController().signal)
    bridge.receive({ type: 'server-response', requestId: 2, result: { stdout: '', stderr: '', exitCode: 0 } })
    await expect(wrong).rejects.toThrow('无效结果')
  })

  it('routes a reviewed download through the broker request channel', async () => {
    const sent: object[] = []
    const bridge = new ServerBridge(message => { sent.push(message) })
    const download = bridge.download('server-1', '/work', '/srv/app.log', 'logs/app.log', 'a'.repeat(64), null, new AbortController().signal)
    expect(sent[0]).toMatchObject({ type: 'server-download-request', source: '/srv/app.log', destination: 'logs/app.log' })
    bridge.receive({ type: 'server-response', requestId: 1, result: { destination: 'logs/app.log', bytes: 8, sha256: 'a'.repeat(64) } })
    await expect(download).resolves.toMatchObject({ bytes: 8 })
  })
})
