import type { ClientTerminals, TerminalView, TerminalViewState } from '@deepseek-ai/dsh-api-terminal-controller/client'
import type { ClientRemote } from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-terminal-controller/remote'
import type { WebTerminalId, WebTerminalInfo } from '@deepseek-ai/dsh-api-terminal-controller/types'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { LingCommandRejectionReason, LingReadResult, LingTaskTerminal, LingTerminalPanel, LingTerminalPanelState, LingTerminalService, LingTerminalState, LingTerminalView } from 'ling-desktop/runtime'

function rejected<Value>(
  reason: LingCommandRejectionReason,
  message: string,
  retryable = false,
): LingReadResult<Value> {
  return { ok: false, reason, message, retryable }
}

function remoteFailure<Value>(error: { readonly code: string; readonly message?: string }): LingReadResult<Value> {
  const reason = /permission|denied|forbidden/i.test(error.code)
    ? 'permission-denied'
    : /not-found|missing/i.test(error.code)
      ? 'task-not-found'
      : /invalid|bad-request|validation|conflict|limit/i.test(error.code)
        ? 'invalid-command'
        : 'runtime-unavailable'
  return rejected(
    reason,
    error.message?.trim() || '终端列表读取失败。',
    /transport|connection|timeout|unavailable/i.test(error.code),
  )
}

function projectTerminal(info: WebTerminalInfo): LingTaskTerminal {
  return {
    terminalId: String(info.id),
    title: info.title,
    shell: info.shell.name || info.shell.path,
    cwd: info.cwd,
    state: info.state,
    ...(typeof info.exitCode === 'number' ? { exitCode: info.exitCode } : {}),
    ...(info.error === undefined ? {} : { error: info.error }),
  }
}

export function createDshTerminalProjection(remote: Pick<ClientRemote, 'terminal'>, models?: ClientTerminals) {
  const projection = {
    service: undefined as LingTerminalService | undefined,
    async list(taskId: string): Promise<LingReadResult<readonly LingTaskTerminal[]>> {
      try {
        const result = await remote.terminal.list(brandString<SessionId>(taskId))
        if (!result.ok) return remoteFailure(result.error)
        return { ok: true, value: result.value.map(projectTerminal) }
      } catch {
        return rejected('runtime-unavailable', '终端列表暂时不可用。', true)
      }
    },
    async rename(taskId: string, terminalId: string, title: string): Promise<LingReadResult<void>> {
      const name = title.trim()
      if (!name || name.length > 120) return rejected('invalid-command', '终端名称需为 1–120 个字符。')
      try {
        const result = await remote.terminal.rename(brandString<SessionId>(taskId), brandString<WebTerminalId>(terminalId), name)
        return result.ok ? { ok: true, value: undefined } : remoteFailure(result.error)
      } catch { return rejected('runtime-unavailable', '无法重命名终端，请重试。', true) }
    },
    async create(taskId: string): Promise<LingReadResult<LingTaskTerminal>> {
      try {
        const id = brandString<WebTerminalId>(`term-${String(Date.now())}-${Math.random().toString(16).slice(2)}`)
        const result = await remote.terminal.create(brandString<SessionId>(taskId), { id, cols: 80, rows: 24 })
        if (!result.ok) return remoteFailure(result.error)
        return { ok: true, value: projectTerminal(result.value) }
      } catch {
        return rejected('runtime-unavailable', '无法新建终端。', true)
      }
    },
  }
  if (models) projection.service = createTerminalService(projection, models)
  return projection
}

const issueMessages = {
  missingTerminal: '此终端已结束，请新建终端。',
  inputFull: '终端输入队列已满，请重新连接。',
  attachmentEnded: '终端连接已中断。',
  invalidOutput: '终端输出不同步，请重新连接。',
  terminalLimit: '已达到终端数量上限，请关闭不再使用的终端。',
}

function projectView(model: TerminalView): LingTerminalView {
  let previous: TerminalViewState | undefined
  let snapshot: LingTerminalState
  return {
    getSnapshot() {
      const state = model.state.getSnapshot()
      if (previous !== state) {
        previous = state
        const frame = state.render?.frame
        snapshot = {
          phase: state.phase, writable: state.writable,
          terminal: state.info && projectTerminal(state.info),
          error: state.issue ? issueMessages[state.issue] : state.error ?? state.info?.error,
          cols: state.info?.cols, rows: state.info?.rows,
          maxCols: state.environment?.maxCols, maxRows: state.environment?.maxRows,
          scrollback: state.environment?.scrollback,
          render: frame && state.render ? {
            revision: state.render.revision,
            reset: frame.type === 'snapshot',
            data: frame.type === 'snapshot' ? frame.screen : frame.data,
            ...(frame.type === 'snapshot' ? { cols: frame.info.cols, rows: frame.info.rows } : {}),
          } : undefined,
        }
      }
      return snapshot
    },
    subscribe: listener => model.state.subscribe(listener),
    mount: () => model.mount(),
    write: data => model.write(data),
    resize: (cols, rows) => model.resize(cols, rows),
    acknowledge: revision => model.acknowledge(revision),
    reconnect: () => { if (model.state.getSnapshot().info) model.connect(); else void model.refresh() },
  }
}

/** Keep independent bottom/side tab identities while DSH owns PTYs and retention. */
function createTerminalService(projection: Pick<ReturnType<typeof createDshTerminalProjection>, 'list' | 'create' | 'rename'>, models: ClientTerminals): LingTerminalService {
  const placements = new Map<string, 'side' | 'bottom'>()
  const panels = new Map<string, LingTerminalPanel>()
  const retained = new Map<string, { sessionId: SessionId; tabId: string; contentId: string }>()
  const views = new Map<string, { model: TerminalView; view: LingTerminalView }>()
  const retain = () => models.retainTabs([...retained.values()])
  const keyOf = (taskId: string, id: string) => JSON.stringify([taskId, id])
  const bindingKey = (taskId: string, id: string) => `ling.terminal.placement:${keyOf(taskId, id)}`
  const placementOf = (taskId: string, id: string): 'side' | 'bottom' => {
    const saved = placements.get(keyOf(taskId, id))
    if (saved) return saved
    try { return localStorage.getItem(bindingKey(taskId, id)) === 'side' ? 'side' : 'bottom' } catch { return 'bottom' }
  }
  const bind = (taskId: string, id: string, placement: 'side' | 'bottom') => {
    placements.set(keyOf(taskId, id), placement)
    try { localStorage.setItem(bindingKey(taskId, id), placement) } catch { /* Memory retention still works without storage. */ }
  }
  const viewOf = (taskId: string, id: string) => {
    const key = keyOf(taskId, id)
    let entry = views.get(key)
    if (!entry) {
      const sessionId = brandString<SessionId>(taskId)
      const tabId = `ling-terminal:${id}`
      retained.set(key, { sessionId, tabId, contentId: tabId })
      const model = models.view(sessionId, tabId, tabId, brandString<WebTerminalId>(id))
      entry = { model, view: projectView(model) }
      views.set(key, entry)
      retain()
    }
    return entry
  }
  return {
    panel(taskId, placement) {
      const panelKey = keyOf(taskId, placement)
      const existing = panels.get(panelKey)
      if (existing) return existing
      let state: LingTerminalPanelState = { terminals: [], loading: false }
      const listeners = new Set<() => void>()
      const publish = (patch: Partial<LingTerminalPanelState>) => {
        state = { ...state, ...patch }
        for (const listener of listeners) listener()
      }
      let loading: Promise<void> | undefined
      let initialized = false
      let creating: Promise<void> | undefined
      const closing = new Set<string>()
      const panel: LingTerminalPanel = {
        getSnapshot: () => state,
        subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
        load() {
          if (loading) return loading
          if (initialized) return Promise.resolve()
          publish({ loading: true, error: undefined })
          loading = (async () => {
            const result = await projection.list(taskId)
            if (!result.ok) { publish({ error: result.message }); return }
            const terminals = result.value.filter(terminal => placementOf(taskId, terminal.terminalId) === placement)
            for (const terminal of terminals) viewOf(taskId, terminal.terminalId)
            publish({ terminals })
            if (terminals.length === 0) await panel.create()
            initialized = !state.error
          })().catch(error => publish({ error: error instanceof Error ? error.message : '无法连接终端。' }))
            .finally(() => { loading = undefined; publish({ loading: false }) })
          return loading
        },
        create() {
          if (creating) return creating
          publish({ loading: true, error: undefined })
          creating = (async () => {
            const result = await projection.create(taskId)
            if (!result.ok) { publish({ error: result.message }); return }
            bind(taskId, result.value.terminalId, placement)
            viewOf(taskId, result.value.terminalId)
            publish({ terminals: [...state.terminals, result.value] })
          })().catch(error => publish({ error: error instanceof Error ? error.message : '无法新建终端。' }))
            .finally(() => { creating = undefined; publish({ loading: false }) })
          return creating
        },
        async rename(id, title) {
          const terminal = state.terminals.find(item => item.terminalId === id)
          if (!terminal || closing.has(id)) return rejected('invalid-command', '此终端已关闭。')
          const name = title.trim()
          if (name === terminal.title) return { ok: true, value: undefined }
          const result = await projection.rename(taskId, id, name)
          if (result.ok) publish({ terminals: state.terminals.map(item => item.terminalId === id ? { ...item, title: name } : item) })
          return result
        },
        async close(id) {
          if (closing.has(id)) return
          closing.add(id)
          const key = keyOf(taskId, id)
          try {
            // Keep the tab on failure so the user can retry, then let DSH dispose its binding and hold.
            await viewOf(taskId, id).model.close()
            const binding = retained.get(key)!
            models.close(binding.sessionId, binding.tabId, binding.contentId, brandString<WebTerminalId>(id))
            placements.delete(key)
            retained.delete(key)
            views.delete(key)
            retain()
            try { localStorage.removeItem(bindingKey(taskId, id)) } catch { /* Optional persistence. */ }
            publish({ terminals: state.terminals.filter(terminal => terminal.terminalId !== id), error: undefined })
          } catch (error) { publish({ error: error instanceof Error ? error.message : '无法关闭终端。' }) }
          finally { closing.delete(id) }
        },
        view: id => viewOf(taskId, id).view,
      }
      panels.set(panelKey, panel)
      return panel
    },
  }
}
