import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-file-upload'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { PromptContentPart } from '@deepseek-ai/dsh-api-session-controller'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { LING_MESSAGE_ACTIONS_HOST, recordedAttachmentsRequest, withdrawQueueRequest, reorderQueueRequest, type RecordedAttachmentsRequest, type WithdrawQueueRequest, type ReorderQueueRequest } from '../message-actions-contract.ts'
import type { LingWithdrawnMessage } from 'ling-desktop/runtime'
import type {} from '../session-lifecycle.ts'

declare module '@deepseek-ai/cordis' { interface Context { lingMessageActions: LingMessageActionsController } }

/** Only prepare references owned by this session; sending stays in the normal client pipeline. */
export async function prepareRecordedAttachments(ctx: Context, input: RecordedAttachmentsRequest): Promise<PromptContentPart[]> {
  const request = recordedAttachmentsRequest.parse(input)
  const sessionId = SessionId(request.taskId)
  const history = await ctx.sessionController.inspect(sessionId)
  const original = history.events.find(event => event.seq === request.seq)
  const messages = original?.type === 'user/message' ? [original.data]
    : original?.type === 'agent/inbox/spliced' ? original.data.inserted : []
  const owned = messages.filter(message => message.source.kind === 'user')
  if (!owned.length) throw new Error('找不到原消息。')
  const originalAttachments = owned.flatMap(message => message.content).filter(part => (part.type === 'file' || part.type === 'image') && request.attachmentIds.includes(part.attachment.attachmentId))
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

/** Validate the live occurrence after async reads; consumed messages must never return to the composer. */
export async function withdrawQueuedMessage(ctx: Context, input: WithdrawQueueRequest): Promise<LingWithdrawnMessage> {
  const request = withdrawQueueRequest.parse(input)
  const sessionId = SessionId(request.taskId)
  if (!ctx.agents.get(sessionId)) await ctx.sessionController.resolveAgent(sessionId)
  const agent = ctx.agents.get(sessionId)
  if (!agent) throw new Error('找不到会话。')
  const history = await ctx.sessionController.inspect(sessionId)
  const message = agent.inbox.nextTurn.find(item => String(item.id) === request.itemId && item.source.kind === 'user')
  if (!message) throw new Error('消息已开始执行或已移除，无法撤回。')
  const attachments = message.content.flatMap(part => part.type === 'file' || part.type === 'image' ? [{
    attachmentId: String(part.attachment.attachmentId), kind: part.type, name: part.attachment.name || (part.type === 'image' ? '图片' : '文件'),
    bytes: part.attachment.bytes, ...(part.type === 'image' ? { mediaType: part.attachment.mediaType } : {}),
  }] : [])
  const source = history.events.findLast(event => event.type === 'agent/inbox/spliced' && event.data.inserted.some(item => item.id === message.id && item.source.kind === 'user'))
  if (attachments.length && !source) throw new Error('无法保留原附件，消息仍在队列中。')
  // The loaded Agent is synchronously mutated by the upstream controller. This
  // retires the old RPC without deleting the durable session attachment facts.
  await ctx.sessionController.updateQueue({ sessionId, itemId: message.id, action: { kind: 'remove' } })
  return { text: message.content.flatMap(part => part.type === 'text' ? [part.text] : []).join('\n'),
    ...(attachments.length && source ? { recordedAttachments: { seq: Number(source.seq), attachments } } : {}) }
}

/** Reorder one durable Inbox splice, preserving every non-user occurrence in place. */
export async function reorderQueuedMessages(ctx: Context, input: ReorderQueueRequest): Promise<{ accepted: true }> {
  const request = reorderQueueRequest.parse(input)
  const sessionId = SessionId(request.taskId)
  if (!ctx.agents.get(sessionId)) await ctx.sessionController.resolveAgent(sessionId)
  const agent = ctx.agents.get(sessionId)
  if (!agent) throw new Error('找不到会话。')
  const queue = agent.inbox.nextTurn
  const users = queue.filter(item => item.source.kind === 'user')
  if (new Set(request.itemIds).size !== request.itemIds.length || users.length !== request.itemIds.length
    || request.itemIds.some(id => !users.some(item => String(item.id) === id))) throw new Error('队列已变化，请按最新队列重新排序。')
  const order = request.itemIds.map(id => users.find(item => String(item.id) === id)!)
  let index = 0
  const updated = queue.map(item => item.source.kind === 'user' ? order[index++]! : item)
  if (updated.some((item, position) => item !== queue[position])) agent.inbox.splice('next-turn', 0, queue.length, updated)
  return { accepted: true }
}

export class LingMessageActionsController extends TypertRemoteService {
  private readonly withdrawals = new Map<string, { result: Promise<LingWithdrawnMessage>; settled: boolean }>()
  static inject = ['sessionController', 'agents', 'attachments', 'fileUploads', 'typert', 'lingSessionLifecycle']
  constructor(ctx: Context) { super(ctx, 'lingMessageActions'); ctx.effect(() => ctx.typert.register(LING_MESSAGE_ACTIONS_HOST), 'LING recorded attachments Remote') }
  async prepareAttachments(request: RecordedAttachmentsRequest) { return await prepareRecordedAttachments(this.ctx, request) }
  async withdrawQueue(request: WithdrawQueueRequest) {
    withdrawQueueRequest.parse(request)
    const key = JSON.stringify([request.taskId, request.itemId])
    const existing = this.withdrawals.get(key)
    if (existing) {
      await this.ctx.sessionController.inspect(SessionId(request.taskId))
      return await existing.result
    }
    // Replaying a lost acknowledgement returns the same withdrawn occurrence;
    // it never removes another item or admits a new prompt.
    if (this.withdrawals.size >= 64) {
      const settled = [...this.withdrawals].find(([, value]) => value.settled)
      if (settled) this.withdrawals.delete(settled[0])
    }
    const entry = { result: this.ctx.lingSessionLifecycle.withSessionOperation(SessionId(request.taskId), () => withdrawQueuedMessage(this.ctx, request)), settled: false }
    this.withdrawals.set(key, entry)
    try { const result = await entry.result; entry.settled = true; return result }
    catch (error) { this.withdrawals.delete(key); throw error }
  }
  async reorderQueue(request: ReorderQueueRequest) { return await this.ctx.lingSessionLifecycle.withSessionOperation(SessionId(request.taskId), () => reorderQueuedMessages(this.ctx, request)) }
}
const prototype = LingMessageActionsController.prototype
const receiver = Object.create(prototype) as LingMessageActionsController
const decorate = Remote as unknown as (implementation: (...args: never[]) => unknown, context: { name: string; private: boolean; static: boolean; addInitializer(initializer: (this: LingMessageActionsController) => void): void }) => void
for (const name of ['prepareAttachments', 'withdrawQueue', 'reorderQueue'] as const) {
  decorate(prototype[name] as (...args: never[]) => unknown, { name, private: false, static: false, addInitializer(initializer) { initializer.call(receiver) } })
}
