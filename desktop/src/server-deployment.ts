import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, opendir, realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep, posix } from 'node:path'

export interface LocalDeploymentFile {
  readonly path: string
  readonly bytes: number
  readonly sha256: string
  readonly mode: number
}

export async function localDeploymentFile(root: string, source: string): Promise<LocalDeploymentFile> {
  if (!source || source.length > 4096 || source.includes('\0') || isAbsolute(source)
    || source.split(/[\\/]/).some(part => part === '..')) throw new Error('部署源文件必须位于当前本地工作区。')
  const rootPath = await realpath(root)
  const filePath = await realpath(resolve(rootPath, source))
  const within = relative(rootPath, filePath)
  if (!within || within === '..' || within.startsWith(`..${sep}`) || isAbsolute(within))
    throw new Error('部署源文件必须位于当前本地工作区。')
  const before = await stat(filePath)
  if (!before.isFile()) throw new Error('只能部署普通文件。')
  const hash = createHash('sha256')
  let bytes = 0
  for await (const chunk of createReadStream(filePath)) {
    bytes += chunk.length
    hash.update(chunk)
  }
  const after = await stat(filePath)
  if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || bytes !== after.size)
    throw new Error('部署文件读取期间发生变化，请重新预览。')
  return { path: filePath, bytes, sha256: hash.digest('hex'), mode: after.mode & 0o777 }
}

/** Resolve a download target without allowing a symlink to redirect the write outside the workspace. */
export async function localDownloadTarget(root: string, destination: string): Promise<{ path: string; sha256: string | null }> {
  if (!destination || destination.length > 4096 || destination.includes('\0') || isAbsolute(destination)
    || destination.split(/[\\/]/).some(part => part === '..')) throw new Error('取回目标必须位于当前本地工作区。')
  const rootPath = await realpath(root)
  const target = resolve(rootPath, destination)
  const within = relative(rootPath, target)
  if (!within || within === '..' || within.startsWith(`..${sep}`) || isAbsolute(within))
    throw new Error('取回目标必须位于当前本地工作区。')
  const parent = await realpath(resolve(target, '..'))
  const parentWithin = relative(rootPath, parent)
  if (parentWithin === '..' || parentWithin.startsWith(`..${sep}`) || isAbsolute(parentWithin))
    throw new Error('取回目标必须位于当前本地工作区。')
  try {
    const entry = await lstat(target)
    if (!entry.isFile()) throw new Error('取回目标必须是普通文件。')
    return { path: target, sha256: (await localDeploymentFile(root, destination)).sha256 }
  } catch (error) {
    if (typeof error === 'object' && error && 'code' in error && error.code === 'ENOENT') return { path: target, sha256: null }
    throw error
  }
}

export interface LocalDeploymentDirectoryFile extends LocalDeploymentFile { readonly source: string; readonly relative: string }
export interface LocalDeploymentTree { readonly files: readonly LocalDeploymentDirectoryFile[]; readonly directories: readonly string[] }

/** A deterministic directory snapshot. Symlinks are deliberately excluded from deployment. */
export async function localDeploymentTree(root: string, source: string): Promise<LocalDeploymentTree> {
  if (!source || source.length > 4096 || source.includes('\0') || isAbsolute(source)
    || source.split(/[\\/]/).some(part => part === '..')) throw new Error('部署目录必须位于当前本地工作区。')
  const rootPath = await realpath(root)
  const directory = await realpath(resolve(rootPath, source))
  const within = relative(rootPath, directory)
  if (within === '..' || within.startsWith(`..${sep}`) || isAbsolute(within)) throw new Error('部署目录必须位于当前本地工作区。')
  if (!(await stat(directory)).isDirectory()) throw new Error('部署源不是目录。')
  const files: LocalDeploymentDirectoryFile[] = []
  const directories: string[] = []
  const walk = async (path: string) => {
    const entries = []
    for await (const entry of await opendir(path)) entries.push(entry)
    entries.sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      const child = resolve(path, entry.name)
      const info = await lstat(child)
      if (info.isSymbolicLink()) throw new Error('部署目录包含符号链接，请先处理该文件。')
      if (info.isDirectory()) { directories.push(relative(directory, child).split(sep).join('/')); await walk(child); continue }
      if (!info.isFile()) throw new Error('部署目录包含非普通文件。')
      const relativePath = relative(directory, child).split(sep).join('/')
      const fileSource = relative(rootPath, child)
      const file = await localDeploymentFile(root, fileSource)
      files.push({ ...file, source: fileSource, relative: relativePath })
    }
  }
  await walk(directory)
  return { files, directories }
}

export async function localDeploymentDirectory(root: string, source: string): Promise<LocalDeploymentDirectoryFile[]> {
  return [...(await localDeploymentTree(root, source)).files]
}

export function remoteDeploymentDirectory(path: string): string {
  if (!posix.isAbsolute(path) || path === '/' || path.endsWith('/') || path.includes('\0')
    || path.length > 4096 || posix.normalize(path) !== path) throw new Error('远端部署目录必须是绝对路径。')
  return path
}

export function remoteDeploymentPath(destination: string): string {
  if (!posix.isAbsolute(destination) || destination === '/' || destination.endsWith('/')
    || destination.includes('\0') || destination.length > 4096 || posix.normalize(destination) !== destination)
    throw new Error('远端部署路径必须是绝对文件路径。')
  return destination
}

export function shellQuote(value: string): string { return `'${value.replaceAll("'", "'\\''")}'` }

export function remoteFileHashCommand(destination: string): string {
  const path = shellQuote(remoteDeploymentPath(destination))
  return `set -e; if [ -L ${path} ]; then printf '__LING_NOT_FILE__\\n'; elif [ -f ${path} ]; then printf '__LING_FILE__ '; sha256sum -- ${path} | cut -d ' ' -f 1; elif [ -e ${path} ]; then printf '__LING_NOT_FILE__\\n'; else printf '__LING_ABSENT__\\n'; fi`
}

export function parseRemoteFileHash(output: string): string | null {
  const text = output.trim()
  if (text === '__LING_ABSENT__') return null
  if (text === '__LING_NOT_FILE__') throw new Error('远端目标不是普通文件。')
  const match = /^__LING_FILE__ ([a-f0-9]{64})$/.exec(text)
  if (!match) throw new Error('无法确认远端文件状态。')
  return match[1]!
}
