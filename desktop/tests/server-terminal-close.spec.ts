import { PassThrough } from 'node:stream'
import type { SubprocessOutcome, SubprocessTerminalHandle } from '@deepseek-ai/dsh-subprocess'
import { describe, expect, it, vi } from 'vitest'
import { ServerBroker } from '../src/server-broker.ts'
import type { DshRemoteRuntime } from '../src/ssh/runtime.ts'

function terminal() {
  const done = Promise.withResolvers<SubprocessOutcome>()
  const handle: SubprocessTerminalHandle = {
    pid: 1, output: new PassThrough(), done: done.promise,
    write: vi.fn(async () => {}), resize: vi.fn(async () => {}), terminate: vi.fn(async () => {}),
    inspectForeground: async () => undefined,
    inspectActivity: async () => ({ state: 'unknown', revision: 0 }),
    signalForeground: async () => 1,
  }
  return { handle, done }
}

function fixture(...handles: SubprocessTerminalHandle[]) {
  const broker = new ServerBroker('/unused-terminal-close-fixture', {
    available: async () => false,
    encrypt: async () => { throw new Error('Unexpected credential access') },
    decrypt: async () => { throw new Error('Unexpected credential access') },
  })
  const runtime: Pick<DshRemoteRuntime, 'terminal' | 'close'> = {
    terminal: vi.fn(async () => handles.shift()!), close: vi.fn(async () => {}),
  }
  vi.spyOn(broker as unknown as { runtime(): Promise<typeof runtime> }, 'runtime').mockResolvedValue(runtime)
  return { broker, runtime }
}

describe('explicit remote terminal dismissal', () => {
  it.each(['exited', 'disconnected'])('discards an already %s terminal without another remote termination', async state => {
    const { handle, done } = terminal()
    const { broker } = fixture(handle)
    const { terminalId } = await broker.terminalOpen('server', '/', 80, 24)
    if (state === 'exited') done.resolve({ exitCode: 0, signal: null })
    else done.reject(new Error('SSH connection lost'))
    await Promise.resolve()
    expect(await broker.terminalPoll(terminalId, 0)).toMatchObject({ closed: true })

    await expect(broker.terminalClose(terminalId)).resolves.toBeUndefined()
    expect(handle.terminate).not.toHaveBeenCalled()
    await expect(broker.terminalPoll(terminalId, 0)).rejects.toThrow('不存在')
    await expect(broker.terminalClose(terminalId)).resolves.toBeUndefined()
  })

  it.each(['SSH operation cancelled; a completed remote mutation is not rolled back', 'SSH connection lost'])(
    'discards only the requested terminal when cleanup fails with %s', async message => {
      const first = terminal(), second = terminal()
      vi.mocked(first.handle.terminate).mockRejectedValue(new Error(message))
      const { broker, runtime } = fixture(first.handle, second.handle)
      const closed = await broker.terminalOpen('server', '/', 80, 24)
      const live = await broker.terminalOpen('server', '/', 80, 24)

      await expect(broker.terminalClose(closed.terminalId)).rejects.toThrow(message)
      await expect(broker.terminalPoll(closed.terminalId, 0)).rejects.toThrow('不存在')
      expect(runtime.close).not.toHaveBeenCalled()
      expect(second.handle.terminate).not.toHaveBeenCalled()
      await broker.terminalWrite(live.terminalId, 'still live')
      expect(second.handle.write).toHaveBeenCalledWith('still live')
      expect(await broker.terminalPoll(live.terminalId, 0)).toMatchObject({ closed: false })

      // A failure on a tab the user did not close must still reach its view.
      second.done.reject(new Error('Unexpected live transport failure'))
      await Promise.resolve()
      expect(await broker.terminalPoll(live.terminalId, 0)).toMatchObject({
        closed: true, error: 'Unexpected live transport failure',
      })
    },
  )
})
