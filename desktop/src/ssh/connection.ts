import type { Client, ClientChannel } from 'ssh2'
import type { Socket } from 'node:net'
import { connect as connectTls, getCiphers } from 'node:tls'
import { z } from 'zod'
import { SshRpcPeer, SSH_PROTOCOL_VERSION } from '@deepseek-ai/dsh-ssh/protocol'
import { helloSchema, type SshStreamEndpoint } from '@deepseek-ai/dsh-ssh/schemas'
import type { RemoteConnection } from './runtime.ts'
import { relaySshStream } from './stream-relay.ts'

const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`

/** Adapts an already authenticated/pinned ssh2 connection to the public DSH seam. */
export class BrokerSshConnection implements RemoteConnection {
  readonly ready: Promise<z.infer<typeof helloSchema>>
  private peer?: SshRpcPeer
  private remote?: z.infer<typeof helloSchema>
  private timer?: ReturnType<typeof setInterval>
  private failure?: Error
  private readonly streams = new Set<Socket>()
  private readonly lifetime = new AbortController()
  constructor(private readonly client: Client, node: string, helper: string, hash: string, workspace: string) {
    this.ready = this.start(node, helper, hash, workspace)
    void this.ready.catch(error => this.fail(error))
    client.once('close', () => this.fail(new Error('SSH 连接已断开；远端执行结果需要重新确认。')))
    client.on('error', () => this.fail(new Error('SSH 连接失败。')))
  }
  get nodeExecutable() { if (!this.remote) throw new Error('远端运行时未就绪。'); return this.remote.node }
  get bootstrapPath(): string { throw new Error('此连接未配置 PTC 引导程序。') }
  private async start(node: string, helper: string, hash: string, workspace: string) {
    const stream = await new Promise<ClientChannel>((resolve, reject) => this.client.exec(
      `${quote(node)} --disable-sigusr1 ${quote(helper)}`, (error, channel) => error ? reject(error) : resolve(channel)))
    stream.stderr.resume()
    const peer = new SshRpcPeer(stream, stream, 64 * 1024 * 1024, 128)
    this.peer = peer
    peer.once('closed', error => this.fail(error))
    const hello = await peer.request('hello', { protocol: SSH_PROTOCOL_VERSION, workspace, leaseMs: 30_000 }, helloSchema, AbortSignal.timeout(30_000))
    if (hello.hash !== hash) throw new Error('远端辅助程序校验失败。')
    this.remote = hello
    let pending = false
    this.timer = setInterval(() => {
      if (pending) return
      pending = true
      void peer.request('heartbeat', {}, z.null(), AbortSignal.timeout(10_000))
        .catch(error => this.fail(error)).finally(() => { pending = false })
    }, 10_000)
    this.timer.unref()
    return hello
  }
  async request<T>(method: string, params: unknown, schema: z.ZodType<T>, signal?: AbortSignal, wait = false): Promise<T> {
    await this.ready
    if (this.failure) throw this.failure
    const signals = [this.lifetime.signal, ...(signal ? [signal] : []), ...(wait ? [] : [AbortSignal.timeout(30_000)])]
    return this.peer!.request(method, params, schema, AbortSignal.any(signals))
  }
  async connectStream(endpoint: SshStreamEndpoint, signal?: AbortSignal): Promise<Socket> {
    const hello = await this.ready
    const combined = AbortSignal.any([this.lifetime.signal, ...(signal ? [signal] : []), AbortSignal.timeout(30_000)])
    combined.throwIfAborted()
    if (!endpoint.path.startsWith(`${hello.root}/`) || /[\r\n\0]/.test(endpoint.path)) throw new Error('远端数据通道无效。')
    if (!getCiphers().includes('psk-aes256-gcm-sha384')) {
      const stream = await relaySshStream(this.client, hello.node, endpoint, combined)
      this.streams.add(stream)
      const cancel = () => stream.destroy(new Error('远端数据通道已取消。'))
      signal?.addEventListener('abort', cancel, { once: true })
      stream.once('close', () => { this.streams.delete(stream); signal?.removeEventListener('abort', cancel) })
      if (signal?.aborted || this.lifetime.signal.aborted) { stream.destroy(); (signal?.aborted ? signal : this.lifetime.signal).throwIfAborted() }
      return stream
    }
    const channel = await new Promise<ClientChannel>((resolve, reject) => {
      const abort = () => reject(combined.reason)
      combined.addEventListener('abort', abort, { once: true })
      this.client.openssh_forwardOutStreamLocal(endpoint.path, (error, stream) => {
        combined.removeEventListener('abort', abort)
        if (combined.aborted) { stream?.destroy(); reject(combined.reason) }
        else if (error) reject(error)
        else resolve(stream)
      })
      if (combined.aborted) abort()
    })
    // Match the upstream helper's authenticated stream protocol, including TLS-PSK.
    const stream = connectTls({ socket: channel as unknown as Socket, ciphers: 'PSK-AES256-GCM-SHA384',
      minVersion: 'TLSv1.2', maxVersion: 'TLSv1.2', rejectUnauthorized: true,
      pskCallback: () => ({ psk: Buffer.from(endpoint.capability, 'hex'), identity: 'dsh-stream' }), checkServerIdentity: () => undefined })
    const abort = () => stream.destroy(new Error('远端数据通道已取消。'))
    combined.addEventListener('abort', abort, { once: true })
    if (combined.aborted) abort()
    this.streams.add(stream)
    stream.once('close', () => { this.streams.delete(stream); combined.removeEventListener('abort', abort) })
    try {
      await new Promise<void>((resolve, reject) => {
        stream.once('secureConnect', resolve)
        stream.once('error', reject)
        stream.once('close', () => reject(new Error('远端数据通道已关闭。')))
      })
      // Handshake deadline must not become a deadline on a running process stream.
      combined.removeEventListener('abort', abort)
      const cancel = () => stream.destroy(new Error('远端数据通道已取消。'))
      signal?.addEventListener('abort', cancel, { once: true })
      if (signal?.aborted) { stream.destroy(); signal.throwIfAborted() }
      stream.once('close', () => signal?.removeEventListener('abort', cancel))
      stream.disableRenegotiation(); stream.pause()
      return stream
    } catch (error) { stream.destroy(); throw error }
  }
  private fail(error: Error) {
    if (this.failure) return
    this.failure = error
    clearInterval(this.timer)
    this.lifetime.abort(error)
    this.peer?.close(error)
    for (const stream of this.streams) stream.destroy(error)
    this.client.end()
  }
  async dispose() {
    if (!this.failure && this.peer) await this.peer.request('close', {}, z.null(), AbortSignal.timeout(10_000)).catch(() => {})
    this.fail(new Error('远端连接已关闭。'))
  }
}
