import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SFTPWrapper } from 'ssh2'
import { c as tar } from 'tar'
import { afterEach, describe, expect, it } from 'vitest'
import type { LingRemoteFileResult } from 'ling-desktop/runtime'
import { SftpFiles } from '../src/sftp-files.ts'
import { archivePath, extractArchive } from '../src/sftp-archive.ts'
import { sftpRequestSchema, sftpResultSchema } from '../src/sftp-contract.ts'
import { sftpFixture } from './fixtures/sftp-server.ts'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })
async function fixture(picker?: Parameters<typeof sftpFixture>[0], writeDelay = 0) {
  const value = await sftpFixture(picker, writeDelay); cleanups.push(value.close); return value
}
async function settled(value: Awaited<ReturnType<typeof fixture>>, started: LingRemoteFileResult) {
  expect(started.type).toBe('job')
  if (started.type !== 'job') throw new Error('expected job')
  for (let i = 0; i < 500; i++) {
    const result = await value.broker.manageFiles(value.serverId, { type: 'jobs' })
    if (result.type !== 'jobs') throw new Error('expected jobs')
    const job = result.jobs.find(job => job.id === started.job.id)!
    if (job.status !== 'running') return job
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error('file job did not settle')
}
function zipEntry(name: string, text: string): Buffer {
  const filename = Buffer.from(name); const data = Buffer.from(text)
  let crc = 0xffffffff
  for (const byte of data) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0) }
  crc = (crc ^ 0xffffffff) >>> 0
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt32LE(crc, 14)
  local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(filename.length, 26)
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6)
  central.writeUInt32LE(crc, 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(filename.length, 28)
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10)
  end.writeUInt32LE(central.length + filename.length, 12); end.writeUInt32LE(local.length + filename.length + data.length, 16)
  return Buffer.concat([local, filename, data, central, filename, end])
}

describe('native SFTP file operations', () => {
  it('browses, creates, renames and deletes without any shell/helper or task session', async () => {
    const value = await fixture()
    const send = value.broker.manageFiles.bind(value.broker, value.serverId)
    await writeFile(join(value.home, '.hidden'), 'hidden')
    const directory = await send({ type: 'list', path: '.' })
    expect(directory).toMatchObject({ type: 'directory', directory: { path: '/home/tester', entries: [{ name: '.hidden', kind: 'file' }] } })
    await send({ type: 'create', path: '/home/tester/new', directory: true })
    await send({ type: 'create', path: '/home/tester/new/hello.txt', directory: false })
    await expect(send({ type: 'create', path: '/home/tester/new/hello.txt', directory: false })).rejects.toThrow()
    await send({ type: 'rename', path: '/home/tester/new/hello.txt', destination: '/home/tester/new/renamed.txt' })
    expect(await readdir(join(value.home, 'new'))).toEqual(['renamed.txt'])
    await expect(send({ type: 'delete', path: '/home/tester', recursive: true })).rejects.toThrow('登录目录')
    expect((await settled(value, await send({ type: 'delete', path: '/home/tester/new', recursive: true }))).status).toBe('completed')
    expect(await readdir(value.home)).toEqual(['.hidden'])
    expect(value.execs).toBe(0)
    expect(value.logins).toBe(1)
    expect(await readdir(value.profile)).not.toContain('ssh-runtime-cache')
  }, 30000)

  it('reads JSON and binary previews, rejects stale saves, and retains originals on unsupported atomic replacement', async () => {
    const value = await fixture()
    const send = value.broker.manageFiles.bind(value.broker, value.serverId)
    await writeFile(join(value.home, 'data.json'), '{"hello":"世界"}')
    await writeFile(join(value.home, 'picture.png'), Buffer.from([137, 80, 78, 71]))
    const read = await send({ type: 'read', path: '/home/tester/data.json' })
    expect(read).toMatchObject({ type: 'document', document: { kind: 'code', text: '{"hello":"世界"}', truncated: false } })
    if (read.type !== 'document') throw new Error('expected document')
    const version = read.document.version!
    await writeFile(join(value.home, 'data.json'), 'changed')
    await expect(send({ type: 'save', path: '/home/tester/data.json', text: 'new', version })).rejects.toThrow('已变化')
    const current = await send({ type: 'read', path: '/home/tester/data.json' })
    if (current.type !== 'document') throw new Error('expected document')
    await expect(send({ type: 'save', path: '/home/tester/data.json', text: 'new', version: current.document.version! })).rejects.toThrow('不支持原子替换')
    expect(await readFile(join(value.home, 'data.json'), 'utf8')).toBe('changed')
    expect((await readdir(value.home)).filter(name => name.startsWith('.ling-'))).toEqual([])
    expect(await send({ type: 'read', path: '/home/tester/picture.png' })).toMatchObject({ type: 'document', document: { kind: 'image', mediaType: 'image/png', data: 'iVBORw==' } })
  }, 30000)

  it('uploads and downloads using streams, never merges existing targets, and extracts validated ZIP content', async () => {
    let upload: readonly string[] = []; let download = ''
    const value = await fixture({ upload: async () => upload, download: async () => download })
    const send = value.broker.manageFiles.bind(value.broker, value.serverId)
    const source = join(value.local, 'upload.txt'); await writeFile(source, 'stream payload')
    upload = [source]
    expect((await settled(value, await send({ type: 'upload', path: '/home/tester', directory: false }))).status).toBe('completed')
    expect(await readFile(join(value.home, 'upload.txt'), 'utf8')).toBe('stream payload')
    expect((await settled(value, await send({ type: 'upload', path: '/home/tester', directory: false }))).error).toContain('未覆盖')
    download = join(value.local, 'download.txt')
    expect((await settled(value, await send({ type: 'download', path: '/home/tester/upload.txt' }))).status).toBe('completed')
    expect(await readFile(download, 'utf8')).toBe('stream payload')
    await writeFile(join(value.home, 'test.zip'), zipEntry('folder/result.txt', 'unpacked'))
    expect((await settled(value, await send({ type: 'extract', path: '/home/tester/test.zip', destination: '/home/tester/extracted' }))).status).toBe('completed')
    expect(await readFile(join(value.home, 'extracted', 'folder', 'result.txt'), 'utf8')).toBe('unpacked')
    await writeFile(join(value.home, 'bad.zip'), zipEntry('../escaped.txt', 'bad'))
    const failed = await settled(value, await send({ type: 'extract', path: '/home/tester/bad.zip', destination: '/home/tester/bad' }))
    expect(failed.status).toBe('failed')
    expect(await lstat(join(value.home, 'bad')).catch(() => undefined)).toBeUndefined()
    const corrupt = zipEntry('broken.txt', 'payload'); const dataStart = 30 + Buffer.byteLength('broken.txt')
    corrupt[dataStart] = corrupt[dataStart]! ^ 1
    await writeFile(join(value.home, 'broken.zip'), corrupt)
    expect((await settled(value, await send({ type: 'extract', path: '/home/tester/broken.zip', destination: '/home/tester/broken' }))).error).toContain('校验失败')
    expect(await lstat(join(value.home, 'broken')).catch(() => undefined)).toBeUndefined()
    expect((await readdir(value.home)).filter(name => name.startsWith('.ling-'))).toEqual([])
    expect(value.execs).toBe(0)
  }, 45000)

  it('cancels in-flight uploads, removes staging files and permits later use of the same SSH connection', async () => {
    let source = ''
    const value = await fixture({ upload: async () => [source], download: async () => undefined }, 15)
    source = join(value.local, 'large.dat'); await writeFile(source, Buffer.alloc(16 * 1024 * 1024, 4))
    const started = await value.broker.manageFiles(value.serverId, { type: 'upload', path: '/home/tester', directory: false })
    if (started.type !== 'job') throw new Error('expected job')
    for (let i = 0; i < 500; i++) {
      const result = await value.broker.manageFiles(value.serverId, { type: 'jobs' })
      if (result.type === 'jobs' && result.jobs[0]!.bytes > 0) break
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    const progress = await value.broker.manageFiles(value.serverId, { type: 'jobs' })
    expect(progress).toMatchObject({ jobs: [{ status: 'running', bytes: expect.any(Number) }] })
    await value.broker.manageFiles(value.serverId, { type: 'cancel', jobId: started.job.id })
    expect((await settled(value, started)).status).toBe('cancelled')
    expect(await readdir(value.home)).toEqual([])
    expect(await value.broker.manageFiles(value.serverId, { type: 'list', path: '.' })).toMatchObject({ type: 'directory' })
  }, 30000)

  it('preserves nested and empty directories in transfers and leaves no partial result when a tree contains links', async () => {
    let sources: readonly string[] = []
    const value = await fixture({ upload: async () => sources, download: async () => value.local })
    const send = value.broker.manageFiles.bind(value.broker, value.serverId)
    const source = join(value.local, 'tree')
    await mkdir(join(source, 'nested'), { recursive: true }); await mkdir(join(source, 'empty'))
    await writeFile(join(source, 'nested', '中文.txt'), 'nested data'); sources = [source]
    expect((await settled(value, await send({ type: 'upload', path: '/home/tester', directory: true }))).status).toBe('completed')
    expect(await readFile(join(value.home, 'tree', 'nested', '中文.txt'), 'utf8')).toBe('nested data')
    await send({ type: 'rename', path: '/home/tester/tree', destination: '/home/tester/download-tree' })
    expect((await settled(value, await send({ type: 'download', path: '/home/tester/download-tree' }))).status).toBe('completed')
    expect(await readFile(join(value.local, 'download-tree', 'nested', '中文.txt'), 'utf8')).toBe('nested data')
    expect((await lstat(join(value.local, 'download-tree', 'empty'))).isDirectory()).toBe(true)
    if (process.platform !== 'win32') {
      await mkdir(join(value.home, 'links')); await symlink('../download-tree', join(value.home, 'links', 'linked'))
      expect((await settled(value, await send({ type: 'download', path: '/home/tester/links' }))).status).toBe('failed')
      expect(await lstat(join(value.local, 'links')).catch(() => undefined)).toBeUndefined()
      expect((await readdir(value.local)).filter(name => name.startsWith('.ling-'))).toEqual([])
    }
  }, 30000)
})

describe('save and archive safety', () => {
  it('atomically replaces a verified text file and preserves its permission bits', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ling-sftp-save-')); cleanups.push(() => rm(root, { recursive: true, force: true }))
    const path = join(root, 'hello'); await writeFile(path, 'before', { mode: 0o640 })
    // SFTP always uses POSIX paths, even when the fixture's filesystem is Windows.
    const localPath = (remote: string) => join(root, remote.replace(/^\/+/, ''))
    const channel = {
      createReadStream: (remote: string, options?: Parameters<typeof createReadStream>[1]) => createReadStream(localPath(remote), options),
      createWriteStream: (remote: string, options?: Parameters<typeof createWriteStream>[1]) => createWriteStream(localPath(remote), options),
      lstat: (remote: string, done: (error: Error | null, value?: unknown) => void) => { void lstat(localPath(remote)).then(value => done(null, value), done) },
      unlink: (remote: string, done: (error?: Error | null) => void) => { void rm(localPath(remote)).then(() => done(), done) },
      ext_openssh_rename: (remote: string, target: string, done: (error?: Error | null) => void) => { void rename(localPath(remote), localPath(target)).then(() => done(), done) },
    } as unknown as SFTPWrapper
    const files = new SftpFiles(channel)
    const version = createHash('sha256').update('before').digest('hex')
    expect(await files.save('/hello', 'after', version)).toBe(createHash('sha256').update('after').digest('hex'))
    expect(await readFile(path, 'utf8')).toBe('after')
    if (process.platform !== 'win32') expect((await lstat(path)).mode & 0o777).toBe(0o640)
    expect(await readdir(root)).toEqual(['hello'])
  })
  it('extracts TAR.GZ and rejects TAR links and unsafe paths before publishing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ling-sftp-tar-')); cleanups.push(() => rm(root, { recursive: true, force: true }))
    const source = join(root, 'source'); const destination = join(root, 'out'); await mkdir(source); await mkdir(destination)
    await writeFile(join(source, 'hello.txt'), 'hello')
    const archive = join(root, 'test.tgz'); await tar({ cwd: source, file: archive, gzip: true }, ['hello.txt'])
    await extractArchive(archive, 'test.tgz', destination, new AbortController().signal)
    expect(await readFile(join(destination, 'hello.txt'), 'utf8')).toBe('hello')
    if (process.platform !== 'win32') {
      await symlink('hello.txt', join(source, 'link'))
      const bad = join(root, 'bad.tar'); await tar({ cwd: source, file: bad }, ['link'])
      await expect(extractArchive(bad, 'bad.tar', destination, new AbortController().signal)).rejects.toThrow('链接')
    }
    for (const path of ['../bad', '/root', 'C:/bad', 'a\\b', 'a/../b', 'a:stream', 'CON.txt', 'a.']) expect(() => archivePath(path)).toThrow('不安全')
  })
  it('rejects malformed cross-process requests and validates file results', () => {
    expect(sftpRequestSchema.safeParse({ type: 'rename', path: '/safe', destination: '/other', command: 'rm' }).success).toBe(false)
    expect(sftpRequestSchema.safeParse({ type: 'save', path: '/safe', text: 'x', version: 'bad' }).success).toBe(false)
    expect(sftpResultSchema.safeParse({ type: 'jobs', jobs: [], credential: 'secret' }).success).toBe(false)
  })
})
