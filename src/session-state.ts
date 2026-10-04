export const selectedTaskStorageKey = 'ling.selectedTask'
export const draftStorageKey = 'ling.drafts'
export const inspectorStorageKey = 'ling.inspector'
export const browserStorageKey = 'ling.browser'
export const browserStateStorageKey = 'ling.browserState'
export const workspaceDocumentStorageKey = 'ling.workspaceDocuments'

export function parseStoredInspector(raw: string | null): boolean {
  return raw !== '0'
}

export function parseStoredBrowserOpen(raw: string | null): boolean {
  return raw === '1'
}

export interface StoredBrowserNavigation {
  readonly entries: readonly string[]
  readonly index: number
}

export function parseStoredBrowserNavigation(raw: string | null): StoredBrowserNavigation {
  if (raw === null) return { entries: [], index: -1 }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { entries: [], index: -1 }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return { entries: [], index: -1 }
  const record = parsed as Record<string, unknown>
  const entries = Array.isArray(record.entries)
    ? record.entries.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
    : []
  const index = typeof record.index === 'number' && Number.isInteger(record.index) ? record.index : entries.length - 1
  return { entries, index: index >= 0 && index < entries.length ? index : entries.length - 1 }
}

export function serializeBrowserNavigation(state: StoredBrowserNavigation): string {
  return JSON.stringify({ entries: state.entries, index: state.index })
}

export function parseStoredDocumentPaths(raw: string | null): Record<string, string> {
  return parseStoredStringMap(raw)
}

export function serializeDocumentPaths(paths: Record<string, string>): string {
  return JSON.stringify(paths)
}

function parseStoredStringMap(raw: string | null): Record<string, string> {
  if (raw === null) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return {}
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
  const texts: Record<string, string> = {}
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value === 'string' && value.length > 0) texts[key] = value
  }
  return texts
}

export interface StoredDraft {
  readonly text: string
  readonly recordedAttachments?: {
    readonly seq: number
    readonly attachments: readonly import('./runtime/contract.js').LingTimelineAttachment[]
  }
}

/** Read legacy text drafts and attachment references, never browser-owned file bytes. */
export function parseStoredDrafts(raw: string | null): Record<string, StoredDraft> {
  let parsed: unknown
  try { parsed = JSON.parse(raw ?? '{}') } catch { return {} }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
  const drafts: Record<string, StoredDraft> = {}
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value === 'string') {
      if (value) drafts[key] = { text: value }
      continue
    }
    if (typeof value !== 'object' || value === null) continue
    const draft = value as Record<string, unknown>
    if (typeof draft.text !== 'string') continue
    const source = draft.recordedAttachments as StoredDraft['recordedAttachments']
    const valid = source && Number.isSafeInteger(source.seq) && source.seq >= 0 && Array.isArray(source.attachments)
      && source.attachments.every(a => a && typeof a.attachmentId === 'string' && typeof a.name === 'string'
        && (a.kind === 'image' || a.kind === 'file')
        && (a.bytes === undefined || typeof a.bytes === 'number') && (a.mediaType === undefined || typeof a.mediaType === 'string'))
    if (draft.text || (valid && source.attachments.length)) drafts[key] = {
      text: draft.text, ...(valid && source.attachments.length ? { recordedAttachments: source } : {}),
    }
  }
  return drafts
}

export function serializeDrafts(drafts: Record<string, StoredDraft>): string {
  return JSON.stringify(Object.fromEntries(Object.entries(drafts).flatMap(([key, draft]) => {
    const source = draft.recordedAttachments
    if (!draft.text && !source?.attachments.length) return []
    return [[key, source?.attachments.length ? { text: draft.text, recordedAttachments: {
      seq: source.seq, attachments: source.attachments.map(({ attachmentId, kind, name, bytes, mediaType }) => ({ attachmentId, kind, name, bytes, mediaType })),
    } } : draft.text]]
  })))
}

export function pickRestorableTaskId(raw: string | null, taskIds: readonly string[]): string | undefined {
  if (raw === null) return undefined
  return taskIds.includes(raw) ? raw : undefined
}
