import { z } from 'zod'
import type { InvocationDescriptor, RemoteResult, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import type { TypertContribution } from '@deepseek-ai/dsh-typert-registry'
import type { PromptContentPart } from '@deepseek-ai/dsh-api-session-controller'
import type { LingWithdrawnMessage } from 'ling-desktop/runtime'

export const recordedAttachmentsRequest = z.object({ taskId: z.string().min(1).max(128), seq: z.number().int().nonnegative(), attachmentIds: z.array(z.string()).max(128) }).strict()
export type RecordedAttachmentsRequest = z.infer<typeof recordedAttachmentsRequest>
const content = z.array(z.discriminatedUnion('type', [
  z.object({ type: z.literal('image'), mediaType: z.enum(['image/png', 'image/jpeg', 'image/gif', 'image/webp']), data: z.string(), name: z.string().optional() }).strict(),
  z.object({ type: z.literal('file'), receiptId: z.string() }).strict(),
]))
export const withdrawQueueRequest = z.object({ taskId: z.string().min(1).max(128), itemId: z.string().min(1).max(128) }).strict()
export const reorderQueueRequest = z.object({ taskId: z.string().min(1).max(128), itemIds: z.array(z.string().min(1).max(128)).min(2).max(256) }).strict()
export type WithdrawQueueRequest = z.infer<typeof withdrawQueueRequest>
export type ReorderQueueRequest = z.infer<typeof reorderQueueRequest>
const withdrawn = z.object({ text: z.string(), recordedAttachments: z.object({ seq: z.number().int().nonnegative(), attachments: z.array(z.object({
  attachmentId: z.string(), kind: z.enum(['file', 'image']), name: z.string(), bytes: z.number().optional(), mediaType: z.string().optional(),
}).strict()) }).strict().optional() }).strict()
export interface LingMessageActionsRemote {
  prepareAttachments(request: RecordedAttachmentsRequest): Promise<RemoteResult<PromptContentPart[]>>
  withdrawQueue(request: WithdrawQueueRequest): Promise<RemoteResult<LingWithdrawnMessage>>
  reorderQueue(request: ReorderQueueRequest): Promise<RemoteResult<{ accepted: true }>>
}
const codec = (name: string, schema: z.ZodType) => ({ mode: 'strict' as const, typeSymbol: `ling-desktop-host/messages#${name}`, create: () => schema })
const descriptors: readonly InvocationDescriptor[] = [{
  id: 'ling-desktop-host/messages#lingMessageActions/prepareAttachments', service: 'lingMessageActions', namespace: 'lingMessageActions', method: 'prepareAttachments', invocation: { kind: 'direct' },
  parameters: [{ name: 'request', wire: 'request', source: 'json', codec: codec('request', recordedAttachmentsRequest) }], result: codec('result', content),
}, ...[
  { method: 'withdrawQueue', schema: withdrawQueueRequest, result: withdrawn },
  { method: 'reorderQueue', schema: reorderQueueRequest, result: z.object({ accepted: z.literal(true) }).strict() },
].map(({ method, schema, result }): InvocationDescriptor => ({
  id: `ling-desktop-host/messages#lingMessageActions/${method}`, service: 'lingMessageActions', namespace: 'lingMessageActions', method, invocation: { kind: 'direct' },
  parameters: [{ name: 'request', wire: 'request', source: 'json', codec: codec(`${method}Request`, schema) }], result: codec(`${method}Result`, result),
}))]
export const LING_MESSAGE_ACTIONS_REMOTE: TypertRemoteContribution = { package: 'ling-desktop-host/messages', descriptors }
export const LING_MESSAGE_ACTIONS_HOST: TypertContribution = { package: 'ling-desktop-host/messages', face: 'host', schemas: [], invocations: descriptors,
  model: { services: [{ key: 'lingMessageActions', exportName: 'LingMessageActionsController', summary: 'Prepare recorded attachments for normal prompt submission.', tags: [], members: [], types: [] }], events: [], objects: [] } }
