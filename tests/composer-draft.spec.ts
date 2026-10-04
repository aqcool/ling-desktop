import { describe, expect, it, vi } from 'vitest'
import { acceptDraft, type ComposerDraft } from '../src/ui/composer-draft.js'
import { resendMessage } from '../src/runtime/message-resend.js'
import type { LingTimelineItem } from '../src/runtime/contract.js'

const submitted: ComposerDraft = { text: '原问题', attachments: [], recordedAttachments: {
  seq: 7, attachments: [{ attachmentId: 'file', kind: 'file', name: 'report.txt' }],
} }

describe('composer admission settlement', () => {
  it('retires exactly the submitted draft', () => { expect(acceptDraft(submitted, submitted)).toBeUndefined() })
  it('keeps text appended while waiting, and retires only the admitted attachment references', () => {
    expect(acceptDraft({ ...submitted, text: '原问题后续输入' }, submitted)).toEqual({ text: '后续输入', attachments: [] })
  })
  it('preserves rewritten text, replacement references and newly added browser files', () => {
    const replaced = { ...submitted, text: '另一个问题' }
    expect(acceptDraft(replaced, submitted)).toBe(replaced)
    const added = { id: 'new', name: 'new.txt' } as ComposerDraft['attachments'][number]
    const source = { seq: 9, attachments: [{ attachmentId: 'new', kind: 'file' as const, name: 'new.txt' }] }
    expect(acceptDraft({ text: '原问题', attachments: [added], recordedAttachments: source }, submitted)).toEqual({ text: '', attachments: [added], recordedAttachments: source })
  })
  it('retries an unacknowledged failure with the same command identity, then begins a new attempt after acceptance', async () => {
    const runtime = { dispatch: vi.fn().mockResolvedValueOnce({ accepted: false, message: 'network', retryable: true }).mockResolvedValue({ accepted: true }) }
    const item = { taskId: 'task', itemId: 'user' } as LingTimelineItem
    await expect(resendMessage(runtime, item)).rejects.toThrow('network')
    await resendMessage(runtime, item)
    await resendMessage(runtime, item)
    expect(runtime.dispatch.mock.calls[0]![0].requestId).toBe(runtime.dispatch.mock.calls[1]![0].requestId)
    expect(runtime.dispatch.mock.calls[2]![0].requestId).not.toBe(runtime.dispatch.mock.calls[1]![0].requestId)
  })
})
