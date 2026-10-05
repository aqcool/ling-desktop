import { generateKeyPairSync, randomUUID } from 'node:crypto'
import { lstat, mkdir, mkdtemp, open, readdir, realpath, rename, rm, rmdir, unlink, type FileHandle } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, posix } from 'node:path'
import ssh2, { type Connection, type SFTPWrapper } from 'ssh2'
import { ServerStore } from '../../src/server-store.ts'
import { ServerBroker } from '../../src/server-broker.ts'
import type { TransferPicker } from '../../src/sftp-manager.ts'

/** Real encrypted SFTP against disposable disk data. Exec is deliberately rejected: no helper can install. */
export async function sftpFixture(picker?: TransferPicker, writeDelay = 0) {
  const temporary = await realpath(await mkdtemp(join(tmpdir(), 'ling-sftp-test-')))
  const remote = join(temporary, 'remote')
  const home = join(remote, 'home', 'tester')
  const local = join(temporary, 'local')
  const profile = join(temporary, 'profile')
  await Promise.all([mkdir(home, { recursive: true }), mkdir(local), mkdir(profile)])
  const key = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ format: 'pem', type: 'pkcs1' }).toString()
  const connections = new Set<Connection>()
  const handles = new Map<string, FileHandle | { path: string; sent: boolean }>()
  let execs = 0
  let logins = 0
  const { Server, utils } = ssh2
  const codes = utils.sftp.STATUS_CODE
  const locate = (path: string) => {
    const normalized = posix.resolve('/home/tester', path)
    return join(remote, ...normalized.split('/').filter(Boolean))
  }
  const server = new Server({ hostKeys: [key] }, client => {
    connections.add(client)
    client.on('error', () => {})
    client.once('close', () => { connections.delete(client) })
    client.on('authentication', auth => {
      if (auth.username === 'tester' && auth.method === 'password' && auth.password === 'test-secret') { logins++; auth.accept() }
      else auth.reject()
    })
    client.on('ready', () => client.on('session', accept => {
      const session = accept()
      session.on('exec', (_accept, reject) => { execs++; reject() })
      session.on('sftp', acceptSftp => {
        const sftp = acceptSftp()
        const status = (id: number, error?: unknown) => {
          const code = (error as { code?: string } | undefined)?.code
          sftp.status(id, !error ? codes.OK : code === 'ENOENT' ? codes.NO_SUCH_FILE : code === 'EACCES' ? codes.PERMISSION_DENIED : codes.FAILURE)
        }
        const action = (event: string, implementation: (...args: any[]) => Promise<void>) => {
          sftp.on(event as 'OPEN', (id: number, ...args: any[]) => { void implementation(id, ...args).catch(error => { status(id, error) }) })
        }
        const attrs = (value: import('node:fs').Stats) => ({ mode: value.mode, size: value.size, uid: value.uid, gid: value.gid,
          atime: Math.floor(value.atimeMs / 1000), mtime: Math.floor(value.mtimeMs / 1000) })
        action('REALPATH', async (id, path: string) => {
          const attributes = attrs(await lstat(locate(path))); const name = posix.resolve('/home/tester', path)
          sftp.name(id, [{ filename: name, longname: name, attrs: attributes }])
        })
        for (const event of ['STAT', 'LSTAT']) action(event, async (id, path: string) => { sftp.attrs(id, attrs(await lstat(locate(path)))) })
        action('OPENDIR', async (id, path: string) => {
          if (!(await lstat(locate(path))).isDirectory()) throw new Error('not a directory')
          const handle = Buffer.from(randomUUID()); handles.set(handle.toString(), { path, sent: false }); sftp.handle(id, handle)
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
          const handle = Buffer.from(randomUUID()); handles.set(handle.toString(), file); sftp.handle(id, handle)
        })
        action('READ', async (id, handle: Buffer, offset: number, length: number) => {
          const file = handles.get(handle.toString()); if (!file || !('fd' in file)) throw new Error('bad handle')
          const data = Buffer.alloc(length); const result = await file.read(data, 0, length, offset)
          if (result.bytesRead) sftp.data(id, data.subarray(0, result.bytesRead)); else sftp.status(id, codes.EOF)
        })
        action('WRITE', async (id, handle: Buffer, offset: number, bytes: Buffer) => {
          const file = handles.get(handle.toString()); if (!file || !('fd' in file)) throw new Error('bad handle')
          if (writeDelay) await new Promise(resolve => setTimeout(resolve, writeDelay))
          await file.write(bytes, 0, bytes.length, offset); status(id)
        })
        action('FSTAT', async (id, handle: Buffer) => {
          const file = handles.get(handle.toString()); if (!file || !('fd' in file)) throw new Error('bad handle')
          sftp.attrs(id, attrs(await file.stat()))
        })
        action('CLOSE', async (id, handle: Buffer) => {
          const file = handles.get(handle.toString()); handles.delete(handle.toString()); if (file && 'fd' in file) await file.close(); status(id)
        })
        action('MKDIR', async (id, path: string, attributes: { mode?: number }) => { await mkdir(locate(path), { mode: attributes.mode }); status(id) })
        action('RMDIR', async (id, path: string) => { await rmdir(locate(path)); status(id) })
        action('REMOVE', async (id, path: string) => { await unlink(locate(path)); status(id) })
        action('RENAME', async (id, path: string, destination: string) => {
          if (await lstat(locate(destination)).catch(() => undefined)) throw new Error('exists')
          await rename(locate(path), locate(destination)); status(id)
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
  await broker.savePassword(entry.id, 'test-secret')
  return { broker, serverId: entry.id, home, local, remote, profile, get execs() { return execs }, get logins() { return logins },
    close: async () => {
      await broker.close()
      for (const client of connections) client.end()
      for (const file of handles.values()) if ('fd' in file) await file.close().catch(() => {})
      await new Promise<void>(resolve => server.close(() => resolve()))
      await rm(temporary, { recursive: true, force: true })
    } }
}
