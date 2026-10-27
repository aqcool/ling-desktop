import { z } from 'zod'

const path = z.string().min(1).max(4096).refine(value => !/[\0\r\n]/u.test(value), '路径无效')
export const serverCopyOptionsSchema = z.object({
  source: path,
  destination: path.refine(value => value.startsWith('/') && value !== '/', '目标必须是远端绝对路径'),
  method: z.enum(['auto', 'sftp', 'rsync']).default('auto'),
  overwrite: z.enum(['replace', 'skip', 'error']).default('replace'),
  exclude: z.array(z.string().min(1).max(1024).refine(value => !/[\0\r\n]/u.test(value))).max(128).default([]),
  dryRun: z.boolean().default(false),
  checksum: z.boolean().default(false),
  concurrency: z.number().int().min(1).max(8).default(4),
}).strict()
export const serverCopyRequestSchema = serverCopyOptionsSchema.extend({
  root: path,
  allowOutsideWorkspace: z.boolean(),
})
export type ServerCopyOptions = z.input<typeof serverCopyOptionsSchema>
export type ServerCopyRequest = z.infer<typeof serverCopyRequestSchema>

export const serverCopyResultSchema = z.object({
  source: path, destination: path, method: z.enum(['sftp', 'rsync']), dryRun: z.boolean(),
  files: z.number().int().nonnegative(), copied: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(), bytes: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative(), changes: z.array(z.string().max(8192)).max(100),
  truncated: z.boolean(),
}).strict()
export type ServerCopyResult = z.infer<typeof serverCopyResultSchema>
