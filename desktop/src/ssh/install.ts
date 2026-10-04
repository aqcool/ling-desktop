import type { Client } from 'ssh2'
import { createReadStream } from 'node:fs'
import { readFile, mkdir, writeFile, rename, rm } from 'node:fs/promises'
import { dirname, join, posix } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash, randomUUID } from 'node:crypto'
import { pipeline } from 'node:stream/promises'

const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`
const nodeVersion = '22.19.0'
export interface HelperInstallation { node: string; helper: string; hash: string }

export async function sshExec(client: Client, command: string, signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted()
  return new Promise((resolve, reject) => {
    client.exec(command, (error, stream) => {
      if (error) return reject(error)
      let output = ''
      let failure = ''
      const abort = () => { stream.close(); reject(new Error('远端运行时准备已取消。')) }
      signal?.addEventListener('abort', abort, { once: true })
      stream.on('data', (data: Buffer) => { output += data.toString(); if (output.length > 1024 * 1024) abort() })
      stream.stderr.on('data', data => { failure = (failure + data.toString()).slice(-4096) })
      stream.once('error', reject)
      stream.once('close', (code: number) => {
        signal?.removeEventListener('abort', abort)
        if (code === 0) resolve(output.trim()); else reject(new Error(failure || '远端运行时准备失败。'))
      })
      if (signal?.aborted) abort()
      stream.end()
    })
  })
}

async function sendFile(client: Client, source: string, destination: string, signal?: AbortSignal) {
  signal?.throwIfAborted()
  const stream = await new Promise<import('ssh2').ClientChannel>((resolve, reject) => client.exec(
    `umask 077; cat > ${quote(destination)}`, (error, value) => error ? reject(error) : resolve(value)))
  const closed = new Promise<void>((resolve, reject) => {
    stream.once('close', (code: number) => code === 0 ? resolve() : reject(new Error('上传远端运行时失败。')))
    stream.once('error', reject)
  })
  void closed.catch(() => {})
  stream.resume(); stream.stderr.resume()
  await pipeline(createReadStream(source), stream, { signal })
  await closed
}

/** Installs only in the account's private app runtime directory; never edits ~/.ssh/config. */
export async function installHelper(client: Client, cache: string, signal?: AbortSignal,
  artifactDirectory = dirname(fileURLToPath(import.meta.url))): Promise<HelperInstallation> {
  const manifest = JSON.parse(await readFile(join(artifactDirectory, 'ssh-runtime.json'), 'utf8')) as {
    helper: string; hash: string; archiveHash: string }
  if (!/^[a-f0-9]{64}$/.test(manifest.hash) || !/^[a-f0-9]{64}$/.test(manifest.archiveHash)
    || manifest.helper !== 'node_modules/@deepseek-ai/dsh-ssh/lib/helper.js') throw new Error('本地 SSH 运行时清单无效。')
  const facts = (await sshExec(client, 'printf "%s\\n" "$HOME"; uname -s; uname -m; command -v node || true', signal)).split('\n')
  const [home, os, cpu, installedNode] = facts
  if (!home?.startsWith('/') || !['Linux', 'Darwin'].includes(os ?? '')) throw new Error('远端运行时需要 Linux 或 macOS。')
  const platform = os === 'Linux' ? 'linux' : 'darwin'
  const arch = cpu === 'x86_64' ? 'x64' : ['aarch64', 'arm64'].includes(cpu ?? '') ? 'arm64' : undefined
  if (!arch) throw new Error('远端 CPU 架构暂不受 Node.js 支持。')
  const base = posix.join(home, '.local/share/ling/ssh-runtime')
  await sshExec(client, `set -eu; p=${quote(base)}; while [ "$p" != / ]; do [ ! -L "$p" ] || exit 45; p=$(dirname "$p"); done; umask 077; mkdir -p ${quote(base)}`, signal)
  let node = installedNode
  if (node) {
    try { await sshExec(client, `${quote(node)} -e 'let [a,b]=process.versions.node.split(".").map(Number); if(!(a===22&&b>=19||a>=24)) process.exit(1)'`, signal) }
    catch { node = undefined }
  }
  if (!node) {
    node = posix.join(base, `node-v${nodeVersion}-${platform}-${arch}/bin/node`)
    try { await sshExec(client, `${quote(node)} --version`, signal) }
    catch {
      const filename = `node-v${nodeVersion}-${platform}-${arch}.tar.gz`
      const origin = `https://nodejs.org/dist/v${nodeVersion}/`
      const sums = await fetch(`${origin}SHASUMS256.txt`, { signal })
      if (!sums.ok) throw new Error('无法获取 Node.js 校验清单。')
      const digest = (await sums.text()).split('\n').find(line => line.endsWith(`  ${filename}`))?.split(' ')[0]
      if (!digest || !/^[a-f0-9]{64}$/.test(digest)) throw new Error('Node.js 校验清单缺少目标运行时。')
      await mkdir(cache, { recursive: true, mode: 0o700 })
      const local = join(cache, filename)
      let bytes = await readFile(local).catch(() => Buffer.alloc(0))
      if (createHash('sha256').update(bytes).digest('hex') !== digest) {
        const response = await fetch(`${origin}${filename}`, { signal })
        if (!response.ok) throw new Error('无法下载远端 Node.js 运行时。')
        bytes = Buffer.from(await response.arrayBuffer())
        if (createHash('sha256').update(bytes).digest('hex') !== digest) throw new Error('Node.js 运行时校验失败。')
        const temporary = `${local}.${randomUUID()}`
        try { await writeFile(temporary, bytes, { mode: 0o600 }); await rename(temporary, local) }
        finally { await rm(temporary, { force: true }) }
      }
      const upload = posix.join(base, `.node-${randomUUID()}.tar.gz`)
      try {
        await sendFile(client, local, upload, signal)
        await sshExec(client, `set -eu; tar -xzf ${quote(upload)} -C ${quote(base)}; ${quote(node)} --version`, signal)
      } finally { await sshExec(client, `rm -f ${quote(upload)}`).catch(() => {}) }
    }
  }
  const destination = posix.join(base, manifest.archiveHash)
  const helper = posix.join(destination, manifest.helper)
  const verify = `${quote(node)} -e 'const fs=require("fs"),c=require("crypto");if(c.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex")!==process.argv[2])process.exit(1)' ${quote(helper)} ${quote(manifest.hash)}`
  try { await sshExec(client, verify, signal) }
  catch {
    signal?.throwIfAborted()
    const archive = join(artifactDirectory, 'ssh-runtime.tar.gz')
    if (createHash('sha256').update(await readFile(archive)).digest('hex') !== manifest.archiveHash) throw new Error('本地 SSH 运行时包校验失败。')
    const stage = `${destination}.${randomUUID()}`
    const upload = `${stage}.tar.gz`
    const replaced = `${stage}.old`
    try {
      await sendFile(client, archive, upload, signal)
      await sshExec(client, `set -eu; ${quote(node)} -e 'const fs=require("fs"),c=require("crypto");if(c.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex")!==process.argv[2])process.exit(1)' ${quote(upload)} ${quote(manifest.archiveHash)}; mkdir -m 700 ${quote(stage)}; tar -xzf ${quote(upload)} -C ${quote(stage)}; if ! ${verify} >/dev/null 2>&1; then if [ -e ${quote(destination)} ] || [ -L ${quote(destination)} ]; then mv ${quote(destination)} ${quote(replaced)}; fi; mv ${quote(stage)} ${quote(destination)}; fi; ${verify}`, signal)
    } finally { await sshExec(client, `rm -rf ${quote(stage)} ${quote(replaced)}; rm -f ${quote(upload)}`).catch(() => {}) }
  }
  return { node, helper, hash: manifest.hash }
}
