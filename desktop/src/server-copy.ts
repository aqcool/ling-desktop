import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, open, opendir, realpath, type FileHandle } from 'node:fs/promises'
import { isAbsolute, posix, relative, resolve, sep } from 'node:path'
import ignore from 'ignore'
import type { Stats } from 'ssh2'
import { SftpFiles, mutablePath } from './sftp-files.ts'
import { serverCopyRequestSchema, type ServerCopyRequest, type ServerCopyResult } from './server-copy-contract.ts'

export interface CopyFile {
  path: string; relative: string; bytes: number; mtimeMs: number; mode: number; dev: number; ino: number; allowedRoot?: string
}
export interface CopyTree { path: string; directory: boolean; directories: string[]; files: CopyFile[] }
export interface CopyTarget { file: CopyFile; destination: string; before?: Stats; skip: boolean }
export interface CopyPlan { targets: CopyTarget[]; directories: string[] }
export interface CopyProgress {
  phase: 'scan' | 'preflight' | 'transfer' | 'verify' | 'complete'
  path?: string; copied: number; skipped: number; bytes: number; totalBytes: number; files: number
  /** Local and remote checksum bytes combined; separate from bytes transferred. */
  verifiedBytes?: number; totalVerifyBytes?: number
}

function inside(root: string, path: string): boolean {
  const rel = relative(root, path)
  return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
}

/** Only metadata is scanned up front. Credentials and payload never enter tool arguments/results. */
export async function scanCopySource(request: ServerCopyRequest, signal: AbortSignal): Promise<CopyTree> {
  const root = await realpath(request.root)
  const candidate = resolve(root, request.source)
  const source = await realpath(candidate)
  if (!request.allowOutsideWorkspace && (!inside(root, candidate) || !inside(root, source))) throw new Error('来源超出本地工作区；需要完整访问权限。')
  const attributes = await lstat(candidate)
  if (attributes.isSymbolicLink() || !attributes.isFile() && !attributes.isDirectory()) throw new Error('只能拷贝普通文件或目录，不跟随符号链接。')
  const filter = ignore().add(request.exclude)
  const tree: CopyTree = { path: source, directory: attributes.isDirectory(), directories: [], files: [] }
  let count = 0
  const visit = async (path: string, rel: string): Promise<void> => {
    signal.throwIfAborted()
    if (++count > 100_000) throw new Error('拷贝超过 100000 项，请缩小来源或增加排除项。')
    const stat = await lstat(path)
    if (rel && filter.ignores(stat.isDirectory() ? `${rel}/` : rel)) return
    if (stat.isDirectory()) {
      if (rel) tree.directories.push(rel)
      const directory = await opendir(path)
      for await (const entry of directory) {
        if (/[\0\r\n]/u.test(entry.name)) throw new Error('文件名不能包含换行或空字符。')
        await visit(resolve(path, entry.name), rel ? `${rel}/${entry.name}` : entry.name)
      }
    } else if (stat.isFile()) {
      tree.files.push({ path, relative: rel, bytes: stat.size, mtimeMs: stat.mtimeMs,
        mode: process.platform === 'win32' ? 0o644 : stat.mode & 0o777, dev: stat.dev, ino: stat.ino,
        ...(!request.allowOutsideWorkspace ? { allowedRoot: root } : {}) })
    } else throw new Error(`不支持的来源条目（符号链接或特殊文件）：${rel || path}`)
  }
  await visit(source, tree.directory ? '' : posix.basename(source.split(sep).join('/')))
  return tree
}

async function fileHash(file: CopyFile, signal: AbortSignal, onProgress?: (bytes: number) => void): Promise<string> {
  const handle = await openCopyFile(file)
  try {
    const hash = createHash('sha256')
    let bytes = 0
    onProgress?.(0)
    for await (const chunk of handle.createReadStream({ autoClose: false })) {
      signal.throwIfAborted(); hash.update(chunk); bytes += chunk.length; onProgress?.(bytes)
    }
    await validateCopyFile(handle, file)
    return hash.digest('hex')
  } finally { await handle.close() }
}
export async function openCopyFile(file: CopyFile): Promise<FileHandle> {
  const handle = await open(file.path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try { await validateCopyFile(handle, file); return handle }
  catch (error) { await handle.close(); throw error }
}
export async function validateCopyFile(handle: FileHandle, file: CopyFile): Promise<void> {
  if (file.allowedRoot && !inside(file.allowedRoot, await realpath(file.path))) throw new Error(`来源超出本地工作区：${file.relative}`)
  const values = await Promise.all([handle.stat(), lstat(file.path)])
  if (values.some(stat => !stat.isFile() || stat.size !== file.bytes || stat.mtimeMs !== file.mtimeMs || stat.dev !== file.dev || stat.ino !== file.ino)) {
    throw new Error(`本地文件在拷贝期间变化：${file.relative}`)
  }
}
function sameRemote(a?: Stats, b?: Stats): boolean {
  return a === undefined ? b === undefined : b !== undefined && a.mode === b.mode && a.size === b.size && a.mtime === b.mtime
}
async function inParallel<T>(items: readonly T[], limit: number, run: (item: T, index: number) => Promise<void>): Promise<void> {
  let next = 0
  let failure: unknown
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (!failure && next < items.length) {
      const index = next++
      try { await run(items[index]!, index) } catch (error) { failure ??= error }
    }
  }))
  if (failure) throw failure
}

/** Every existing parent is checked with lstat, so a remote link cannot redirect an upload. */
export async function prepareCopy(files: SftpFiles, tree: CopyTree, request: ServerCopyRequest, signal: AbortSignal,
  onProgress?: (progress: CopyProgress) => void): Promise<CopyPlan> {
  const destination = mutablePath(request.destination)
  if (!tree.directory && !tree.files.length) return { targets: [], directories: [] }
  const directories = new Map<string, Promise<void>>()
  const created: string[] = []
  const directory = (path: string): Promise<void> => {
    if (path === '/') return Promise.resolve()
    let pending = directories.get(path)
    if (!pending) {
      pending = (async () => {
        await directory(posix.dirname(path)); signal.throwIfAborted()
        const stat = await files.exists(path)
        if (stat && !stat.isDirectory()) throw new Error(`远端路径不是普通目录：${path}`)
        if (!stat) created.push(path)
        if (!stat && !request.dryRun) {
          try { await files.mkdir(path) }
          catch (error) { if (!(await files.exists(path))?.isDirectory()) throw error }
        }
      })()
      directories.set(path, pending)
    }
    return pending
  }
  if (tree.directory) {
    await directory(destination)
    await inParallel(tree.directories, 16, rel => directory(mutablePath(posix.join(destination, rel))))
  } else await directory(posix.dirname(destination))
  const targets: CopyTarget[] = new Array(tree.files.length)
  const checks: CopyTarget[] = []
  await inParallel(tree.files, 16, async (file, index) => {
    signal.throwIfAborted()
    const target = tree.directory ? mutablePath(posix.join(destination, file.relative)) : destination
    const before = await files.exists(target)
    if (before && !before.isFile()) throw new Error(`目标不是普通文件，未覆盖：${target}`)
    if (before && request.overwrite === 'error') throw new Error(`目标文件已存在：${target}`)
    let skip = before !== undefined && request.overwrite === 'skip'
    const comparable = before && !skip && before.size === file.bytes && (before.mode & 0o777) === file.mode
    if (comparable && !request.checksum) skip = before.mtime === Math.floor(file.mtimeMs / 1000)
    const entry = { file, destination: target, before, skip }
    targets[index] = entry
    if (comparable && request.checksum) checks.push(entry)
  })
  const totalVerifyBytes = checks.reduce((sum, target) => sum + target.file.bytes * 2, 0)
  const totalBytes = tree.files.reduce((sum, file) => sum + file.bytes, 0)
  let verifiedBytes = 0
  let skipped = targets.filter(target => target.skip).length
  const progress = (path: string) => onProgress?.({ phase: 'preflight', path, copied: 0,
    skipped, bytes: 0, totalBytes, files: targets.length, verifiedBytes, totalVerifyBytes })
  await inParallel(checks, 16, async target => {
    const track = () => {
      let previous = 0
      return (bytes: number) => { verifiedBytes += bytes - previous; previous = bytes; progress(target.file.relative) }
    }
    progress(target.file.relative)
    target.skip = await fileHash(target.file, signal, track()) === await files.hash(target.destination, signal, track())
    if (target.skip) skipped++
    progress(target.file.relative)
  })
  return { targets, directories: created }
}

export function copyChanges(plan: CopyPlan): { changes: string[]; truncated: boolean } {
  const changes = [...plan.targets.filter(target => !target.skip).map(target => `${target.before ? '更新' : '新增'} ${target.destination}`),
    ...plan.directories.map(path => `新增目录 ${path}`)]
  return { changes: changes.slice(0, 100), truncated: changes.length > 100 }
}
export async function copySftp(files: SftpFiles, cleanupFiles: SftpFiles, request: ServerCopyRequest, plan: CopyPlan, signal: AbortSignal,
  onProgress?: (progress: CopyProgress) => void): Promise<ServerCopyResult> {
  const started = Date.now()
  const { targets } = plan
  const work = targets.filter(target => !target.skip)
  const result: ServerCopyResult = { source: request.source, destination: mutablePath(request.destination), method: 'sftp', dryRun: request.dryRun,
    files: targets.length, copied: 0, skipped: targets.length - work.length, bytes: 0, durationMs: 0,
    ...copyChanges(plan) }
  const totalBytes = work.reduce((sum, target) => sum + target.file.bytes, 0)
  let sent = 0
  let verifiedBytes = 0
  const totalVerifyBytes = request.checksum ? totalBytes * 2 : undefined
  const progress = (phase: CopyProgress['phase'], path?: string) => onProgress?.({ phase, path, copied: result.copied,
    skipped: result.skipped, bytes: sent, totalBytes, files: targets.length,
    ...(totalVerifyBytes === undefined ? {} : { verifiedBytes, totalVerifyBytes }) })
  if (request.dryRun) { result.durationMs = Date.now() - started; progress('complete'); return result }
  const stopped = new AbortController()
  const transferSignal = AbortSignal.any([signal, stopped.signal])
  let next = 0
  let failure: unknown
  const worker = async () => {
    while (next < work.length && !transferSignal.aborted) {
      const target = work[next++]!
      const temporary = posix.join(posix.dirname(target.destination), `.ling-copy-${randomUUID()}`)
      let handle: FileHandle | undefined
      let published = false
      try {
        transferSignal.throwIfAborted()
        handle = await openCopyFile(target.file)
        progress('transfer', target.file.relative)
        await files.putFile(temporary, handle, target.file.bytes, target.file.mode, transferSignal,
          bytes => { sent += bytes; progress('transfer', target.file.relative) })
        await validateCopyFile(handle, target.file)
        if (request.checksum) {
          const verifyProgress = () => progress(sent < totalBytes ? 'transfer' : 'verify', target.file.relative)
          const track = () => {
            let previous = 0
            return (bytes: number) => { verifiedBytes += bytes - previous; previous = bytes; verifyProgress() }
          }
          verifyProgress()
          if (await fileHash(target.file, transferSignal, track()) !== await files.hash(temporary, transferSignal, track())) throw new Error('传输内容校验失败。')
        }
        await files.setAttributes(temporary, target.file.mode, Math.floor(target.file.mtimeMs / 1000))
        if (!sameRemote(target.before, await files.exists(target.destination))) throw new Error('目标文件在拷贝期间变化，未覆盖。')
        transferSignal.throwIfAborted()
        if (target.before) await files.replace(temporary, target.destination)
        else await files.rename(temporary, target.destination)
        published = true
        result.copied++; result.bytes += target.file.bytes
      } catch (error) {
        if (!failure) failure = new Error(`${target.file.relative}：${error instanceof Error ? error.message : String(error)}`)
        stopped.abort()
        files.channel.end()
      } finally {
        await handle?.close().catch(() => {})
        if (!published) await cleanupFiles.unlink(temporary).catch(() => {})
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(request.concurrency, work.length) }, worker))
  if (failure || signal.aborted) throw new Error(`拷贝${signal.aborted ? '已取消' : '失败'}；已完成 ${result.copied} 个，跳过 ${result.skipped} 个。再次调用可跳过已完成文件。${failure instanceof Error ? ` ${failure.message}` : ''}`)
  result.durationMs = Date.now() - started
  progress('complete')
  return result
}

export function parseCopyRequest(value: unknown): ServerCopyRequest { return serverCopyRequestSchema.parse(value) }
