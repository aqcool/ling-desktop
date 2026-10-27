import { randomBytes, randomUUID } from 'node:crypto'
import { chmod, writeFile } from 'node:fs/promises'
import { createServer, type Socket } from 'node:net'
import { join } from 'node:path'
import { Transform } from 'node:stream'
import type { Client, ClientChannel } from 'ssh2'
import { shellQuote } from './server-deployment.ts'

// This short-lived helper is rsync's remote shell. It contains no SSH credential.
// stdin stays binary; stdout/stderr/exit travel in bounded frames over local IPC.
const helper = String.raw`
const net = require('node:net');
const socket = net.connect(process.env.LING_RSYNC_SOCKET);
let buffer = Buffer.alloc(0), blocked = false, exited = false;
function fail() { if (!exited) { exited = true; process.stderr.write('LING rsync transport disconnected\n', () => process.exit(255)); } }
function consume() {
  while (!blocked && buffer.length >= 5) {
    const type = buffer[0], size = buffer.readUInt32BE(1);
    if (size > 256 * 1024 || type > 2) return fail();
    if (buffer.length < 5 + size) return;
    const payload = buffer.subarray(5, 5 + size); buffer = buffer.subarray(5 + size);
    if (type === 2) {
      if (size !== 4) return fail();
      exited = true; process.stdin.unpipe(socket); process.stdin.pause(); socket.destroy();
      Promise.all([new Promise(r => process.stdout.write('', r)), new Promise(r => process.stderr.write('', r))])
        .then(() => process.exit(payload.readInt32BE(0)));
      return;
    }
    const output = type === 0 ? process.stdout : process.stderr;
    if (!output.write(payload)) {
      blocked = true; socket.pause();
      output.once('drain', () => { blocked = false; consume(); if (!blocked && !exited) socket.resume(); });
    }
  }
}
socket.once('connect', () => {
  socket.write(JSON.stringify({ token: process.env.LING_RSYNC_TOKEN, args: process.argv.slice(2) }) + '\n');
  process.stdin.pipe(socket);
});
socket.on('data', chunk => { buffer = Buffer.concat([buffer, chunk]); consume(); });
socket.on('error', fail); socket.on('close', fail);
`

function frame(type: number, bytes: Buffer): Buffer {
  const header = Buffer.alloc(5); header[0] = type; header.writeUInt32BE(bytes.length, 1)
  return Buffer.concat([header, bytes])
}

/** One receiver, one saved SSH connection, one approved destination, one invocation. */
export async function rsyncTransport(client: Client, destination: string, temporary: string, signal: AbortSignal) {
  signal.throwIfAborted()
  const token = randomBytes(32).toString('hex')
  const endpoint = process.platform === 'win32' ? `\\\\.\\pipe\\ling-rsync-${randomUUID()}` : join(temporary, 'ssh.sock')
  const script = join(temporary, 'ssh.cjs')
  await writeFile(script, helper, { mode: 0o600, flag: 'wx' })
  const sockets = new Set<Socket>()
  const channels = new Set<ClientChannel>()
  let used = false
  const server = createServer({ allowHalfOpen: true }, socket => {
    sockets.add(socket)
    socket.on('error', () => {})
    socket.once('close', () => { sockets.delete(socket) })
    let header = Buffer.alloc(0)
    const timeout = setTimeout(() => socket.destroy(), 10_000)
    const read = (chunk: Buffer) => {
      header = Buffer.concat([header, chunk])
      const end = header.indexOf(10)
      if (end < 0) { if (header.length > 32768) socket.destroy(); return }
      clearTimeout(timeout); socket.removeListener('data', read); socket.pause()
      try {
        if (end > 32768 || used || signal.aborted) throw new Error('invalid transport')
        const value: unknown = JSON.parse(header.subarray(0, end).toString())
        if (!value || typeof value !== 'object' || !('token' in value) || value.token !== token || !('args' in value) || !Array.isArray(value.args)) throw new Error('invalid transport')
        const args = value.args as unknown[]
        if (args.length > 128 || args.some(arg => typeof arg !== 'string' || arg.length > 8192 || /[\0\r\n]/u.test(arg))) throw new Error('invalid transport')
        const words = args as string[]
        const start = words.indexOf('rsync')
        if (start < 1 || words[start - 1] !== 'ling-target' || words[start + 1] !== '--server' || words.includes('--sender') || words.at(-2) !== '.') throw new Error('invalid receiver')
        const flags = words.slice(start + 2, -2)
        if (flags.some(flag => !/^-[a-zA-Z.]+$/u.test(flag)
          && !/^--(?:log-format=[a-zA-Z%]+|checksum-seed=\d+|no-i-r|no-implied-dirs|from0|files-from=-|relative|dirs|ignore-times|ignore-existing|checksum|chmod=Du=rwx,Dgo=rx,Fu=rw,Fgo=r)$/u.test(flag))) throw new Error('invalid receiver flags')
        // Quote every argument ourselves and replace rsync's shell-escaped destination
        // with the exact path authorized by server_copy. No arbitrary SSH exec API.
        const command = ['rsync', ...words.slice(start + 1, -1).map(shellQuote), shellQuote(destination)].join(' ')
        used = true
        const rest = header.subarray(end + 1); header = Buffer.alloc(0)
        if (rest.length) socket.unshift(rest)
        client.exec(command, (error, channel) => {
          if (error || signal.aborted || socket.destroyed) { channel?.close(); socket.destroy(); return }
          channels.add(channel)
          socket.once('close', () => { channel.close(); channels.delete(channel) })
          channel.on('error', () => socket.destroy())
          const encode = (type: number) => new Transform({ transform(chunk: Buffer, _encoding, done) { done(null, frame(type, chunk)) } })
          const stdout = encode(0), stderr = encode(1)
          const drained = Promise.all([stdout, stderr].map(stream => new Promise<void>(resolve => stream.once('end', resolve))))
          socket.pipe(channel); channel.pipe(stdout).pipe(socket, { end: false }); channel.stderr.pipe(stderr).pipe(socket, { end: false })
          channel.once('close', (code: number | undefined) => {
            channels.delete(channel)
            void drained.then(() => {
              if (socket.destroyed) return
              const status = Buffer.alloc(4); status.writeInt32BE(Number.isInteger(code) ? code! : 255)
              socket.end(frame(2, status))
            })
          })
          socket.resume()
        })
      } catch { socket.destroy() }
    }
    socket.on('data', read)
    socket.once('close', () => clearTimeout(timeout))
  })
  const abort = () => { for (const channel of channels) channel.close(); for (const socket of sockets) socket.destroy() }
  signal.addEventListener('abort', abort, { once: true })
  try {
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(endpoint, resolve) })
    if (process.platform !== 'win32') await chmod(endpoint, 0o600)
    signal.throwIfAborted()
  } catch (error) { signal.removeEventListener('abort', abort); abort(); server.close(); throw error }
  const shell = `${shellQuote(process.execPath.replaceAll('\\', '/'))} ${shellQuote(script.replaceAll('\\', '/'))}`
  return { shell, environment: { LING_RSYNC_SOCKET: endpoint, LING_RSYNC_TOKEN: token, ELECTRON_RUN_AS_NODE: '1' },
    close: async () => {
      signal.removeEventListener('abort', abort); abort()
      await new Promise<void>(resolve => server.close(() => resolve()))
    } }
}
