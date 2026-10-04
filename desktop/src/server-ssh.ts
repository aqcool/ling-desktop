import { spawn } from 'node:child_process'
import { posix } from 'node:path'
import type { LingServerDirectory, LingServerInput, LingServerProbe } from './server-contract.ts'

const MAX_OUTPUT = 256 * 1024
const DIRECTORY_MARKER = Buffer.from('__LING_DIRS_V1__\0')
const SSH_OPTIONS = [
  '-v',
  '-o', 'BatchMode=yes', '-o', 'NumberOfPasswordPrompts=0',
  '-o', 'StrictHostKeyChecking=yes', '-o', 'ForwardAgent=no',
  '-o', 'ClearAllForwardings=yes', '-o', 'ConnectTimeout=10',
  '-T',
] as const

export function sshArguments(server: Pick<LingServerInput, 'alias' | 'user' | 'port'>, command: string): string[] {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(server.alias)) throw new Error('服务器地址或 SSH 别名无效。')
  if (server.user && !/^[A-Za-z0-9_][A-Za-z0-9._-]{0,63}$/.test(server.user)) throw new Error('SSH 登录用户无效。')
  if (server.port !== undefined && (!Number.isInteger(server.port) || server.port < 1 || server.port > 65535)) throw new Error('SSH 端口无效。')
  return [...SSH_OPTIONS, ...(server.user ? ['-l', server.user] : []), ...(server.port ? ['-p', String(server.port)] : []), server.alias, command]
}

export function quoteRemote(value: string): string {
  if (value.includes('\0')) throw new Error('路径包含无效字符。')
  return `'${value.replaceAll("'", "'\\''")}'`
}

/** Classify SSH diagnostics without exposing remote-provided text or local key paths. */
export function sshFailureMessage(stderr: string): string {
  if (/REMOTE HOST IDENTIFICATION HAS CHANGED|Host key verification failed|No .* host key is known|Offending .* key/i.test(stderr)) {
    return '主机指纹未被信任或已变化。请先在终端核对并信任该主机。'
  }
  if (/Permission denied|Authentication failed|Too many authentication failures|No more authentication methods/i.test(stderr)) {
    if (/Authentications that can continue: [^\n]*password/i.test(stderr) && !/Offering public key:/i.test(stderr)) {
      return '本机没有向服务器提供可用公钥。LING 目前不支持密码登录；请先为该账号配置 SSH 公钥，或在系统 SSH 中指定已有密钥。'
    }
    return 'SSH 认证未通过。LING 当前使用系统 SSH 密钥，不会弹出密码输入；请检查登录用户和密钥配置。'
  }
  if (/Could not resolve hostname|Name or service not known|nodename nor servname provided/i.test(stderr)) return '找不到服务器地址，请检查地址或 SSH 别名。'
  if (/Connection refused/i.test(stderr)) return '服务器拒绝连接，请检查 SSH 端口和服务状态。'
  if (/Connection timed out|Operation timed out|No route to host|Network is unreachable/i.test(stderr)) return '无法连接服务器，请检查网络、防火墙和 SSH 端口。'
  return 'SSH 连接或远端操作失败。请检查登录用户、认证和网络。'
}

export async function runSsh(server: Pick<LingServerInput, 'alias' | 'user' | 'port'>, command: string, signal?: AbortSignal): Promise<Buffer> {
  return await new Promise((resolve, reject) => {
    const child = spawn('ssh', sshArguments(server, command), { stdio: ['ignore', 'pipe', 'pipe'], signal, env: process.env })
    const chunks: Buffer[] = []
    let size = 0
    let diagnostics = ''
    let done = false
    const fail = (message: string) => { if (!done) { done = true; clearTimeout(timeout); reject(new Error(message)) } }
    const timeout = setTimeout(() => { child.kill('SIGKILL'); fail('SSH 操作超时。') }, 20_000)
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_OUTPUT) { child.kill('SIGKILL'); fail('远端输出超过上限。') }
      else chunks.push(chunk)
    })
    child.stderr.on('data', (chunk: Buffer) => { diagnostics = (diagnostics + chunk.toString('utf8')).slice(-16_384) })
    child.once('error', () => fail(signal?.aborted ? '连接已取消。' : '无法启动系统 SSH。'))
    child.once('close', code => {
      clearTimeout(timeout)
      if (done) return
      if (signal?.aborted) return fail('连接已取消。')
      if (code !== 0) return fail(sshFailureMessage(diagnostics))
      done = true
      resolve(Buffer.concat(chunks))
    })
  })
}

export async function probeServer(server: Pick<LingServerInput, 'alias' | 'user' | 'port'>, signal?: AbortSignal): Promise<LingServerProbe> {
  const output = (await runSsh(server, "printf '__LING_SSH_PROBE__\\n'; pwd -P", signal)).toString('utf8')
  const marker = output.lastIndexOf('__LING_SSH_PROBE__\n')
  const home = marker < 0 ? '' : output.slice(marker + '__LING_SSH_PROBE__\n'.length).trim()
  if (!home.startsWith('/') || home.includes('\n')) throw new Error('远端未返回有效的工作目录。')
  return { home }
}

export function directoryCommand(path: string): string {
  if (!posix.isAbsolute(path) || path.includes('\0') || path.length > 4096) throw new Error('请选择有效的远端绝对路径。')
  const script = `dir=${quoteRemote(path)}; [ -d "$dir" ] || exit 1; printf '__LING_DIRS_V1__\\000'; for item in "$dir"/* "$dir"/.[!.]* "$dir"/..?*; do [ -d "$item" ] || continue; printf '%s\\000' "$item"; done`
  return `sh -c ${quoteRemote(script)}`
}

export async function listServerDirectories(server: Pick<LingServerInput, 'alias' | 'user' | 'port'>, path: string, signal?: AbortSignal): Promise<LingServerDirectory> {
  const output = await runSsh(server, directoryCommand(path), signal)
  const marker = output.indexOf(DIRECTORY_MARKER)
  if (marker < 0) throw new Error('远端未返回有效的目录列表。')
  const listing = output.subarray(marker + DIRECTORY_MARKER.length).toString('utf8')
  const directories = listing.split('\0').filter(item => posix.isAbsolute(item)).map(item => ({ path: posix.normalize(item), name: posix.basename(item) }))
  return { path, directories: directories.sort((a, b) => a.name.localeCompare(b.name)).slice(0, 500) }
}
