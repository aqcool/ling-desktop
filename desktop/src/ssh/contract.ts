import { z } from 'zod'
export const remotePolicySchema = z.object({ mode: z.enum(['read-only', 'workspace-write', 'danger-full-access']),
  workspaceRoot: z.string().startsWith('/').max(4096).refine(value => !value.includes('\0')) }).strict()
const path = z.string().startsWith('/').max(4096).refine(value => !value.includes('\0'))
export const remoteFileRequestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('read'), serverId: z.string().uuid(), path, root: path.optional(), maxBytes: z.number().int().min(1).max(512*1024).optional() }).strict(),
  z.object({ action: z.literal('list'), serverId: z.string().uuid(), path, root: path.optional() }).strict(),
  z.object({ action: z.literal('write'), serverId: z.string().uuid(), path, text: z.string(),
    expected: z.string().regex(/^[a-f0-9]{64}$/).nullable(), policy: remotePolicySchema }).strict(),
])
export type RemoteFileRequest = z.infer<typeof remoteFileRequestSchema>
export const remoteFileResultSchema = z.union([
  z.object({ path: z.string(), text: z.string(), sha256: z.string(), truncated: z.literal(false) }).strict(),
  z.object({ path: z.string(), sha256: z.string() }).strict(),
  z.object({ path: z.string(), entries: z.array(z.object({ name: z.string(), type: z.enum(['file', 'directory', 'other']) })) }).strict(),
])
export type RemoteFileResult = z.infer<typeof remoteFileResultSchema>
