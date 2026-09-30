import { z } from 'zod'
import type { InvocationDescriptor, RemoteResult, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import type { TypertContribution } from '@deepseek-ai/dsh-typert-registry'
import type { PromptContentPart } from '@deepseek-ai/dsh-api-session-controller'

export const recordedAttachmentsRequest = z.object({ taskId: z.string().min(1).max(128), seq: z.number().int().nonnegative(), attachmentIds: z.array(z.string()).max(128) }).strict()
export type RecordedAttachmentsRequest = z.infer<typeof recordedAttachmentsRequest>
const content = z.array(z.discriminatedUnion('type', [
  z.object({ type: z.literal('image'), mediaType: z.enum(['image/png', 'image/jpeg', 'image/gif', 'image/webp']), data: z.string(), name: z.string().optional() }).strict(),
  z.object({ type: z.literal('file'), receiptId: z.string() }).strict(),
]))
export interface LingMessageActionsRemote { prepareAttachments(request: RecordedAttachmentsRequest): Promise<RemoteResult<PromptContentPart[]>> }
const codec = (name: string, schema: z.ZodType) => ({ mode: 'strict' as const, typeSymbol: `ling-desktop-host/messages#${name}`, create: () => schema })
const descriptors: readonly InvocationDescriptor[] = [{
  id: 'ling-desktop-host/messages#lingMessageActions/prepareAttachments', service: 'lingMessageActions', namespace: 'lingMessageActions', method: 'prepareAttachments', invocation: { kind: 'direct' },
  parameters: [{ name: 'request', wire: 'request', source: 'json', codec: codec('request', recordedAttachmentsRequest) }], result: codec('result', content),
}]
export const LING_MESSAGE_ACTIONS_REMOTE: TypertRemoteContribution = { package: 'ling-desktop-host/messages', descriptors }
export const LING_MESSAGE_ACTIONS_HOST: TypertContribution = { package: 'ling-desktop-host/messages', face: 'host', schemas: [], invocations: descriptors,
  model: { services: [{ key: 'lingMessageActions', exportName: 'LingMessageActionsController', summary: 'Prepare recorded attachments for normal prompt submission.', tags: [], members: [], types: [] }], events: [], objects: [] } }
