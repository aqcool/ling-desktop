import type { SessionBinding } from '@deepseek-ai/dsh-api-session-controller/client'
import type { InboxState } from '@deepseek-ai/dsh-agent/types'
import type {
  AssistantBlock,
  ChatConversationViewNode,
  ChatSnapshot,
  CommandNode,
  ConversationNode,
  RunningToolCall,
  ToolResultNode,
} from '@deepseek-ai/dsh-client-ui-chat/client'
import type { UiConversation } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { LingTimelineAttachment, LingTimelineItem, LingServerExecution, LingPendingMessage } from 'ling-desktop/runtime'

import { projectCompaction } from './compaction-projection.js'

function isoTime(value: number): string {
  return new Date(value).toISOString()
}

function attachmentRef(block: unknown): Record<string, unknown> | undefined {
  if (typeof block !== 'object' || block === null) return undefined
  const candidate = block as Record<string, unknown>
  if (candidate['type'] !== 'file' && candidate['type'] !== 'image') return undefined
  const attachment = candidate['attachment']
  return typeof attachment === 'object' && attachment !== null
    ? attachment as Record<string, unknown>
    : undefined
}

function blockText(block: unknown): string {
  if (typeof block !== 'object' || block === null) return ''
  const candidate = block as Record<string, unknown>
  if ((candidate['type'] === 'text' || candidate['type'] === 'reasoning')
    && typeof candidate['text'] === 'string') return candidate['text']
  if (candidate['type'] === 'image') return '[图片]'
  if (candidate['type'] === 'file') return '[文件]'
  if (candidate['type'] === 'tool-result' && Array.isArray(candidate['content'])) {
    return candidate['content'].map(blockText).filter(Boolean).join('\n')
  }
  return ''
}

function contentText(content: readonly unknown[]): string {
  return content.map(blockText).filter(Boolean).join('\n').trim()
}

function userText(content: readonly unknown[]): string {
  return content
    .filter(block => attachmentRef(block) === undefined)
    .map(blockText)
    .filter(Boolean)
    .join('\n')
    .trim()
}

function contentAttachments(content: readonly unknown[]): readonly LingTimelineAttachment[] {
  return content.flatMap((block) => {
    const ref = attachmentRef(block)
    if (ref === undefined) return []
    const kind = (block as { type: string }).type === 'image' ? 'image' : 'file'
    const attachmentId = typeof ref['attachmentId'] === 'string' ? ref['attachmentId'] : ''
    if (!attachmentId) return []
    const name = typeof ref['name'] === 'string' && ref['name'] ? ref['name'] : (kind === 'image' ? '图片' : '文件')
    return [{
      attachmentId,
      kind,
      name,
      ...(typeof ref['bytes'] === 'number' ? { bytes: ref['bytes'] } : {}),
      ...(typeof ref['mediaType'] === 'string' ? { mediaType: ref['mediaType'] } : {}),
    }]
  })
}

function assistantText(blocks: readonly AssistantBlock[]): string {
  return blocks.flatMap(block => block.kind === 'text' ? [block.text] : []).join('\n').trim()
}

function assistantReasoning(blocks: readonly AssistantBlock[]): string | undefined {
  const text = blocks.flatMap(block => block.kind === 'reasoning' ? [block.text] : []).join('\n').trim()
  return text || undefined
}

function commandText(command: CommandNode): string {
  if (command.outcome?.text?.trim()) return command.outcome.text.trim()
  if (command.args?.trim()) return command.args.trim()
  return command.outcome === null ? '正在执行' : command.outcome.kind === 'success' ? '已完成' : '执行失败'
}

function toolName(node: RunningToolCall | ToolResultNode): string {
  return 'name' in node ? node.name : node.call?.name ?? node.callId
}

function toolText(node: RunningToolCall | ToolResultNode): string {
  if (!('kind' in node)) return '正在执行'
  const text = contentText(node.content)
  return text || (node.isError ? '执行失败' : '已完成')
}

function toolPresentation(node: RunningToolCall | ToolResultNode): NonNullable<LingTimelineItem['tool']> | undefined {
  const raw = 'name' in node ? node.argsRaw : node.call?.argsRaw
  if (!raw?.trim()) return undefined
  let input = raw
  let preview: string | undefined
  let background: boolean | undefined
  try {
    const args: unknown = JSON.parse(raw)
    input = JSON.stringify(args, null, 2)
    if (args && typeof args === 'object' && !Array.isArray(args)) {
      const value = args as Record<string, unknown>
      if (typeof value['run_in_background'] === 'boolean') background = value['run_in_background']
      for (const key of ['command', 'cmd', 'file_path', 'path', 'pattern', 'query', 'url', 'description']) {
        if (typeof value[key] === 'string' && value[key].trim()) { preview = value[key].trim(); break }
      }
    }
  } catch { preview = raw.trim() }
  const elapsedMs = 'callTime' in node && node.callTime !== null ? Math.max(0, node.time - node.callTime) : undefined
  return { input, ...(preview ? { preview } : {}), ...(elapsedMs === undefined ? {} : { elapsedMs }), ...(background === undefined ? {} : { background }) }
}

interface TurnStops {
  readonly windows: readonly { readonly from: number; readonly to: number }[]
}

// Tool and command nodes carry no turn, so a stopped turn's seq span claims them.
function turnStops(snapshot: ChatSnapshot): TurnStops {
  const windows: { from: number; to: number }[] = []
  for (const location of snapshot.timeline.turns.values()) {
    const kind = location.end?.data.reason?.kind
    if (kind !== 'aborted' && kind !== 'interrupted') continue
    const from = location.start?.seq
    const to = location.end?.seq
    if (from !== undefined && to !== undefined) windows.push({ from, to })
  }
  return { windows }
}

function stoppedAt(stops: TurnStops, seq: number): boolean {
  return stops.windows.some(window => seq >= window.from && seq <= window.to)
}

type WorkflowRunStatus = 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted'

interface WorkflowRunView {
  readonly name: string
  readonly status: WorkflowRunStatus
  readonly phases: readonly {
    readonly phase: string | null
    readonly members: readonly {
      readonly label: string
      readonly status: WorkflowRunStatus
    }[]
  }[]
}

const workflowRunLabels: Record<WorkflowRunStatus, string> = {
  running: '进行中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
  interrupted: '已停止',
}

function workflowRunStatus(status: string): LingTimelineItem['status'] {
  if (status === 'completed') return 'completed'
  if (status === 'failed') return 'failed'
  if (status === 'running') return 'running'
  return 'interrupted'
}

function isWorkflowRunStatus(value: unknown): value is WorkflowRunStatus {
  return typeof value === 'string' && value in workflowRunLabels
}

// Keyed 'workflow-run' payload published by the upstream workflow-run definition.
function workflowRunView(data: unknown): WorkflowRunView | undefined {
  if (typeof data !== 'object' || data === null) return undefined
  const candidate = data as Record<string, unknown>
  if (typeof candidate['name'] !== 'string' || !isWorkflowRunStatus(candidate['status'])) return undefined
  const phases = Array.isArray(candidate['phases']) ? candidate['phases'] : []
  return {
    name: candidate['name'],
    status: candidate['status'],
    phases: phases.flatMap((entry) => {
      if (typeof entry !== 'object' || entry === null) return []
      const phase = entry as Record<string, unknown>
      const members = Array.isArray(phase['members']) ? phase['members'] : []
      return [{
        phase: typeof phase['phase'] === 'string' ? phase['phase'] : null,
        members: members.flatMap((member) => {
          if (typeof member !== 'object' || member === null) return []
          const item = member as Record<string, unknown>
          if (typeof item['label'] !== 'string' || !isWorkflowRunStatus(item['status'])) return []
          return [{ label: item['label'], status: item['status'] }]
        }),
      }]
    }),
  }
}

function workflowRunTime(snapshot: ChatSnapshot, anchorSeq: number): string {
  let best: number | undefined
  let bestSeq = Number.NEGATIVE_INFINITY
  for (const node of snapshot.legacy.nodes) {
    if (node.seq <= anchorSeq && node.seq > bestSeq) {
      bestSeq = node.seq
      best = node.time
    }
  }
  if (best === undefined) {
    for (const node of snapshot.legacy.nodes) {
      if (node.seq > anchorSeq && (best === undefined || node.time < best)) best = node.time
    }
  }
  return best === undefined ? '' : isoTime(best)
}

function projectWorkflowRun(taskId: string, node: ChatConversationViewNode, snapshot: ChatSnapshot): LingTimelineItem | undefined {
  const data = workflowRunView(node.data)
  if (data === undefined) return undefined
  const members = data.phases.flatMap(phase => phase.members)
  const detail = data.phases.map((phase) => {
    const heading = phase.phase === null ? [] : [`阶段 ${phase.phase}`]
    return [...heading, ...phase.members.map(member => `${member.label} · ${workflowRunLabels[member.status]}`)].join('\n')
  }).filter(Boolean).join('\n\n')
  return {
    itemId: `${taskId}:workflow-run:${node.id}`,
    taskId,
    seq: node.anchorSeq,
    kind: 'tool-activity',
    title: `工作流 ${data.name}`,
    text: `${members.length} 个执行项`,
    ...(detail ? { detail } : {}),
    createdAt: workflowRunTime(snapshot, node.anchorSeq),
    status: workflowRunStatus(data.status),
  }
}

function projectTool(
  taskId: string,
  node: RunningToolCall | ToolResultNode,
  suffix: string,
  stopped: boolean,
): LingTimelineItem {
  const settled = 'kind' in node
  const aborted = settled && stopped && node.isError
  const seq = 'seq' in node ? node.seq : undefined
  const attachments = settled ? contentAttachments(node.content) : []
  const tool = toolPresentation(node)
  const children = node.subCalls?.filter(child => !['server_exec', 'remote_run'].includes(toolName(child)))
    .map(child => projectTool(taskId, child, suffix, stopped))
  return {
    itemId: `${taskId}:tool:${node.callId}:${suffix}`,
    taskId,
    ...(seq === undefined ? {} : { seq }),
    kind: 'tool-activity',
    title: toolName(node),
    ...(tool || children?.length ? { tool: { input: tool?.input ?? '', ...tool, ...(children?.length ? { children } : {}) } } : {}),
    ...(attachments.length > 0 ? { attachments } : {}),
    text: aborted ? '已停止' : toolText(node),
    createdAt: isoTime(node.time),
    status: aborted ? 'interrupted' : settled ? (node.isError ? 'failed' : 'completed') : 'running',
  }
}

function projectNode(taskId: string, stops: TurnStops, node: ConversationNode): LingTimelineItem | undefined {
  const base = {
    itemId: `${taskId}:conversation:${String(node.seq)}:${node.kind}`,
    taskId,
    seq: node.seq,
    createdAt: isoTime(node.time),
  }
  switch (node.kind) {
    case 'user':
    case 'steering': {
      const attachments = contentAttachments(node.content)
      return {
        ...base,
        kind: 'user-message',
        text: userText(node.content),
        ...(attachments.length > 0 ? { attachments } : {}),
      }
    }
    case 'assistant':
      return {
        ...base,
        kind: 'assistant-message',
        text: assistantText(node.blocks),
        detail: assistantReasoning(node.blocks),
        status: node.interrupted ? 'interrupted' : 'completed',
      }
    case 'tool-result':
      return projectTool(taskId, node, String(node.seq), stoppedAt(stops, node.seq))
    case 'command':
      return {
        ...base,
        kind: 'tool-activity',
        title: node.name === null ? '命令' : `/${node.name}`,
        text: commandText(node),
        status: node.outcome === null
          ? 'running'
          : node.outcome.kind === 'success'
            ? 'completed'
            : stoppedAt(stops, node.seq) ? 'interrupted' : 'failed',
      }
    case 'context':
      return {
        ...base,
        kind: 'system-notice',
        title: node.producer.label ?? '上下文',
        text: contentText(node.content),
      }
    case 'model-retry':
      return {
        ...base,
        kind: 'system-notice',
        title: '模型重试',
        text: node.failure.message,
        status: node.retryState === 'cancelled' ? 'interrupted' : 'running',
      }
    case 'turn-error':
      return {
        ...base,
        kind: 'system-notice',
        title: node.code ?? '运行失败',
        text: node.message || '本轮任务执行失败。',
        status: 'failed',
      }
    case 'turn-max-tokens':
      return {
        ...base,
        kind: 'system-notice',
        title: '已达到输出上限',
        text: '可以继续发送消息完成剩余内容。',
        status: 'interrupted',
      }
    case 'compaction':
      return {
        ...base,
        kind: 'system-notice',
        title: '上下文已整理',
        text: node.summary ?? '较早的对话内容已压缩。',
        status: 'completed',
      }
    case 'unknown':
      return {
        ...base,
        kind: 'system-notice',
        title: node.type,
        text: '当前版本暂未提供这种记录的专用展示。',
      }
    default:
      return undefined
  }
}

function serverCalls(snapshot: ChatSnapshot): Array<RunningToolCall | ToolResultNode> {
  const calls = new Map<string, RunningToolCall | ToolResultNode>()
  const visit = (call: RunningToolCall | ToolResultNode) => {
    if (['server_exec', 'remote_run'].includes(toolName(call))) calls.set(call.callId, call)
    for (const child of call.subCalls ?? []) visit(child)
  }
  for (const node of snapshot.legacy.nodes) if (node.kind === 'tool-result') visit(node)
  for (const call of snapshot.legacy.runningCalls) visit(call)
  return [...calls.values()]
}

export function projectConversation(taskId: string, snapshot: ChatSnapshot, executions: readonly LingServerExecution[] = []): readonly LingTimelineItem[] {
  const stops = turnStops(snapshot)
  const compactedSeqs = new Set<number>()
  const compactCommands = new Set<string>()
  let resumeSeq = -1
  for (const node of snapshot.nodes.values()) {
    if (node.kind === 'ling-compaction-boundary') resumeSeq = Math.max(resumeSeq, node.anchorSeq)
    if (node.kind === 'ling-compaction') {
      const { checkpointSeq: seq, sourceCommandId } = node.data as { checkpointSeq?: number; sourceCommandId?: string }
      if (seq !== undefined) compactedSeqs.add(seq)
      if (sourceCommandId !== undefined) compactCommands.add(sourceCommandId)
    }
  }
  // Carry engine-owned locations across the native Renderer boundary.
  const turnsBySeq = new Map<number, number>()
  for (const node of snapshot.nodes.values()) {
    if (node.location.kind === 'turn' || node.location.kind === 'step') turnsBySeq.set(node.anchorSeq, node.location.turn.turn)
  }
  const questions = new Map<number, string>()
  for (const node of snapshot.legacy.nodes) {
    const turn = turnsBySeq.get(node.seq)
    if (node.kind === 'user' && turn !== undefined && !questions.has(turn)) questions.set(turn, `${taskId}:conversation:${node.seq}:user`)
  }
  const lastReplies = new Map<number, number>()
  for (const node of snapshot.legacy.nodes) {
    if (node.kind === 'assistant' && assistantText(node.blocks).trim()) lastReplies.set(node.turn, node.seq)
  }
  const items = snapshot.legacy.nodes.flatMap(node => {
    if (node.kind === 'compaction' && compactedSeqs.has(node.seq)) return []
    if (node.kind === 'command' && compactCommands.has(node.commandId)) return []
    const projected = projectNode(taskId, stops, node)
    if (projected === undefined) return []
    const turn = 'turn' in node && typeof node.turn === 'number' ? node.turn : turnsBySeq.get(node.seq)
    const item = { ...projected, ...(turn === undefined ? {} : { turn }),
      ...(node.kind === 'turn-error' && turn !== undefined && questions.has(turn) ? { retrySourceId: questions.get(turn)! } : {}),
    }
    if (node.kind === 'assistant' && snapshot.timeline.turns.has(node.turn)) {
      return item.text ? [{ ...item, turnComplete: snapshot.timeline.turns.get(node.turn)?.end !== undefined && lastReplies.get(node.turn) === node.seq }] : []
    }
    if (item.kind === 'tool-activity') return [item]
    return item.text || (item.attachments?.length ?? 0) > 0 ? [item] : []
  })

  // Hidden business records still invalidate their owning visible result.
  for (const node of snapshot.nodes.values()) {
    if (node.kind === 'ling-workspace-changes') {
      const data = node.data as { turn: number; seq: number }
      const at = items.findLastIndex(item => item.turn === data.turn)
      if (at >= 0) items[at] = { ...items[at]!, turnChangesSeq: data.seq }
    }
  }
  for (const key of snapshot.order) {
    const node = snapshot.nodes.get(key)
    if (node === undefined) continue
    if (node.kind === 'ling-deliverables') {
      const data = node.data as { turn: number; time: number; files: NonNullable<LingTimelineItem['presentedFiles']> }
      const reply = items.findLastIndex(item => item.kind === 'assistant-message' && item.turn === data.turn && item.turnComplete)
      if (reply >= 0) items[reply] = { ...items[reply]!, presentedFiles: [...items[reply]!.presentedFiles ?? [], ...data.files] }
      else {
        const item: LingTimelineItem = { itemId: `${taskId}:delivery:${node.anchorSeq}`, taskId, seq: node.anchorSeq, turn: data.turn,
          kind: 'system-notice', text: '', createdAt: isoTime(data.time), status: 'completed', presentedFiles: data.files }
        const at = items.findIndex(existing => existing.seq !== undefined && existing.seq > node.anchorSeq)
        if (at === -1) items.push(item); else items.splice(at, 0, item)
      }
      continue
    }
    const compactTurn = node.kind === 'ling-compaction' ? (node.data as { turn?: number }).turn : undefined
    const item = node.kind === 'ling-compaction' ? projectCompaction(taskId, node, node.anchorSeq < resumeSeq || (compactTurn !== undefined && snapshot.timeline.turns.get(compactTurn)?.end !== undefined))
      : node.kind === 'workflow-run' ? projectWorkflowRun(taskId, node, snapshot) : undefined
    if (item === undefined) continue
    const at = items.findIndex(existing => existing.seq !== undefined && existing.seq > (item.seq ?? Number.POSITIVE_INFINITY))
    if (at === -1) items.push(item)
    else items.splice(at, 0, item)
  }

  for (const call of snapshot.legacy.runningCalls) {
    items.push(projectTool(taskId, call, 'running', false))
  }

  for (const execution of executions) {
    let at = items.findIndex(item => item.itemId.startsWith(`${taskId}:tool:${execution.callId}:`))
    if (at < 0) {
      const call = serverCalls(snapshot).find(call => call.callId === execution.callId)
      if (!call) continue
      const child = projectTool(taskId, call, 'stream', 'seq' in call && stoppedAt(stops, call.seq))
      const parent = items.findIndex(item => item.itemId.startsWith(`${taskId}:tool:${call.parentCallId}:`))
      at = parent < 0 ? items.length : parent + 1
      items.splice(at, 0, child)
    }
    const previous = items[at]!
    const status = execution.status === 'running' && previous.status !== 'running'
      ? previous.status === 'failed' ? 'failed' : 'interrupted' : execution.status
    items[at] = { ...previous, itemId: `${taskId}:server:${execution.callId}`, title: execution.summary || '执行远端命令',
      text: execution.output, status, execution: { ...execution, status } }
  }

  const partial = snapshot.legacy.partial
  if (partial !== null) {
    const text = assistantText(partial.blocks)
    const detail = assistantReasoning(partial.blocks)
    if (text || detail) {
      items.push({
        itemId: `${taskId}:assistant:${String(partial.turn)}:${String(partial.step)}:stream`,
        taskId,
        turn: partial.turn,
        kind: 'assistant-message',
        text,
        detail,
        createdAt: isoTime(Math.max(
          0,
          ...snapshot.legacy.nodes.map(node => node.time),
          ...snapshot.legacy.runningCalls.map(call => call.time),
        )),
        status: 'running',
        streaming: true,
        turnComplete: false,
        reasoningStreaming: partial.blocks.at(-1)?.kind === 'reasoning',
      })
    }
  }

  // Re-presenting a file updates its durable coordinates rather than multiplying cards.
  const delivered = new Set<string>()
  for (let at = items.length - 1; at >= 0; at--) {
    const item = items[at]!
    if (!item.presentedFiles) continue
    const files = [...item.presentedFiles].reverse().filter(file => {
      const key = JSON.stringify([item.turn, file.path])
      if (delivered.has(key)) return false
      delivered.add(key); return true
    }).reverse()
    if (!files.length && !item.text) items.splice(at, 1)
    else items[at] = { ...item, presentedFiles: files }
  }
  return items.map(item => {
    if (item.turn === undefined) return item
    const location = snapshot.timeline.turns.get(item.turn)
    const timing = snapshot.legacy.turnTimings.get(item.turn)
    const start = location?.start?.time ?? timing?.startTime
    const end = location?.end?.time ?? timing?.endTime
    if (start === undefined || !Number.isFinite(start)) return item
    return { ...item, turnTiming: { startedAt: isoTime(start),
      ...(end === undefined || !Number.isFinite(end) ? {} : { endedAt: isoTime(end) }) } }
  })
}

export function projectPendingMessages(inbox: InboxState | undefined, session: ReturnType<SessionBinding['session']['getSnapshot']>): readonly LingPendingMessage[] {
  const items: LingPendingMessage[] = []
  const admitted = new Set<string>()
  for (const [target, delivery] of [['next-turn', 'queue'], ['next-step', 'steer']] as const) {
    for (const message of inbox?.[target] ?? []) {
      // Only user-owned input belongs in the composer queue, never internal Agent messages.
      if (message.source.kind !== 'user') continue
      const rpcId = 'rpcId' in message.source ? String(message.source.rpcId) : undefined
      if (rpcId) admitted.add(rpcId)
      items.push({ id: rpcId ?? String(message.id), queueId: String(message.id), delivery, status: 'pending',
        text: userText(message.content), attachments: contentAttachments(message.content).map(({ kind, name }) => ({ kind, name })) })
    }
  }
  for (const submission of session.pendingSubmissions) {
    if (submission.placement === 'transcript' || admitted.has(String(submission.requestId))) continue
    items.push({ id: String(submission.requestId), delivery: submission.placement === 'queued' ? 'queue' : 'steer', status: 'sending',
      text: submission.text, attachments: submission.attachments.map(attachment => ({ kind: attachment.type, name: attachment.value.name ?? (attachment.type === 'image' ? '图片' : '文件') })) })
  }
  return items
}

export function createDshConversationProjection(conversation: Pick<UiConversation, 'binding'>, readExecutions?: (taskId: string, callIds: readonly string[]) => Promise<readonly LingServerExecution[]>) {
  const sources = new WeakMap<SessionBinding, {
    getSnapshot(): readonly LingTimelineItem[]
    subscribe(listener: () => void): () => void
  }>()

  return {
    pending(binding: SessionBinding) {
      const inbox = binding.session.projections.faceOf('inbox')
      return {
        getSnapshot: () => projectPendingMessages(inbox.getSnapshot() as InboxState | undefined, binding.session.getSnapshot()),
        subscribe(listener: () => void) {
          const stopInbox = inbox.subscribe(listener)
          const stopSession = binding.session.subscribe(listener)
          return () => { stopInbox(); stopSession() }
        },
      }
    },
    timeline(binding: SessionBinding) {
      let projected = sources.get(binding)
      if (projected === undefined) {
        const source = conversation.binding(binding).target('chat')
        const taskId = String(binding.sessionId)
        const executions = new Map<string, LingServerExecution>()
        const listeners = new Set<() => void>()
        let timer: ReturnType<typeof setTimeout> | undefined
        let unsubscribe: (() => void) | undefined
        let generation = 0
        let polling = false
        let dirty = false
        const poll = async () => {
          clearTimeout(timer); timer = undefined
          if (!readExecutions || !listeners.size) return
          if (polling) { dirty = true; return }
          const snapshot = source.getSnapshot()
          if (!snapshot) return
          const calls = serverCalls(snapshot)
          const running = calls.filter(call => !('kind' in call))
          const ids = calls.map(call => call.callId)
            .filter(id => !executions.has(id) || executions.get(id)?.status === 'running')
          if (!ids.length) return
          const current = generation
          polling = true; dirty = false
          try {
            for (let at = 0; at < ids.length; at += 256) {
              const values = await readExecutions(taskId, ids.slice(at, at + 256))
              if (current !== generation || !listeners.size) return
              for (const value of values) executions.set(value.callId, value)
            }
            for (const listener of listeners) listener()
          } catch { /* Keep available logs; reconnect on the next refresh. */ }
          finally {
            polling = false
            if (listeners.size && (dirty || running.length > 0 || ids.some(id => executions.get(id)?.status === 'running'))) {
              timer = setTimeout(() => { void poll() }, dirty ? 0 : 350)
            }
          }
        }
        projected = {
          getSnapshot: () => {
            const snapshot = source.getSnapshot()
            return snapshot === undefined ? [] : projectConversation(taskId, snapshot, [...executions.values()])
          },
          subscribe: listener => {
            listeners.add(listener)
            if (listeners.size === 1) {
              unsubscribe = source.subscribe(() => { for (const fn of listeners) fn(); void poll() })
              void poll()
            }
            return () => {
              listeners.delete(listener)
              if (!listeners.size) { generation++; clearTimeout(timer); timer = undefined; unsubscribe?.(); unsubscribe = undefined }
            }
          },
        }
        sources.set(binding, projected)
      }
      return projected
    },
  }
}
