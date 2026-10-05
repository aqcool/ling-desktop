import { randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { lstat, mkdir, mkdtemp, readdir, rename, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, posix } from 'node:path'
import type { LingRemoteFileJob, LingRemoteFileRequest, LingRemoteFileResult } from 'ling-desktop/runtime'
import { ARCHIVE_LIMIT, extractArchive, localFileName } from './sftp-archive.ts'
import { mutablePath, remotePath, SftpFiles } from './sftp-files.ts'
import { sftpRequestSchema } from './sftp-contract.ts'

export interface TransferPicker {
  upload(directory: boolean): Promise<readonly string[]>
  download(name: string, directory: boolean): Promise<string | undefined>
}
type Job = { -readonly [P in keyof LingRemoteFileJob]: LingRemoteFileJob[P] } & { serverId: string; abort: AbortController; done?: Promise<void> }
type LocalEntry = { path: string; relative: string; directory: boolean; size: number; mode: number; mtime: number }
async function localTree(root: string, signal: AbortSignal, relative = '', output: LocalEntry[] = []): Promise<LocalEntry[]> {
  signal.throwIfAborted()
  const path = relative ? join(root, ...relative.split('/')) : root
  const attributes = await lstat(path)
  if (!attributes.isDirectory() && !attributes.isFile()) throw new Error('不传输符号链接或特殊文件。')
  if (output.length >= 10000) throw new Error('目录超过 10000 项，请分批传输。')
  output.push({ path, relative, directory: attributes.isDirectory(), size: attributes.isFile() ? attributes.size : 0,
    mode: attributes.mode, mtime: attributes.mtimeMs })
  if (attributes.isDirectory()) for (const name of await readdir(path)) {
    if (/[\0\r\n]/u.test(name)) throw new Error('文件名含不支持的控制字符。')
    await localTree(root, signal, relative ? `${relative}/${name}` : name, output)
  }
  return output
}

/** Transfer jobs survive workbench tab switches, and remain isolated from Agent jobs and credentials. */
export class SftpManager {
  private readonly jobs = new Map<string, Job>()
  constructor(private readonly files: (serverId: string) => Promise<SftpFiles>, private readonly picker?: TransferPicker) {}
  async close(serverId?: string): Promise<void> {
    const selected = [...this.jobs.values()].filter(job => !serverId || job.serverId === serverId)
    for (const job of selected) job.abort.abort()
    await Promise.allSettled(selected.map(job => job.done))
  }
  private snapshot(job: Job): LingRemoteFileJob {
    const { serverId: _server, abort: _abort, done: _done, ...value } = job
    return value
  }
  private start(serverId: string, operation: LingRemoteFileJob['operation'], path: string,
    run: (job: Job, signal: AbortSignal) => Promise<void>): LingRemoteFileResult {
    if ([...this.jobs.values()].filter(job => job.status === 'running').length >= 4) throw new Error('最多同时运行 4 个文件任务。')
    for (const [id, job] of this.jobs) if (this.jobs.size >= 32 && job.status !== 'running') this.jobs.delete(id)
    const job: Job = { id: randomUUID(), operation, path, serverId, status: 'running', phase: '准备中', bytes: 0, abort: new AbortController() }
    this.jobs.set(job.id, job)
    job.done = run(job, job.abort.signal).then(() => { job.status = 'completed'; job.phase = '完成' }, error => {
      job.status = job.abort.signal.aborted ? 'cancelled' : 'failed'
      job.phase = job.status === 'cancelled' ? '已取消' : '失败'
      job.error = job.abort.signal.aborted ? undefined : error instanceof Error ? error.message : '文件任务失败。'
    })
    return { type: 'job', job: this.snapshot(job) }
  }
  async request(serverId: string, input: LingRemoteFileRequest, signal?: AbortSignal): Promise<LingRemoteFileResult> {
    const request = sftpRequestSchema.parse(input)
    signal?.throwIfAborted()
    if (request.type === 'jobs') return { type: 'jobs', jobs: [...this.jobs.values()].filter(job => job.serverId === serverId).map(job => this.snapshot(job)) }
    if (request.type === 'cancel') {
      const job = this.jobs.get(request.jobId)
      if (!job || job.serverId !== serverId) throw new Error('文件任务已不存在。')
      job.abort.abort(); await job.done
      return { type: 'ok' }
    }
    const files = await this.files(serverId)
    signal?.throwIfAborted()
    if (request.type === 'list') return { type: 'directory', directory: await files.list(request.path, signal) }
    if (request.type === 'read') return { type: 'document', document: await files.document(request.path, signal) }
    if (request.type === 'save') return { type: 'saved', version: await files.save(request.path, request.text, request.version, signal) }
    if (request.type === 'create') { await files.create(request.path, request.directory, signal); return { type: 'ok' } }
    if (request.type === 'rename') {
      if (await files.exists(request.destination)) throw new Error('目标已存在，请使用其他名称。')
      signal?.throwIfAborted()
      await files.rename(request.path, request.destination)
      return { type: 'ok' }
    }
    if (request.type === 'delete') {
      const target = mutablePath(request.path)
      if (target === await files.realpath('.')) throw new Error('不能删除服务器登录目录。')
      return this.start(serverId, 'delete', target, async (job, abort) => {
        job.phase = '删除中'; await files.remove(target, request.recursive, abort)
      })
    }
    if (request.type === 'upload') {
      if (!this.picker) throw new Error('上传需要 LING 桌面应用。')
      const selected = await this.picker.upload(request.directory)
      signal?.throwIfAborted()
      if (!selected.length) return { type: 'ok' }
      return this.start(serverId, 'upload', request.path, async (job, abort) => {
        const sources = []
        for (const path of selected) sources.push({ path, entries: await localTree(path, abort) })
        job.total = sources.reduce((sum, source) => sum + source.entries.reduce((value, entry) => value + entry.size, 0), 0)
        for (const source of sources) await this.publish(files, source.entries, posix.join(request.path, basename(source.path)), job, abort)
      })
    }
    if (request.type === 'download') {
      if (!this.picker) throw new Error('下载需要 LING 桌面应用。')
      const path = remotePath(request.path)
      const directory = (await files.stat(path)).isDirectory()
      const selected = await this.picker.download(posix.basename(path), directory)
      signal?.throwIfAborted()
      if (!selected) return { type: 'ok' }
      return this.start(serverId, 'download', path, async (job, abort) => {
        const target = directory ? join(selected, localFileName(posix.basename(path))) : selected
        // The native save dialog supplies overwrite consent for a file; directories never merge.
        if (directory && await lstat(target).catch(() => undefined)) throw new Error('本地目标目录已存在，请选择其他位置。')
        const staging = await mkdtemp(join(dirname(target), '.ling-download-'))
        try {
          job.phase = '下载中'
          await this.fetch(files, path, join(staging, 'content'), job, abort, { count: 0 })
          abort.throwIfAborted()
          await rename(join(staging, 'content'), target)
        } finally { await rm(staging, { recursive: true, force: true }) }
      })
    }
    const destination = mutablePath(request.destination)
    if (await files.exists(destination)) throw new Error('解压目标已存在，请使用新目录。')
    const attributes = await files.stat(request.path)
    if (!attributes.isFile() || attributes.size > ARCHIVE_LIMIT) throw new Error('仅支持不超过 256 MB 的普通压缩文件。')
    return this.start(serverId, 'extract', request.path, async (job, abort) => {
      const staging = await mkdtemp(join(tmpdir(), 'ling-extract-'))
      try {
        const archive = join(staging, 'archive')
        const contents = join(staging, 'contents')
        await mkdir(contents, { mode: 0o700 })
        job.phase = '读取压缩包'; job.total = attributes.size
        await files.download(request.path, createWriteStream(archive, { flags: 'wx', mode: 0o600 }), abort, bytes => { job.bytes += bytes }, ARCHIVE_LIMIT)
        job.phase = '校验并解压'
        await extractArchive(archive, request.path, contents, abort)
        const entries = await localTree(contents, abort)
        job.bytes = 0; job.total = entries.reduce((sum, entry) => sum + entry.size, 0)
        await this.publish(files, entries, destination, job, abort)
      } finally { await rm(staging, { recursive: true, force: true }) }
    })
  }
  private async fetch(files: SftpFiles, source: string, target: string, job: Job, signal: AbortSignal, counter: { count: number }) {
    signal.throwIfAborted()
    if (++counter.count > 10000) throw new Error('目录超过 10000 项，请分批下载。')
    const attributes = await files.stat(source)
    if (attributes.isDirectory()) {
      await mkdir(target, { mode: 0o700 })
      const listing = await files.list(source, signal)
      if (listing.path !== source || !(await files.stat(source)).isDirectory()) throw new Error('目录路径已变化，已停止下载。')
      if (listing.truncated) throw new Error('目录过大，请分批下载。')
      const names = new Set<string>()
      for (const entry of listing.entries) {
        const name = localFileName(entry.name); const key = name.toLocaleLowerCase('en-US')
        if (names.has(key)) throw new Error('目录包含大小写冲突的文件名，未保存下载结果。')
        names.add(key)
        await this.fetch(files, entry.path, join(target, name), job, signal, counter)
      }
    } else {
      if (!attributes.isFile()) throw new Error('目录包含符号链接或特殊文件，未保存下载结果。')
      await files.download(source, createWriteStream(target, { flags: 'wx', mode: 0o600 }), signal, bytes => { job.bytes += bytes })
    }
  }
  private async publish(files: SftpFiles, entries: LocalEntry[], destination: string, job: Job, signal: AbortSignal) {
    const target = mutablePath(destination)
    if (await files.exists(target)) throw new Error(`目标已存在，未覆盖：${target}`)
    const stage = posix.join(posix.dirname(target), `.ling-upload-${randomUUID()}`)
    let created = false
    try {
      job.phase = '上传中'
      for (const entry of entries) {
        signal.throwIfAborted()
        const path = entry.relative ? posix.join(stage, entry.relative) : stage
        if (entry.directory) { await files.mkdir(path); if (!entry.relative) created = true }
        else {
          const current = await lstat(entry.path)
          if (!current.isFile() || current.size !== entry.size || current.mtimeMs !== entry.mtime) throw new Error('本地文件已变化，请重新上传。')
          if (!entry.relative) created = true
          await files.upload(path, createReadStream(entry.path), entry.mode, signal, bytes => { job.bytes += bytes })
          const after = await lstat(entry.path)
          if (after.size !== entry.size || after.mtimeMs !== entry.mtime) throw new Error('本地文件在传输期间发生变化。')
        }
      }
      signal.throwIfAborted()
      if (await files.exists(target)) throw new Error('传输期间目标已出现，未覆盖。')
      await files.rename(stage, target)
      created = false
    } finally { if (created) await files.remove(stage, true).catch(() => {}) }
  }
}
