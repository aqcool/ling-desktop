import { posix } from 'node:path'
import type { KnowledgeScope } from './engine.ts'
import { eligiblePath, parseCode } from './code-index.ts'
import type { IndexedFile } from './store.ts'
import { getServerBridge } from '../host/server-bridge.ts'
import { GitIgnoreRules } from './git-ignore.ts'

const ignored = /^(?:\.git|\.ssh|\.aws|node_modules|vendor|dist|build|coverage|\.yarn|\.next)$/
export async function readRemoteCode(scope: KnowledgeScope, path: string, signal: AbortSignal): Promise<{ text: string; hash: string }> {
  if (!scope.remote || !scope.root || !eligiblePath(path)) throw new Error('SSH 文件范围无效。')
  const target = posix.resolve(scope.root,path), relative = posix.relative(scope.root,target)
  if (!relative || relative.startsWith('../') || relative === '..') throw new Error('文件不属于此 SSH 工作区。')
  const value = await getServerBridge().file({ action: 'read', serverId: scope.remote.serverId, root: scope.root, path: target, maxBytes: 512*1024 },signal)
  if (!('text' in value)) throw new Error('SSH 文件读取失败。')
  return { text: value.text, hash: value.sha256 }
}
/** Reuses the existing SSH provider and canonical containment, never a same-looking local path. */
export async function listRemoteCodePaths(scope: KnowledgeScope, signal: AbortSignal): Promise<string[]> {
  if (!scope.remote || !scope.root) throw new Error('SSH 工作区范围无效。')
  const paths: string[] = [], rules = new GitIgnoreRules()
  let entries = 0
  const walk = async (directory: string, depth: number) => {
    signal.throwIfAborted()
    if (depth > 32) throw new Error('SSH 目录层级超过索引上限。')
    const result = await getServerBridge().file({ action: 'list', serverId: scope.remote!.serverId, root: scope.root, path: posix.join(scope.root!,directory) }, signal)
    if (!('entries' in result)) throw new Error('SSH 目录读取失败。')
    if (result.entries.some(entry => entry.name === '.gitignore' && entry.type === 'file')) {
      const value = await getServerBridge().file({ action: 'read', serverId: scope.remote!.serverId, root: scope.root!, path: posix.join(scope.root!, directory, '.gitignore'), maxBytes: 512 * 1024 }, signal)
      if (!('text' in value) || value.truncated) throw new Error('SSH 忽略规则读取失败，索引未更新。')
      rules.add(directory, value.text)
    }
    for (const entry of result.entries) {
      if (++entries > 20000) throw new Error('SSH 工作区超过 20,000 个目录条目，请缩小项目范围。')
      if (entry.name === '.' || entry.name === '..' || entry.name.includes('/') || ignored.test(entry.name)) continue
      const path = posix.join(directory,entry.name)
      if (rules.ignores(path, entry.type === 'directory')) continue
      if (entry.type === 'directory') await walk(path,depth+1)
      else if (entry.type === 'file' && eligiblePath(path)) paths.push(path)
    }
  }
  await walk('',0)
  return paths.sort()
}
export async function indexRemoteCode(scope: KnowledgeScope, previous: IndexedFile[], signal: AbortSignal): Promise<IndexedFile[]> {
  const paths = await listRemoteCodePaths(scope, signal)
  const files: IndexedFile[] = [], old = new Map(previous.map(file => [file.path, file]))
  let bytes = 0
  for (const path of paths) {
    const value = await readRemoteCode(scope, path, signal), cached = old.get(path)
    bytes += Buffer.byteLength(value.text)
    if (bytes > 128 * 1024 * 1024) throw new Error('SSH 工作区文本超过 128 MB 索引预算，请缩小项目范围。')
    files.push(cached?.hash === value.hash ? cached : await parseCode(path, value.text))
  }
  return files
}
