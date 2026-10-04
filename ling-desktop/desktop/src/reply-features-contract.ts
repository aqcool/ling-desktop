import { z } from 'zod'
import type { InvocationDescriptor, RemoteResult, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import type { TypertContribution } from '@deepseek-ai/dsh-typert-registry'

export const suggestionsRequest = z.object({ taskId: z.string().min(1).max(128), seq: z.number().int().nonnegative() }).strict()
export type SuggestionsRequest = z.infer<typeof suggestionsRequest>
export interface LingReplyRemote {
  suggestions(request: SuggestionsRequest, signal?: AbortSignal): Promise<RemoteResult<string[]>>
}
declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteNamespaceMap { lingReply: LingReplyRemote }
  interface TypertRemoteMap { 'lingReply/suggestions': LingReplyRemote['suggestions'] }
}
const codec = (name: string, schema: z.ZodType) => ({ mode: 'strict' as const, typeSymbol: `ling-desktop-host/reply#${name}`, create: () => schema })
const descriptors: readonly InvocationDescriptor[] = [{
  id: 'ling-desktop-host/reply#lingReply/suggestions', service: 'lingReply', namespace: 'lingReply', method: 'suggestions', invocation: { kind: 'direct' },
  parameters: [{ name: 'request', wire: 'request', source: 'json', codec: codec('request', suggestionsRequest) }],
  cancellation: { parameter: 'signal' }, result: codec('result', z.array(z.string().min(1).max(120)).max(3)),
}]
export const LING_REPLY_REMOTE: TypertRemoteContribution = { package: 'ling-desktop-host/reply', descriptors }
export const LING_REPLY_HOST: TypertContribution = { package: 'ling-desktop-host/reply', face: 'host', schemas: [], invocations: descriptors,
  model: { services: [{ key: 'lingReply', exportName: 'LingReplyController', summary: 'Generate optional next questions without changing the conversation.', tags: [], members: [], types: [] }], events: [], objects: [] } }
