import { z } from 'zod'

/** Non-secret connection identity used to pin an admitted operation to its endpoint. */
export function serverEndpoint(server: { readonly alias: string; readonly port?: number; readonly user?: string }): string {
  return `${server.alias.toLowerCase()}:${server.port ?? 22}:${server.user ?? ''}`
}

// Shared with the browser-side RPC contract; keep this module free of Node APIs.
export const serverCwdSchema = z.string().min(1).max(4096).refine(value => value.startsWith('/')
  && !value.includes('\0') && !value.includes('//') && (value === '/' || !value.endsWith('/'))
  && value.split('/').every(segment => segment !== '.' && segment !== '..'), '远端目录无效。')
export const taskServersSchema = z.object({
  revision: z.number().int().nonnegative(),
  developmentServerId: z.string().uuid().optional(),
  servers: z.array(z.object({ serverId: z.string().uuid(), cwd: serverCwdSchema.optional() }).strict()).max(200),
}).strict().refine(value => new Set(value.servers.map(item => item.serverId)).size === value.servers.length, '服务器不能重复。')
  .refine(value => value.developmentServerId === undefined || value.servers.some(item => item.serverId === value.developmentServerId), '主开发服务器必须已关联。')
export const taskServersUpdateSchema = z.object({
  expectedRevision: z.number().int().nonnegative(), serverIds: z.array(z.string().uuid()).max(200), developmentServerId: z.string().uuid().optional(),
}).strict().refine(value => new Set(value.serverIds).size === value.serverIds.length, '服务器不能重复。')
  .refine(value => value.developmentServerId === undefined || value.serverIds.includes(value.developmentServerId), '主开发服务器必须已关联。')
