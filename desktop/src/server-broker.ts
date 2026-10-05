import { DshRemoteRuntime, type RemotePolicy } from './ssh/runtime.ts'
import { BrokerSshConnection } from './ssh/connection.ts'
import { installHelper } from './ssh/install.ts'
import type { SubprocessTerminalHandle } from '@deepseek-ai/dsh-subprocess'
import type { ServerOutput } from './server-execution.ts'
import { createHash, randomUUID } from 'node:crypto'
import { writeSync } from 'node:fs'
import { mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, posix } from 'node:path'
import ssh2 from 'ssh2'
import { z } from 'zod'
import type { LingServer, LingServerDirectory, LingServerProbe } from './server-contract.ts'
import { directoryCommand } from './server-ssh.ts'
import { localDeploymentFile, localDownloadTarget, parseRemoteFileHash, remoteDeploymentDirectory, remoteDeploymentPath, remoteFileHashCommand, shellQuote } from './server-deployment.ts'
import { ServerStore } from './server-store.ts'
import { SftpFiles } from './sftp-files.ts'
import { SftpManager, type TransferPicker } from './sftp-manager.ts'
import type { LingRemoteFileRequest } from 'ling-desktop/runtime'

const { Client, utils } = ssh2

export interface HostFingerprint { readonly algorithm: string; readonly sha256: string }
export interface ServerSecurityStatus {
  readonly trusted: boolean
  readonly fingerprint?: HostFingerprint
  readonly credential: 'none' | 'password' | 'key'
}
export interface ServerCommandResult {
  readonly stdout: string
  readonly stderr: string
  readonly exitCode: number
}
export interface ServerUploadResult { readonly destination: string; readonly bytes: number; readonly sha256: string }
export interface ServerDownloadResult { readonly destination: string; readonly bytes: number; readonly sha256: string }
export interface ServerDirectoryEntry { readonly path: string; readonly type: 'file' | 'directory' | 'symlink'; readonly sha256?: string }
export interface ServerDirectoryManifest { readonly exists: boolean; readonly entries: readonly ServerDirectoryEntry[]; readonly sha256: string }
export interface ServerTerminalSnapshot { readonly terminalId: string; readonly offset: number; readonly data: string; readonly closed: boolean; readonly truncated?: boolean; readonly exitCode?: number; readonly error?: string }
type Credential = { method: 'password'; password: string } | { method: 'key'; privateKey: string; passphrase?: string }
interface VaultEntry { endpoint: string; fingerprint?: HostFingerprint; credential?: { method: Credential['method']; encrypted: string } }
const documentSchema = z.object({ version: z.literal(1), entries: z.record(z.string().uuid(), z.object({
  endpoint: z.string(), fingerprint: z.object({ algorithm: z.string(), sha256: z.string() }).optional(),
  credential: z.object({ method: z.enum(['password', 'key']), encrypted: z.string() }).optional(),
})) })
type VaultDocument = { version: 1; entries: Record<string, VaultEntry> }
export interface SecretCodec { available(): Promise<boolean>; encrypt(value: string): Promise<Buffer>; decrypt(value: Buffer): Promise<string> }

export function fingerprintFromKey(key: Buffer): HostFingerprint {
  if (key.length < 5) throw new Error('服务器返回了无效主机密钥。')
  const length = key.readUInt32BE(0)
  if (length < 1 || length > 128 || length + 4 > key.length) throw new Error('服务器返回了无效主机密钥。')
  const algorithm = key.subarray(4, 4 + length).toString('ascii')
  if (!/^[-a-zA-Z0-9@._+]+$/.test(algorithm)) throw new Error('服务器返回了无效主机密钥。')
  return { algorithm, sha256: `SHA256:${createHash('sha256').update(key).digest('base64').replace(/=+$/, '')}` }
}

function endpoint(server: LingServer): string { return `${server.alias.toLowerCase()}:${server.port ?? 22}:${server.user ?? ''}` }
function sameFingerprint(a: HostFingerprint, b: HostFingerprint): boolean { return a.algorithm === b.algorithm && a.sha256 === b.sha256 }

/** Terminal scrollback remains in process memory, never in a transcript or a plaintext file. */
class TerminalOutput {
  private readonly limit = 16 * 1024 * 1024
  private chunks: Array<{ offset: number; data: Buffer }> = []
  private start = 0
  private end = 0

  append(chunk: Buffer): void {
    const data = chunk.length > this.limit ? chunk.subarray(-this.limit) : chunk
    this.chunks.push({ offset: this.end + chunk.length - data.length, data: Buffer.from(data) })
    this.end += chunk.length
    while (this.chunks.length > 1 && this.end - this.chunks[0]!.offset > this.limit) this.chunks.shift()
    this.start = this.chunks[0]?.offset ?? this.end
  }

  read(offset: number): { offset: number; data: string; truncated: boolean } {
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > this.end) throw new Error('终端读取位置无效。')
    const truncated = offset < this.start
    const from = Math.max(offset, this.start)
    const output = Buffer.alloc(Math.min(64 * 1024, this.end - from))
    let copied = 0
    for (const chunk of this.chunks) {
      const skip = Math.max(0, from + copied - chunk.offset)
      if (skip >= chunk.data.length) continue
      if (chunk.offset > from + copied) break
      copied += chunk.data.copy(output, copied, skip, skip + output.length - copied)
      if (copied === output.length) break
    }
    return { offset: from + copied, data: output.subarray(0, copied).toString('base64'), truncated }
  }
}

export class ServerBroker {
  private pending: Promise<unknown> = Promise.resolve()
  private readonly inventory: ServerStore
  private readonly runtimes = new Map<string, { key: string; runtime: Promise<DshRemoteRuntime> }>()
  private readonly sftpSessions = new Map<string, Promise<{ client: ssh2.Client; files: SftpFiles }>>()
  private readonly fileManager: SftpManager
  private readonly terminals = new Map<string, { serverId: string; handle: SubprocessTerminalHandle;
    output: TerminalOutput; closed: boolean; exitCode?: number; error?: string }>()
  constructor(private readonly home: string, private readonly codec: SecretCodec, private readonly artifactDirectory?: string, picker?: TransferPicker) {
    this.inventory = new ServerStore(join(home, 'ling-servers.json'))
    this.fileManager = new SftpManager(async id => (await this.sftp(id)).files, picker)
  }
  private get file(): string { return join(this.home, 'ling-server-secrets.json') }

  private async server(id: string): Promise<LingServer> {
    if (!z.string().uuid().safeParse(id).success) throw new Error('服务器标识无效。')
    const server = (await this.inventory.list()).find(value => value.id === id)
    if (!server) throw new Error('服务器已不存在。')
    if (!server.user) throw new Error('请先填写服务器地址和登录用户。SSH 别名可继续使用系统 SSH。')
    return server
  }

  private async read(): Promise<VaultDocument> {
    try { return documentSchema.parse(JSON.parse(await readFile(this.file, 'utf8'))) as VaultDocument }
    catch (error) {
      if (typeof error === 'object' && error && 'code' in error && error.code === 'ENOENT') return { version: 1, entries: {} }
      throw new Error('服务器凭证库无法读取。', { cause: error })
    }
  }

  private update<T>(change: (document: VaultDocument) => Promise<T>): Promise<T> {
    const result = this.pending.then(async () => {
      const document = await this.read()
      const value = await change(document)
      await mkdir(this.home, { recursive: true, mode: 0o700 })
      const temporary = join(dirname(this.file), `.ling-server-secrets-${randomUUID()}.tmp`)
      try {
        await writeFile(temporary, `${JSON.stringify(document)}\n`, { flag: 'wx', mode: 0o600 })
        await rename(temporary, this.file)
      } finally { await rm(temporary, { force: true }) }
      return value
    })
    this.pending = result.catch(() => undefined)
    return result
  }

  async status(id: string): Promise<ServerSecurityStatus> {
    const server = await this.server(id)
    const entry = (await this.read()).entries[id]
    if (!entry || entry.endpoint !== endpoint(server)) return { trusted: false, credential: 'none' }
    return { trusted: Boolean(entry.fingerprint), fingerprint: entry.fingerprint, credential: entry.credential?.method ?? 'none' }
  }

  async inspect(id: string): Promise<HostFingerprint> {
    const server = await this.server(id)
    return await new Promise((resolve, reject) => {
      const client = new Client()
      let settled = false
      const finish = (fingerprint?: HostFingerprint, error?: Error) => {
        if (settled) return
        settled = true
        client.end()
        if (fingerprint) resolve(fingerprint)
        else reject(error ?? new Error('未能读取服务器指纹。'))
      }
      client.on('error', () => finish(undefined, new Error('无法读取主机指纹，请检查地址、端口和网络。')))
      client.on('close', () => finish(undefined, new Error('服务器在返回指纹前断开连接。')))
      try { client.connect({ host: server.alias, port: server.port ?? 22, username: server.user,
        readyTimeout: 10000, hostVerifier: (key: Buffer) => { try { finish(fingerprintFromKey(key)); return false } catch (error) { finish(undefined, error as Error); return false } },
      }) } catch { finish(undefined, new Error('无法读取主机指纹，请检查地址、端口和网络。')) }
    })
  }

  async trust(id: string, fingerprint: HostFingerprint): Promise<void> {
    const server = await this.server(id)
    const observed = await this.inspect(id)
    if (!sameFingerprint(observed, fingerprint)) throw new Error('主机指纹已变化，请重新核对。')
    await this.update(async document => {
      const previous = document.entries[id]
      document.entries[id] = { endpoint: endpoint(server), fingerprint: observed,
        ...(previous?.endpoint === endpoint(server) && previous.fingerprint && sameFingerprint(previous.fingerprint, observed)
          ? { credential: previous.credential } : {}),
      }
    })
    await this.disconnect(id)
  }

  async savePassword(id: string, password: string): Promise<void> {
    if (!password || password.length > 8192) throw new Error('请输入有效密码。')
    await this.saveCredential(id, { method: 'password', password })
  }

  async saveKey(id: string, privateKey: string, passphrase?: string): Promise<void> {
    if (!privateKey || privateKey.length > 131072 || (passphrase?.length ?? 0) > 8192) throw new Error('私钥文件无效或超过大小限制。')
    const parsed = utils.parseKey(privateKey, passphrase)
    if (parsed instanceof Error || (Array.isArray(parsed) && parsed.every(value => value instanceof Error))) throw new Error('私钥或口令无效。')
    await this.saveCredential(id, { method: 'key', privateKey, ...(passphrase ? { passphrase } : {}) })
  }

  private async saveCredential(id: string, credential: Credential): Promise<void> {
    const server = await this.server(id)
    if (!(await this.codec.available())) throw new Error('系统安全存储不可用，未保存凭证。')
    const encrypted = (await this.codec.encrypt(JSON.stringify(credential))).toString('base64')
    await this.update(async document => {
      const previous = document.entries[id]
      if (!previous?.fingerprint || previous.endpoint !== endpoint(server)) throw new Error('请先确认该服务器的主机指纹。')
      document.entries[id] = { ...previous, credential: { method: credential.method, encrypted } }
    })
    await this.disconnect(id)
  }

  async clearCredential(id: string): Promise<void> {
    await this.update(async document => { const entry = document.entries[id]; if (entry) delete entry.credential })
    await this.disconnect(id)
  }
  async forget(id: string): Promise<void> {
    await this.update(async document => { delete document.entries[id] })
    await this.disconnect(id)
  }
  private async disconnect(id: string) {
    await this.fileManager.close(id)
    const sftp = this.sftpSessions.get(id)
    this.sftpSessions.delete(id)
    await sftp?.then(value => { value.client.end() }).catch(() => {})
    const previous = this.runtimes.get(id)
    this.runtimes.delete(id)
    await previous?.runtime.then(runtime => runtime.close()).catch(() => {})
  }

  private async connect<T>(id: string, command: string, parse: (output: Buffer) => T): Promise<T> {
    const server = await this.server(id)
    const entry = (await this.read()).entries[id]
    if (!entry?.fingerprint || entry.endpoint !== endpoint(server)) throw new Error('请先确认当前服务器的主机指纹。')
    if (!entry.credential) throw new Error('请先保存服务器密码或私钥。')
    if (!(await this.codec.available())) throw new Error('系统安全存储不可用，无法读取凭证。')
    const credential = JSON.parse(await this.codec.decrypt(Buffer.from(entry.credential.encrypted, 'base64'))) as Credential
    if (credential.method !== entry.credential.method) throw new Error('服务器凭证库内容不一致。')
    return await new Promise((resolve, reject) => {
      const client = new Client()
      let settled = false
      let mismatch = false
      const timer = setTimeout(() => finish(undefined, new Error('SSH 操作超时。')), 20000)
      const finish = (value?: T, error?: Error) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        client.end()
        if (error) reject(error)
        else resolve(value as T)
      }
      client.on('error', () => finish(undefined, mismatch ? new Error('主机指纹与已确认的指纹不一致，连接已阻断。') : new Error('SSH 认证或连接失败，请检查账号和凭证。')))
      client.on('close', () => finish(undefined, new Error('SSH 连接已断开。')))
      client.on('ready', () => client.exec(command, (error, stream) => {
        if (error) return finish(undefined, new Error('无法执行远端检查。'))
        const chunks: Buffer[] = []
        let size = 0
        stream.on('data', (chunk: Buffer) => { size += chunk.length; if (size > 256 * 1024) finish(undefined, new Error('远端输出超过上限。')); else chunks.push(chunk) })
        stream.on('close', (code: number) => {
          if (code !== 0) return finish(undefined, new Error('远端检查失败。'))
          try { finish(parse(Buffer.concat(chunks))) } catch { finish(undefined, new Error('远端返回了无效结果。')) }
        })
      }))
      try { client.connect({ host: server.alias, port: server.port ?? 22, username: server.user,
        readyTimeout: 10000, hostVerifier: (key: Buffer) => {
          try { const matched = sameFingerprint(fingerprintFromKey(key), entry.fingerprint!); mismatch = !matched; return matched }
          catch { mismatch = true; return false }
        },
        authHandler: [credential.method === 'password' ? 'password' : 'publickey'],
        ...(credential.method === 'password' ? { password: credential.password } : { privateKey: credential.privateKey, passphrase: credential.passphrase }),
      }) } catch { finish(undefined, new Error('无法启动 SSH 连接。')) }
    })
  }

  probe(id: string): Promise<LingServerProbe> {
    return this.connect(id, "printf '__LING_SSH_PROBE__\\n'; pwd -P", output => {
      const text = output.toString('utf8')
      const marker = text.lastIndexOf('__LING_SSH_PROBE__\n')
      if (marker < 0) throw new Error('Invalid probe')
      const home = text.slice(marker + '__LING_SSH_PROBE__\n'.length).trim()
      if (!home.startsWith('/') || home.includes('\n')) throw new Error('Invalid home')
      return { home }
    })
  }

  directories(id: string, path: string): Promise<LingServerDirectory> {
    return this.connect(id, directoryCommand(path), output => {
      const marker = Buffer.from('__LING_DIRS_V1__\0')
      const offset = output.indexOf(marker)
      if (offset < 0) throw new Error('Invalid directory listing')
      const directories = output.subarray(offset + marker.length).toString('utf8').split('\0')
        .filter(value => posix.isAbsolute(value))
        .map(value => ({ path: posix.normalize(value), name: posix.basename(value) }))
        .sort((a, b) => a.name.localeCompare(b.name)).slice(0, 500)
      return { path, directories }
    })
  }

  /** Snapshot names, types and file hashes without truncating large directory trees. */
  async directoryManifest(id: string, directory: string, signal?: AbortSignal, shallow = false): Promise<ServerDirectoryManifest> {
    const path = remoteDeploymentDirectory(directory)
    const quoted = shellQuote(path)
    const depth = shallow ? '-maxdepth 1 ' : ''
    const hashesCommand = shallow ? '' : 'find . -type f -exec sha256sum -z -- {} +'
    const command = `set -eu; d=${quoted}; if [ -L "$d" ]; then exit 45; fi; if [ ! -e "$d" ]; then printf '__LING_ABSENT__\\0'; exit 0; fi; [ -d "$d" ] || exit 45; cd "$d"; printf '__LING_PRESENT__\\0__LING_DIRS__\\0'; find . -mindepth 1 ${depth}-type d -print0; printf '__LING_LINKS__\\0'; find . -mindepth 1 ${depth}-type l -print0; printf '__LING_FILES__\\0'; find . -mindepth 1 ${depth}-type f -print0; printf '__LING_OTHER__\\0'; find . -mindepth 1 ${depth}! -type d ! -type l ! -type f -print0; printf '__LING_HASHES__\\0'; ${hashesCommand}`
    const chunks: Buffer[] = []
    const result = await this.execute(id, '/', command, signal, undefined, chunk => { chunks.push(Buffer.from(chunk)) }, Number.MAX_SAFE_INTEGER)
    if (result.exitCode !== 0) throw new Error(result.stderr.trim() || '无法读取远端目录清单。')
    const fields = Buffer.concat(chunks).toString('utf8').split('\0')
    if (fields.at(-1) !== '') throw new Error('远端目录清单不完整。')
    fields.pop()
    if (fields.length === 1 && fields[0] === '__LING_ABSENT__') return { exists: false, entries: [], sha256: createHash('sha256').update('absent').digest('hex') }
    if (fields.shift() !== '__LING_PRESENT__') throw new Error('远端目录清单无效。')
    const entries: ServerDirectoryEntry[] = []
    let phase: 'dirs' | 'links' | 'files' | 'other' | 'hashes' | undefined
    const hashes = new Map<string, string>()
    for (const field of fields) {
      if (field === '__LING_DIRS__') { phase = 'dirs'; continue }
      if (field === '__LING_LINKS__') { phase = 'links'; continue }
      if (field === '__LING_FILES__') { phase = 'files'; continue }
      if (field === '__LING_OTHER__') { phase = 'other'; continue }
      if (field === '__LING_HASHES__') { phase = 'hashes'; continue }
      if (phase === 'hashes') {
        const match = /^([a-f0-9]{64})  \.\/(.+)$/s.exec(field)
        if (!match) throw new Error('远端目录哈希清单无效。')
        hashes.set(match[2]!, match[1]!)
      } else {
        if (phase === 'other') throw new Error('远端目录包含不支持的文件类型。')
        if (!phase || !field.startsWith('./')) throw new Error('远端目录清单无效。')
        const relativePath = field.slice(2)
        if (!relativePath || relativePath.startsWith('/') || relativePath.split('/').includes('..'))
          throw new Error('远端目录清单包含无效路径。')
        entries.push({ path: relativePath, type: phase === 'dirs' ? 'directory' : phase === 'links' ? 'symlink' : 'file' })
      }
    }
    if (phase !== 'hashes') throw new Error('远端目录哈希清单缺失。')
    const complete = entries.map(entry => {
      if (entry.type !== 'file') return entry
      const sha256 = hashes.get(entry.path)
      if (!sha256 && !shallow) throw new Error('远端文件哈希缺失。')
      return sha256 ? { ...entry, sha256 } : entry
    }).sort((a, b) => a.path.localeCompare(b.path))
    if (!shallow && hashes.size !== complete.filter(entry => entry.type === 'file').length) throw new Error('远端目录哈希清单不一致。')
    return { exists: true, entries: complete,
      sha256: createHash('sha256').update(JSON.stringify(complete)).digest('hex') }
  }

  /** Keep an interactive PTY alive independently of a Renderer tab. */
  async terminalOpen(id: string, cwd: string, cols: number, rows: number, signal?: AbortSignal): Promise<{ terminalId: string }> {
    if (!posix.isAbsolute(cwd) || cwd.includes('\0') || cwd.length > 4096) throw new Error('远端目录无效。')
    if (!Number.isInteger(cols) || cols < 2 || cols > 500 || !Number.isInteger(rows) || rows < 1 || rows > 200) throw new Error('终端尺寸无效。')
    const runtime = await this.runtime(id, signal)
    const handle = await runtime.terminal(cwd, cols, rows, signal)
    const terminalId = randomUUID()
    const terminal: { serverId: string; handle: SubprocessTerminalHandle; output: TerminalOutput; closed: boolean; exitCode?: number; error?: string } = {
      serverId: id, handle, output: new TerminalOutput(), closed: false }
    this.terminals.set(terminalId, terminal)
    handle.output.on('data', (chunk: Buffer) => terminal.output.append(chunk))
    handle.output.on('error', () => { terminal.error = '远端终端连接已中断。' })
    void handle.done.then(result => { terminal.closed = true; terminal.exitCode = result.exitCode ?? 255 }, error => {
      terminal.closed = true; terminal.error = error instanceof Error ? error.message : '远端终端已中断。'
    })
    return { terminalId }
  }

  async terminalPoll(terminalId: string, offset: number): Promise<ServerTerminalSnapshot> {
    const terminal = this.terminals.get(terminalId)
    if (!terminal) throw new Error('远端终端不存在。')
    const output = terminal.output.read(offset)
    return { terminalId, ...output, closed: terminal.closed,
      ...(terminal.exitCode === undefined ? {} : { exitCode: terminal.exitCode }),
      ...(terminal.error === undefined ? {} : { error: terminal.error }) }
  }

  async terminalWrite(terminalId: string, data: string): Promise<void> {
    const terminal = this.terminals.get(terminalId)
    if (!terminal || terminal.closed) throw new Error('远端终端已关闭。')
    if (data.length > 64 * 1024) throw new Error('终端输入过长。')
    await terminal.handle.write(data)
  }

  async terminalResize(terminalId: string, cols: number, rows: number): Promise<void> {
    const terminal = this.terminals.get(terminalId)
    if (!terminal || terminal.closed) throw new Error('远端终端已关闭。')
    if (!Number.isInteger(cols) || cols < 2 || cols > 500 || !Number.isInteger(rows) || rows < 1 || rows > 200) throw new Error('终端尺寸无效。')
    await terminal.handle.resize(cols, rows)
  }

  async terminalClose(terminalId: string): Promise<void> {
    const terminal = this.terminals.get(terminalId)
    if (!terminal) return
    await terminal.handle.terminate()
    terminal.closed = true
    this.terminals.delete(terminalId)
  }

  /** Deploy one reviewed local file through the pinned SSH connection, without exposing credentials. */
  async upload(id: string, root: string, source: string, destination: string,
    expectedSha256: string, expectedRemoteSha256: string | null, signal?: AbortSignal): Promise<ServerUploadResult> {
    const file = await localDeploymentFile(root, source)
    const target = remoteDeploymentPath(destination)
    if (!/^[a-f0-9]{64}$/.test(expectedSha256) || file.sha256 !== expectedSha256)
      throw new Error('本地文件已变化，请重新预览部署。')
    if (expectedRemoteSha256 !== null && !/^[a-f0-9]{64}$/.test(expectedRemoteSha256)) throw new Error('远端文件校验值无效。')
    const quotedTarget = shellQuote(target)
    const remoteCheck = expectedRemoteSha256 === null
      ? '[ ! -e "$dest" ] && [ ! -L "$dest" ] || { echo "远端目标已出现，请重新预览" >&2; exit 42; }'
      : `[ ! -L "$dest" ] && [ -f "$dest" ] && actual=$(sha256sum -- "$dest" | cut -d ' ' -f 1) && [ "$actual" = ${shellQuote(expectedRemoteSha256)} ] || { echo "远端文件已变化，请重新预览" >&2; exit 42; }`
    const command = [
      'set -eu', `dest=${quotedTarget}`, 'dir=$(dirname -- "$dest")',
      '[ -d "$dir" ] || { echo "远端目标目录不存在" >&2; exit 43; }',
      'tmp=$(mktemp "$dir/.ling-upload.XXXXXXXX")',
      'trap \u0027rm -f "$tmp"\u0027 EXIT HUP INT TERM',
      'cat > "$tmp"',
      `actual=$(sha256sum -- "$tmp" | cut -d ' ' -f 1); [ "$actual" = ${shellQuote(expectedSha256)} ] || { echo "传输校验失败" >&2; exit 44; }`,
      remoteCheck,
      `chmod ${file.mode.toString(8)} "$tmp"`,
      'mv -f -- "$tmp" "$dest"',
      'trap - EXIT HUP INT TERM',
      'printf "__LING_DEPLOYED__\\n"',
    ].join('; ')
    const result = await this.execute(id, '/', command, signal, file.path)
    if (result.exitCode !== 0 || !result.stdout.includes('__LING_DEPLOYED__'))
      throw new Error(result.stderr.trim() || '远端部署失败，目标文件未确认更新。')
    return { destination: target, bytes: file.bytes, sha256: file.sha256 }
  }

  /** Fetch one reviewed remote file into the local workspace, with version checks on both sides. */
  async download(id: string, root: string, source: string, destination: string,
    expectedSha256: string, expectedLocalSha256: string | null, signal?: AbortSignal): Promise<ServerDownloadResult> {
    const remote = remoteDeploymentPath(source)
    if (!/^[a-f0-9]{64}$/.test(expectedSha256) ||
      (expectedLocalSha256 !== null && !/^[a-f0-9]{64}$/.test(expectedLocalSha256))) throw new Error('文件校验值无效。')
    const local = await localDownloadTarget(root, destination)
    if (local.sha256 !== expectedLocalSha256) throw new Error('本地目标已变化，请重新预览取回。')
    const checkRemote = async () => {
      const result = await this.run(id, '/', remoteFileHashCommand(remote), signal)
      if (result.exitCode !== 0) throw new Error(result.stderr.trim() || '无法读取远端文件状态。')
      if (parseRemoteFileHash(result.stdout) !== expectedSha256) throw new Error('远端文件已变化，请重新预览取回。')
    }
    await checkRemote()
    const temporary = join(dirname(local.path), `.ling-download-${randomUUID()}.tmp`)
    const handle = await open(temporary, 'wx', 0o600)
    const hash = createHash('sha256')
    let bytes = 0
    try {
      const result = await this.execute(id, '/', `cat -- ${shellQuote(remote)}`, signal, undefined, chunk => {
        bytes += chunk.length
        hash.update(chunk)
        let offset = 0
        while (offset < chunk.length) offset += writeSync(handle.fd, chunk, offset, chunk.length - offset)
      }, Number.MAX_SAFE_INTEGER)
      if (result.exitCode !== 0) throw new Error(result.stderr.trim() || '远端文件取回失败。')
      const sha256 = hash.digest('hex')
      if (sha256 !== expectedSha256) throw new Error('远端文件传输期间发生变化，请重新预览。')
      await handle.sync()
      await checkRemote()
      if ((await localDownloadTarget(root, destination)).sha256 !== expectedLocalSha256)
        throw new Error('本地目标已变化，请重新预览取回。')
      await handle.close()
      await rename(temporary, local.path)
      return { destination, bytes, sha256 }
    } finally {
      await handle.close().catch(() => undefined)
      await rm(temporary, { force: true })
    }
  }

  /** Execute one explicitly approved remote command. The secret never leaves this process. */
  async run(id: string, cwd: string, command: string, signal?: AbortSignal, outputLimit = 256 * 1024, onOutput?: (chunk: ServerOutput) => void, policy?: RemotePolicy): Promise<ServerCommandResult> {
    if (!Number.isSafeInteger(outputLimit) || outputLimit < 1 || outputLimit > 16 * 1024 * 1024) throw new Error('远端输出预算无效。')
    return this.execute(id, cwd, command, signal, undefined, undefined, outputLimit, onOutput, policy)
  }

  async readFile(id: string, path: string, signal?: AbortSignal, root?: string, maxBytes?: number) {
    return (await this.runtime(id, signal)).readFile(path, signal, root, maxBytes)
  }
  async writeFile(id: string, path: string, text: string, expected: string | null, policy: RemotePolicy, signal?: AbortSignal) {
    return (await this.runtime(id, signal)).writeFile(path, text, expected, policy, signal)
  }
  async listFiles(id: string, path: string, signal?: AbortSignal, root?: string) {
    return (await this.runtime(id, signal)).listFiles(path, signal, root)
  }
  async close(): Promise<void> {
    await this.fileManager.close()
    const sftp = [...this.sftpSessions.values()]
    this.sftpSessions.clear()
    await Promise.allSettled(sftp.map(async record => { (await record).client.end() }))
    const records = [...this.runtimes.values()]
    this.runtimes.clear()
    await Promise.allSettled(records.map(async record => (await record.runtime).close()))
  }
  manageFiles(id: string, request: LingRemoteFileRequest, signal?: AbortSignal) {
    return this.fileManager.request(id, request, signal)
  }
  /** A separate pooled SSH channel keeps file transfers independent of helper/terminal lifecycle. */
  private async sftp(id: string): Promise<{ client: ssh2.Client; files: SftpFiles }> {
    // Revalidate inventory/vault identity even when reusing a live connection.
    const server = await this.server(id)
    const entry = (await this.read()).entries[id]
    if (!entry?.fingerprint || entry.endpoint !== endpoint(server)) throw new Error('请先确认当前服务器的主机指纹。')
    if (!entry.credential) throw new Error('请先保存服务器密码或私钥。')
    const storedCredential = entry.credential
    const existing = this.sftpSessions.get(id)
    if (existing) return existing
    const opening = (async () => {
      if (!(await this.codec.available())) throw new Error('系统安全存储不可用，无法读取凭证。')
      const credential = JSON.parse(await this.codec.decrypt(Buffer.from(storedCredential.encrypted, 'base64'))) as Credential
      if (credential.method !== storedCredential.method) throw new Error('服务器凭证库内容不一致。')
      const client = new Client()
      try {
        await new Promise<void>((resolve, reject) => {
          let mismatch = false
          client.on('error', () => reject(new Error(mismatch ? '服务器指纹已变化，连接已阻断。' : 'SFTP 连接失败，请检查账号和凭证。')))
          client.once('ready', resolve)
          client.once('close', () => {
            if (this.sftpSessions.get(id) === opening) this.sftpSessions.delete(id)
            reject(new Error('SFTP 连接已断开，请重试。'))
          })
          client.connect({ host: server.alias, port: server.port ?? 22, username: server.user,
            readyTimeout: 10000, keepaliveInterval: 10000, keepaliveCountMax: 3,
            hostVerifier: (key: Buffer) => {
              try { mismatch = !sameFingerprint(fingerprintFromKey(key), entry.fingerprint!); return !mismatch }
              catch { mismatch = true; return false }
            }, authHandler: [credential.method === 'password' ? 'password' : 'publickey'],
            ...(credential.method === 'password' ? { password: credential.password } : { privateKey: credential.privateKey, passphrase: credential.passphrase }),
          })
        })
        const channel = await new Promise<ssh2.SFTPWrapper>((resolve, reject) => client.sftp((error, value) => error ? reject(error) : resolve(value)))
        channel.once('close', () => {
          if (this.sftpSessions.get(id) === opening) this.sftpSessions.delete(id)
          client.end()
        })
        channel.on('error', () => { client.end() })
        return { client, files: new SftpFiles(channel) }
      } catch (error) { client.end(); throw error }
    })()
    this.sftpSessions.set(id, opening)
    void opening.catch(() => { if (this.sftpSessions.get(id) === opening) this.sftpSessions.delete(id) })
    return opening
  }
  private async runtime(id: string, signal?: AbortSignal): Promise<DshRemoteRuntime> {
    const server = await this.server(id)
    const entry = (await this.read()).entries[id]
    if (!entry?.fingerprint || entry.endpoint !== endpoint(server)) throw new Error('请先确认当前服务器的主机指纹。')
    if (!entry.credential) throw new Error('请先保存服务器密码或私钥。')
    const key = JSON.stringify(entry)
    signal?.throwIfAborted()
    const existing = this.runtimes.get(id)
    if (existing?.key === key) return existing.runtime
    if (existing) await existing.runtime.then(runtime => runtime.close()).catch(() => {})
    const runtime = (async () => {
      if (!(await this.codec.available())) throw new Error('系统安全存储不可用，无法读取凭证。')
      const credential = JSON.parse(await this.codec.decrypt(Buffer.from(entry.credential!.encrypted, 'base64'))) as Credential
      if (credential.method !== entry.credential!.method) throw new Error('服务器凭证库内容不一致。')
      const client = new Client()
      try {
        await new Promise<void>((resolve, reject) => {
          let mismatch = false
          client.on('error', () => reject(new Error(mismatch ? '主机指纹与已确认的指纹不一致，连接已阻断。' : 'SSH 认证或连接失败，请检查账号和凭证。')))
          client.once('ready', resolve)
          client.once('close', () => {
            if (this.runtimes.get(id)?.runtime === runtime) this.runtimes.delete(id)
            reject(new Error('SSH 连接已断开。'))
          })
          client.connect({ host: server.alias, port: server.port ?? 22, username: server.user,
            readyTimeout: 10_000, keepaliveInterval: 10_000, keepaliveCountMax: 3,
            hostVerifier: (publicKey: Buffer) => {
              try { mismatch = !sameFingerprint(fingerprintFromKey(publicKey), entry.fingerprint!); return !mismatch }
              catch { mismatch = true; return false }
            }, authHandler: [credential.method === 'password' ? 'password' : 'publickey'],
            ...(credential.method === 'password' ? { password: credential.password } : { privateKey: credential.privateKey, passphrase: credential.passphrase }) })
        })
        const helper = await installHelper(client, join(this.home, 'ssh-runtime-cache'), signal, this.artifactDirectory)
        const connection = new BrokerSshConnection(client, helper.node, helper.helper, helper.hash, '/')
        return await DshRemoteRuntime.create(connection)
      } catch (error) { client.end(); throw error }
    })()
    this.runtimes.set(id, { key, runtime })
    void runtime.catch(() => { if (this.runtimes.get(id)?.runtime === runtime) this.runtimes.delete(id) })
    return runtime
  }
  private async execute(id: string, cwd: string, command: string, signal?: AbortSignal, inputPath?: string,
    onStdout?: (chunk: Buffer) => void, maxOutputBytes = 256 * 1024, onOutput?: (chunk: ServerOutput) => void,
    policy: RemotePolicy = { mode: 'danger-full-access', workspaceRoot: cwd }): Promise<ServerCommandResult> {
    if (!posix.isAbsolute(cwd) || cwd.includes('\0') || cwd.length > 4096) throw new Error('远端目录无效。')
    if (!command.trim() || command.length > 16384 || command.includes('\0')) throw new Error('远端命令无效。')
    return (await this.runtime(id, signal)).execute(cwd, command, policy, signal,
      { inputPath, onStdout, limit: maxOutputBytes, onOutput })
  }
}
