import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lstat, mkdir, readFile, readdir, symlink, utimes, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { serverCopyRequestSchema, type ServerCopyOptions } from '../src/server-copy-contract.ts'
import { shellQuote } from '../src/server-deployment.ts'
import { sftpFixture } from './fixtures/sftp-server.ts'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })
async function fixture(options: Parameters<typeof sftpFixture>[2] = { atomicRename: true }, delay = 0) {
  const value = await sftpFixture(undefined, delay, options); cleanups.push(value.close); return value
}
const signal = () => new AbortController().signal
function copy(value: Awaited<ReturnType<typeof fixture>>, options: ServerCopyOptions, abort = signal(), progress?: Parameters<typeof value.broker.copy>[3]) {
  return value.broker.copy(value.serverId, serverCopyRequestSchema.parse({ root: value.local, allowOutsideWorkspace: false, method: 'sftp', ...options }), abort, progress)
}

describe('agent copy using saved authentication', () => {
  it.each([false, true])('copies arbitrary binary data with saved %s key authentication, pipelined writes and no remote helper', async key => {
    const value = await fixture({ key, atomicRename: true }, 10)
    const data = Buffer.alloc(2 * 1024 * 1024); for (let i = 0; i < data.length; i++) data[i] = i % 251
    await writeFile(join(value.local, '二进制 file.dat'), data)
    const progress: number[] = []
    const result = await copy(value, { source: '二进制 file.dat', destination: '/home/tester/new/deep/file.dat' }, signal(), item => progress.push(item.bytes))
    const received = await readFile(join(value.home, 'new/deep/file.dat'))
    expect(createHash('sha256').update(received).digest('hex')).toBe(createHash('sha256').update(data).digest('hex'))
    expect(result).toMatchObject({ copied: 1, skipped: 0, bytes: data.length, method: 'sftp' })
    expect(value.peakWrites).toBeGreaterThan(8)
    expect(Math.max(...progress)).toBe(data.length)
    expect(value.execs).toBe(0); expect(value.logins).toBe(1)
    expect(await readdir(value.profile)).not.toContain('ssh-runtime-cache')
    expect(await copy(value, { source: '二进制 file.dat', destination: '/home/tester/new/deep/file.dat' })).toMatchObject({ copied: 0, skipped: 1 })
    expect(value.logins).toBe(1)
  }, 30000)

  it('merges directory contents, preserves remote-only files and empty directories, and applies exclusions before transfer', async () => {
    const value = await fixture()
    await mkdir(join(value.local, 'dist/nested'), { recursive: true }); await mkdir(join(value.local, 'dist/empty'))
    await mkdir(join(value.local, 'dist/node_modules')); await writeFile(join(value.local, 'dist/node_modules/secret'), 'excluded')
    await writeFile(join(value.local, 'dist/nested/a.txt'), 'new'); await writeFile(join(value.local, 'dist/debug.map'), 'excluded')
    await mkdir(join(value.home, 'app/nested'), { recursive: true }); await writeFile(join(value.home, 'app/nested/a.txt'), 'old')
    await writeFile(join(value.home, 'app/remote.conf'), 'preserve')
    const options = { source: 'dist', destination: '/home/tester/app', exclude: ['node_modules/', '*.map'], checksum: true }
    expect(await copy(value, options)).toMatchObject({ files: 1, copied: 1 })
    expect(await readFile(join(value.home, 'app/nested/a.txt'), 'utf8')).toBe('new')
    expect(await readFile(join(value.home, 'app/remote.conf'), 'utf8')).toBe('preserve')
    expect((await lstat(join(value.home, 'app/empty'))).isDirectory()).toBe(true)
    expect(await readdir(join(value.home, 'app'))).toEqual(expect.arrayContaining(['empty', 'nested', 'remote.conf']))
    expect(await lstat(join(value.home, 'app/node_modules')).catch(() => undefined)).toBeUndefined()
    expect(await lstat(join(value.home, 'app/debug.map')).catch(() => undefined)).toBeUndefined()
    expect(await copy(value, options)).toMatchObject({ copied: 0, skipped: 1 })
  })

  it('supports preview and explicit conflict choices, including checksum detection of identical size/mtime', async () => {
    const value = await fixture()
    await writeFile(join(value.local, 'a.txt'), 'before')
    const target = '/home/tester/new/a.txt'
    expect(await copy(value, { source: 'a.txt', destination: target, dryRun: true })).toMatchObject({ dryRun: true, copied: 0, changes: expect.arrayContaining([`新增 ${target}`, '新增目录 /home/tester/new']) })
    expect(await lstat(join(value.home, 'new')).catch(() => undefined)).toBeUndefined()
    await copy(value, { source: 'a.txt', destination: target })
    const before = await lstat(join(value.local, 'a.txt'))
    await writeFile(join(value.local, 'a.txt'), 'after!'); await utimes(join(value.local, 'a.txt'), before.atime, before.mtime)
    expect(await copy(value, { source: 'a.txt', destination: target })).toMatchObject({ skipped: 1 })
    expect(await copy(value, { source: 'a.txt', destination: target, checksum: true, overwrite: 'skip' })).toMatchObject({ skipped: 1 })
    await expect(copy(value, { source: 'a.txt', destination: target, overwrite: 'error' })).rejects.toThrow('已存在')
    expect(await copy(value, { source: 'a.txt', destination: target, checksum: true })).toMatchObject({ copied: 1 })
    expect(await readFile(join(value.home, 'new/a.txt'), 'utf8')).toBe('after!')
  })

  it('retains existing content and cleans stages when atomic overwrite is unsupported', async () => {
    const value = await fixture({ atomicRename: false })
    await writeFile(join(value.local, 'file'), 'longer replacement'); await writeFile(join(value.home, 'file'), 'old')
    await expect(copy(value, { source: 'file', destination: '/home/tester/file' })).rejects.toThrow('原子替换')
    expect(await readFile(join(value.home, 'file'), 'utf8')).toBe('old')
    expect(await readdir(value.home)).toEqual(['file'])
  })

  it('cancels in-flight data, retains completed files for retry and keeps the saved connection usable', async () => {
    const value = await fixture({ atomicRename: true }, 20)
    await mkdir(join(value.local, 'tree')); await writeFile(join(value.local, 'tree/done'), 'finished')
    await writeFile(join(value.local, 'tree/large'), Buffer.alloc(8 * 1024 * 1024, 6))
    await mkdir(join(value.home, 'app'))
    await copy(value, { source: 'tree/done', destination: '/home/tester/app/done' })
    const controller = new AbortController()
    const copying = copy(value, { source: 'tree', destination: '/home/tester/app' }, controller.signal,
      progress => { if (progress.bytes > 0) controller.abort() })
    await expect(copying).rejects.toThrow('取消')
    expect(await readdir(join(value.home, 'app'))).toEqual(['done'])
    expect(await copy(value, { source: 'tree', destination: '/home/tester/app' })).toMatchObject({ copied: 1, skipped: 1 })
    expect(value.logins).toBe(1)
  }, 30000)

  it('enforces local scope and rejects links and special targets without publishing data', async () => {
    const value = await fixture()
    await writeFile(join(value.local, 'file'), 'safe')
    await writeFile(join(value.home, 'outside'), 'outside')
    await expect(copy(value, { source: join(value.home, 'outside'), destination: '/home/tester/copy' })).rejects.toThrow('超出')
    await mkdir(join(value.home, 'directory'))
    await expect(copy(value, { source: 'file', destination: '/home/tester/directory' })).rejects.toThrow('不是普通文件')
    if (process.platform !== 'win32') {
      await symlink(value.home, join(value.local, 'link'))
      await expect(copy(value, { source: 'link/outside', destination: '/home/tester/copy' })).rejects.toThrow('超出')
      await symlink('outside', join(value.home, 'link'))
      await expect(copy(value, { source: 'file', destination: '/home/tester/link/copy' })).rejects.toThrow('不是普通目录')
    }
    const request = serverCopyRequestSchema.parse({ root: value.local, source: join(value.home, 'outside'), destination: '/home/tester/copy', allowOutsideWorkspace: true, method: 'sftp' })
    expect(await value.broker.copy(value.serverId, request, signal())).toMatchObject({ copied: 1 })
    expect(await readFile(join(value.home, 'copy'), 'utf8')).toBe('outside')
  })
  it('cleans unfinished stages before closing the shared SSH connection', async () => {
    const value = await fixture({ atomicRename: true }, 20)
    await writeFile(join(value.local, 'large'), Buffer.alloc(4 * 1024 * 1024))
    let started!: () => void
    const progress = new Promise<void>(resolve => { started = resolve })
    const copying = copy(value, { source: 'large', destination: '/home/tester/large' }, signal(), item => { if (item.bytes > 0) started() })
    const cancelled = expect(copying).rejects.toThrow('取消')
    await progress
    await value.broker.close()
    await cancelled
    expect(await readdir(value.home)).toEqual([])
  })
  it('cancels a stalled WRITE response without breaking other SFTP users or saved authentication', async () => {
    let notify!: () => void
    const writing = new Promise<void>(resolve => { notify = resolve })
    const options = { atomicRename: true, stallWrites: true, onWrite: () => notify() }
    const value = await fixture(options)
    await writeFile(join(value.local, 'file'), Buffer.alloc(2 * 1024 * 1024, 7))
    const abort = new AbortController()
    const copying = copy(value, { source: 'file', destination: '/home/tester/file' }, abort.signal)
    const cancelled = expect(copying).rejects.toThrow('取消')
    await writing
    abort.abort()
    await cancelled
    expect(await readdir(value.home)).toEqual([])
    expect(await value.broker.manageFiles(value.serverId, { type: 'list', path: '.' })).toMatchObject({ type: 'directory' })
    options.stallWrites = false
    expect(await copy(value, { source: 'file', destination: '/home/tester/file' })).toMatchObject({ copied: 1 })
    expect(value.logins).toBe(1)
  })
  it('cancels a stalled checksum READ during preflight and leaves the existing target untouched', async () => {
    let notify!: () => void
    let writes = 0
    const reading = new Promise<void>(resolve => { notify = resolve })
    const options = { atomicRename: true, stallReads: false, onRead: () => notify(), onWrite: () => { writes++ } }
    const value = await fixture(options)
    await writeFile(join(value.local, 'file'), 'payload')
    // Seed POSIX permissions through SFTP; a direct Windows write reports 0666
    // instead of the copy source's normalized 0644 and requires a replacement.
    await copy(value, { source: 'file', destination: '/home/tester/file' })
    writes = 0
    options.stallReads = true
    const abort = new AbortController()
    const copying = copy(value, { source: 'file', destination: '/home/tester/file', checksum: true }, abort.signal)
    const cancelled = expect(copying).rejects.toThrow('取消')
    await reading; abort.abort(); await cancelled
    expect(writes).toBe(0)
    expect(await readFile(join(value.home, 'file'), 'utf8')).toBe('payload')
    expect(await readdir(value.home)).toEqual(['file'])
    options.stallReads = false
    expect(await copy(value, { source: 'file', destination: '/home/tester/file', checksum: true })).toMatchObject({ copied: 0, skipped: 1 })
    expect(value.logins).toBe(1)
  })

  it('falls back to native SFTP when remote rsync is absent; explicit rsync fails before changing remote paths', async () => {
    const value = await fixture()
    await mkdir(join(value.local, 'tree')); await writeFile(join(value.local, 'tree/file'), 'payload')
    expect(await copy(value, { source: 'tree', destination: '/home/tester/app', method: 'auto' })).toMatchObject({ method: 'sftp', copied: 1 })
    await expect(copy(value, { source: 'tree', destination: '/home/tester/absent', method: 'rsync' })).rejects.toThrow('不支持 rsync')
    expect(await lstat(join(value.home, 'absent')).catch(() => undefined)).toBeUndefined()
  })
})

const rsyncAvailable = process.platform !== 'win32' && spawnSync('rsync', ['--version'], { stdio: 'ignore' }).status === 0
describe.skipIf(!rsyncAvailable)('optional rsync through saved SSH authentication', () => {
  it('runs real rsync without another password, transfers filtered directory contents and handles quoted paths', async () => {
    let remotePath = ''
    let diskPath = ''
    const commands: string[] = []
    const value = await fixture({ atomicRename: true, key: true, exec: (command, channel) => {
      commands.push(command)
      const child = spawn('/bin/sh', ['-c', command === 'rsync --version' ? command : command.replace(shellQuote(remotePath), shellQuote(diskPath))], { stdio: ['pipe', 'pipe', 'pipe'] })
      channel.pipe(child.stdin); child.stdout.pipe(channel, { end: false }); child.stderr.pipe(channel.stderr, { end: false })
      child.stdin.on('error', () => {})
      channel.on('error', () => child.kill()); channel.once('close', () => child.kill())
      child.once('close', code => { channel.exit(code ?? 255); channel.end() })
    } })
    await mkdir(join(value.local, 'tree/nested'), { recursive: true }); await mkdir(join(value.local, 'tree/node_modules'))
    await writeFile(join(value.local, 'tree/nested/中文 file.txt'), 'binary\0payload'); await writeFile(join(value.local, 'tree/node_modules/secret'), 'excluded')
    remotePath = "/home/tester/a 'quoted' folder"; diskPath = join(value.home, "a 'quoted' folder")
    await mkdir(join(diskPath, 'nested'), { recursive: true, mode: 0o750 })
    const result = await copy(value, { source: 'tree', destination: remotePath, exclude: ['node_modules/'], method: 'auto' })
    expect(result).toMatchObject({ method: 'rsync', copied: 1 })
    expect(await readFile(join(diskPath, 'nested/中文 file.txt'), 'utf8')).toBe('binary\0payload')
    expect(await lstat(join(diskPath, 'node_modules')).catch(() => undefined)).toBeUndefined()
    expect((await lstat(join(diskPath, 'nested'))).mode & 0o777).toBe(0o750)
    expect(value.logins).toBe(1)
    expect(commands).toHaveLength(2)
    expect(commands[1]).toMatch(/^rsync '--server'/)
    expect(commands.join('\n')).not.toContain('key-secret')
    await writeFile(join(value.local, '-file.dat'), Buffer.alloc(2 * 1024 * 1024, 19))
    remotePath = '/home/tester/exact renamed.dat'; diskPath = join(value.home, 'exact renamed.dat')
    expect(await copy(value, { source: '-file.dat', destination: remotePath, method: 'rsync', checksum: true })).toMatchObject({ copied: 1, bytes: 2 * 1024 * 1024 })
    expect(await readFile(diskPath)).toEqual(Buffer.alloc(2 * 1024 * 1024, 19))
    expect(value.logins).toBe(1)
    remotePath = '/home/tester/skip.dat'; diskPath = join(value.home, 'skip.dat')
    expect(await copy(value, { source: '-file.dat', destination: remotePath, method: 'rsync', overwrite: 'skip' })).toMatchObject({ copied: 1, skipped: 0 })
  }, 30000)
  it('propagates receiver failure instead of silently rerunning with another transport', async () => {
    const value = await fixture({ exec: (command, channel) => {
      if (command === 'rsync --version') { channel.exit(0); channel.end(); return }
      channel.stderr.write('fixture receiver refused\n'); channel.exit(23); channel.end()
    } })
    await writeFile(join(value.local, 'file'), 'payload')
    await expect(copy(value, { source: 'file', destination: '/home/tester/file', method: 'rsync' })).rejects.toThrow('fixture receiver refused')
    expect(await lstat(join(value.home, 'file')).catch(() => undefined)).toBeUndefined()
    expect(value.execs).toBe(2)
  })
  it('cancels an active receiver and allows reuse of the saved SSH connection', async () => {
    let ready!: () => void
    const receiverReady = new Promise<void>(resolve => { ready = resolve })
    const value = await fixture({ exec: (command, channel) => {
      if (command === 'rsync --version') { channel.exit(0); channel.end(); return }
      ready()
      channel.on('error', () => {})
      channel.resume()
    } })
    await writeFile(join(value.local, 'file'), 'payload')
    const controller = new AbortController()
    const copying = copy(value, { source: 'file', destination: '/home/tester/file', method: 'rsync' }, controller.signal)
    const cancelled = expect(copying).rejects.toThrow('取消')
    await receiverReady
    controller.abort()
    await cancelled
    expect(await copy(value, { source: 'file', destination: '/home/tester/file' })).toMatchObject({ method: 'sftp', copied: 1 })
    expect(value.logins).toBe(1)
  })
  it.each(['skip', 'error'] as const)('honors overwrite=%s when a target is created after preflight', async overwrite => {
    let target = ''
    const value = await fixture({ exec: (command, channel) => {
      if (command === 'rsync --version') { const child = spawn('rsync', ['--version']); child.stdout.pipe(channel, { end: false }); child.once('close', code => { channel.exit(code ?? 255); channel.end() }); return }
      void writeFile(target, 'concurrent content').then(() => {
        const child = spawn('/bin/sh', ['-c', command.replace(shellQuote('/home/tester/file'), shellQuote(target))], { stdio: ['pipe', 'pipe', 'pipe'] })
        channel.pipe(child.stdin); child.stdout.pipe(channel, { end: false }); child.stderr.pipe(channel.stderr, { end: false })
        child.stdin.on('error', () => {}); channel.once('close', () => child.kill())
        child.once('close', code => { channel.exit(code ?? 255); channel.end() })
      })
    } })
    target = join(value.home, 'file')
    await writeFile(join(value.local, 'file'), 'payload')
    const copying = copy(value, { source: 'file', destination: '/home/tester/file', method: 'rsync', overwrite })
    if (overwrite === 'skip') await expect(copying).resolves.toMatchObject({ copied: 0, skipped: 1, bytes: 0 })
    else await expect(copying).rejects.toThrow('未覆盖')
    expect(await readFile(target, 'utf8')).toBe('concurrent content')
  })
})
