import type { InvocationDescriptor, RemoteResult, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import type { TypertContribution } from '@deepseek-ai/dsh-typert-registry'
import { z } from 'zod'
import type { LingGitRequest, LingGitResult, LingServerExecution } from 'ling-desktop/runtime'

export const serverEnvironmentSchema = z.enum(['development', 'staging', 'production'])
export const serverInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  alias: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/),
  user: z.string().regex(/^[A-Za-z0-9_][A-Za-z0-9._-]{0,63}$/).optional(),
  port: z.number().int().min(1).max(65535).optional(),
  environment: serverEnvironmentSchema,
}).strict()
export const serverSchema = serverInputSchema.extend({ id: z.string().uuid() }).strict()
export const directorySchema = z.object({ path: z.string(), name: z.string() }).strict()
export type LingServerInput = z.infer<typeof serverInputSchema>
export type LingServer = z.infer<typeof serverSchema>
export interface LingServerProbe { readonly home: string }
export interface LingServerDirectory { readonly path: string; readonly directories: readonly { readonly path: string; readonly name: string }[] }
export interface LingServerTerminalSnapshot { readonly terminalId: string; readonly offset: number; readonly data: string; readonly closed: boolean; readonly exitCode?: number; readonly error?: string }
export interface LingServerFilesDirectory { readonly path: string; readonly entries: readonly { readonly name: string; readonly type: 'directory' | 'file' | 'other' }[] }
export interface LingServerTextFile { readonly path: string; readonly text: string; readonly sha256: string; readonly truncated: boolean }
const gitRequestSchema: z.ZodType<LingGitRequest> = z.discriminatedUnion('type', [
  z.object({ type: z.literal('inspect') }).strict(), z.object({ type: z.literal('fetch') }).strict(),
  z.object({ type: z.literal('pull') }).strict(),
  z.object({ type: z.literal('diff'), path: z.string(), staged: z.boolean() }).strict(),
  z.object({ type: z.literal('stage'), paths: z.array(z.string()) }).strict(),
  z.object({ type: z.literal('unstage'), paths: z.array(z.string()) }).strict(),
  z.object({ type: z.literal('commit'), message: z.string() }).strict(),
  z.object({ type: z.literal('switch'), branch: z.string() }).strict(),
  z.object({ type: z.literal('create-branch'), branch: z.string() }).strict(),
  z.object({ type: z.literal('push'), remote: z.string().optional() }).strict(),
  z.object({ type: z.literal('worktree-add'), path: z.string(), branch: z.string(), newBranch: z.boolean() }).strict(),
  z.object({ type: z.literal('worktree-remove'), path: z.string() }).strict(),
  z.object({ type: z.literal('worktree-open'), path: z.string() }).strict(),
])
const gitSnapshotSchema = z.object({ repository: z.boolean(), root: z.string(), branch: z.string().nullable(), detached: z.boolean(),
  unborn: z.boolean(), upstream: z.string().nullable(), ahead: z.number().int(), behind: z.number().int(),
  files: z.array(z.object({ path: z.string(), originalPath: z.string().optional(), index: z.string(), worktree: z.string(), conflict: z.boolean() }).strict()),
  branches: z.array(z.string()), remotes: z.array(z.string()),
  worktrees: z.array(z.object({ path: z.string(), branch: z.string().nullable(), head: z.string(), main: z.boolean(), locked: z.boolean(), prunable: z.boolean() }).strict()),
}).strict()
const gitResultSchema: z.ZodType<LingGitResult> = z.object({ snapshot: gitSnapshotSchema, diff: z.string().optional(), message: z.string().optional() }).strict()

export interface LingServersRemote {
  executions(taskId: string, callIds: readonly string[]): Promise<RemoteResult<readonly LingServerExecution[]>>
  list(): Promise<RemoteResult<readonly LingServer[]>>
  add(input: LingServerInput): Promise<RemoteResult<LingServer>>
  configure(id: string, input: LingServerInput): Promise<RemoteResult<LingServer>>
  forget(id: string): Promise<RemoteResult<{ readonly ok: true }>>
  probe(id: string, signal?: AbortSignal): Promise<RemoteResult<LingServerProbe>>
  directories(id: string, path: string, signal?: AbortSignal): Promise<RemoteResult<LingServerDirectory>>
  bindTask(taskId: string, serverId: string, home: string): Promise<RemoteResult<{ readonly serverId: string; readonly cwd: string }>>
  taskBinding(taskId: string): Promise<RemoteResult<{ readonly serverId: string; readonly cwd: string } | null>>
  attachOperations(taskId: string, serverId: string, home: string): Promise<RemoteResult<{ readonly serverId: string; readonly cwd: string }>>
  operationsBinding(taskId: string): Promise<RemoteResult<{ readonly serverId: string; readonly cwd: string } | null>>
  takeTerminalUiRequest(taskId: string): Promise<RemoteResult<{ readonly open: boolean }>>
  terminalList(taskId: string): Promise<RemoteResult<readonly string[]>>
  terminalOpen(taskId: string, cols: number, rows: number, signal?: AbortSignal): Promise<RemoteResult<{ readonly terminalId: string }>>
  terminalPoll(taskId: string, terminalId: string, offset: number, signal?: AbortSignal): Promise<RemoteResult<LingServerTerminalSnapshot>>
  terminalWrite(taskId: string, terminalId: string, data: string, signal?: AbortSignal): Promise<RemoteResult<{ readonly ok: true }>>
  terminalResize(taskId: string, terminalId: string, cols: number, rows: number, signal?: AbortSignal): Promise<RemoteResult<{ readonly ok: true }>>
  terminalClose(taskId: string, terminalId: string, signal?: AbortSignal): Promise<RemoteResult<{ readonly ok: true }>>
  filesList(taskId: string, path: string, signal?: AbortSignal): Promise<RemoteResult<LingServerFilesDirectory>>
  filesRead(taskId: string, path: string, signal?: AbortSignal): Promise<RemoteResult<LingServerTextFile>>
  filesSave(taskId: string, path: string, text: string, expectedSha256: string | null, signal?: AbortSignal): Promise<RemoteResult<{ readonly path: string; readonly sha256: string }>>
  gitRequest(taskId: string, request: LingGitRequest, signal?: AbortSignal): Promise<RemoteResult<LingGitResult>>
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteNamespaceMap { lingServers: LingServersRemote }
  interface TypertRemoteMap {
    'lingServers/executions': LingServersRemote['executions']
    'lingServers/list': LingServersRemote['list']
    'lingServers/add': LingServersRemote['add']
    'lingServers/configure': LingServersRemote['configure']
    'lingServers/forget': LingServersRemote['forget']
    'lingServers/probe': LingServersRemote['probe']
    'lingServers/directories': LingServersRemote['directories']
    'lingServers/bindTask': LingServersRemote['bindTask']
    'lingServers/taskBinding': LingServersRemote['taskBinding']
    'lingServers/attachOperations': LingServersRemote['attachOperations']
    'lingServers/operationsBinding': LingServersRemote['operationsBinding']
    'lingServers/takeTerminalUiRequest': LingServersRemote['takeTerminalUiRequest']
    'lingServers/terminalList': LingServersRemote['terminalList']
    'lingServers/terminalOpen': LingServersRemote['terminalOpen']
    'lingServers/terminalPoll': LingServersRemote['terminalPoll']
    'lingServers/terminalWrite': LingServersRemote['terminalWrite']
    'lingServers/terminalResize': LingServersRemote['terminalResize']
    'lingServers/terminalClose': LingServersRemote['terminalClose']
    'lingServers/filesList': LingServersRemote['filesList']
    'lingServers/filesRead': LingServersRemote['filesRead']
    'lingServers/filesSave': LingServersRemote['filesSave']
    'lingServers/gitRequest': LingServersRemote['gitRequest']
  }
}

const codec = (name: string, schema: z.ZodType) => ({ mode: 'strict' as const, typeSymbol: `ling-desktop-host/servers#${name}`, create: () => schema })
const parameter = (method: string, name: string, schema: z.ZodType) => ({ name, wire: name, source: 'json' as const, codec: codec(`${method}:${name}`, schema) })
function descriptor(method: string, parameters: InvocationDescriptor['parameters'], result: z.ZodType, cancellable = false): InvocationDescriptor {
  return {
    id: `ling-desktop-host/servers#lingServers/${method}`, service: 'lingServers', namespace: 'lingServers', method,
    invocation: { kind: 'direct' }, parameters,
    ...(cancellable ? { cancellation: { parameter: 'signal' as const } } : {}),
    result: codec(`${method}:result`, result),
  }
}
const executionSchema: z.ZodType<LingServerExecution> = z.object({
  callId: z.string(), summary: z.string(), server: z.string(), cwd: z.string(), command: z.string(), output: z.string(),
  status: z.enum(['running', 'completed', 'failed', 'interrupted']), exitCode: z.number().int().optional(), error: z.string().optional(),
}).strict()
const descriptors: readonly InvocationDescriptor[] = [
  descriptor('executions', [parameter('executions', 'taskId', z.string().min(1).max(128)), parameter('executions', 'callIds', z.array(z.string().min(1).max(256)).max(256))], z.array(executionSchema)),
  descriptor('list', [], z.array(serverSchema)),
  descriptor('add', [parameter('add', 'input', serverInputSchema)], serverSchema),
  descriptor('configure', [parameter('configure', 'id', z.string().uuid()), parameter('configure', 'input', serverInputSchema)], serverSchema),
  descriptor('forget', [parameter('forget', 'id', z.string().uuid())], z.object({ ok: z.literal(true) }).strict()),
  descriptor('probe', [parameter('probe', 'id', z.string().uuid())], z.object({ home: z.string().startsWith('/') }).strict(), true),
  descriptor('directories', [parameter('directories', 'id', z.string().uuid()), parameter('directories', 'path', z.string().startsWith('/').max(4096))], z.object({ path: z.string(), directories: z.array(directorySchema) }).strict(), true),
  descriptor('bindTask', [parameter('bindTask', 'taskId', z.string().min(1).max(128)), parameter('bindTask', 'serverId', z.string().uuid()), parameter('bindTask', 'home', z.string().startsWith('/').max(4096))], z.object({ serverId: z.string().uuid(), cwd: z.string() }).strict()),
  descriptor('taskBinding', [parameter('taskBinding', 'taskId', z.string().min(1).max(128))], z.object({ serverId: z.string().uuid(), cwd: z.string() }).strict().nullable()),
  descriptor('attachOperations', [parameter('attachOperations', 'taskId', z.string().min(1).max(128)), parameter('attachOperations', 'serverId', z.string().uuid()), parameter('attachOperations', 'home', z.string().startsWith('/').max(4096))], z.object({ serverId: z.string().uuid(), cwd: z.string() }).strict()),
  descriptor('operationsBinding', [parameter('operationsBinding', 'taskId', z.string().min(1).max(128))], z.object({ serverId: z.string().uuid(), cwd: z.string() }).strict().nullable()),
  descriptor('takeTerminalUiRequest', [parameter('takeTerminalUiRequest', 'taskId', z.string().min(1).max(128))], z.object({ open: z.boolean() }).strict()),
  descriptor('terminalList', [parameter('terminalList', 'taskId', z.string().min(1).max(128))], z.array(z.string().uuid())),
  descriptor('terminalOpen', [parameter('terminalOpen', 'taskId', z.string().min(1).max(128)), parameter('terminalOpen', 'cols', z.number().int().min(2).max(500)), parameter('terminalOpen', 'rows', z.number().int().min(1).max(200))], z.object({ terminalId: z.string().uuid() }).strict(), true),
  descriptor('terminalPoll', [parameter('terminalPoll', 'taskId', z.string().min(1).max(128)), parameter('terminalPoll', 'terminalId', z.string().uuid()), parameter('terminalPoll', 'offset', z.number().int().min(0))], z.object({ terminalId: z.string().uuid(), offset: z.number().int().min(0), data: z.string(), closed: z.boolean(), truncated: z.boolean().optional(), exitCode: z.number().int().optional(), error: z.string().optional() }).strict(), true),
  descriptor('terminalWrite', [parameter('terminalWrite', 'taskId', z.string().min(1).max(128)), parameter('terminalWrite', 'terminalId', z.string().uuid()), parameter('terminalWrite', 'data', z.string().max(64 * 1024))], z.object({ ok: z.literal(true) }).strict(), true),
  descriptor('terminalResize', [parameter('terminalResize', 'taskId', z.string().min(1).max(128)), parameter('terminalResize', 'terminalId', z.string().uuid()), parameter('terminalResize', 'cols', z.number().int().min(2).max(500)), parameter('terminalResize', 'rows', z.number().int().min(1).max(200))], z.object({ ok: z.literal(true) }).strict(), true),
  descriptor('terminalClose', [parameter('terminalClose', 'taskId', z.string().min(1).max(128)), parameter('terminalClose', 'terminalId', z.string().uuid())], z.object({ ok: z.literal(true) }).strict(), true),
  descriptor('filesList', [parameter('filesList', 'taskId', z.string().min(1).max(128)), parameter('filesList', 'path', z.string().max(4096))], z.object({ path: z.string(), entries: z.array(z.object({ name: z.string(), type: z.enum(['directory', 'file', 'other']) }).strict()) }).strict(), true),
  descriptor('filesRead', [parameter('filesRead', 'taskId', z.string().min(1).max(128)), parameter('filesRead', 'path', z.string().min(1).max(4096))], z.object({ path: z.string(), text: z.string(), sha256: z.string().regex(/^[a-f0-9]{64}$/), truncated: z.boolean() }).strict(), true),
  descriptor('filesSave', [parameter('filesSave', 'taskId', z.string().min(1).max(128)), parameter('filesSave', 'path', z.string().min(1).max(4096)), parameter('filesSave', 'text', z.string()), parameter('filesSave', 'expectedSha256', z.string().regex(/^[a-f0-9]{64}$/).nullable())], z.object({ path: z.string(), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict(), true),
  descriptor('gitRequest', [parameter('gitRequest', 'taskId', z.string().min(1).max(128)), parameter('gitRequest', 'request', gitRequestSchema)], gitResultSchema, true),
]
export const LING_SERVERS_REMOTE: TypertRemoteContribution = { package: 'ling-desktop-host/servers', descriptors }
export const LING_SERVERS_HOST: TypertContribution = {
  package: 'ling-desktop-host/servers', face: 'host', schemas: [], invocations: descriptors,
  model: { services: [{ key: 'lingServers', exportName: 'LingServersController', summary: 'LING server inventory and task-scoped SSH operations.', tags: [], members: [], types: [] }], events: [], objects: [] },
}
