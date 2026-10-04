import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-file-upload'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { PromptContentPart } from '@deepseek-ai/dsh-api-session-controller'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { LING_MESSAGE_ACTIONS_HOST, recordedAttachmentsRequest, type RecordedAttachmentsRequest } from '../message-actions-contract.ts'

declare module '@deepseek-ai/cordis' { interface Context { lingMessageActions: LingMessageActionsController } }

/** Only prepare references owned by this session; sending stays in the normal client pipeline. */
export async function prepareRecordedAttachments(ctx: Context, input: RecordedAttachmentsRequest): Promise<PromptContentPart[]> {
  const request = recordedAttachmentsRequest.parse(input)
  const sessionId = SessionId(request.taskId)
  const history = await ctx.sessionController.inspect(sessionId)
  const original = history.events.find(event => event.seq === request.seq && event.type === 'user/message')
  if (!original || original.type !== 'user/message' || original.data.source.kind !== 'user') throw new Error('找不到原消息。')
  const originalAttachments = original.data.content.filter(part => (part.type === 'file' || part.type === 'image') && request.attachmentIds.includes(part.attachment.attachmentId))
  if (request.attachmentIds.some(id => !originalAttachments.some(part => (part.type === 'file' || part.type === 'image') && part.attachment.attachmentId === id))) throw new Error('找不到原附件。')
  const content: PromptContentPart[] = []
  for (const part of originalAttachments) {
    if (part.type === 'image') {
      const image = await ctx.attachments.readImage(part.attachment)
      content.push({ type: 'image', mediaType: image.ref.mediaType, data: Buffer.from(image.data).toString('base64'), ...(part.attachment.name ? { name: part.attachment.name } : {}) })
    } else if (part.type === 'file') {
      const file = await ctx.fileUploads.uploadStream({ sessionId, data: ctx.attachments.readFileStream(part.attachment), ...(part.attachment.name ? { name: part.attachment.name } : {}) })
      content.push({ type: 'file', receiptId: file.receiptId })
    }
  }
  return content
}

export class LingMessageActionsController extends TypertRemoteService {
  static inject = ['sessionController', 'attachments', 'fileUploads', 'typert']
  constructor(ctx: Context) { super(ctx, 'lingMessageActions'); ctx.effect(() => ctx.typert.register(LING_MESSAGE_ACTIONS_HOST), 'LING recorded attachments Remote') }
  async prepareAttachments(request: RecordedAttachmentsRequest) { return await prepareRecordedAttachments(this.ctx, request) }
}
const prototype = LingMessageActionsController.prototype
const receiver = Object.create(prototype) as LingMessageActionsController
const decorate = Remote as unknown as (implementation: (...args: never[]) => unknown, context: { name: string; private: boolean; static: boolean; addInitializer(initializer: (this: LingMessageActionsController) => void): void }) => void
decorate(prototype.prepareAttachments as (...args: never[]) => unknown, { name: 'prepareAttachments', private: false, static: false, addInitializer(initializer) { initializer.call(receiver) } })
