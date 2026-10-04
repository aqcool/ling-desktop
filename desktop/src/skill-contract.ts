import type { InvocationDescriptor, RemoteResult, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import type { TypertContribution } from '@deepseek-ai/dsh-typert-registry'
import type { LingSkill } from 'ling-desktop/runtime'
import { z } from 'zod'

export interface LingSkillsRemote {
  list(workspaceId: string | null, agentPreset: string | null, signal?: AbortSignal): Promise<RemoteResult<readonly LingSkill[]>>
}
declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteNamespaceMap { lingSkills: LingSkillsRemote }
  interface TypertRemoteMap { 'lingSkills/list': LingSkillsRemote['list'] }
}
const codec = (name: string, schema: z.ZodType) => ({ mode: 'strict' as const, typeSymbol: `ling-desktop-host/skills#skills:${name}`, create: () => schema })
const descriptors: readonly InvocationDescriptor[] = [{
  id: 'ling-desktop-host/skills#lingSkills/list', service: 'lingSkills', namespace: 'lingSkills', method: 'list',
  invocation: { kind: 'direct' },
  parameters: ['workspaceId', 'agentPreset'].map(name => ({ name, wire: name, source: 'json' as const, codec: codec(name, z.string().min(1).nullable()) })),
  cancellation: { parameter: 'signal' },
  result: codec('result', z.array(z.object({ name: z.string(), description: z.string(), path: z.string().optional(), whenToUse: z.string().optional(), modelInvocable: z.boolean() }).strict())),
}]
export const LING_SKILLS_REMOTE: TypertRemoteContribution = { package: 'ling-desktop-host/skills', descriptors }
export const LING_SKILLS_HOST: TypertContribution = {
  package: 'ling-desktop-host/skills', face: 'host', schemas: [], invocations: descriptors,
  model: { services: [{ key: 'lingSkills', exportName: 'LingSkillsController', summary: 'Draft workspace skill catalog.', tags: [], members: [], types: [] }], events: [], objects: [] },
}
