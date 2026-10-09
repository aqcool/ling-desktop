import { z } from 'zod'
import type { InvocationDescriptor, RemoteResult, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import type { TypertContribution } from '@deepseek-ai/dsh-typert-registry'
import type { LingEvolutionSuggestion } from 'ling-desktop/runtime'

export const evolutionTaskId = z.string().min(1).max(128)
export const evolutionMutation = z.object({ taskId: evolutionTaskId, id: z.string().min(1).max(128), version: z.number().int().positive() }).strict()
export type EvolutionMutation = z.infer<typeof evolutionMutation>
const suggestion = z.object({
  id: z.string(), name: z.string(), description: z.string(), version: z.number().int().positive(), createdAt: z.number(),
  source: z.object({ taskId: evolutionTaskId, throughSeq: z.number().int().nonnegative(), seqs: z.array(z.number().int().nonnegative()) }).strict(),
}).strict()
export interface LingEvolutionRemote {
  list(taskId: string, signal?: AbortSignal): Promise<RemoteResult<readonly LingEvolutionSuggestion[]>>
  create(request: EvolutionMutation): Promise<RemoteResult<{ completed: true }>>
  ignore(request: EvolutionMutation): Promise<RemoteResult<{ completed: true }>>
}
declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    'evolution/unavailable': Record<string, never>
    'evolution/not-found': Record<string, never>
    'evolution/conflict': Record<string, never>
    'evolution/invalid-name': Record<string, never>
    'evolution/permission-denied': Record<string, never>
  }
  interface TypertRemoteNamespaceMap { lingEvolution: LingEvolutionRemote }
  interface TypertRemoteMap {
    'lingEvolution/list': LingEvolutionRemote['list']
    'lingEvolution/create': LingEvolutionRemote['create']
    'lingEvolution/ignore': LingEvolutionRemote['ignore']
  }
}
const codec = (name: string, schema: z.ZodType) => ({ mode: 'strict' as const, typeSymbol: `ling-desktop-host/evolution#${name}`, create: () => schema })
const descriptors: readonly InvocationDescriptor[] = [
  {
    id: 'ling-desktop-host/evolution#lingEvolution/list', service: 'lingEvolution', namespace: 'lingEvolution', method: 'list', invocation: { kind: 'direct' },
    parameters: [{ name: 'taskId', wire: 'taskId', source: 'json', codec: codec('taskId', evolutionTaskId) }],
    cancellation: { parameter: 'signal' }, result: codec('suggestions', z.array(suggestion)),
  },
  ...(['create', 'ignore'] as const).map(method => ({
    id: `ling-desktop-host/evolution#lingEvolution/${method}`, service: 'lingEvolution', namespace: 'lingEvolution', method, invocation: { kind: 'direct' as const },
    parameters: [{ name: 'request', wire: 'request', source: 'json' as const, codec: codec('mutation', evolutionMutation) }],
    result: codec('completed', z.object({ completed: z.literal(true) }).strict()),
  })),
]
export const LING_EVOLUTION_REMOTE: TypertRemoteContribution = { package: 'ling-desktop-host/evolution', descriptors }
export const LING_EVOLUTION_HOST: TypertContribution = { package: 'ling-desktop-host/evolution', face: 'host', schemas: [], invocations: descriptors,
  model: { services: [{ key: 'lingEvolution', exportName: 'LingEvolutionController', summary: 'Saved skill proposals derived from completed local task evidence.', tags: [], members: [], types: [] }], events: [], objects: [] } }
