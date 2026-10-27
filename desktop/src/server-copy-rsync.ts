import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import type { Client } from 'ssh2'
import { rsyncTransport } from './rsync-transport.ts'
import { mutablePath } from './sftp-files.ts'
import { copyChanges, openCopyFile, validateCopyFile, type CopyPlan, type CopyProgress, type CopyTree } from './server-copy.ts'
import type { ServerCopyRequest, ServerCopyResult } from './server-copy-contract.ts'

function rsyncFilename(value: string): string {
  // rsync escapes nonprintable/locale-dependent filename bytes as \#ooo.
  return Buffer.concat(value.split(/(\\#[0-7]{3})/u).map(part => /^\\#[0-7]{3}$/u.test(part)
    ? Buffer.from([Number.parseInt(part.slice(2), 8)]) : Buffer.from(part))).toString('utf8').replace(/^\.\//u, '')
}

/** Capability checks never install a dependency or fall back after a transfer has started. */
export async function supportsRsync(client: Client, signal: AbortSignal): Promise<boolean> {
  signal.throwIfAborted()
  const local = await new Promise<boolean>(resolve => {
    const child = spawn('rsync', ['--version'], { stdio: 'ignore', windowsHide: true })
    const abort = () => child.kill()
    signal.addEventListener('abort', abort, { once: true })
    const timeout = setTimeout(abort, 5000)
    child.once('error', () => resolve(false))
    child.once('close', code => { clearTimeout(timeout); signal.removeEventListener('abort', abort); resolve(code === 0) })
  })
  signal.throwIfAborted()
  if (!local) return false
  return new Promise<boolean>((resolve, reject) => {
    let finished = false
    let channel: import('ssh2').ClientChannel | undefined
    const finish = (value: boolean) => {
      if (finished) return
      finished = true; clearTimeout(timeout); signal.removeEventListener('abort', abort); channel?.close()
      if (signal.aborted) reject(new Error('拷贝已取消。')); else resolve(value)
    }
    const abort = () => finish(false)
    const timeout = setTimeout(() => finish(false), 5000)
    signal.addEventListener('abort', abort, { once: true })
    client.exec('rsync --version', (error, value) => {
      if (error || finished) { value?.close(); finish(false); return }
      channel = value; channel.on('error', () => finish(false))
      channel.resume(); channel.stderr.resume(); channel.once('close', (code: number) => finish(code === 0))
    })
  })
}

export async function copyRsync(client: Client, tree: CopyTree, request: ServerCopyRequest, plan: CopyPlan, signal: AbortSignal,
  onProgress?: (progress: CopyProgress) => void): Promise<ServerCopyResult> {
  signal.throwIfAborted()
  const started = Date.now()
  const { targets } = plan
  const work = targets.filter(target => !target.skip)
  const selected = new Map(work.map(target => [target.file.relative, target.file.bytes]))
  const processed = new Set<string>()
  const bytes = work.reduce((sum, target) => sum + target.file.bytes, 0)
  const result: ServerCopyResult = { source: request.source, destination: mutablePath(request.destination), method: 'rsync', dryRun: request.dryRun,
    files: targets.length, copied: 0, skipped: targets.length - work.length, bytes: 0, durationMs: 0,
    ...copyChanges(plan) }
  if (!work.length || request.dryRun) { result.durationMs = Date.now() - started; return result }
  const temporary = await mkdtemp(join(tmpdir(), 'ling-rsync-'))
  let transport: Awaited<ReturnType<typeof rsyncTransport>> | undefined
  try {
    for (const target of work) { const file = await openCopyFile(target.file); await file.close() }
    transport = await rsyncTransport(client, result.destination, temporary, signal)
    // --files-from is fed over stdin. Relative sources avoid Windows drive letters
    // being mistaken for SSH hosts, and excluded directories are never recursed.
    const args = ['-dtp', '--no-implied-dirs', '--ignore-times', '--out-format=%i %n', '-e', transport.shell]
    if (request.overwrite !== 'replace') args.push('--ignore-existing')
    if (request.checksum) args.push('--checksum')
    if (process.platform === 'win32') args.push('--chmod=Du=rwx,Dgo=rx,Fu=rw,Fgo=r')
    if (tree.directory) args.push('--files-from=-', '--from0')
    args.push('--', tree.directory ? './' : `./${basename(tree.path)}`, `ling-target:${result.destination}`)
    onProgress?.({ phase: 'transfer', copied: 0, skipped: result.skipped, bytes: 0, totalBytes: bytes, files: result.files })
    await new Promise<void>((resolve, reject) => {
      const child = spawn('rsync', args, { cwd: tree.directory ? tree.path : dirname(tree.path),
        env: { ...process.env, ...transport!.environment }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
      let stderr = ''
      let pending = ''
      const decoder = new StringDecoder('utf8')
      let killTimer: ReturnType<typeof setTimeout> | undefined
      child.once('error', reject)
      child.stderr.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-64 * 1024) })
      child.stdout.on('data', (chunk: Buffer) => {
        pending = (pending + decoder.write(chunk)).slice(-64 * 1024)
        const lines = pending.split('\n'); pending = lines.pop()!
        for (const line of lines) {
          const entry = line.match(/^[<>.c]f\S* (.*)$/u)
          if (!entry) continue
          const path = rsyncFilename(entry[1]!)
          if (selected.has(path)) {
            processed.add(path); result.copied = processed.size
            onProgress?.({ phase: 'transfer', path, copied: result.copied, skipped: result.skipped,
              bytes: 0, totalBytes: bytes, files: result.files })
          }
        }
      })
      child.stdin.on('error', () => {})
      child.stdin.end(tree.directory ? Buffer.from(work.map(target => target.file.relative).join('\0') + '\0') : undefined)
      const stop = () => { child.kill(); killTimer = setTimeout(() => child.kill('SIGKILL'), 2000); killTimer.unref() }
      signal.addEventListener('abort', stop, { once: true })
      if (signal.aborted) stop()
      child.once('close', code => {
        if (killTimer) clearTimeout(killTimer)
        signal.removeEventListener('abort', stop)
        if (signal.aborted) reject(new Error(`rsync 拷贝已取消；已处理 ${result.copied} 个文件，再次调用可重试。`))
        else if (code !== 0) reject(new Error(`rsync 拷贝失败（${code ?? '未启动'}）；已处理 ${result.copied} 个文件，再次调用可重试。${stderr ? ` ${stderr.trim()}` : ''}`))
        else resolve()
      })
    })
    for (const target of work) {
      const file = await openCopyFile(target.file)
      try { await validateCopyFile(file, target.file) } finally { await file.close() }
    }
    if (request.overwrite === 'error' && processed.size < work.length) throw new Error(`目标文件在拷贝期间出现，未覆盖；已处理 ${processed.size} 个文件。`)
    result.copied = request.overwrite === 'replace' ? work.length : processed.size
    result.skipped += work.length - result.copied
    result.bytes = request.overwrite === 'replace' ? bytes : [...processed].reduce((sum, path) => sum + selected.get(path)!, 0)
    result.durationMs = Date.now() - started
    onProgress?.({ phase: 'complete', copied: result.copied, skipped: result.skipped, bytes: result.bytes, totalBytes: bytes, files: result.files })
    return result
  } finally { await transport?.close(); await rm(temporary, { recursive: true, force: true }) }
}
