import { describe, expect, it, vi } from 'vitest'
import { createDshAttachmentPreparation } from '../src/client/attachment-preparation.js'

describe('DSH attachment preparation', () => {
  it('keeps image bytes in the prompt and creates a local preview echo', async () => {
    const upload = vi.fn()
    const preparation = createDshAttachmentPreparation({ upload } as never)

    await expect(preparation.prepare('session-1', [{
      kind: 'image',
      mediaType: 'image/png',
      data: 'aW1hZ2U=',
      name: 'diagram.png',
      width: 640,
      height: 480,
    }])).resolves.toEqual({
      content: [{
        type: 'image',
        mediaType: 'image/png',
        data: 'aW1hZ2U=',
        name: 'diagram.png',
      }],
      pending: [{
        type: 'image',
        value: {
          previewUrl: 'data:image/png;base64,aW1hZ2U=',
          name: 'diagram.png',
          width: 640,
          height: 480,
        },
      }],
    })
    expect(upload).not.toHaveBeenCalled()
  })

  it('uploads files and sends only the Host-issued receipt to the session', async () => {
    let uploadedBody: Blob | undefined
    const upload = vi.fn(async (_id: string, body: Blob) => {
      uploadedBody = body
      return {
        ok: true,
        value: {
          receiptId: 'receipt-1',
          file: { attachmentId: 'file-1', name: 'report.txt', size: 3 },
        },
      }
    })
    const preparation = createDshAttachmentPreparation({ upload } as never)
    const data = new Uint8Array([1, 2, 3])

    await expect(preparation.prepare('session-1', [{
      kind: 'file',
      data,
      name: 'report.txt',
    }])).resolves.toEqual({
      content: [{ type: 'file', receiptId: 'receipt-1' }],
      pending: [{
        type: 'file',
        value: { attachmentId: 'file-1', name: 'report.txt', size: 3 },
      }],
    })
    expect(upload).toHaveBeenCalledWith('session-1', expect.any(Blob), 'report.txt')
    const body = uploadedBody as Blob
    expect(new Uint8Array(await body.arrayBuffer())).toEqual(data)
  })
})
