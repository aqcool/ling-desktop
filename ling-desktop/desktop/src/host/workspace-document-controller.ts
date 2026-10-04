import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { FsError, type FsInfo, type FsTarget } from '@deepseek-ai/dsh-fs'
import { SessionId } from '@deepseek-ai/dsh-session'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import type {} from './server-controller.ts'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { documentListRequest, documentReadRequest, documentSaveRequest, LING_WORKSPACE_DOCUMENTS_HOST, WORKSPACE_DOCUMENT_MAX_BYTES, type EditableWorkspaceText, type SavedWorkspaceText, type WorkspaceDirectory, type WorkspaceDocumentRequest } from '../workspace-document-contract.ts'
import type { z } from 'zod'

declare module '@deepseek-ai/cordis' { interface Context { lingWorkspaceDocuments: LingWorkspaceDocumentsController } }
const contentVersion = (version: FsInfo['version'], bytes: Uint8Array) => createHash('sha256').update(String(version)).update('\0').update(bytes).digest('hex')
function decodeText(bytes: Uint8Array, path: string): string {
  let text: string
  try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes) } catch { throw new RemoteError('ling-document/not-text', '此文件不是有效的 UTF-8 文本，不能在代码编辑器中编辑。', { path }) }
  if (text.includes('\0')) throw new RemoteError('ling-document/not-text', '此文件包含二进制内容，不能在代码编辑器中编辑。', { path })
  return text
}
function failure(error: unknown, path: string): never {
  if (error instanceof RemoteError) throw error
  if (error instanceof FsError) {
    if (error.code === 'FS_STALE_VERSION' || error.code === 'FS_NOT_OBSERVED') throw new RemoteError('ling-document/conflict', '文件已在其他位置修改，请重新读取后再保存。', { path })
    if (error.code === 'FS_TOO_LARGE') throw new RemoteError('ling-document/too-large', '文件超过 1 MB，无法在代码编辑器中完整读取。', { maxBytes: WORKSPACE_DOCUMENT_MAX_BYTES })
    if (error.code === 'FS_NOT_TEXT') throw new RemoteError('ling-document/not-text', '此文件不是 UTF-8 文本。', { path })
    if (error.code === 'FS_PERMISSION_DENIED' || error.code === 'FS_SANDBOX_DENIED') throw new RemoteError('ling-document/permission-denied', '没有权限编辑此文件。', { path })
    if (error.code === 'FS_NOT_FOUND') throw new RemoteError('ling-document/not-found', '文件已不存在，请刷新目录。', { path })
    if (error.code === 'FS_ABORTED') throw new RemoteError('ling-document/aborted', '文件操作已取消。', {})
  }
  if (error instanceof Error && error.name === 'AbortError') throw new RemoteError('ling-document/aborted', '文件操作已取消。', {})
  throw new RemoteError('ling-document/unavailable', '文件操作未能完成，请重试。', {}, { cause: error })
}

/** Human editor boundary over the composed FS; no Agent activation or blind write endpoint. */
export class LingWorkspaceDocumentsController extends TypertRemoteService {
  static inject = ['fs', 'typert', 'sessions', 'sandboxPolicy', 'workspaceRegistry']
  constructor(ctx: Context) { super(ctx, 'lingWorkspaceDocuments'); ctx.effect(() => ctx.typert.register(LING_WORKSPACE_DOCUMENTS_HOST), 'LING workspace document Remote') }
  private async workspaceRoot(request: WorkspaceDocumentRequest): Promise<string> {
    if ('workspaceId' in request) {
      const workspace = this.ctx.workspaceRegistry.get(WorkspaceId(request.workspaceId))
      if (!workspace) throw new RemoteError('ling-document/workspace-not-found', '工作区已不存在，请重新选择。', { workspaceId: request.workspaceId })
      return workspace.path
    }
    if (await this.ctx.get('lingServers')?.taskBinding(request.taskId)) {
      throw new RemoteError('ling-document/readonly', '远端开发任务请使用服务器文件编辑器。', { path: request.path })
    }
    const id = SessionId(request.taskId)
    const header = this.ctx.sessions.get(id)?.header ?? (await this.ctx.get('sessionPersistence')?.stat(id))?.header
    if (!header) throw new RemoteError('ling-document/task-not-found', '任务已不存在，请重新打开文件。', { taskId: request.taskId })
    if (!header.cwd) throw new RemoteError('ling-document/readonly', '此任务没有本地工作区，仅支持预览。', { path: request.path })
    return header.cwd
  }
  private async locate(request: WorkspaceDocumentRequest, signal?: AbortSignal): Promise<{ target: FsTarget; info: FsInfo; workspaceRoot: string }> {
    signal?.throwIfAborted()
    if (request.path.includes('\0')) throw new RemoteError('gateway/bad-request', '文件路径无效。', {})
    const workspaceRoot = await this.workspaceRoot(request)
    const root = await this.ctx.fs.resolve(workspaceRoot, { signal })
    const entry = await this.ctx.fs.lstat(request.path, { cwd: workspaceRoot }, signal)
    if (!entry) throw new RemoteError('ling-document/not-found', '文件已不存在，请刷新目录。', { path: request.path })
    if (entry.type !== 'file') throw new RemoteError('ling-document/readonly', '仅支持编辑工作区内的普通文件。', { path: request.path })
    const target = await this.ctx.fs.resolve(request.path, { cwd: workspaceRoot, signal })
    if (!this.ctx.fs.contains(root, target)) throw new RemoteError('ling-document/readonly', '工作区外的文件仅支持预览。', { path: request.path })
    const info = await this.ctx.fs.stat(target, signal)
    if (!info || info.type !== 'file') throw new RemoteError('ling-document/readonly', '文件类型已变化，请刷新目录。', { path: request.path })
    if (info.size !== undefined && info.size > WORKSPACE_DOCUMENT_MAX_BYTES) throw new RemoteError('ling-document/too-large', '文件超过 1 MB，无法在代码编辑器中完整读取。', { maxBytes: WORKSPACE_DOCUMENT_MAX_BYTES })
    return { target, info, workspaceRoot }
  }
  private async contents(request: z.infer<typeof documentReadRequest>, signal?: AbortSignal) {
    const located = await this.locate(request, signal)
    const bytes = await this.ctx.fs.readBytes(located.target, signal, WORKSPACE_DOCUMENT_MAX_BYTES)
    const text = decodeText(bytes, request.path)
    const after = await this.ctx.fs.stat(located.target, signal)
    if (after?.version !== located.info.version) throw new RemoteError('ling-document/conflict', '文件在读取时发生变化，请重新读取。', { path: request.path })
    return { ...located, bytes, text, version: contentVersion(located.info.version, bytes) }
  }
  async read(input: z.infer<typeof documentReadRequest>, signal?: AbortSignal): Promise<EditableWorkspaceText> {
    const request = documentReadRequest.parse(input)
    try { const result = await this.contents(request, signal); return { text: result.text, bytes: result.bytes.byteLength, version: result.version } } catch (error) { failure(error, request.path) }
  }
  async list(input: z.infer<typeof documentListRequest>, signal?: AbortSignal): Promise<WorkspaceDirectory> {
    const request = documentListRequest.parse(input)
    try {
      signal?.throwIfAborted()
      if (request.path.includes('\0')) throw new RemoteError('gateway/bad-request', '目录路径无效。', {})
      const workspaceRoot = await this.workspaceRoot(request)
      const root = await this.ctx.fs.resolve(workspaceRoot, { signal })
      const target = await this.ctx.fs.resolve(request.path || '.', { cwd: workspaceRoot, signal })
      if (!this.ctx.fs.contains(root, target)) throw new RemoteError('ling-document/readonly', '仅支持浏览已选择的工作区。', { path: request.path })
      const info = await this.ctx.fs.stat(target, signal)
      if (!info) throw new RemoteError('ling-document/not-found', '目录已不存在，请刷新。', { path: request.path })
      if (info.type !== 'directory') throw new RemoteError('ling-document/readonly', '此路径不是目录。', { path: request.path })
      const children = await this.ctx.fs.listDir(target, signal)
      const rootPath = new URL(this.ctx.fs.fileUrl(root)).pathname.replace(/\/+$/, '')
      const targetPath = new URL(this.ctx.fs.fileUrl(target)).pathname
      const path = targetPath === rootPath ? '' : targetPath.slice(rootPath.length + 1).split('/').map(decodeURIComponent).join('/')
      return { path, entries: children.slice(0, 2000).map(child => ({ name: child.name, path: path ? `${path}/${child.name}` : child.name, kind: child.type, ...(child.size === undefined ? {} : { bytes: child.size }) })), truncated: children.length > 2000 }
    } catch (error) { failure(error, request.path) }
  }
  async save(input: z.infer<typeof documentSaveRequest>, signal?: AbortSignal): Promise<SavedWorkspaceText> {
    const request = documentSaveRequest.parse(input)
    try {
      if (!request.text.isWellFormed() || request.text.includes('\0')) throw new RemoteError('ling-document/not-text', '内容不是有效的 UTF-8 文本，未保存。', { path: request.path })
      const bytes = Buffer.from(request.text, 'utf8')
      if (bytes.byteLength > WORKSPACE_DOCUMENT_MAX_BYTES) throw new RemoteError('ling-document/too-large', '超过 1 MB 的文件无法在此编辑器保存。', { maxBytes: WORKSPACE_DOCUMENT_MAX_BYTES })
      const before = await this.contents(request, signal)
      if (request.version !== before.version) throw new RemoteError('ling-document/conflict', '文件已在其他位置修改，请重新读取后再保存。', { path: request.path })
      signal?.throwIfAborted()
      // Explicit human action stays workspace-confined, independent of agent tool policy.
      const policy = { ...this.ctx.sandboxPolicy.resolve({ mode: 'workspace-write' }), workspaceRoot: before.workspaceRoot }
      const outcome = await this.ctx.fs.writeText(before.target, request.text, { kind: 'replaceIfVersion', version: before.info.version }, signal, policy)
      return { version: contentVersion(outcome.version, bytes) }
    } catch (error) { failure(error, request.path) }
  }
}
const prototype = LingWorkspaceDocumentsController.prototype
const receiver = Object.create(prototype) as LingWorkspaceDocumentsController
const decorate = Remote as unknown as (implementation: (...args: never[]) => unknown, context: { name: string; private: boolean; static: boolean; addInitializer(initializer: (this: LingWorkspaceDocumentsController) => void): void }) => void
for (const name of ['read', 'save', 'list'] as const) decorate(prototype[name] as (...args: never[]) => unknown, { name, private: false, static: false, addInitializer(initializer) { initializer.call(receiver) } })
