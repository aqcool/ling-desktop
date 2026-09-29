import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ServerExecutionRecorder } from '../src/host/server-execution-recorder.ts'
import type { ServerOutput } from '../src/server-execution.ts'

const homes: string[] = []
afterEach(async () => { await Promise.all(homes.splice(0).map(home => rm(home, { recursive: true, force: true }))) })
const start = { callId: 'call-1', summary: '构建项目', server: '测试服务器', cwd: '/srv/app', command: 'make' }

describe('server execution presentation', () => {
  it('publishes live output and keeps it after failure and a new recorder instance', async () => {
    const home = await mkdtemp(join(tmpdir(), 'ling-execution-')); homes.push(home)
    const recorder = new ServerExecutionRecorder(home)
    let output!: (chunk: ServerOutput) => void
    let reject!: (error: Error) => void
    let ready!: () => void
    const started = new Promise<void>(resolve => { ready = resolve })
    const running = recorder.run('task', start, new AbortController().signal, stream => {
      output = stream; ready()
      return new Promise((_resolve, fail) => { reject = fail })
    })
    const failure = expect(running).rejects.toThrow('SSH 连接已断开')
    await started
    expect(await new ServerExecutionRecorder(home).list('task', ['call-1'])).toMatchObject([{ status: 'interrupted' }])
    output({ stream: 'stdout', data: 'step 1\n' }); output({ stream: 'stderr', data: 'compile failed\n' })
    expect(await recorder.list('task', ['call-1'])).toMatchObject([{ status: 'running', output: 'step 1\ncompile failed\n' }])
    expect(await recorder.list('another-task', ['call-1'])).toEqual([])
    reject(new Error('SSH 连接已断开'))
    await failure
    expect(await new ServerExecutionRecorder(home).list('task', ['call-1'])).toMatchObject([{ status: 'failed', output: 'step 1\ncompile failed\n', error: 'SSH 连接已断开' }])
  })

  it('settles nonzero exits and cancellation without retrying the command', async () => {
    const home = await mkdtemp(join(tmpdir(), 'ling-execution-')); homes.push(home)
    const recorder = new ServerExecutionRecorder(home)
    const controller = new AbortController()
    let calls = 0
    await recorder.run('task', start, controller.signal, async output => {
      calls++; output({ stream: 'stderr', data: 'build failed' }); return { stdout: '', stderr: 'build failed', exitCode: 2 }
    })
    expect(await recorder.list('task', ['call-1'])).toMatchObject([{ status: 'failed', exitCode: 2 }])
    await expect(recorder.run('task', { ...start, callId: 'cancel' }, controller.signal, async () => {
      calls++; controller.abort(); throw new Error('已取消')
    })).rejects.toThrow('取消')
    expect(await recorder.list('task', ['cancel'])).toMatchObject([{ status: 'interrupted' }])
    expect(calls).toBe(2)
  })
})
