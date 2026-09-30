import { createHash, generateKeyPairSync } from 'node:crypto'
import { execFileSync, spawn } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createConnection } from 'node:net'
import { createRequire } from 'node:module'
import { createServer as createTlsServer } from 'node:tls'
import type { Socket } from 'node:net'
import { Client, Server, utils } from 'ssh2'
import { Context } from '@deepseek-ai/cordis'
import { SandboxPolicyService } from '@deepseek-ai/dsh-sandbox-policy'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import type { SshConnection } from '@deepseek-ai/dsh-ssh'
import * as sshPlugin from '../src/ssh/plugin.ts'
import { BrokerSshConnection } from '../src/ssh/connection.ts'
import { relaySshStream } from '../src/ssh/stream-relay.ts'
import { installHelper } from '../src/ssh/install.ts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ServerBroker, fingerprintFromKey } from '../src/server-broker.ts'
import { ServerStore } from '../src/server-store.ts'
import { localDeploymentTree } from '../src/server-deployment.ts'
import { deployDirectory } from '../src/host/server-directory-deploy.ts'

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => { for (const task of cleanup.splice(0).reverse()) await task() })

async function fixture(authentication: 'password' | 'key', onCommand?: (command: string) => void) {
  const hostPrivate = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ format: 'pem', type: 'pkcs1' }).toString()
  const clientPrivate = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ format: 'pem', type: 'pkcs1' }).toString()
  const parsedClient = utils.parseKey(clientPrivate)
  if (parsedClient instanceof Error || Array.isArray(parsedClient)) throw new Error('test key parsing failed')
  const server = new Server({ hostKeys: [hostPrivate] }, client => {
    // A deliberately rejected host key terminates KEX before authentication.
    client.on('error', () => {})
    client.on('authentication', ctx => {
      if (ctx.username !== 'tester') return ctx.reject()
      if (authentication === 'password' && ctx.method === 'password' && ctx.password === 'test-secret') return ctx.accept()
      if (authentication === 'key' && ctx.method === 'publickey' && ctx.key.data.equals(parsedClient.getPublicSSH())) {
        if (!ctx.signature) return ctx.accept()
        if (ctx.blob && parsedClient.verify(ctx.blob, ctx.signature, ctx.hashAlgo) === true) return ctx.accept()
      }
      ctx.reject()
    })
    client.on('ready', () => client.on('session', accept => {
      const session = accept()
      session.on('pty', acceptPty => { acceptPty() })
      session.on('exec', (acceptExec, _reject, info) => {
        const stream = acceptExec()
        onCommand?.(info.command)
        if (onCommand) {
          const output = Buffer.from('远端-ok\n')
          stream.write(output.subarray(0, 1))
          stream.write(output.subarray(1))
        } else stream.write('__LING_SSH_PROBE__\n/home/tester\n')
        stream.exit(0)
        stream.end()
      })
    }))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  cleanup.push(() => new Promise(resolve => server.close(() => resolve())))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('test server has no port')
  return { port: address.port, clientPrivate }
}

async function uploadFixture(withoutNode = false) {
  const remoteHome = await realpath(await mkdtemp(join(tmpdir(), 'ling-dsh-helper-')))
  cleanup.push(() => rm(remoteHome, { recursive: true, force: true }))
  const hostPrivate = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ format: 'pem', type: 'pkcs1' }).toString()
  const commands: string[] = []
  const chunks: Buffer[] = []
  const server = new Server({ hostKeys: [hostPrivate] }, client => {
    client.on('error', () => {})
    client.on('openssh.streamlocal', (accept, reject, info) => {
      const socket = createConnection(info.socketPath)
      socket.once('connect', () => {
        const channel = accept()
        socket.pipe(channel).pipe(socket)
        channel.on('error', () => socket.destroy())
        channel.on('close', () => socket.destroy())
      })
      socket.on('error', () => { if (socket.connecting) reject(); socket.destroy() })
      const closed = () => { socket.destroy() }
      client.once('close', closed)
      socket.once('close', () => client.removeListener('close', closed))
    })
    client.on('authentication', ctx => {
      if (ctx.username === 'tester' && ctx.method === 'password' && ctx.password === 'test-secret') ctx.accept()
      else ctx.reject()
    })
    client.on('ready', () => client.on('session', accept => {
      const session = accept()
      session.on('pty', acceptPty => { acceptPty() })
      session.on('exec', (acceptExec, _reject, info) => {
        commands.push(info.command)
        const stream = acceptExec()
        stream.on('data', (chunk: Buffer) => { chunks.push(Buffer.from(chunk)) })
        const command = withoutNode && info.command.includes('command -v node') ? info.command.replace('command -v node', 'false') : info.command
        const process = spawn('sh', ['-c', command], { stdio: ['pipe', 'pipe', 'pipe'], env: { ...globalThis.process.env, HOME: remoteHome } })
        stream.pipe(process.stdin)
        process.stdin.on('error', () => {})
        stream.on('close', () => process.kill('SIGTERM'))
        process.stdout.on('data', (chunk: Buffer) => { stream.write(chunk) })
        process.stderr.on('data', (chunk: Buffer) => { stream.stderr.write(chunk) })
        process.on('close', code => { stream.exit(code ?? 255); stream.end() })
      })
    }))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  cleanup.push(() => new Promise(resolve => server.close(() => resolve())))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('test server has no port')
  return { port: address.port, commands, chunks }
}

async function broker(port: number) {
  const home = await mkdtemp(join(tmpdir(), 'ling-server-broker-'))
  cleanup.push(() => rm(home, { recursive: true, force: true }))
  const codec = {
    available: async () => true,
    encrypt: async (value: string) => Buffer.from(`sealed:${Buffer.from(value).toString('base64')}`),
    decrypt: async (value: Buffer) => Buffer.from(value.toString().slice(7), 'base64').toString(),
  }
  const store = new ServerStore(join(home, 'ling-servers.json'))
  const server = await store.add({ name: 'Local fixture', alias: '127.0.0.1', user: 'tester', port, environment: 'development' })
  const connection = new ServerBroker(home, codec, fileURLToPath(new URL('../lib/', import.meta.url)))
  cleanup.push(() => connection.close())
  return { broker: connection, id: server.id, home }
}

describe('server credential broker', () => {
  it('rejects a replaced stream socket with the wrong PSK and cancels pending authentication', async () => {
    const ssh = await uploadFixture()
    const root = await realpath(await mkdtemp(join(tmpdir(), 'ling-tls-auth-')))
    cleanup.push(() => rm(root, { recursive: true, force: true }))
    const path = join(root, 'stream.sock')
    const capability = 'ab'.repeat(32)
    const sockets = new Set<Socket>()
    const server = createTlsServer({ ciphers: 'PSK-AES256-GCM-SHA384', minVersion: 'TLSv1.2', maxVersion: 'TLSv1.2',
      pskCallback: (_socket, identity) => identity === 'dsh-stream' ? Buffer.from(capability, 'hex') : null,
    })
    server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)) })
    server.on('tlsClientError', () => {})
    await new Promise<void>(resolve => server.listen(path, resolve))
    cleanup.push(() => { for (const socket of sockets) socket.destroy(); return new Promise(resolve => server.close(() => resolve())) })
    const client = new Client()
    await new Promise<void>((resolve, reject) => {
      client.once('ready', resolve).once('error', reject)
      client.connect({ host: '127.0.0.1', port: ssh.port, username: 'tester', password: 'test-secret' })
    })
    cleanup.push(async () => { client.end() })
    await expect(relaySshStream(client, process.execPath, { path, capability: 'cd'.repeat(32) }, AbortSignal.timeout(5000))).rejects.toThrow('加密数据通道连接失败')
    const cancelled = new AbortController()
    const connecting = relaySshStream(client, process.execPath, { path, capability }, cancelled.signal)
    cancelled.abort(new Error('cancelled'))
    await expect(connecting).rejects.toThrow('cancelled')
    expect(ssh.commands.some(command => command.includes(capability) || command.includes('cd'.repeat(32)))).toBe(false)
  }, 15_000)
  it('opens, writes, resizes and closes an SSH terminal under the actual Electron TLS implementation', async () => {
    const ssh = await uploadFixture()
    const root = await realpath(await mkdtemp(join(tmpdir(), 'ling-electron-ssh-')))
    cleanup.push(() => rm(root, { recursive: true, force: true }))
    const client = new Client()
    await new Promise<void>((resolve, reject) => {
      client.once('ready', resolve).once('error', reject)
      client.connect({ host: '127.0.0.1', port: ssh.port, username: 'tester', password: 'test-secret' })
    })
    cleanup.push(async () => { client.end() })
    const helper = await installHelper(client, root, undefined, fileURLToPath(new URL('../lib/', import.meta.url)))
    const electron = createRequire(import.meta.url)('electron') as string
    const child = spawn(electron, ['--experimental-transform-types', fileURLToPath(new URL('./fixtures/electron-ssh-terminal.mjs', import.meta.url)),
      String(ssh.port), helper.node, helper.helper, helper.hash, root], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: ['ignore', 'pipe', 'pipe'],
    })
    cleanup.push(async () => { if (child.exitCode === null) child.kill() })
    let output = '', errors = ''
    child.stdout.on('data', data => { output += data.toString() })
    child.stderr.on('data', data => { errors += data.toString() })
    const code = await new Promise<number | null>((resolve, reject) => { child.once('exit', resolve); child.once('error', reject) })
    if (code !== 0) throw new Error(`Electron SSH regression failed: ${errors}`)
    expect(output).toContain('ELECTRON_PTY_OK')
  }, 30_000)
  it('delivers stdout and stderr before SSH completion without splitting UTF-8 text', async () => {
    const ssh = await uploadFixture()
    const { broker: connection, id } = await broker(ssh.port)
    await connection.trust(id, await connection.inspect(id))
    await connection.savePassword(id, 'test-secret')
    const chunks: Array<{ stream: string; data: string }> = []
    let first!: () => void
    const received = new Promise<void>(resolve => { first = resolve })
    let finished = false
    const running = connection.run(id, '/tmp', "printf '开始\\n'; sleep 0.2; printf '错误\\n' >&2; exit 3",
      new AbortController().signal, undefined, chunk => { chunks.push(chunk); first() }).then(result => { finished = true; return result })
    await received
    expect(finished).toBe(false)
    expect(chunks.map(chunk => chunk.data).join('')).toContain('开始')
    await expect(running).resolves.toEqual({ stdout: '开始\n', stderr: '错误\n', exitCode: 3 })
    expect(chunks).toContainEqual({ stream: 'stderr', data: '错误\n' })
    expect(chunks.map(chunk => chunk.data).join('')).not.toContain('\uFFFD')
  }, 30000)
  it('requires explicit fingerprint trust, encrypts the password and probes without an SSH config', async () => {
    const ssh = await fixture('password')
    const { broker: connection, id, home } = await broker(ssh.port)
    await expect(connection.probe(id)).rejects.toThrow('指纹')
    const fingerprint = await connection.inspect(id)
    expect(fingerprint.sha256).toMatch(/^SHA256:/)
    await connection.trust(id, fingerprint)
    await connection.savePassword(id, 'test-secret')
    expect(await connection.status(id)).toEqual({ trusted: true, fingerprint, credential: 'password' })
    const saved = await readFile(join(home, 'ling-server-secrets.json'), 'utf8')
    expect(saved).not.toContain('test-secret')
    expect(await connection.probe(id)).toEqual({ home: '/home/tester' })
    await connection.clearCredential(id)
    await expect(connection.probe(id)).rejects.toThrow('密码或私钥')
    const unavailable = new ServerBroker(home, {
      available: async () => false,
      encrypt: async () => { throw new Error('must not encrypt') },
      decrypt: async () => { throw new Error('must not decrypt') },
    })
    await expect(unavailable.savePassword(id, 'test-secret')).rejects.toThrow('系统安全存储不可用')
    expect((await unavailable.status(id)).credential).toBe('none')
  }, 30000)

  it('imports a private key and blocks a changed host fingerprint', async () => {
    const ssh = await fixture('key')
    const { broker: connection, id, home } = await broker(ssh.port)
    const fingerprint = await connection.inspect(id)
    await connection.trust(id, fingerprint)
    await connection.saveKey(id, ssh.clientPrivate)
    expect((await connection.status(id)).credential).toBe('key')
    expect(await connection.probe(id)).toEqual({ home: '/home/tester' })
    const saved = await readFile(join(home, 'ling-server-secrets.json'), 'utf8')
    expect(saved).not.toContain('BEGIN RSA PRIVATE KEY')
    const vault = JSON.parse(saved) as { entries: Record<string, { fingerprint: { sha256: string } }> }
    vault.entries[id]!.fingerprint.sha256 = 'SHA256:changed'
    await writeFile(join(home, 'ling-server-secrets.json'), JSON.stringify(vault))
    await expect(connection.probe(id)).rejects.toThrow('指纹与已确认')
    const store = new ServerStore(join(home, 'ling-servers.json'))
    await store.configure(id, { name: 'Changed', alias: '127.0.0.1', user: 'tester', port: ssh.port + 1, environment: 'development' })
    expect(await connection.status(id)).toEqual({ trusted: false, credential: 'none' })
    await expect(connection.probe(id)).rejects.toThrow('指纹')
  }, 30000)

  it('derives OpenSSH SHA-256 fingerprints from public host keys', () => {
    const algorithm = Buffer.from('ssh-ed25519')
    const wire = Buffer.concat([Buffer.from([0, 0, 0, algorithm.length]), algorithm, Buffer.from([1, 2, 3])])
    expect(fingerprintFromKey(wire)).toMatchObject({ algorithm: 'ssh-ed25519', sha256: expect.stringMatching(/^SHA256:/) })
    expect(() => fingerprintFromKey(Buffer.from([0, 0, 1, 0]))).toThrow()
  })

  it('runs a remote command only with saved trust and credential, and quotes its working directory', async () => {
    const ssh = await uploadFixture()
    const { broker: connection, id, home } = await broker(ssh.port)
    await expect(connection.run(id, '/home/tester', 'pwd')).rejects.toThrow('指纹')
    await connection.trust(id, await connection.inspect(id))
    await connection.savePassword(id, 'test-secret')
    const cwd = join(home, "a'b")
    await mkdir(cwd)
    await expect(connection.run(id, cwd, 'pwd')).resolves.toEqual({ stdout: `${await realpath(cwd)}\n`, stderr: '', exitCode: 0 })
    expect(ssh.commands.join('\n')).not.toContain('test-secret')
    await expect(connection.run(id, 'relative', 'pwd')).rejects.toThrow('目录无效')
  }, 30000)

  it('streams a reviewed binary file through the pinned connection without putting bytes in the command', async () => {
    const ssh = await uploadFixture()
    const { broker: connection, id } = await broker(ssh.port)
    await connection.trust(id, await connection.inspect(id))
    await connection.savePassword(id, 'test-secret')
    const root = await mkdtemp(join(tmpdir(), 'ling-upload-source-'))
    const remoteRoot = await mkdtemp(join(tmpdir(), 'ling-upload-remote-'))
    cleanup.push(() => rm(root, { recursive: true, force: true }), () => rm(remoteRoot, { recursive: true, force: true }))
    const bytes = Buffer.from([0, 255, 13, 10, 39, 36, 0, 1])
    await writeFile(join(root, 'release.bin'), bytes)
    const hash = createHash('sha256').update(bytes).digest('hex')
    const destination = join(remoteRoot, "a'b.bin")
    await expect(connection.upload(id, root, 'release.bin', destination, hash, null)).resolves.toEqual({ destination, bytes: bytes.length, sha256: hash })
    expect(await readFile(destination)).toEqual(bytes)
    expect(ssh.commands.join('\n')).not.toContain('test-secret')
    await writeFile(destination, 'changed remotely')
    await expect(connection.upload(id, root, 'release.bin', destination, hash, hash)).rejects.toThrow('远端文件已变化')
    expect(await readFile(destination, 'utf8')).toBe('changed remotely')
    await expect(connection.upload(id, root, 'release.bin', destination, 'a'.repeat(64), null)).rejects.toThrow('已变化')
  }, 30000)

  it('downloads a reviewed binary file into the workspace and rejects changed versions', async () => {
    const ssh = await uploadFixture()
    const { broker: connection, id } = await broker(ssh.port)
    await connection.trust(id, await connection.inspect(id))
    await connection.savePassword(id, 'test-secret')
    const root = await mkdtemp(join(tmpdir(), 'ling-download-local-'))
    const remoteRoot = await mkdtemp(join(tmpdir(), 'ling-download-remote-'))
    cleanup.push(() => rm(root, { recursive: true, force: true }), () => rm(remoteRoot, { recursive: true, force: true }))
    const bytes = Buffer.from([0, 255, 10, 39, 36, 0, 1])
    const source = join(remoteRoot, "a'b.bin")
    await writeFile(source, bytes)
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    await expect(connection.download(id, root, source, 'copy.bin', sha256, null)).resolves.toEqual({ destination: 'copy.bin', bytes: bytes.length, sha256 })
    expect(await readFile(join(root, 'copy.bin'))).toEqual(bytes)
    await writeFile(source, 'changed')
    await expect(connection.download(id, root, source, 'copy.bin', sha256, sha256)).rejects.toThrow('远端文件已变化')
    await writeFile(source, bytes)
    await writeFile(join(root, 'copy.bin'), 'changed locally')
    await expect(connection.download(id, root, source, 'copy.bin', sha256, sha256)).rejects.toThrow('本地目标已变化')
    expect(await readFile(join(root, 'copy.bin'), 'utf8')).toBe('changed locally')
  }, 30000)

  it('snapshots complete remote directory contents including empty directories and symlinks', async () => {
    const ssh = await uploadFixture()
    const { broker: connection, id } = await broker(ssh.port)
    await connection.trust(id, await connection.inspect(id))
    await connection.savePassword(id, 'test-secret')
    const remoteRoot = await mkdtemp(join(tmpdir(), 'ling-manifest-'))
    cleanup.push(() => rm(remoteRoot, { recursive: true, force: true }))
    await mkdir(join(remoteRoot, 'empty'))
    await writeFile(join(remoteRoot, 'a.txt'), 'first')
    await symlink('a.txt', join(remoteRoot, 'link'))
    const first = await connection.directoryManifest(id, remoteRoot)
    expect(first.exists).toBe(true)
    expect(first.entries).toEqual(expect.arrayContaining([
      { path: 'a.txt', type: 'file', sha256: createHash('sha256').update('first').digest('hex') },
      { path: 'empty', type: 'directory' },
      { path: 'link', type: 'symlink' },
    ]))
    await writeFile(join(remoteRoot, 'empty', 'nested.txt'), 'nested')
    const shallow = await connection.directoryManifest(id, remoteRoot, undefined, true)
    expect(shallow.entries).toEqual([
      { path: 'a.txt', type: 'file' },
      { path: 'empty', type: 'directory' },
      { path: 'link', type: 'symlink' },
    ])
    await writeFile(join(remoteRoot, 'a.txt'), 'second')
    expect((await connection.directoryManifest(id, remoteRoot)).sha256).not.toBe(first.sha256)
    expect((await connection.directoryManifest(id, join(remoteRoot, 'missing'))).exists).toBe(false)
  }, 30000)

  it('replaces a reviewed directory including remote-only files, and refuses changed remote state', async () => {
    const ssh = await uploadFixture()
    const { broker: connection, id } = await broker(ssh.port)
    await connection.trust(id, await connection.inspect(id))
    await connection.savePassword(id, 'test-secret')
    const root = await mkdtemp(join(tmpdir(), 'ling-tree-local-'))
    const remoteRoot = await realpath(await mkdtemp(join(tmpdir(), 'ling-tree-remote-')))
    cleanup.push(() => rm(root, { recursive: true, force: true }), () => rm(remoteRoot, { recursive: true, force: true }))
    await mkdir(join(root, 'release', 'empty'), { recursive: true })
    await writeFile(join(root, 'release', 'app.txt'), 'new version')
    const destination = join(remoteRoot, 'target')
    await mkdir(destination)
    await writeFile(join(destination, 'app.txt'), 'old version')
    await writeFile(join(destination, 'obsolete.txt'), 'remove me')
    const tree = await localDeploymentTree(root, 'release')
    const remote = await connection.directoryManifest(id, destination)
    const plan = { serverId: id, root, source: 'release', destination, directories: tree.directories,
      remoteSha256: remote.sha256, files: tree.files.map(file => ({ source: file.source, relative: file.relative, sha256: file.sha256, mode: file.mode })) }
    const bridge = { run: connection.run.bind(connection), upload: connection.upload.bind(connection),
      manifest: connection.directoryManifest.bind(connection) }
    await writeFile(join(destination, 'unexpected.txt'), 'concurrent edit')
    await expect(deployDirectory(bridge, plan, new AbortController().signal)).rejects.toThrow('远端目录已变化')
    expect(await readFile(join(destination, 'obsolete.txt'), 'utf8')).toBe('remove me')
    const refreshed = { ...plan, remoteSha256: (await connection.directoryManifest(id, destination)).sha256 }
    await expect(deployDirectory(bridge, refreshed, new AbortController().signal)).resolves.toMatchObject({ destination, count: 1 })
    expect(await readFile(join(destination, 'app.txt'), 'utf8')).toBe('new version')
    await expect(readFile(join(destination, 'obsolete.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(join(destination, 'unexpected.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect((await connection.directoryManifest(id, destination)).entries).toEqual([
      { path: 'app.txt', type: 'file', sha256: createHash('sha256').update('new version').digest('hex') },
      { path: 'empty', type: 'directory' },
    ])
  }, 60000)

  it('keeps an interactive terminal alive across output polls without revealing credentials', async () => {
    const ssh = await uploadFixture()
    const { broker: connection, id, home } = await broker(ssh.port)
    await connection.trust(id, await connection.inspect(id))
    await connection.savePassword(id, 'test-secret')
    const { terminalId } = await connection.terminalOpen(id, '/tmp', 80, 24)
    await connection.terminalWrite(terminalId, "printf 'hello-remote\\n'\nexit\n")
    let snapshot = await connection.terminalPoll(terminalId, 0)
    for (let attempt = 0; attempt < 20 && !Buffer.from(snapshot.data, 'base64').toString().includes('hello-remote'); attempt++) {
      await new Promise(resolve => setTimeout(resolve, 25))
      snapshot = await connection.terminalPoll(terminalId, 0)
    }
    expect(Buffer.from(snapshot.data, 'base64').toString()).toContain('hello-remote')
    await expect(readFile(join(home, 'ling-server-terminals', `${terminalId}.log`))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(ssh.commands.some(command => command.includes('--disable-sigusr1'))).toBe(true)
    expect(ssh.commands.join('\n')).not.toContain('test-secret')
    await connection.terminalClose(terminalId)
  }, 30000)
  it('uses DSH filesystem version checks and enforces per-call policy without cross-session leakage', async () => {
    const ssh = await uploadFixture()
    const { broker: connection, id, home } = await broker(ssh.port)
    await connection.trust(id, await connection.inspect(id))
    await connection.savePassword(id, 'test-secret')
    const workspaceRoot = await realpath(home)
    const file = join(workspaceRoot, 'remote.txt')
    const writable = { mode: 'workspace-write' as const, workspaceRoot }
    const readonly = { ...writable, mode: 'read-only' as const }
    const results = await Promise.allSettled([
      connection.writeFile(id, file, 'first', null, writable),
      connection.writeFile(id, join(workspaceRoot, 'denied.txt'), 'no', null, readonly),
    ])
    expect(results.map(result => result.status)).toEqual(['fulfilled', 'rejected'])
    const first = await connection.readFile(id, file)
    expect(first.text).toBe('first')
    expect(await connection.listFiles(id, workspaceRoot)).toContainEqual(expect.objectContaining({ name: 'remote.txt', type: 'file' }))
    await connection.writeFile(id, file, 'second', first.sha256, writable)
    await expect(connection.writeFile(id, file, 'stale', first.sha256, writable)).rejects.toThrow('已变化')
    await expect(connection.writeFile(id, `/etc/ling-test-${id}`, 'no', null, writable)).rejects.toMatchObject({ code: 'FS_SANDBOX_DENIED' })
    expect(await readFile(file, 'utf8')).toBe('second')
  }, 30000)

  it('confines remote shell execution using the DSH sandbox on the same server', async () => {
    const ssh = await uploadFixture()
    const { broker: connection, id, home } = await broker(ssh.port)
    await connection.trust(id, await connection.inspect(id))
    await connection.savePassword(id, 'test-secret')
    const cwd = await realpath(home)
    const signal = new AbortController().signal
    const denied = await connection.run(id, cwd, 'printf bad > forbidden.txt', signal, undefined, undefined,
      { mode: 'read-only', workspaceRoot: cwd })
    expect(denied.exitCode).not.toBe(0)
    await expect(readFile(join(cwd, 'forbidden.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
    const allowed = await connection.run(id, cwd, 'printf allowed > allowed.txt', signal, undefined, undefined,
      { mode: 'workspace-write', workspaceRoot: cwd })
    expect(allowed.exitCode).toBe(0)
    expect(await readFile(join(cwd, 'allowed.txt'), 'utf8')).toBe('allowed')
  }, 30000)

  it('retains a bounded result while streaming all output and completing a verbose command', async () => {
    const ssh = await uploadFixture()
    const { broker: connection, id } = await broker(ssh.port)
    await connection.trust(id, await connection.inspect(id))
    await connection.savePassword(id, 'test-secret')
    let bytes = 0
    const result = await connection.run(id, '/tmp', 'head -c 1048576 /dev/zero; printf done', undefined, 4096,
      chunk => { bytes += Buffer.byteLength(chunk.data) })
    expect(result.exitCode).toBe(0)
    expect(bytes).toBe(1048580)
    expect(result.stdout).toMatch(/^\[earlier output omitted\]/)
    expect(result.stdout.endsWith('done')).toBe(true)
  }, 30000)

  it('cancels the managed process range and keeps the authenticated connection usable', async () => {
    const ssh = await uploadFixture()
    const { broker: connection, id } = await broker(ssh.port)
    await connection.trust(id, await connection.inspect(id))
    await connection.savePassword(id, 'test-secret')
    const abort = new AbortController()
    let pid = 0
    const result = connection.run(id, '/tmp', 'sleep 60 & printf "%s\\n" "$!"; wait', abort.signal, undefined,
      chunk => { pid = Number(chunk.data.trim()); abort.abort(new Error('test cancellation')) })
    await expect(result).rejects.toThrow()
    expect(pid).toBeGreaterThan(0)
    expect(() => process.kill(pid, 0)).toThrow()
    expect(await connection.run(id, '/tmp', 'printf alive')).toMatchObject({ stdout: 'alive', exitCode: 0 })
    await connection.clearCredential(id)
    await expect(connection.run(id, '/tmp', 'pwd')).rejects.toThrow('密码或私钥')
  }, 30000)

  it('loads the same provider composition in a plain DSH context without Electron or LING services', async () => {
    const ssh = await uploadFixture()
    const workspaceRoot = await realpath(await mkdtemp(join(tmpdir(), 'ling-native-dsh-')))
    cleanup.push(() => rm(workspaceRoot, { recursive: true, force: true }))
    const client = new Client()
    await new Promise<void>((resolve, reject) => {
      client.once('ready', resolve).once('error', reject)
      client.connect({ host: '127.0.0.1', port: ssh.port, username: 'tester', password: 'test-secret' })
    })
    const artifact = fileURLToPath(new URL('../lib/', import.meta.url))
    const helper = await installHelper(client, workspaceRoot, undefined, artifact)
    const connection = new BrokerSshConnection(client, helper.node, helper.helper, helper.hash, workspaceRoot)
    cleanup.push(() => connection.dispose())
    await connection.ready
    const ctx = new Context()
    ctx.provide('ssh', connection as unknown as SshConnection)
    const projection = ctx.plugin(SessionProjectionRegistry)
    await projection
    const policy = ctx.plugin(SandboxPolicyService, { mode: 'workspace-write', workspaceRoot })
    await policy
    const plugin = ctx.plugin(sshPlugin)
    await plugin
    cleanup.push(async () => { await plugin.dispose(); await policy.dispose(); await projection.dispose() })
    const target = await ctx.fs.resolve(join(workspaceRoot, 'native.txt'))
    await ctx.fs.writeText(target, 'native DSH', { kind: 'createIfAbsent' })
    expect(await ctx.fs.readText(target)).toBe('native DSH')
    const confined = await ctx.sandbox.confine(['/bin/sh', '-c', 'cat native.txt'],
      { ...ctx.sandboxPolicy.resolve(), mode: 'workspace-write' })
    const child = ctx.subprocess.spawn({ argv: confined.argv, cwd: workspaceRoot, graceMs: 1500,
      stdio: { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' } })
    let output = ''
    child.stdout!.on('data', data => { output += data.toString() })
    child.stderr!.resume()
    expect((await child.done).exitCode).toBe(0)
    expect(output).toBe('native DSH')
  }, 30000)

  it('bootstraps Node without a remote preinstall and repairs a corrupt cached helper', async () => {
    const ssh = await uploadFixture(true)
    const root = await mkdtemp(join(tmpdir(), 'ling-node-bootstrap-'))
    cleanup.push(() => rm(root, { recursive: true, force: true }))
    const distribution = `node-v22.19.0-${process.platform}-${process.arch}`
    await mkdir(join(root, distribution, 'bin'), { recursive: true })
    const wrapper = join(root, distribution, 'bin/node')
    // A tiny local distribution fixture exercises the install protocol without network.
    await writeFile(wrapper, `#!/bin/sh\nexec '${process.execPath}' "$@"\n`)
    await chmod(wrapper, 0o700)
    const archive = join(root, 'node.tar.gz')
    execFileSync('tar', ['-czf', archive, '-C', root, distribution])
    const bytes = await readFile(archive)
    const digest = createHash('sha256').update(bytes).digest('hex')
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async url =>
      String(url).endsWith('SHASUMS256.txt') ? new Response(`${digest}  ${distribution}.tar.gz\n`) : new Response(new Uint8Array(bytes)))
    cleanup.push(async () => { fetch.mockRestore() })
    const client = new Client()
    await new Promise<void>((resolve, reject) => {
      client.once('ready', resolve).once('error', reject)
      client.connect({ host: '127.0.0.1', port: ssh.port, username: 'tester', password: 'test-secret' })
    })
    cleanup.push(async () => { client.end() })
    const artifact = fileURLToPath(new URL('../lib/', import.meta.url))
    const first = await installHelper(client, root, undefined, artifact)
    expect(first.node).toContain(distribution)
    expect(fetch).toHaveBeenCalledTimes(2)
    await writeFile(first.helper, 'corrupt cached helper')
    const second = await installHelper(client, root, undefined, artifact)
    expect(second).toEqual(first)
    expect(createHash('sha256').update(await readFile(second.helper)).digest('hex')).toBe(second.hash)
    expect(fetch).toHaveBeenCalledTimes(2)
  }, 30000)

})
