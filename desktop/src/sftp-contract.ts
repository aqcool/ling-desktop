import { z } from 'zod'
import type { LingRemoteFileRequest, LingRemoteFileResult } from 'ling-desktop/runtime'

const path = z.string().min(1).max(4096).refine(value => !/[\0\r\n]/u.test(value))
const absolute = path.refine(value => value.startsWith('/'))
export const sftpRequestSchema: z.ZodType<LingRemoteFileRequest> = z.discriminatedUnion('type', [
  z.object({ type: z.literal('list'), path }).strict(),
  z.object({ type: z.literal('read'), path: absolute }).strict(),
  z.object({ type: z.literal('save'), path: absolute, text: z.string().max(2 * 1024 * 1024), version: z.string().regex(/^[a-f0-9]{64}$/u) }).strict(),
  z.object({ type: z.literal('create'), path: absolute, directory: z.boolean() }).strict(),
  z.object({ type: z.literal('rename'), path: absolute, destination: absolute }).strict(),
  z.object({ type: z.literal('delete'), path: absolute, recursive: z.boolean() }).strict(),
  z.object({ type: z.literal('upload'), path: absolute, directory: z.boolean() }).strict(),
  z.object({ type: z.literal('download'), path: absolute }).strict(),
  z.object({ type: z.literal('extract'), path: absolute, destination: absolute }).strict(),
  z.object({ type: z.literal('jobs') }).strict(),
  z.object({ type: z.literal('cancel'), jobId: z.string().uuid() }).strict(),
])
const job = z.object({ id: z.string().uuid(), operation: z.enum(['upload', 'download', 'extract', 'delete']), path: z.string(),
  status: z.enum(['running', 'completed', 'failed', 'cancelled']), phase: z.string(), bytes: z.number().nonnegative(),
  total: z.number().nonnegative().optional(), error: z.string().optional() }).strict()
export const sftpResultSchema: z.ZodType<LingRemoteFileResult> = z.discriminatedUnion('type', [
  z.object({ type: z.literal('directory'), directory: z.object({ path: z.string(), truncated: z.boolean(), entries: z.array(z.object({
    name: z.string(), path: z.string(), kind: z.enum(['file', 'directory', 'other']), bytes: z.number().optional(),
  }).strict()) }).strict() }).strict(),
  z.object({ type: z.literal('document'), document: z.object({ path: z.string(), kind: z.enum(['markdown', 'code', 'text', 'image', 'pdf', 'office', 'unsupported']),
    mediaType: z.string(), text: z.string().optional(), lines: z.number().optional(), truncated: z.boolean().optional(),
    version: z.string().optional(), data: z.string().optional(), bytes: z.number().optional(),
  }).strict() }).strict(),
  z.object({ type: z.literal('saved'), version: z.string().regex(/^[a-f0-9]{64}$/u) }).strict(),
  z.object({ type: z.literal('ok') }).strict(),
  z.object({ type: z.literal('job'), job }).strict(),
  z.object({ type: z.literal('jobs'), jobs: z.array(job).max(64) }).strict(),
])
