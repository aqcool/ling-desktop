import { z } from 'zod'
import type { InvocationDescriptor, RemoteResult, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import type { TypertContribution } from '@deepseek-ai/dsh-typert-registry'
import { hookEvents, type LingHooksRequest, type LingHooksResponse } from 'ling-desktop/runtime'

export const hookEntrySchema = z.object({ id: z.string().min(1).max(128), event: z.enum(hookEvents), command: z.string().trim().min(1).max(32768), matcher: z.string().max(2048), timeoutSec: z.number().int().min(1).max(600), enabled: z.boolean() }).strict()
export const hookSettingsSchema = z.object({ enabled: z.boolean(), dialect: z.enum(['claude-code', 'codex']), entries: z.array(hookEntrySchema).max(100) }).strict()
export const hooksRequestSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('snapshot') }).strict(),
  z.object({ type: z.literal('save'), revision: z.number().int().nonnegative(), settings: hookSettingsSchema }).strict(),
  z.object({ type: z.literal('import'), path: z.string().min(1).max(4096), dialect: z.enum(['claude-code', 'codex']) }).strict(),
])
const snapshotSchema = z.object({ settings: hookSettingsSchema, revision: z.number().int().nonnegative(), configPath: z.string(), scope: z.literal('process'), state: z.enum(['disabled', 'loaded', 'error']), error: z.string().optional(), activeCount: z.number().int().nonnegative(), busy: z.boolean(), history: z.array(z.object({ taskId: z.string(), point: z.string(), handlerId: z.string(), time: z.number(), decision: z.string(), durationMs: z.number(), exitCode: z.number().optional(), stderrSummary: z.string().optional() }).strict()).max(50) }).strict()
const responseSchema = z.object({ snapshot: snapshotSchema.optional(), imported: z.array(hookEntrySchema).optional() }).strict()
export interface LingHooksRemote { request(request: LingHooksRequest, signal?: AbortSignal): Promise<RemoteResult<LingHooksResponse>> }
const descriptors: readonly InvocationDescriptor[] = [{
  id: 'ling-desktop-host/hooks#lingHooks/request', service: 'lingHooks', namespace: 'lingHooks', method: 'request', invocation: { kind: 'direct' },
  parameters: [{ name: 'request', wire: 'request', source: 'json', codec: { mode: 'strict', typeSymbol: 'ling-desktop-host/hooks#LingHooksRequest', create: () => hooksRequestSchema } }],
  cancellation: { parameter: 'signal' },
  result: { mode: 'strict', typeSymbol: 'ling-desktop-host/hooks#LingHooksResponse', create: () => responseSchema },
}]
export const LING_HOOKS_REMOTE: TypertRemoteContribution = { package: 'ling-desktop-host/hooks', descriptors }
export const LING_HOOKS_HOST: TypertContribution = { package: 'ling-desktop-host/hooks', face: 'host', schemas: [], invocations: descriptors, model: { services: [{ key: 'lingHooks', exportName: 'LingHooksController', summary: 'Manage explicitly configured process-wide command hooks through official DSH bridges.', tags: [], members: [], types: [] }], events: [], objects: [] } }
