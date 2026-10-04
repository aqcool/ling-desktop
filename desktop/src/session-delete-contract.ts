import { z } from 'zod'
import type { InvocationDescriptor, RemoteResult, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import type { TypertContribution } from '@deepseek-ai/dsh-typert-registry'
export const deleteSessionRequest = z.object({ taskId: z.string().min(1).max(128) }).strict()
export type DeleteSessionRequest = z.infer<typeof deleteSessionRequest>
export interface LingSessionDeleteRemote { deleteArchived(request: DeleteSessionRequest): Promise<RemoteResult<{ deleted: true }>> }
const codec = (name: string, schema: z.ZodType) => ({ mode: 'strict' as const, typeSymbol: `ling-desktop-host/session-delete#${name}`, create: () => schema })
const descriptors: readonly InvocationDescriptor[] = [{
  id: 'ling-desktop-host/session-delete#lingSessionDelete/deleteArchived', service: 'lingSessionDelete', namespace: 'lingSessionDelete', method: 'deleteArchived', invocation: { kind: 'direct' },
  parameters: [{ name: 'request', wire: 'request', source: 'json', codec: codec('request', deleteSessionRequest) }], result: codec('result', z.object({ deleted: z.literal(true) }).strict()),
}]
export const LING_SESSION_DELETE_REMOTE: TypertRemoteContribution = { package: 'ling-desktop-host/session-delete', descriptors }
export const LING_SESSION_DELETE_HOST: TypertContribution = { package: 'ling-desktop-host/session-delete', face: 'host', schemas: [], invocations: descriptors,
  model: { services: [{ key: 'lingSessionDelete', exportName: 'LingSessionDeleteController', summary: 'Delete one idle archived session from the local LING profile.', tags: [], members: [], types: [] }], events: [], objects: [] } }
