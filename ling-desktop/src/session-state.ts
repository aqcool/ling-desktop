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

export function parseStoredDrafts(raw: string | null): Record<string, string> {
  return parseStoredStringMap(raw)
}

export function serializeDrafts(drafts: Record<string, { text: string }>): string {
  const texts: Record<string, string> = {}
  for (const [key, draft] of Object.entries(drafts)) {
    if (draft.text.length > 0) texts[key] = draft.text
  }
  return JSON.stringify(texts)
}

export function pickRestorableTaskId(raw: string | null, taskIds: readonly string[]): string | undefined {
  if (raw === null) return undefined
  return taskIds.includes(raw) ? raw : undefined
}
