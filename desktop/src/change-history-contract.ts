import { z } from 'zod'
import type { InvocationDescriptor, RemoteResult, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import type { TypertContribution } from '@deepseek-ai/dsh-typert-registry'

export const changeSummaryRequest = z.object({ taskId: z.string().min(1).max(256), seq: z.number().int().positive() }).strict()
export const changeDiffRequest = changeSummaryRequest.extend({ index: z.number().int().nonnegative() })
const count = z.number().int().nonnegative()
export const savedChangeSummary = z.object({ turn: z.number().int().positive(), workspacePath: z.string().optional(), files: z.array(z.object({
  path: z.string(), display: z.string(), added: count, deleted: count, binary: z.literal(true).optional(), oversized: z.literal(true).optional(),
}).strict()), total: count, added: count, deleted: count }).strict()
export const savedChangeDiff = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), path: z.string(), display: z.string(), before: z.boolean(), after: z.boolean(), coarse: z.boolean(),
    hunks: z.array(z.object({ oldStart: count, oldLines: count, newStart: count, newLines: count, lines: z.array(z.string()) }).strict()) }).strict(),
  z.object({ kind: z.literal('binary'), path: z.string(), display: z.string() }).strict(),
  z.object({ kind: z.literal('oversized'), path: z.string(), display: z.string() }).strict(),
])
export type SavedChangeSummary = z.infer<typeof savedChangeSummary>
export type SavedChangeDiff = z.infer<typeof savedChangeDiff>
export interface LingChangeHistoryRemote {
  summary(request: z.infer<typeof changeSummaryRequest>, signal?: AbortSignal): Promise<RemoteResult<SavedChangeSummary | null>>
  diff(request: z.infer<typeof changeDiffRequest>, signal?: AbortSignal): Promise<RemoteResult<SavedChangeDiff | null>>
}
const codec = (name: string, schema: z.ZodType) => ({ mode: 'strict' as const, typeSymbol: `ling-desktop-host/changes#${name}`, create: () => schema })
const descriptors: readonly InvocationDescriptor[] = [
  { method: 'summary', request: changeSummaryRequest, result: savedChangeSummary.nullable() },
  { method: 'diff', request: changeDiffRequest, result: savedChangeDiff.nullable() },
].map(({ method, request, result }) => ({
  id: `ling-desktop-host/changes#lingChangeHistory/${method}`, service: 'lingChangeHistory', namespace: 'lingChangeHistory', method,
  invocation: { kind: 'direct' }, parameters: [{ name: 'request', wire: 'request', source: 'json', codec: codec(`${method}Request`, request) }],
  cancellation: { parameter: 'signal' }, result: codec(`${method}Result`, result),
}))
export const LING_CHANGE_HISTORY_REMOTE: TypertRemoteContribution = { package: 'ling-desktop-host/changes', descriptors }
export const LING_CHANGE_HISTORY_HOST: TypertContribution = { package: 'ling-desktop-host/changes', face: 'host', schemas: [], invocations: descriptors,
  model: { services: [{ key: 'lingChangeHistory', exportName: 'LingChangeHistoryController', summary: 'Read durable per-turn file changes.', tags: [], members: [], types: [] }], events: [], objects: [] } }
