import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { SandboxPolicyService } from '@deepseek-ai/dsh-sandbox-policy'
import { SandboxedFileSystem } from '@deepseek-ai/dsh-fs-sandbox'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import TypertGatewayService from '@deepseek-ai/dsh-api-gateway'
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LingWorkspaceDocumentsController } from '../src/host/workspace-document-controller.ts'
import { WORKSPACE_DOCUMENT_MAX_BYTES, WORKSPACE_OFFICE_MAX_BYTES, WORKSPACE_PREVIEW_MAX_BYTES, type WorkspaceOfficePreview, type WorkspaceBinaryPreview, type EditableWorkspaceText, type SavedWorkspaceText, type WorkspaceDirectory } from '../src/workspace-document-contract.ts'

const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose() })
async function fixture() {
  const home = await realpath(await mkdtemp(join(tmpdir(), 'ling-editor-')))
  cleanup.push(() => rm(home, { recursive: true, force: true }))
  const workspace = join(home, 'workspace')
  await mkdir(workspace)
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SandboxPolicyService, { mode: 'read-only', workspaceRoot: home })
  await ctx.plugin(SandboxedFileSystem, { cwd: home })
  await ctx.plugin(TypertRegistry)
  await ctx.plugin(TypertGatewayService)
  ctx.provide('workspaceRegistry', { get: (id: string) => id === 'workspace-fixture' ? { id, path: workspace } : undefined } as never)
  await ctx.plugin(LingWorkspaceDocumentsController)
  cleanup.push(() => ctx.fiber.dispose())
  const session = ctx.sessions.create(SessionId('editor-task'), { meta: { cwd: workspace } })
  const request = <T,>(method: string, request: unknown, signal = new AbortController().signal) => ctx.typertGateway.invoke({ namespace: 'lingWorkspaceDocuments', method, args: { request }, signal }) as Promise<T>
  const read = (path: string) => request<EditableWorkspaceText>('read', { taskId: session.id, path })
  const save = (path: string, text: string, version: string, signal?: AbortSignal) => request<SavedWorkspaceText>('save', { taskId: session.id, path, text, version }, signal)
  return { ctx, home, workspace, session, request, read, save }
}

describe('LING local workspace editor over the composed filesystem', () => {
  it.each(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'svg', 'avif', 'pdf'])('previews complete %s bytes in a draft workspace without creating a session', async extension => {
    const { ctx, workspace, request } = await fixture()
    const bytes = Buffer.from([0, 0xff, 0x80, 0x42])
    const path = `预览.${extension}`
    await writeFile(join(workspace, path), bytes)
    let created = 0
    ctx.on('session/created', () => { created += 1 })
    expect(await request<WorkspaceBinaryPreview>('readBinary', { workspaceId: 'workspace-fixture', path })).toEqual({ data: bytes.toString('base64'), bytes: bytes.length })
    expect(created).toBe(0)
  })
  it('confines binary previews, rejects changed/oversized sources and preserves cancellation', async () => {
    const { ctx, workspace, home, request } = await fixture()
    const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xd9])
    const scope = { workspaceId: 'workspace-fixture', path: 'photo.JPG' }
    await writeFile(join(workspace, 'photo.JPG'), bytes)
    await writeFile(join(home, 'outside.jpg'), bytes)
    await symlink(join(home, 'outside.jpg'), join(workspace, 'link.jpg'))
    await expect(request('readBinary', { ...scope, path: '../outside.jpg' })).rejects.toMatchObject({ code: 'ling-document/readonly' })
    await expect(request('readBinary', { ...scope, path: 'link.jpg' })).rejects.toMatchObject({ code: 'ling-document/readonly' })
    await expect(request('readBinary', { ...scope, path: 'program.exe' })).rejects.toThrow()
    await expect(request('readBinary', { ...scope, taskId: 'editor-task' })).rejects.toThrow()
    const aborted = new AbortController(); aborted.abort()
    await expect(request('readBinary', scope, aborted.signal)).rejects.toMatchObject({ code: 'gateway/cancelled' })
    const fs = ctx.fs as SandboxedFileSystem
    fs.internals.inspectReadBytesAfterStat = async () => { fs.internals.inspectReadBytesAfterStat = undefined; await writeFile(join(workspace, 'photo.JPG'), 'changed') }
    await expect(request('readBinary', scope)).rejects.toMatchObject({ code: 'ling-document/conflict' })
    await writeFile(join(workspace, 'photo.JPG'), Buffer.alloc(WORKSPACE_PREVIEW_MAX_BYTES + 1))
    await expect(request('readBinary', scope)).rejects.toMatchObject({ code: 'ling-document/too-large' })
  })
  it('reads bounded Office bytes in draft and task scopes without granting a save token or creating a task', async () => {
    const { ctx, workspace, home, request } = await fixture()
    const bytes = Buffer.from([0x50, 0x4b, 0, 0xff, 0x80])
    await writeFile(join(workspace, 'report.xlsx'), bytes)
    let created = 0
    ctx.on('session/created', () => { created += 1 })
    const scope = { workspaceId: 'workspace-fixture', path: 'report.xlsx' }
    const result = await request<WorkspaceOfficePreview>('readOffice', scope)
    expect(result).toEqual({ data: bytes.toString('base64'), bytes: bytes.length })
    expect(result).not.toHaveProperty('version')
    expect(created).toBe(0)
    expect(await request('readOffice', { taskId: 'editor-task', path: 'report.xlsx' })).toEqual(result)
    await writeFile(join(home, 'outside.xlsx'), bytes)
    await symlink(join(home, 'outside.xlsx'), join(workspace, 'link.xlsx'))
    await expect(request('readOffice', { ...scope, path: '../outside.xlsx' })).rejects.toMatchObject({ code: 'ling-document/readonly' })
    await expect(request('readOffice', { ...scope, path: 'link.xlsx' })).rejects.toMatchObject({ code: 'ling-document/readonly' })
    await expect(request('readOffice', { ...scope, path: 'report.exe' })).rejects.toThrow()
    const aborted = new AbortController(); aborted.abort()
    await expect(request('readOffice', scope, aborted.signal)).rejects.toMatchObject({ code: 'gateway/cancelled' })
    const fs = ctx.fs as SandboxedFileSystem
    fs.internals.inspectReadBytesAfterStat = async () => { fs.internals.inspectReadBytesAfterStat = undefined; await writeFile(join(workspace, 'report.xlsx'), 'changed') }
    await expect(request('readOffice', scope)).rejects.toMatchObject({ code: 'ling-document/conflict' })
    await writeFile(join(workspace, 'report.xlsx'), Buffer.alloc(WORKSPACE_OFFICE_MAX_BYTES + 1))
    await expect(request('readOffice', scope)).rejects.toMatchObject({ code: 'ling-document/too-large' })
  })
  it('reads all lines with original BOM/CRLF and saves exactly the complete text through a real Remote', async () => {
    const { ctx, workspace, read, save } = await fixture()
    const path = join(workspace, 'long.ts')
    const original = '\uFEFF' + Array.from({ length: 901 }, (_, index) => `const line${index} = "灵创"`).join('\r\n') + '\r\n'
    await writeFile(path, original)
    const loaded = await read('long.ts')
    expect(loaded).toMatchObject({ text: original, bytes: Buffer.byteLength(original) })
    expect(loaded.version).toMatch(/^[a-f0-9]{64}$/)
    const edited = original.replace('line900', 'edited900')
    let staged = false
    const fs = ctx.fs as SandboxedFileSystem
    fs.internals.inspectTemp = async ({ tempPath }) => {
      expect(await readFile(path, 'utf8')).toBe(original)
      expect(await readFile(tempPath, 'utf8')).toBe(edited)
      staged = true
    }
    const saved = await save('long.ts', edited, loaded.version)
    fs.internals.inspectTemp = undefined
    expect(staged).toBe(true)
    expect(await readdir(workspace)).toEqual(['long.ts'])
    expect(await readFile(path, 'utf8')).toBe(edited)
    expect((await read('long.ts')).version).toBe(saved.version)
    await save('long.ts', edited + 'next\r\n', saved.version)
    expect(await readFile(path, 'utf8')).toBe(edited + 'next\r\n')
    expect(ctx.sandboxPolicy.defaultMode).toBe('read-only')
  })

  it('rejects external changes and makes concurrent saves compete on the observed version', async () => {
    const { workspace, read, save } = await fixture()
    const path = join(workspace, 'code.ts')
    await writeFile(path, 'original')
    const loaded = await read('code.ts')
    await writeFile(path, 'externally changed')
    await expect(save('code.ts', 'stale editor', loaded.version)).rejects.toMatchObject({ code: 'ling-document/conflict' })
    expect(await readFile(path, 'utf8')).toBe('externally changed')
    const fresh = await read('code.ts')
    const results = await Promise.allSettled([save('code.ts', 'first', fresh.version), save('code.ts', 'second', fresh.version)])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(result => result.status === 'rejected')).toMatchObject([{ reason: { code: 'ling-document/conflict' } }])
    expect(['first', 'second']).toContain(await readFile(path, 'utf8'))
  })

  it('refuses workspaces escapes, final symlinks, missing tasks, binary and invalid UTF-8 without touching files', async () => {
    const { ctx, workspace, home, read, request } = await fixture()
    await writeFile(join(home, 'outside.txt'), 'outside')
    await writeFile(join(workspace, 'nul.txt'), 'binary\0tail')
    await writeFile(join(workspace, 'invalid.txt'), Uint8Array.from([0xc3, 0x28]))
    await symlink(join(home, 'outside.txt'), join(workspace, 'link.txt'))
    await expect(read('../outside.txt')).rejects.toMatchObject({ code: 'ling-document/readonly' })
    await expect(read('link.txt')).rejects.toMatchObject({ code: 'ling-document/readonly' })
    await expect(read('nul.txt')).rejects.toMatchObject({ code: 'ling-document/not-text' })
    await expect(read('invalid.txt')).rejects.toMatchObject({ code: 'ling-document/not-text' })
    await expect(request('read', { taskId: 'missing', path: 'outside.txt' })).rejects.toMatchObject({ code: 'ling-document/task-not-found' })
    ctx.sessions.create(SessionId('without-cwd'))
    await expect(request('read', { taskId: 'without-cwd', path: '../outside.txt' })).rejects.toMatchObject({ code: 'ling-document/readonly' })
    ctx.sessions.create(SessionId('remote-task'), { meta: { cwd: workspace } })
    ctx.provide('lingServers', { taskBinding: async (id: string) => id === 'remote-task' ? { serverId: 'server', cwd: workspace } : null } as never)
    await expect(request('read', { taskId: 'remote-task', path: 'nul.txt' })).rejects.toMatchObject({ code: 'ling-document/readonly' })
    await expect(request('read', { taskId: 'editor-task', workspaceId: 'workspace-fixture', path: 'nul.txt' })).rejects.toThrow()
    expect(await readFile(join(home, 'outside.txt'), 'utf8')).toBe('outside')
    expect(await readFile(join(workspace, 'nul.txt'), 'utf8')).toBe('binary\0tail')
  })

  it('enforces the UTF-8 byte bound on reads, growth races and saves, and preserves cancellation', async () => {
    const { ctx, workspace, read, save } = await fixture()
    const path = join(workspace, 'bounded.txt')
    await writeFile(path, 'small')
    const loaded = await read('bounded.txt')
    await expect(save('bounded.txt', '灵'.repeat(Math.floor(WORKSPACE_DOCUMENT_MAX_BYTES / 3) + 1), loaded.version)).rejects.toMatchObject({ code: 'ling-document/too-large' })
    const aborted = new AbortController(); aborted.abort()
    await expect(save('bounded.txt', 'cancelled', loaded.version, aborted.signal)).rejects.toMatchObject({ code: 'gateway/cancelled' })
    expect(await readFile(path, 'utf8')).toBe('small')
    const fs = ctx.fs as SandboxedFileSystem
    const cancelling = new AbortController()
    fs.internals.inspectTemp = () => { cancelling.abort() }
    await expect(save('bounded.txt', 'aborted before publication', loaded.version, cancelling.signal)).rejects.toMatchObject({ code: 'gateway/cancelled' })
    fs.internals.inspectTemp = undefined
    await vi.waitFor(async () => expect(await readdir(workspace)).toEqual(['bounded.txt']))
    expect(await readFile(path, 'utf8')).toBe('small')
    await expect(save('bounded.txt', '\ud800', loaded.version)).rejects.toMatchObject({ code: 'ling-document/not-text' })
    fs.internals.inspectReadBytesAfterStat = async () => { fs.internals.inspectReadBytesAfterStat = undefined; await writeFile(path, 'changed while reading') }
    await expect(read('bounded.txt')).rejects.toMatchObject({ code: 'ling-document/conflict' })
    await writeFile(path, 'a'.repeat(WORKSPACE_DOCUMENT_MAX_BYTES))
    expect((await read('bounded.txt')).bytes).toBe(WORKSPACE_DOCUMENT_MAX_BYTES)
    await writeFile(path, 'small')
    fs.internals.inspectReadBytesAfterStat = async () => { fs.internals.inspectReadBytesAfterStat = undefined; await writeFile(path, 'a'.repeat(WORKSPACE_DOCUMENT_MAX_BYTES + 1)) }
    await expect(read('bounded.txt')).rejects.toMatchObject({ code: 'ling-document/too-large' })
    await expect(read('bounded.txt')).rejects.toMatchObject({ code: 'ling-document/too-large' })
  })

  it('lists, reads and saves a registered draft workspace without creating a session', async () => {
    const { ctx, workspace, request } = await fixture()
    await mkdir(join(workspace, 'src 灵创 #'))
    await writeFile(join(workspace, 'src 灵创 #', 'draft 代码.ts'), 'before first prompt')
    let created = 0
    ctx.on('session/created', () => { created += 1 })
    const scope = { workspaceId: 'workspace-fixture' }
    expect(await request<WorkspaceDirectory>('list', { ...scope, path: '' })).toMatchObject({ path: '', entries: [{ name: 'src 灵创 #', path: 'src 灵创 #', kind: 'directory' }], truncated: false })
    expect(await request<WorkspaceDirectory>('list', { ...scope, path: 'src 灵创 #' })).toMatchObject({ path: 'src 灵创 #', entries: [{ name: 'draft 代码.ts', path: 'src 灵创 #/draft 代码.ts', kind: 'file' }] })
    const loaded = await request<EditableWorkspaceText>('read', { ...scope, path: 'src 灵创 #/draft 代码.ts' })
    const saved = await request<SavedWorkspaceText>('save', { ...scope, path: 'src 灵创 #/draft 代码.ts', text: 'edited before first prompt', version: loaded.version })
    expect(saved.version).not.toBe(loaded.version)
    expect(await readFile(join(workspace, 'src 灵创 #', 'draft 代码.ts'), 'utf8')).toBe('edited before first prompt')
    expect(created).toBe(0)
    await expect(request('list', { ...scope, path: '..' })).rejects.toMatchObject({ code: 'ling-document/readonly' })
    await expect(request('read', { workspaceId: 'missing', path: 'src/draft.ts' })).rejects.toMatchObject({ code: 'ling-document/workspace-not-found' })
  })
})
