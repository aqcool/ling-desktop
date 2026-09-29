import type { SessionBinding } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ChatSnapshot } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { UiConversation } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {
  LingChangedFile,
  LingDiffHunk,
  LingFileDiff,
  LingTaskChanges,
} from 'ling-desktop/runtime'

interface ChangeCoordinates {
  readonly turn: number
  readonly seq: number
}

interface LocationDataReader {
  get(key: string): unknown
}

function object(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function nonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function positiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1
}

function changedFile(value: unknown): LingChangedFile | undefined {
  const entry = object(value)
  if (entry === undefined
    || typeof entry['path'] !== 'string'
    || typeof entry['display'] !== 'string'
    || !nonNegativeInteger(entry['added'])
    || !nonNegativeInteger(entry['deleted'])
    || (entry['binary'] !== undefined && entry['binary'] !== true)
    || (entry['oversized'] !== undefined && entry['oversized'] !== true)) return undefined
  return {
    path: entry['path'],
    display: entry['display'],
    added: entry['added'],
    deleted: entry['deleted'],
    ...(entry['binary'] === true ? { binary: true as const } : {}),
    ...(entry['oversized'] === true ? { oversized: true as const } : {}),
  }
}

function taskChanges(taskId: string, seq: number, value: unknown): LingTaskChanges | undefined {
  const summary = object(value)
  if (summary === undefined
    || !positiveInteger(summary['turn'])
    || !Array.isArray(summary['files'])
    || !nonNegativeInteger(summary['total'])
    || !nonNegativeInteger(summary['added'])
    || !nonNegativeInteger(summary['deleted'])) return undefined
  const files = summary['files'].map(changedFile)
  if (files.some(file => file === undefined)) return undefined
  return {
    taskId,
    seq,
    turn: summary['turn'],
    files: files as LingChangedFile[],
    total: summary['total'],
    added: summary['added'],
    deleted: summary['deleted'],
  }
}

function diffHunk(value: unknown): LingDiffHunk | undefined {
  const hunk = object(value)
  if (hunk === undefined
    || !positiveInteger(hunk['oldStart'])
    || !nonNegativeInteger(hunk['oldLines'])
    || !positiveInteger(hunk['newStart'])
    || !nonNegativeInteger(hunk['newLines'])
    || !Array.isArray(hunk['lines'])
    || !hunk['lines'].every(line => typeof line === 'string')) return undefined
  return {
    oldStart: hunk['oldStart'],
    oldLines: hunk['oldLines'],
    newStart: hunk['newStart'],
    newLines: hunk['newLines'],
    lines: hunk['lines'],
  }
}

function fileDiff(value: unknown): LingFileDiff | undefined {
  const diff = object(value)
  if (diff === undefined || typeof diff['path'] !== 'string' || typeof diff['display'] !== 'string') {
    return undefined
  }
  if (diff['kind'] === 'binary' || diff['kind'] === 'oversized') {
    return { kind: diff['kind'], path: diff['path'], display: diff['display'] }
  }
  if (diff['kind'] !== 'text'
    || typeof diff['before'] !== 'boolean'
    || typeof diff['after'] !== 'boolean'
    || typeof diff['coarse'] !== 'boolean'
    || !Array.isArray(diff['hunks'])) return undefined
  const hunks = diff['hunks'].map(diffHunk)
  if (hunks.some(hunk => hunk === undefined)) return undefined
  return {
    kind: 'text',
    path: diff['path'],
    display: diff['display'],
    before: diff['before'],
    after: diff['after'],
    hunks: hunks as LingDiffHunk[],
    coarse: diff['coarse'],
  }
}

function coordinates(snapshot: ChatSnapshot): readonly ChangeCoordinates[] {
  return snapshot.timeline.turnOrder.flatMap(turn => {
    const location = snapshot.timeline.turns.get(turn)
    if (location === undefined) return []
    const deliverables = object((location.data as unknown as LocationDataReader).get('deliverables'))
    const changes = object(deliverables?.['changes'])
    return positiveInteger(changes?.['seq']) ? [{ turn, seq: changes['seq'] }] : []
  })
}

function endpoint(path: string, values: Record<string, string | number>): string {
  return `${path}?${new URLSearchParams(
    Object.fromEntries(Object.entries(values).map(([key, value]) => [key, String(value)])),
  )}`
}

export function createDshWorkspaceChangesProjection(
  conversation: Pick<UiConversation, 'binding'>,
  fetcher: typeof fetch = globalThis.fetch,
) {
  return {
    async list(binding: SessionBinding, signal: AbortSignal): Promise<readonly LingTaskChanges[]> {
      const snapshot = conversation.binding(binding).target('chat').getSnapshot()
      if (snapshot === undefined) return []
      const taskId = String(binding.sessionId)
      const summaries = await Promise.all(coordinates(snapshot).map(async item => {
        const response = await fetcher(endpoint('/api/changes.summary', {
          sessionId: taskId,
          seq: item.seq,
        }), { signal })
        if (response.status === 404) return undefined
        if (!response.ok) throw new Error(`Changes summary request failed: ${response.status}`)
        const summary = taskChanges(taskId, item.seq, await response.json())
        if (summary === undefined || summary.turn !== item.turn) {
          throw new Error('Invalid changes summary response')
        }
        return summary
      }))
      return summaries.filter(summary => summary !== undefined)
    },
    async diff(
      binding: SessionBinding,
      seq: number,
      index: number,
      signal: AbortSignal,
    ): Promise<LingFileDiff | undefined> {
      const taskId = String(binding.sessionId)
      const response = await fetcher(endpoint('/api/changes.diff', { sessionId: taskId, seq, index }), { signal })
      if (response.status === 404) return undefined
      if (!response.ok) throw new Error(`Changes diff request failed: ${response.status}`)
      const result = fileDiff(await response.json())
      if (result === undefined) throw new Error('Invalid changes diff response')
      return result
    },
  }
}
