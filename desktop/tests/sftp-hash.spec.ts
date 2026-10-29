import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import type { SFTPWrapper, Stats } from 'ssh2'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { SftpFiles } from '../src/sftp-files.ts'

const chunkSize = 64 * 1024
const handle = Buffer.from('file-handle')
type ReadReply = (error: Error | null, count: number) => void
function mockChannel(data: Buffer, options: {
  shortReads?: boolean
  stall?: 'open' | 'fstat' | 'read' | 'close'
  reportedSize?: number
  changedMtime?: boolean
} = {}) {
  const events = new EventEmitter()
  let active = 0, peak = 0, stats = 0
  const replies: Array<() => void> = []
  const received: number[] = []
  const complete = (operation: typeof options.stall, reply: () => void) => {
    if (operation === options.stall) replies.push(reply)
    else queueMicrotask(reply)
  }
  const channel = Object.assign(events, {
    open: vi.fn((_path: string, _flags: string, done: (error: Error | null, value: Buffer) => void) => complete('open', () => done(null, handle))),
    fstat: vi.fn((_handle: Buffer, done: (error: Error | null, value: Stats) => void) => {
      stats++
      const value = { size: options.reportedSize ?? data.length, mtime: options.changedMtime && stats > 1 ? 2 : 1,
        mode: 0o100644, isFile: () => true } as Stats
      complete('fstat', () => done(null, value))
    }),
    read: vi.fn((_handle: Buffer, buffer: Buffer, start: number, length: number, offset: number, done: ReadReply) => {
      peak = Math.max(peak, ++active)
      const reply = () => {
        active--; received.push(offset)
        const size = Math.max(0, Math.min(length, data.length - offset, options.shortReads ? 7001 : Infinity))
        data.copy(buffer, start, offset, offset + size)
        done(null, size)
      }
      if (options.stall === 'read') replies.push(reply)
      else setTimeout(reply, Math.floor(offset / chunkSize) % 3 === 0 ? 3 : 1)
    }),
    close: vi.fn((_handle: Buffer, done: (error: Error | null) => void) => complete('close', () => done(null))),
    end: vi.fn(() => { events.emit('close') }),
  })
  return { channel: channel as unknown as SFTPWrapper, methods: channel, replies, received, get peak() { return peak } }
}
beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

it('hashes bounded concurrent, out-of-order short reads in file order and reports verification progress', async () => {
  const data = Buffer.alloc(chunkSize * 70 + 123)
  for (let at = 0; at < data.length; at++) data[at] = at % 251
  const remote = mockChannel(data, { shortReads: true })
  const progress: Array<[number, number]> = []
  const result = new SftpFiles(remote.channel).hash('/large', undefined, (bytes, total) => progress.push([bytes, total]))
  const checked = expect(result).resolves.toBe(createHash('sha256').update(data).digest('hex'))
  await vi.runAllTimersAsync(); await checked
  expect(remote.peak).toBe(32)
  expect(remote.received[0]).not.toBe(0)
  expect(progress[0]).toEqual([0, data.length])
  expect(progress.at(-1)).toEqual([data.length, data.length])
  expect(progress.every(([bytes, total], i) => total === data.length && (i === 0 || bytes > progress[i - 1]![0]))).toBe(true)
  expect(remote.methods.close).toHaveBeenCalledExactlyOnceWith(handle, expect.any(Function))
  expect(remote.methods.end).not.toHaveBeenCalled()
  expect(vi.getTimerCount()).toBe(0)
})

it('hashes empty files and emits a zero-byte verification state', async () => {
  const remote = mockChannel(Buffer.alloc(0))
  const progress = vi.fn()
  const checked = expect(new SftpFiles(remote.channel).hash('/empty', undefined, progress))
    .resolves.toBe(createHash('sha256').digest('hex'))
  await vi.runAllTimersAsync(); await checked
  expect(progress).toHaveBeenCalledExactlyOnceWith(0, 0)
  expect(remote.methods.read).toHaveBeenCalledTimes(1)
  expect(remote.methods.close).toHaveBeenCalledTimes(1)
  expect(vi.getTimerCount()).toBe(0)
})

it.each(['truncated', 'grown', 'modified'] as const)('rejects a %s file rather than returning a partial or stale digest', async change => {
  const data = Buffer.alloc(chunkSize * 2 + 5, 6)
  const remote = mockChannel(data, change === 'modified' ? { changedMtime: true }
    : { reportedSize: data.length + (change === 'truncated' ? 1 : -1) })
  const checked = expect(new SftpFiles(remote.channel).hash('/changing')).rejects.toThrow('校验期间发生变化')
  await vi.runAllTimersAsync(); await checked
  expect(remote.methods.close).toHaveBeenCalledTimes(1)
  expect(vi.getTimerCount()).toBe(0)
})

it.each(['open', 'fstat', 'read', 'close'] as const)('bounds an unanswered %s request and ignores late replies after closing the channel', async stall => {
  const remote = mockChannel(Buffer.alloc(chunkSize * 2), { stall })
  const files = new SftpFiles(remote.channel, { requestTimeoutMs: 25 })
  const checked = expect(files.hash('/stalled')).rejects.toThrow('SFTP 请求超时')
  await vi.runAllTimersAsync(); await checked
  expect(remote.methods.end).toHaveBeenCalledTimes(1)
  const reads = remote.methods.read.mock.calls.length
  for (const reply of remote.replies) reply()
  await vi.runAllTimersAsync()
  await expect(files.stat('/later')).rejects.toThrow('SFTP 请求超时')
  expect(remote.methods.read).toHaveBeenCalledTimes(reads)
  expect(remote.methods.end).toHaveBeenCalledTimes(1)
  expect(vi.getTimerCount()).toBe(0)
})

it('times out a mutation once and fails other pending requests without retrying the mutation', async () => {
  const remote = mockChannel(Buffer.alloc(0))
  const callbacks: Array<(error: Error | null, value?: string) => void> = []
  const mkdir = vi.fn((_path, _attrs, done) => callbacks.push(done))
  const realpath = vi.fn((_path, done) => callbacks.push(done))
  Object.assign(remote.channel, { mkdir, realpath })
  const files = new SftpFiles(remote.channel, { requestTimeoutMs: 25 })
  const checked = Promise.all([
    expect(files.mkdir('/new')).rejects.toThrow('超时'),
    expect(files.realpath('/')).rejects.toThrow('超时'),
  ])
  await vi.runAllTimersAsync(); await checked
  for (const callback of callbacks) callback(null, '/')
  expect(mkdir).toHaveBeenCalledTimes(1)
  expect(realpath).toHaveBeenCalledTimes(1)
  expect(remote.methods.end).toHaveBeenCalledTimes(1)
  expect(vi.getTimerCount()).toBe(0)
})

it('cancels an unanswered READ promptly, closes its handle and ignores late data without killing shared users', async () => {
  const remote = mockChannel(Buffer.alloc(chunkSize * 64, 4), { stall: 'read' })
  const controller = new AbortController()
  const progress = vi.fn()
  const checked = expect(new SftpFiles(remote.channel).hash('/cancel', controller.signal, progress)).rejects.toThrow('cancel hash')
  await vi.advanceTimersByTimeAsync(0)
  expect(remote.methods.read).toHaveBeenCalledTimes(32)
  controller.abort(new Error('cancel hash'))
  await vi.advanceTimersByTimeAsync(0); await checked
  expect(remote.methods.close).toHaveBeenCalledTimes(1)
  expect(remote.methods.end).not.toHaveBeenCalled()
  for (const reply of remote.replies) reply()
  await vi.runAllTimersAsync()
  expect(progress).toHaveBeenCalledExactlyOnceWith(0, chunkSize * 64)
  expect(remote.methods.read).toHaveBeenCalledTimes(32)
  expect(vi.getTimerCount()).toBe(0)
})

it('closes a handle returned after cancellation during OPEN', async () => {
  const remote = mockChannel(Buffer.from('data'), { stall: 'open' })
  const controller = new AbortController()
  const checked = expect(new SftpFiles(remote.channel).hash('/cancel-open', controller.signal)).rejects.toThrow('cancel open')
  controller.abort(new Error('cancel open')); await checked
  expect(vi.getTimerCount()).toBe(0)
  remote.replies[0]!()
  await vi.runAllTimersAsync()
  expect(remote.methods.close).toHaveBeenCalledTimes(1)
  expect(remote.methods.read).not.toHaveBeenCalled()
  expect(remote.methods.end).not.toHaveBeenCalled()
  expect(vi.getTimerCount()).toBe(0)
})

it('returns promptly when cancelled during CLOSE and still supervises handle cleanup', async () => {
  const remote = mockChannel(Buffer.from('data'), { stall: 'close' })
  const controller = new AbortController()
  const checked = expect(new SftpFiles(remote.channel, { requestTimeoutMs: 25 })
    .hash('/cancel-close', controller.signal)).rejects.toThrow('cancel close')
  await vi.advanceTimersByTimeAsync(10)
  expect(remote.methods.close).toHaveBeenCalledTimes(1)
  controller.abort(new Error('cancel close')); await checked
  expect(remote.methods.end).not.toHaveBeenCalled()
  expect(vi.getTimerCount()).toBe(1)
  remote.replies[0]!()
  await vi.runAllTimersAsync()
  expect(remote.methods.end).not.toHaveBeenCalled()
  expect(vi.getTimerCount()).toBe(0)
})
