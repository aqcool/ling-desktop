import { createServer } from 'node:http'
import { connect, type Socket } from 'node:net'
import { createLaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment'
import { installProxyFromEnvironment } from '@deepseek-ai/dsh-http-proxy'
import { describe, expect, it, vi } from 'vitest'
import { withSystemProxy } from '../src/host/system-proxy.ts'

const snapshot = (values: Record<string, string> = {}) => createLaunchEnvironmentSnapshot([{ source: 'user-env', values }])
const config = (port = 7890) => `<dictionary> {
  ExceptionsList : <array> {
    0 : localhost
    1 : *.local
  }
  HTTPEnable : 1
  HTTPProxy : 127.0.0.1
  HTTPPort : ${port}
  HTTPSEnable : 1
  HTTPSProxy : 127.0.0.1
  HTTPSPort : ${port}
}`

describe('desktop system proxy', () => {
  it('inherits enabled static proxies and system exceptions', async () => {
    const env = await withSystemProxy(snapshot(), { platform: 'darwin', read: async () => config() })
    expect(env.get('HTTPS_PROXY')?.value).toBe('http://127.0.0.1:7890/')
    expect(env.get('NO_PROXY')?.value).toBe('localhost,*.local')
    expect(env.getFrom('HTTPS_PROXY', ['user-env'])).toBeUndefined()
  })

  it.each(['HTTPS_PROXY', 'http_proxy', 'ALL_PROXY'])('preserves explicit %s, including empty values', async name => {
    for (const value of ['http://explicit.test:8080', '']) {
      const original = snapshot({ [name]: value })
      const read = vi.fn(async () => config())
      expect(await withSystemProxy(original, { platform: 'darwin', read })).toBe(original)
      expect(read).not.toHaveBeenCalled()
    }
  })

  it('preserves a user bypass list and disabled proxy state', async () => {
    const env = await withSystemProxy(snapshot({ NO_PROXY: 'example.test' }), { platform: 'darwin', read: async () => config() })
    expect(env.get('NO_PROXY')?.value).toBe('example.test')
    const disabled = await withSystemProxy(snapshot(), { platform: 'darwin', read: async () => config().replaceAll('Enable : 1', 'Enable : 0') })
    expect(disabled.get('HTTPS_PROXY')).toBeUndefined()
    const httpOnly = snapshot()
    expect(await withSystemProxy(httpOnly, {
      platform: 'darwin', read: async () => config().replace('HTTPSEnable : 1', 'HTTPSEnable : 0'), warn: () => {},
    })).toBe(httpOnly)
  })

  it('does not guess a static proxy from PAC or probe other platforms', async () => {
    const original = snapshot()
    const warn = vi.fn()
    expect(await withSystemProxy(original, { platform: 'darwin', read: async () => `${config()}\nProxyAutoConfigEnable : 1`, warn })).toBe(original)
    expect(warn).toHaveBeenCalledOnce()
    const read = vi.fn()
    expect(await withSystemProxy(original, { platform: 'win32', read })).toBe(original)
    expect(read).not.toHaveBeenCalled()
  })

  it('routes real Node fetch through DSH proxy installation while bypassing loopback', async () => {
    const origin = createServer((_req, res) => { res.end('origin') })
    const targets: string[] = []
    const proxy = createServer((req, res) => { targets.push(req.url ?? ''); res.end('origin') })
    const sockets = new Set<Socket>()
    proxy.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)) })
    await new Promise<void>(resolve => origin.listen(0, '127.0.0.1', resolve))
    const originPort = (origin.address() as { port: number }).port
    proxy.on('connect', (req, socket, head) => {
      targets.push(req.url ?? '')
      const upstream = connect(originPort, '127.0.0.1', () => {
        socket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
        if (head.length) upstream.write(head)
        socket.pipe(upstream).pipe(socket)
      })
      socket.on('error', () => upstream.destroy())
      socket.on('close', () => upstream.destroy())
      upstream.on('error', () => socket.destroy())
    })
    await new Promise<void>(resolve => proxy.listen(0, '127.0.0.1', resolve))
    let dispose: (() => Promise<void>) | undefined
    try {
      const env = await withSystemProxy(snapshot(), { platform: 'darwin', read: async () => config((proxy.address() as { port: number }).port) })
      dispose = await installProxyFromEnvironment(env, () => {})
      expect(await (await fetch('http://oauth.test/token', { signal: AbortSignal.timeout(2000) })).text()).toBe('origin')
      expect(targets).toHaveLength(1)
      expect(['oauth.test:80', 'http://oauth.test/token']).toContain(targets[0])
      expect(await (await fetch(`http://127.0.0.1:${originPort}/callback`, { signal: AbortSignal.timeout(2000) })).text()).toBe('origin')
      expect(targets).toHaveLength(1)
    } finally {
      for (const socket of sockets) socket.destroy()
      origin.closeAllConnections()
      await dispose?.()
      await Promise.all([new Promise<void>(resolve => origin.close(() => resolve())), new Promise<void>(resolve => proxy.close(() => resolve()))])
    }
  })
})
