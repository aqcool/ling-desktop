import { Context } from '@deepseek-ai/cordis'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import TypertGatewayService from '@deepseek-ai/dsh-api-gateway'
import { describe, expect, it, vi } from 'vitest'
import { LingMessageActionsController, prepareRecordedAttachments } from '../src/host/message-actions-controller.ts'
import { recordedAttachmentsRequest } from '../src/message-actions-contract.ts'

const request = { taskId: 'task', seq: 7, attachmentIds: ['image', 'file'] }
function fixture() {
  const original = { seq: 7, type: 'user/message', data: { source: { kind: 'user', rpcId: 'original' }, content: [
    { type: 'text', text: '检查服务' },
    { type: 'image', attachment: { attachmentId: 'image', name: 'screen.png' } },
    { type: 'file', attachment: { attachmentId: 'file', name: 'report.txt' } },
  ] } }
  const history = { events: [original] }
  const agent = { status: 'idle', inbox: { nextTurn: [] as { source: { kind: string; rpcId: string } }[], nextStep: [] } }
  const stream = (async function* () { yield Buffer.from('original file') })()
  const sessionController = {
    resolveAgent: vi.fn(async () => ({ agent })), inspect: vi.fn(async () => history),
    prompt: vi.fn(async (_request: unknown, _signal: AbortSignal) => ({ accepted: true as const })),
  }
  const attachments = { readImage: vi.fn(async () => ({ ref: { mediaType: 'image/png' }, data: Buffer.from([1, 2, 3]) })), readFileStream: vi.fn(() => stream) }
  const fileUploads = { uploadStream: vi.fn(async (input: { data: AsyncIterable<Uint8Array> }) => {
    const chunks = []; for await (const chunk of input.data) chunks.push(Buffer.from(chunk))
    expect(Buffer.concat(chunks).toString()).toBe('original file')
    return { receiptId: 'receipt' }
  }) }
  const ctx = { sessionController, attachments, fileUploads } as unknown as Context
  return { ctx, sessionController, attachments, fileUploads, original, history, agent, stream }
}

describe('recorded attachment preparation', () => {
  it('returns image bytes and staged file receipts without admitting a prompt', async () => {
    const f = fixture()
    expect(await prepareRecordedAttachments(f.ctx, request)).toEqual([
      { type: 'image', mediaType: 'image/png', data: 'AQID', name: 'screen.png' }, { type: 'file', receiptId: 'receipt' },
    ])
    expect(f.fileUploads.uploadStream).toHaveBeenCalledWith({ sessionId: 'task', data: f.stream, name: 'report.txt' })
    expect(f.sessionController.prompt).not.toHaveBeenCalled()
    expect(f.history.events).toEqual([f.original])
  })

  it('prepares an older question while a task is running, leaving queue/steer admission to ordinary send', async () => {
    const f = fixture()
    f.agent.status = 'running'
    f.history.events.push({ ...f.original, seq: 9 })
    expect(await prepareRecordedAttachments(f.ctx, { ...request, attachmentIds: ['image'] })).toHaveLength(1)
    expect(f.sessionController.resolveAgent).not.toHaveBeenCalled()
    expect(f.sessionController.prompt).not.toHaveBeenCalled()
  })

  it('honors removed attachments and rejects unknown or non-user sources before reading bytes', async () => {
    const f = fixture()
    expect(await prepareRecordedAttachments(f.ctx, { ...request, attachmentIds: [] })).toEqual([])
    await expect(prepareRecordedAttachments(f.ctx, { ...request, seq: 99 })).rejects.toThrow('原消息')
    await expect(prepareRecordedAttachments(f.ctx, { ...request, attachmentIds: ['foreign'] })).rejects.toThrow('原附件')
    f.original.data.source.kind = 'plugin'
    await expect(prepareRecordedAttachments(f.ctx, request)).rejects.toThrow('原消息')
    expect(f.attachments.readImage).not.toHaveBeenCalled()
  })

  it('does not return partial content when an attachment cannot be read', async () => {
    const f = fixture()
    f.attachments.readImage.mockRejectedValue(new Error('attachment unavailable'))
    await expect(prepareRecordedAttachments(f.ctx, request)).rejects.toThrow('attachment unavailable')
    expect(f.fileUploads.uploadStream).not.toHaveBeenCalled()
    expect(f.sessionController.prompt).not.toHaveBeenCalled()
  })

  it('rejects invalid sequences and oversized attachment selectors at the boundary', () => {
    expect(recordedAttachmentsRequest.safeParse({ ...request, seq: -1 }).success).toBe(false)
    expect(recordedAttachmentsRequest.safeParse({ ...request, attachmentIds: Array(129).fill('x') }).success).toBe(false)
  })

  it('registers an attachment-only Gateway endpoint with source validation', async () => {
    const f = fixture()
    const host = new Context()
    try {
      await host.plugin(TypertRegistry)
      await host.plugin(TypertGatewayService)
      host.provide('sessionController', f.sessionController as never)
      host.provide('attachments', f.attachments as never)
      host.provide('fileUploads', f.fileUploads as never)
      await host.plugin(LingMessageActionsController)
      expect(await host.typertGateway.invoke({ namespace: 'lingMessageActions', method: 'prepareAttachments', args: { request: { ...request, attachmentIds: ['image'] } } })).toMatchObject([{ type: 'image', data: 'AQID' }])
      await expect(host.typertGateway.invoke({ namespace: 'lingMessageActions', method: 'prepareAttachments', args: { request: { ...request, seq: 99 } } })).rejects.toThrow('原消息')
      expect(f.sessionController.prompt).not.toHaveBeenCalled()
    } finally { await host.fiber.dispose() }
  })
})
