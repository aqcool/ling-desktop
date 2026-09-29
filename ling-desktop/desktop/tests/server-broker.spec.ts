import { createHash, generateKeyPairSync } from 'node:crypto'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Server, utils } from 'ssh2'
import { afterEach, describe, expect, it } from 'vitest'
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

async function uploadFixture() {
  const hostPrivate = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ format: 'pem', type: 'pkcs1' }).toString()
  const commands: string[] = []
  const chunks: Buffer[] = []
  const server = new Server({ hostKeys: [hostPrivate] }, client => {
    client.on('error', () => {})
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
        const process = spawn('sh', ['-c', info.command], { stdio: ['pipe', 'pipe', 'pipe'] })
        stream.pipe(process.stdin)
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
  return { broker: new ServerBroker(home, codec), id: server.id, home }
}

describe('server credential broker', () => {
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
  })
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
    const commands: string[] = []
    const ssh = await fixture('password', command => commands.push(command))
    const { broker: connection, id, home } = await broker(ssh.port)
    await expect(connection.run(id, '/home/tester', 'pwd')).rejects.toThrow('指纹')
    await connection.trust(id, await connection.inspect(id))
    await connection.savePassword(id, 'test-secret')
    await expect(connection.run(id, "/home/tester/a'b", 'pwd')).resolves.toEqual({ stdout: '远端-ok\n', stderr: '', exitCode: 0 })
    expect(commands).toEqual(["cd '/home/tester/a'\\''b' && sh -c 'pwd'"])
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
    expect(Buffer.concat(ssh.chunks)).toEqual(bytes)
    expect(await readFile(destination)).toEqual(bytes)
    expect(ssh.commands).toHaveLength(1)
    expect(ssh.commands[0]).toContain(hash)
    expect(ssh.commands[0]).not.toContain('test-secret')
    await writeFile(destination, 'changed remotely')
    await expect(connection.upload(id, root, 'release.bin', destination, hash, hash)).rejects.toThrow('远端文件已变化')
    expect(await readFile(destination, 'utf8')).toBe('changed remotely')
    await expect(connection.upload(id, root, 'release.bin', destination, 'a'.repeat(64), null)).rejects.toThrow('已变化')
    expect(ssh.commands).toHaveLength(2)
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
    expect(ssh.commands.some(command => command.includes('cat --'))).toBe(true)
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
    connection.terminalWrite(terminalId, "printf 'hello-remote\\n'\nexit\n")
    let snapshot = await connection.terminalPoll(terminalId, 0)
    for (let attempt = 0; attempt < 20 && !Buffer.from(snapshot.data, 'base64').toString().includes('hello-remote'); attempt++) {
      await new Promise(resolve => setTimeout(resolve, 25))
      snapshot = await connection.terminalPoll(terminalId, 0)
    }
    expect(Buffer.from(snapshot.data, 'base64').toString()).toContain('hello-remote')
    await expect(readFile(join(home, 'ling-server-terminals', `${terminalId}.log`))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(ssh.commands.some(command => command.includes('exec "${SHELL:-/bin/sh}" -l'))).toBe(true)
    expect(ssh.commands.join('\n')).not.toContain('test-secret')
    connection.terminalClose(terminalId)
  }, 30000)
})
