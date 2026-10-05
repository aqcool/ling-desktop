import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname, join, posix } from 'node:path'
import { Transform, type Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { Unpack } from 'tar'
import yauzl, { type Entry, type ZipFile } from 'yauzl'

export const ARCHIVE_LIMIT = 256 * 1024 * 1024
export const EXPANDED_LIMIT = 512 * 1024 * 1024
const ENTRY_LIMIT = 10000
export function localFileName(name: string): string {
  if (!name || name === '.' || name === '..' || /[<>:"/\\\0-\x1f]/u.test(name) || /[. ]$/u.test(name)
    || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(name))
    throw new Error('文件名不安全或无法在本机保存。')
  return name
}
export function archivePath(path: string): string {
  if (!path || path.startsWith('/') || /^[a-z]:/iu.test(path) || /[\\\0\r\n]/u.test(path) || path.split('/').includes('..'))
    throw new Error('压缩包包含不安全的路径。')
  const clean = posix.normalize(path).replace(/\/$/u, '')
  if (clean === '.') return ''
  for (const name of clean.split('/')) localFileName(name)
  return clean
}

/** Extract into an app-owned, empty local staging directory. Nothing is published until validation completes. */
export async function extractArchive(file: string, name: string, destination: string, signal: AbortSignal): Promise<void> {
  let count = 0
  let total = 0
  const names = new Set<string>()
  const accept = (path: string, size: number, directory: boolean) => {
    signal.throwIfAborted()
    const clean = archivePath(path)
    if (!clean) { if (!directory) throw new Error('压缩包包含无效文件名。'); return clean }
    if (++count > ENTRY_LIMIT || !Number.isSafeInteger(size) || size < 0 || (total += size) > EXPANDED_LIMIT)
      throw new Error('压缩包超过 10000 项或解压后 512 MB 的上限。')
    // Case-folded collisions also need rejection on macOS/Windows staging filesystems.
    const key = clean.toLocaleLowerCase('en-US')
    if (names.has(key)) throw new Error('压缩包包含重复或大小写冲突的路径。')
    names.add(key)
    return clean
  }
  if (/\.zip$/iu.test(name)) {
    const zip = await new Promise<ZipFile>((resolve, reject) => yauzl.open(file, { lazyEntries: true, autoClose: false,
      strictFileNames: true, validateEntrySizes: true }, (error, value) => error ? reject(error) : resolve(value!)))
    const abort = () => { zip.close() }
    let rejectAborted: (() => void) | undefined
    signal.addEventListener('abort', abort, { once: true })
    try {
      await new Promise<void>((resolve, reject) => {
        zip.once('error', reject)
        zip.once('end', resolve)
        rejectAborted = () => reject(signal.reason)
        signal.addEventListener('abort', rejectAborted, { once: true })
        zip.on('entry', (entry: Entry) => {
          void (async () => {
            const mode = entry.externalFileAttributes >>> 16
            const type = mode & 0o170000
            const directory = entry.fileName.endsWith('/')
            if (entry.isEncrypted() || (type !== 0 && type !== 0o100000 && type !== 0o040000))
              throw new Error('不支持加密文件、符号链接或特殊文件。')
            const path = accept(entry.fileName, directory ? 0 : entry.uncompressedSize, directory)
            if (path) {
              const target = join(destination, ...path.split('/'))
              await mkdir(directory ? target : dirname(target), { recursive: true, mode: 0o700 })
              if (!directory) {
                const input = await new Promise<import('node:stream').Readable>((yes, no) => zip.openReadStream(entry, (error, stream) => error ? no(error) : yes(stream!)))
                let written = 0
                await pipeline(input, new Transform({ transform(chunk: Buffer, _encoding, done) {
                  written += chunk.length
                  if (written > entry.uncompressedSize) done(new Error('解压大小与清单不一致。'))
                  else done(null, chunk)
                } }), createWriteStream(target, { flags: 'wx', mode: 0o600 }), { signal })
                if (written !== entry.uncompressedSize) throw new Error('解压文件不完整。')
              }
            }
            zip.readEntry()
          })().catch(reject)
        })
        zip.readEntry()
      })
    } finally { signal.removeEventListener('abort', abort); if (rejectAborted) signal.removeEventListener('abort', rejectAborted); zip.close() }
  } else if (/\.(tar|tar\.gz|tgz)$/iu.test(name)) {
    let validationError: unknown
    const unpack = new Unpack({ cwd: destination, strict: true, preservePaths: false, preserveOwner: false,
      chmod: false, noMtime: true, maxMetaEntrySize: 1024 * 1024,
      filter: (_path, entry) => {
        if (validationError) return false
        try {
          if (!('type' in entry) || (entry.type !== 'File' && entry.type !== 'Directory')) throw new Error('不支持压缩包中的链接或特殊文件。')
          return Boolean(accept(entry.path, entry.size, entry.type === 'Directory'))
        } catch (error) { validationError = error; return false }
      } })
    await pipeline(createReadStream(file), unpack as unknown as Writable, { signal })
    if (validationError) throw validationError
  } else throw new Error('目前支持 ZIP、TAR、TAR.GZ 和 TGZ。')
  signal.throwIfAborted()
}
