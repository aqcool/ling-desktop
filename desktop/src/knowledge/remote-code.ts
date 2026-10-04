import { posix } from 'node:path'
import type { KnowledgeScope } from './engine.ts'
import { eligiblePath, parseCode } from './code-index.ts'
import type { IndexedFile } from './store.ts'
import { getServerBridge } from '../host/server-bridge.ts'

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
export async function indexRemoteCode(scope: KnowledgeScope, previous: IndexedFile[], signal: AbortSignal): Promise<IndexedFile[]> {
  if (!scope.remote || !scope.root) throw new Error('SSH 工作区范围无效。')
  const files: IndexedFile[] = [], old = new Map(previous.map(file => [file.path,file]))
  let entries = 0
  const walk = async (directory: string, depth: number) => {
    signal.throwIfAborted()
    if (depth > 32) throw new Error('SSH 目录层级超过索引上限。')
    const result = await getServerBridge().file({ action: 'list', serverId: scope.remote!.serverId, root: scope.root, path: posix.join(scope.root!,directory) }, signal)
    if (!('entries' in result)) throw new Error('SSH 目录读取失败。')
    for (const entry of result.entries) {
      if (++entries > 20000) throw new Error('SSH 工作区超过 20,000 个目录条目，请缩小项目范围。')
      if (entry.name === '.' || entry.name === '..' || entry.name.includes('/') || ignored.test(entry.name)) continue
      const path = posix.join(directory,entry.name)
      if (entry.type === 'directory') await walk(path,depth+1)
      else if (entry.type === 'file' && eligiblePath(path)) {
        const value = await readRemoteCode(scope,path,signal), cached = old.get(path)
        files.push(cached?.hash === value.hash ? cached : await parseCode(path,value.text))
      }
    }
  }
  await walk('',0)
  return files
}
