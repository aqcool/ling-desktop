import { randomUUID } from 'node:crypto'
import { posix } from 'node:path'
import type { ServerDirectoryManifest, ServerCommandResult, ServerUploadResult } from '../server-broker.ts'
import { localDeploymentTree, remoteDeploymentDirectory, remoteDeploymentPath, shellQuote } from '../server-deployment.ts'

export interface DirectoryDeploymentPlan {
  readonly serverId: string
  readonly root: string
  readonly source: string
  readonly destination: string
  readonly directories: readonly string[]
  readonly remoteSha256: string
  readonly files: readonly { source: string; relative: string; sha256: string; mode: number }[]
}

export interface DirectoryDeploymentConnection {
  run(serverId: string, cwd: string, command: string, signal: AbortSignal): Promise<ServerCommandResult>
  upload(serverId: string, root: string, source: string, destination: string,
    sha256: string, remoteSha256: string | null, signal: AbortSignal): Promise<ServerUploadResult>
  manifest(serverId: string, directory: string, signal: AbortSignal): Promise<ServerDirectoryManifest>
}

/** Replace a reviewed tree only after the complete staged tree has been verified. */
export async function deployDirectory(connection: DirectoryDeploymentConnection, plan: DirectoryDeploymentPlan,
  signal: AbortSignal): Promise<{ destination: string; count: number; bytes: number }> {
  const latest = await localDeploymentTree(plan.root, plan.source)
  if (latest.files.length !== plan.files.length || latest.directories.join('\0') !== plan.directories.join('\0')
    || latest.files.some((file, index) => file.relative !== plan.files[index]?.relative || file.sha256 !== plan.files[index]?.sha256 || file.mode !== plan.files[index]?.mode))
    throw new Error('本地目录已变化，请重新预览部署。')
  const { serverId, destination } = plan
  if ((await connection.manifest(serverId, destination, signal)).sha256 !== plan.remoteSha256)
    throw new Error('远端目录已变化，请重新预览部署。')
  const stage = remoteDeploymentDirectory(posix.join(posix.dirname(destination), `.ling-stage-${randomUUID()}`))
  const backup = remoteDeploymentDirectory(posix.join(posix.dirname(destination), `.ling-backup-${randomUUID()}`))
  const prepare = `set -eu; parent=${shellQuote(posix.dirname(stage))}; p="$parent"; while [ "$p" != / ]; do [ ! -L "$p" ] || exit 45; p=$(dirname -- "$p"); done; mkdir -p -- "$parent"; mkdir -m 700 -- ${shellQuote(stage)}`
  const prepared = await connection.run(serverId, '/', prepare, signal)
  if (prepared.exitCode !== 0) throw new Error(prepared.stderr.trim() || '无法准备远端部署目录。')
  let count = 0
  let bytes = 0
  let switched = false
  try {
    for (const directory of plan.directories) {
      const result = await connection.run(serverId, '/', `mkdir -p -- ${shellQuote(posix.join(stage, directory))}`, signal)
      if (result.exitCode !== 0) throw new Error(result.stderr.trim() || `无法创建远端目录：${directory}`)
    }
    for (const file of plan.files) {
      const result = await connection.upload(serverId, plan.root, file.source,
        remoteDeploymentPath(posix.join(stage, file.relative)), file.sha256, null, signal)
      count++
      bytes += result.bytes
    }
    const expected = [...plan.directories.map(path => ({ path, type: 'directory' as const })),
      ...plan.files.map(file => ({ path: file.relative, type: 'file' as const, sha256: file.sha256 }))]
      .sort((a, b) => a.path.localeCompare(b.path))
    const staged = await connection.manifest(serverId, stage, signal)
    if (JSON.stringify(staged.entries) !== JSON.stringify(expected)) throw new Error('远端暂存目录校验失败。')
    if ((await connection.manifest(serverId, destination, signal)).sha256 !== plan.remoteSha256)
      throw new Error('远端目录已变化，请重新预览部署。')
    const command = `set -eu; dest=${shellQuote(destination)}; stage=${shellQuote(stage)}; backup=${shellQuote(backup)}; [ -d "$stage" ] && [ ! -L "$stage" ] && [ ! -e "$backup" ] || exit 46; moved=0; if [ -e "$dest" ]; then [ -d "$dest" ] && [ ! -L "$dest" ] || exit 45; mv -- "$dest" "$backup"; moved=1; fi; restore() { if [ "$moved" = 1 ] && [ ! -e "$dest" ] && [ -d "$backup" ]; then mv -- "$backup" "$dest"; fi; }; trap restore EXIT HUP INT TERM; mv -- "$stage" "$dest"; trap - EXIT HUP INT TERM; printf '__LING_DIRECTORY_DEPLOYED__\\n'`
    const result = await connection.run(serverId, '/', command, signal)
    switched = result.exitCode === 0 && result.stdout.includes('__LING_DIRECTORY_DEPLOYED__')
    if (!switched) throw new Error(result.stderr.trim() || '远端目录切换未确认，请检查目标目录。')
    return { destination, count, bytes }
  } catch (error) {
    throw new Error(`目录部署中断，已传输 ${count}/${plan.files.length} 个文件。${error instanceof Error ? error.message : ''}`)
  } finally {
    const cleanup = new AbortController().signal
    await connection.run(serverId, '/', `if [ -d ${shellQuote(stage)} ] && [ ! -L ${shellQuote(stage)} ]; then rm -rf -- ${shellQuote(stage)}; fi`, cleanup).catch(() => undefined)
    if (switched) await connection.run(serverId, '/', `if [ -d ${shellQuote(backup)} ] && [ ! -L ${shellQuote(backup)} ]; then rm -rf -- ${shellQuote(backup)}; fi`, cleanup).catch(() => undefined)
  }
}
