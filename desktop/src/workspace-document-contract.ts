import { z } from 'zod'
import type { InvocationDescriptor, RemoteResult, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import type { TypertContribution } from '@deepseek-ai/dsh-typert-registry'

export const WORKSPACE_DOCUMENT_MAX_BYTES = 1024 * 1024
const taskScope = z.object({ taskId: z.string().min(1).max(256) })
const workspaceScope = z.object({ workspaceId: z.string().min(1).max(256) })
const path = z.string().min(1).max(4096)
const version = z.string().regex(/^[a-f0-9]{64}$/)
const scoped = <Fields extends z.ZodRawShape>(fields: Fields) => z.union([taskScope.extend(fields).strict(), workspaceScope.extend(fields).strict()])
export const documentReadRequest = scoped({ path })
export const documentSaveRequest = scoped({ path, text: z.string().max(WORKSPACE_DOCUMENT_MAX_BYTES), version })
export const documentListRequest = scoped({ path: z.string().max(4096) })
export type WorkspaceDocumentRequest = z.infer<typeof documentReadRequest>
export interface EditableWorkspaceText { readonly text: string; readonly bytes: number; readonly version: string }
export interface SavedWorkspaceText { readonly version: string }
export interface WorkspaceDirectory { readonly path: string; readonly entries: readonly { readonly name: string; readonly path: string; readonly kind: 'file' | 'directory' | 'other'; readonly bytes?: number }[]; readonly truncated: boolean }
export interface LingWorkspaceDocumentsRemote {
  list(request: z.infer<typeof documentListRequest>, signal?: AbortSignal): Promise<RemoteResult<WorkspaceDirectory>>
  read(request: z.infer<typeof documentReadRequest>, signal?: AbortSignal): Promise<RemoteResult<EditableWorkspaceText>>
  save(request: z.infer<typeof documentSaveRequest>, signal?: AbortSignal): Promise<RemoteResult<SavedWorkspaceText>>
}
declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    'ling-document/conflict': { path: string }
    'ling-document/readonly': { path: string }
    'ling-document/too-large': { maxBytes: number }
    'ling-document/not-text': { path: string }
    'ling-document/not-found': { path: string }
    'ling-document/task-not-found': { taskId: string }
    'ling-document/workspace-not-found': { workspaceId: string }
    'ling-document/permission-denied': { path: string }
    'ling-document/aborted': Record<string, never>
    'ling-document/unavailable': Record<string, never>
  }
}
const textSchema = z.object({ text: z.string().max(WORKSPACE_DOCUMENT_MAX_BYTES), bytes: z.number().int().nonnegative().max(WORKSPACE_DOCUMENT_MAX_BYTES), version: z.string().regex(/^[a-f0-9]{64}$/) }).strict()
const saveSchema = z.object({ version: z.string().regex(/^[a-f0-9]{64}$/) }).strict()
const directorySchema = z.object({ path: z.string(), entries: z.array(z.object({ name: z.string(), path: z.string(), kind: z.enum(['file', 'directory', 'other']), bytes: z.number().nonnegative().optional() }).strict()).max(2000), truncated: z.boolean() }).strict()
const codec = (name: string, schema: z.ZodType) => ({ mode: 'strict' as const, typeSymbol: `ling-desktop-host/workspace-documents#${name}`, create: () => schema })
const descriptors: readonly InvocationDescriptor[] = ['read', 'save', 'list'].map(method => ({
  id: `ling-desktop-host/workspace-documents#lingWorkspaceDocuments/${method}`, service: 'lingWorkspaceDocuments', namespace: 'lingWorkspaceDocuments', method,
  invocation: { kind: 'direct' }, parameters: [{ name: 'request', wire: 'request', source: 'json', codec: codec(`${method}Request`, method === 'read' ? documentReadRequest : method === 'save' ? documentSaveRequest : documentListRequest) }], cancellation: { parameter: 'signal' }, result: codec(`${method}Result`, method === 'read' ? textSchema : method === 'save' ? saveSchema : directorySchema),
}))
export const LING_WORKSPACE_DOCUMENTS_REMOTE: TypertRemoteContribution = { package: 'ling-desktop-host/workspace-documents', descriptors }
export const LING_WORKSPACE_DOCUMENTS_HOST: TypertContribution = { package: 'ling-desktop-host/workspace-documents', face: 'host', schemas: [], invocations: descriptors,
  model: { services: [{ key: 'lingWorkspaceDocuments', exportName: 'LingWorkspaceDocumentsController', summary: 'Read complete bounded UTF-8 workspace documents and save explicit human edits with optimistic versions.', tags: [], members: [], types: [] }], events: [], objects: [] } }
