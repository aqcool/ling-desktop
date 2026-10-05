import { createHash, randomUUID } from 'node:crypto'
import { posix } from 'node:path'
import { Readable, Transform, type Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { Stats, SFTPWrapper } from 'ssh2'
import type { LingWorkspaceDirectory, LingWorkspaceDocument } from 'ling-desktop/runtime'

export const TEXT_LIMIT = 2 * 1024 * 1024
export const PREVIEW_LIMIT = 12 * 1024 * 1024
export function remotePath(path: string): string {
  if (!path.startsWith('/') || path.length > 4096 || /[\0\r\n]/u.test(path)) throw new Error('远端路径无效。')
  return posix.normalize(path)
}
export function mutablePath(path: string): string {
  const target = remotePath(path)
  if (target === '/') throw new Error('不能修改服务器根目录。')
  return target
}
const binaryTypes: Record<string, { kind: 'image' | 'pdf' | 'office'; mediaType: string }> = {
  '.png': { kind: 'image', mediaType: 'image/png' }, '.jpg': { kind: 'image', mediaType: 'image/jpeg' },
  '.jpeg': { kind: 'image', mediaType: 'image/jpeg' }, '.gif': { kind: 'image', mediaType: 'image/gif' },
  '.webp': { kind: 'image', mediaType: 'image/webp' }, '.avif': { kind: 'image', mediaType: 'image/avif' },
  '.svg': { kind: 'image', mediaType: 'image/svg+xml' }, '.pdf': { kind: 'pdf', mediaType: 'application/pdf' },
  '.docx': { kind: 'office', mediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  '.xlsx': { kind: 'office', mediaType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  '.pptx': { kind: 'office', mediaType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' },
}

/** Native SFTP streams; no remote executable, helper installation or shell quoting. */
export class SftpFiles {
  constructor(readonly channel: SFTPWrapper) {}
  private call<T>(invoke: (done: (error: Error | undefined | null, value: T) => void) => void): Promise<T> {
    return new Promise((resolve, reject) => invoke((error, value) => error ? reject(error) : resolve(value)))
  }
  realpath(path: string) { return this.call<string>(done => this.channel.realpath(path, done)) }
  stat(path: string) { return this.call<Stats>(done => this.channel.lstat(remotePath(path), done)) }
  async exists(path: string): Promise<Stats | undefined> {
    try { return await this.stat(path) } catch (error) {
      if ((error as { code?: number }).code === 2) return undefined
      throw error
    }
  }
  mkdir(path: string) { return this.call<void>(done => this.channel.mkdir(mutablePath(path), { mode: 0o755 }, done)) }
  rename(path: string, destination: string) { return this.call<void>(done => this.channel.rename(mutablePath(path), mutablePath(destination), done)) }
  unlink(path: string) { return this.call<void>(done => this.channel.unlink(mutablePath(path), done)) }
  rmdir(path: string) { return this.call<void>(done => this.channel.rmdir(mutablePath(path), done)) }
  async list(path: string, signal?: AbortSignal): Promise<LingWorkspaceDirectory> {
    signal?.throwIfAborted()
    const resolved = await this.realpath(path === '.' ? '.' : remotePath(path))
    const entries = await this.call<import('ssh2').FileEntry[]>(done => this.channel.readdir(resolved, done))
    signal?.throwIfAborted()
    const valid = entries.filter(entry => !['.', '..'].includes(entry.filename) && !/[\/\0]/u.test(entry.filename))
    return { path: resolved, truncated: valid.length > 10000, entries: valid.slice(0, 10000).map(entry => ({
      name: entry.filename, path: posix.join(resolved, entry.filename),
      kind: (entry.attrs.mode & 0o170000) === 0o040000 ? 'directory' : (entry.attrs.mode & 0o170000) === 0o100000 ? 'file' : 'other', bytes: entry.attrs.size,
    })) }
  }
  async readBytes(path: string, limit: number, signal?: AbortSignal): Promise<Buffer> {
    const chunks: Buffer[] = []
    let size = 0
    const sink = new Transform({ transform(chunk: Buffer, _encoding, done) {
      size += chunk.length
      if (size > limit) done(new Error('文件超过读取上限。'))
      else { chunks.push(Buffer.from(chunk)); done() }
    } })
    await pipeline(this.channel.createReadStream(remotePath(path), { start: 0, end: limit - 1 }), sink, { signal })
    return Buffer.concat(chunks)
  }
  async document(path: string, signal?: AbortSignal): Promise<LingWorkspaceDocument> {
    const target = remotePath(path)
    const before = await this.stat(target)
    if (!before.isFile()) return { path: target, kind: 'unsupported', mediaType: 'application/octet-stream', bytes: before.size }
    const binary = binaryTypes[posix.extname(target).toLowerCase()]
    if (binary && before.size > PREVIEW_LIMIT) return { path: target, kind: 'unsupported', mediaType: binary.mediaType, bytes: before.size }
    const bytes = await this.readBytes(target, binary ? PREVIEW_LIMIT : TEXT_LIMIT, signal)
    const after = await this.stat(target)
    if (before.size !== after.size || before.mtime !== after.mtime) throw new Error('文件在读取期间发生变化，请刷新后重试。')
    if (binary) return { path: target, ...binary, data: bytes.toString('base64'), bytes: bytes.length }
    let text: string
    const truncated = before.size > bytes.length
    try {
      // A truncated UTF-8 preview may end in a partial character; never allow it to be saved.
      text = new TextDecoder('utf-8', { fatal: !truncated }).decode(bytes)
      if (text.includes('\0')) throw new Error('binary')
    } catch { return { path: target, kind: 'unsupported', mediaType: 'application/octet-stream', bytes: before.size } }
    const markdown = /\.(md|markdown|mdown)$/iu.test(target)
    return { path: target, kind: markdown ? 'markdown' : 'code', mediaType: markdown ? 'text/markdown' : 'text/plain',
      text, truncated, lines: text.split('\n').length, bytes: before.size,
      ...(!truncated ? { version: createHash('sha256').update(bytes).digest('hex') } : {}) }
  }
  async hash(path: string, signal?: AbortSignal): Promise<string> {
    const hash = createHash('sha256')
    await pipeline(this.channel.createReadStream(remotePath(path)), new Transform({ transform(chunk: Buffer, _encoding, done) {
      hash.update(chunk); done()
    } }), { signal })
    return hash.digest('hex')
  }
  async create(path: string, directory: boolean, signal?: AbortSignal) {
    signal?.throwIfAborted()
    if (directory) return this.mkdir(path)
    await pipeline(Readable.from([]), this.channel.createWriteStream(mutablePath(path), { flags: 'wx', mode: 0o644 }), { signal })
  }
  async save(path: string, text: string, version: string, signal?: AbortSignal): Promise<string> {
    const target = mutablePath(path)
    const before = await this.stat(target)
    if (!before.isFile() || before.size > TEXT_LIMIT || Buffer.byteLength(text) > TEXT_LIMIT) throw new Error('此文件不能直接编辑。')
    if (await this.hash(target, signal) !== version) throw new Error('远端文件已变化，未覆盖。请保留修改并重新读取文件。')
    const temporary = posix.join(posix.dirname(target), `.ling-save-${randomUUID()}`)
    try {
      await pipeline(Readable.from([Buffer.from(text)]), this.channel.createWriteStream(temporary, { flags: 'wx', mode: before.mode & 0o777 }), { signal })
      const current = await this.stat(target)
      if (!current.isFile() || await this.hash(target, signal) !== version) throw new Error('远端文件已变化，未覆盖。请保留修改并重新读取文件。')
      signal?.throwIfAborted()
      // SFTP v3 rename cannot atomically replace a file. Never emulate replacement by deleting it first.
      try { await this.call<void>(done => this.channel.ext_openssh_rename(temporary, target, done)) }
      catch (error) {
        if ((error as { code?: number }).code === 8 || /extension|extended request/i.test(String(error))) throw new Error('服务器不支持原子替换，无法安全保存已有文件。修改仍保留。')
        throw error
      }
      return createHash('sha256').update(text).digest('hex')
    } finally { await this.unlink(temporary).catch(() => {}) }
  }
  async remove(path: string, recursive: boolean, signal?: AbortSignal, counter = { count: 0 }): Promise<void> {
    signal?.throwIfAborted()
    if (++counter.count > 10000) throw new Error('删除条目超过 10000 项，请分批处理。')
    const target = mutablePath(path)
    const attributes = await this.stat(target)
    if (!attributes.isDirectory()) return this.unlink(target)
    if (recursive) {
      const listing = await this.list(target, signal)
      if (listing.path !== target || !(await this.stat(target)).isDirectory()) throw new Error('目录路径已变化，已停止删除。')
      if (listing.truncated) throw new Error('目录过大，请分批删除。')
      for (const entry of listing.entries) await this.remove(entry.path, true, signal, counter)
    }
    signal?.throwIfAborted()
    await this.rmdir(target)
  }
  async download(path: string, output: Writable, signal: AbortSignal, progress: (bytes: number) => void, limit = Infinity): Promise<void> {
    const before = await this.stat(path)
    if (!before.isFile()) throw new Error('只能传输普通文件，不跟随符号链接。')
    let size = 0
    await pipeline(this.channel.createReadStream(remotePath(path)), new Transform({ transform(chunk: Buffer, _encoding, done) {
      size += chunk.length
      if (size > limit || size > before.size) done(new Error('远端文件在传输期间增大，已停止下载。'))
      else { progress(chunk.length); done(null, chunk) }
    } }), output, { signal })
    const after = await this.stat(path)
    if (size !== before.size || before.size !== after.size || before.mtime !== after.mtime) throw new Error('远端文件在传输期间发生变化，请重新下载。')
  }
  async upload(path: string, input: Readable, mode: number, signal: AbortSignal, progress: (bytes: number) => void): Promise<void> {
    await pipeline(input, new Transform({ transform(chunk: Buffer, _encoding, done) {
      progress(chunk.length); done(null, chunk)
    } }), this.channel.createWriteStream(mutablePath(path), { flags: 'wx', mode: mode & 0o777 }), { signal })
  }
}
