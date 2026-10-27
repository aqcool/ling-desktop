import { generateKeyPairSync, randomUUID } from 'node:crypto'
import { chmod, lstat, mkdir, mkdtemp, open, readdir, realpath, rename, rm, rmdir, unlink, utimes, type FileHandle } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, posix } from 'node:path'
import ssh2, { type Connection, type ServerChannel } from 'ssh2'
import { ServerStore } from '../../src/server-store.ts'
import { ServerBroker } from '../../src/server-broker.ts'
import type { TransferPicker } from '../../src/sftp-manager.ts'

/** Real encrypted SFTP against disposable disk data. Exec is deliberately rejected: no helper can install. */
export async function sftpFixture(picker?: TransferPicker, writeDelay = 0, options: { atomicRename?: boolean; key?: boolean; stallWrites?: boolean; onWrite?: () => void; stallReads?: boolean; onRead?: () => void; exec?: (command: string, channel: ServerChannel) => void } = {}) {
  const temporary = await realpath(await mkdtemp(join(tmpdir(), 'ling-sftp-test-')))
  const remote = join(temporary, 'remote')
  const home = join(remote, 'home', 'tester')
  const local = join(temporary, 'local')
  const profile = join(temporary, 'profile')
  await Promise.all([mkdir(home, { recursive: true }), mkdir(local), mkdir(profile)])
  const key = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ format: 'pem', type: 'pkcs1' }).toString()
  const userKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ format: 'pem', type: 'pkcs1' }).toString()
  const encryptedKey = options.key ? generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ format: 'pem', type: 'pkcs1', cipher: 'aes-256-cbc', passphrase: 'key-secret' }).toString() : undefined
  const connections = new Set<Connection>()
  const handles = new Map<string, FileHandle | { path: string; sent: boolean }>()
  let execs = 0
  let logins = 0
  let writes = 0, peakWrites = 0
  const modes = new Map<string, number>()
  const paths = new Map<FileHandle, string>()
  const { Server, utils } = ssh2
  const codes = utils.sftp.STATUS_CODE
  const loginKey = utils.parseKey(encryptedKey ?? userKey, encryptedKey ? 'key-secret' : undefined)
  if (loginKey instanceof Error || Array.isArray(loginKey)) throw new Error('invalid fixture key')
  const locate = (path: string) => {
    const normalized = posix.resolve('/home/tester', path)
    return join(remote, ...normalized.split('/').filter(Boolean))
  }
  const server = new Server({ hostKeys: [key] }, client => {
    connections.add(client)
    client.on('error', () => {})
    client.once('close', () => { connections.delete(client) })
    client.on('authentication', auth => {
      if (auth.username === 'tester' && !options.key && auth.method === 'password' && auth.password === 'test-secret') { logins++; auth.accept() }
      else if (auth.username === 'tester' && options.key && auth.method === 'publickey' && auth.key.data.equals(loginKey.getPublicSSH())
        && (!auth.signature || loginKey.verify(auth.blob!, auth.signature, auth.hashAlgo) === true)) { if (auth.signature) logins++; auth.accept() }
      else auth.reject()
    })
    client.on('ready', () => client.on('session', accept => {
      const session = accept()
      session.on('exec', (accept, reject, info) => { execs++; if (options.exec) options.exec(info.command, accept()); else reject() })
      session.on('sftp', acceptSftp => {
        const sftp = acceptSftp()
        sftp.once('end', () => sftp.end())
        const owned = new Set<string>()
        sftp.once('close', () => {
          for (const id of owned) { const item = handles.get(id); handles.delete(id); if (item && 'fd' in item) { paths.delete(item); void item.close().catch(() => {}) } }
          owned.clear()
        })
        if (options.atomicRename) {
          // ssh2's server sends a fixed extension-free VERSION packet. Advertise
          // OpenSSH rename on this fixture channel using the normal SFTP wire format.
          const stream = sftp as unknown as { outgoing: { id: number }; _protocol: { channelData(id: number, bytes: Buffer): void } }
          const protocol = stream._protocol
          const send = protocol.channelData.bind(protocol)
          protocol.channelData = (id, bytes) => {
            if (id === stream.outgoing.id && bytes.length === 9 && bytes[4] === 2) {
              const name = Buffer.from('posix-rename@openssh.com'), value = Buffer.from('1')
              const packet = Buffer.alloc(9 + 4 + name.length + 4 + value.length)
              bytes.copy(packet); packet.writeUInt32BE(packet.length - 4)
              packet.writeUInt32BE(name.length, 9); name.copy(packet, 13)
              packet.writeUInt32BE(value.length, 13 + name.length); value.copy(packet, 17 + name.length)
              send(id, packet)
            } else send(id, bytes)
          }
        }
        const status = (id: number, error?: unknown) => {
          const code = (error as { code?: string } | undefined)?.code
          sftp.status(id, !error ? codes.OK : code === 'ENOENT' ? codes.NO_SUCH_FILE : code === 'EACCES' ? codes.PERMISSION_DENIED : codes.FAILURE)
        }
        const action = (event: string, implementation: (...args: any[]) => Promise<void>) => {
          sftp.on(event as 'OPEN', (id: number, ...args: any[]) => { void implementation(id, ...args).catch(error => { status(id, error) }) })
        }
        const attrs = (value: import('node:fs').Stats, path?: string) => ({ mode: path && modes.has(path) ? value.mode & ~0o777 | modes.get(path)! : value.mode, size: value.size, uid: value.uid, gid: value.gid,
          atime: Math.floor(value.atimeMs / 1000), mtime: Math.floor(value.mtimeMs / 1000) })
        action('REALPATH', async (id, path: string) => {
          const attributes = attrs(await lstat(locate(path))); const name = posix.resolve('/home/tester', path)
          sftp.name(id, [{ filename: name, longname: name, attrs: attributes }])
        })
        for (const event of ['STAT', 'LSTAT']) action(event, async (id, path: string) => { sftp.attrs(id, attrs(await lstat(locate(path)), path)) })
        action('OPENDIR', async (id, path: string) => {
          if (!(await lstat(locate(path))).isDirectory()) throw new Error('not a directory')
          const handle = Buffer.from(randomUUID()); handles.set(handle.toString(), { path, sent: false }); owned.add(handle.toString()); sftp.handle(id, handle)
        })
        action('READDIR', async (id, handle: Buffer) => {
          const item = handles.get(handle.toString())
          if (!item || 'fd' in item) throw new Error('bad handle')
          if (item.sent) { sftp.status(id, codes.EOF); return }
          item.sent = true
          const entries = await Promise.all((await readdir(locate(item.path))).map(async name => ({ filename: name, longname: name, attrs: attrs(await lstat(locate(posix.join(item.path, name)))) })))
          if (entries.length) sftp.name(id, entries); else sftp.status(id, codes.EOF)
        })
        action('OPEN', async (id, path: string, flags: number, attributes: { mode?: number }) => {
          const file = await open(locate(path), utils.sftp.flagsToString(flags)!, attributes.mode ?? 0o644)
          paths.set(file, path); if (attributes.mode !== undefined && flags & 8 /* CREAT */) modes.set(path, attributes.mode)
          const handle = Buffer.from(randomUUID()); handles.set(handle.toString(), file); owned.add(handle.toString()); sftp.handle(id, handle)
        })
        action('READ', async (id, handle: Buffer, offset: number, length: number) => {
          const file = handles.get(handle.toString()); if (!file || !('fd' in file)) throw new Error('bad handle')
          options.onRead?.(); if (options.stallReads) return
          const data = Buffer.alloc(length); const result = await file.read(data, 0, length, offset)
          if (result.bytesRead) sftp.data(id, data.subarray(0, result.bytesRead)); else sftp.status(id, codes.EOF)
        })
        action('WRITE', async (id, handle: Buffer, offset: number, bytes: Buffer) => {
          const file = handles.get(handle.toString()); if (!file || !('fd' in file)) throw new Error('bad handle')
          writes++; peakWrites = Math.max(peakWrites, writes)
          options.onWrite?.()
          if (options.stallWrites) return
          try {
            if (writeDelay) await new Promise(resolve => setTimeout(resolve, writeDelay))
            await file.write(bytes, 0, bytes.length, offset); status(id)
          } finally { writes-- }
        })
        action('FSTAT', async (id, handle: Buffer) => {
          const file = handles.get(handle.toString()); if (!file || !('fd' in file)) throw new Error('bad handle')
          sftp.attrs(id, attrs(await file.stat(), paths.get(file)))
        })
        action('CLOSE', async (id, handle: Buffer) => {
          const file = handles.get(handle.toString()); handles.delete(handle.toString()); owned.delete(handle.toString()); if (file && 'fd' in file) { paths.delete(file); await file.close() }; status(id)
        })
        action('MKDIR', async (id, path: string, attributes: { mode?: number }) => { await mkdir(locate(path), { mode: attributes.mode }); status(id) })
        action('RMDIR', async (id, path: string) => { await rmdir(locate(path)); status(id) })
        action('REMOVE', async (id, path: string) => { await unlink(locate(path)); modes.delete(path); status(id) })
        action('SETSTAT', async (id, path: string, attributes: { mode?: number; atime?: number; mtime?: number }) => {
          if (attributes.mode !== undefined) { await chmod(locate(path), attributes.mode); modes.set(path, attributes.mode & 0o777) }
          if (attributes.mtime !== undefined) await utimes(locate(path), attributes.atime ?? attributes.mtime, attributes.mtime)
          status(id)
        })
        action('RENAME', async (id, path: string, destination: string) => {
          if (await lstat(locate(destination)).catch(() => undefined)) throw new Error('exists')
          await rename(locate(path), locate(destination)); if (modes.has(path)) { modes.set(destination, modes.get(path)!); modes.delete(path) }; status(id)
        })
        action('EXTENDED', async (id, extension: string, data: Buffer) => {
          if (!options.atomicRename || extension !== 'posix-rename@openssh.com') { sftp.status(id, codes.OP_UNSUPPORTED); return }
          const length = data.readUInt32BE(0), path = data.subarray(4, 4 + length).toString()
          const destination = data.subarray(8 + length, 8 + length + data.readUInt32BE(4 + length)).toString()
          await rename(locate(path), locate(destination)); if (modes.has(path)) { modes.set(destination, modes.get(path)!); modes.delete(path) }; status(id)
        })
      })
    }))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('fixture needs TCP')
  const store = new ServerStore(join(profile, 'ling-servers.json'))
  const entry = await store.add({ name: 'SFTP fixture', alias: '127.0.0.1', port: address.port, user: 'tester', environment: 'development' })
  const broker = new ServerBroker(profile, { available: async () => true, encrypt: async text => Buffer.from(text), decrypt: async bytes => bytes.toString() }, undefined, picker)
  await broker.trust(entry.id, await broker.inspect(entry.id))
  if (encryptedKey) await broker.saveKey(entry.id, encryptedKey, 'key-secret'); else await broker.savePassword(entry.id, 'test-secret')
  return { broker, serverId: entry.id, home, local, remote, profile, get execs() { return execs }, get logins() { return logins }, get peakWrites() { return peakWrites },
    close: async () => {
      await broker.close()
      for (const client of connections) client.end()
      for (const file of handles.values()) if ('fd' in file) await file.close().catch(() => {})
      await new Promise<void>(resolve => server.close(() => resolve()))
      await rm(temporary, { recursive: true, force: true })
    } }
}
