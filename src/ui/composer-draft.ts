import type { StoredDraft } from '../session-state.js'
import type { ComposerAttachment } from './attachments.js'

export interface ComposerDraft extends StoredDraft {
  readonly attachments: readonly ComposerAttachment[]
}

/** Only retire content captured by this send; preserve later edits and file additions. */
export function acceptDraft(current: ComposerDraft, submitted: ComposerDraft): ComposerDraft | undefined {
  if (current === submitted) return undefined
  if (!current.text.startsWith(submitted.text)) return current
  const text = current.text.slice(submitted.text.length)
  const sentIds = new Set(submitted.attachments.map(a => a.id))
  const attachments = current.attachments.filter(a => !sentIds.has(a.id))
  const source = current.recordedAttachments
  const sentRecorded = source?.seq === submitted.recordedAttachments?.seq
    ? new Set(submitted.recordedAttachments?.attachments.map(a => a.attachmentId)) : new Set<string>()
  const retained = source?.attachments.filter(a => !sentRecorded.has(a.attachmentId))
  if (!text && !attachments.length && !retained?.length) return undefined
  return { text, attachments, ...(source && retained?.length ? { recordedAttachments: { seq: source.seq, attachments: retained } } : {}) }
}
