import { useCallback } from 'react'
import type { LingReadResult, LingWorkspaceDirectory, LingWorkspaceDocument } from '../runtime/contract.js'
import type { LingServerService } from '../runtime/servers.js'
import { FileBrowser } from './FileBrowser.js'
import type { WorkspaceContextReference } from './attachments.js'

function error<Value>(message: string): LingReadResult<Value> {
  return { ok: false, reason: 'runtime-unavailable', message, retryable: true }
}

export function ServerFileBrowser({ service, taskId, stateScope, workspaceLabel, onAddContext }: {
  readonly service: LingServerService
  readonly taskId: string
  readonly stateScope: string
  readonly workspaceLabel: string
  readonly onAddContext?: (reference: WorkspaceContextReference) => void
}) {
  const list = useCallback(async (id: string, path: string, signal: AbortSignal): Promise<LingReadResult<LingWorkspaceDirectory>> => {
    const result = await service.filesList(id, path || '.', signal)
    if (!result.ok) return result
    return { ok: true, value: { path: result.value.path, truncated: false,
      entries: result.value.entries.map(entry => ({ name: entry.name, path: path ? `${path}/${entry.name}` : entry.name,
        kind: entry.type })) } }
  }, [service])
  const read = useCallback(async (id: string, path: string, signal: AbortSignal): Promise<LingReadResult<LingWorkspaceDocument>> => {
    const result = await service.filesRead(id, path, signal)
    if (!result.ok) return result
    const markdown = /\.(md|markdown|mdown)$/i.test(path)
    return { ok: true, value: { path, kind: markdown ? 'markdown' : 'code',
      mediaType: markdown ? 'text/markdown' : 'text/plain', text: result.value.text,
      version: result.value.sha256, truncated: result.value.truncated,
      lines: result.value.text.split('\n').length } }
  }, [service])
  const save = useCallback(async (id: string, path: string, text: string, version: string, signal: AbortSignal): Promise<LingReadResult<{ readonly version: string }>> => {
    const result = await service.filesSave(id, path, text, version, signal)
    return result.ok ? { ok: true, value: { version: result.value.sha256 } } : error(result.message)
  }, [service])
  return <FileBrowser key={stateScope} taskId={taskId} stateScope={stateScope} workspaceLabel={workspaceLabel} loadDirectory={list} loadDocument={read} saveDocument={save} onAddContext={onAddContext} />
}
