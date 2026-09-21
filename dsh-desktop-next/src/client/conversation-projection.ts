import type { SessionBinding } from '@deepseek-ai/dsh-api-session-controller/client'
import type {
  AssistantBlock,
  ChatSnapshot,
  CommandNode,
  ConversationNode,
  RunningToolCall,
  ToolResultNode,
} from '@deepseek-ai/dsh-client-ui-chat/client'
import type { UiConversation } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { LingTimelineItem } from 'ling-desktop/runtime'

function isoTime(value: number): string {
  return new Date(value).toISOString()
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

function projectTool(taskId: string, node: RunningToolCall | ToolResultNode, suffix: string): LingTimelineItem {
  const settled = 'kind' in node
  return {
    itemId: `${taskId}:tool:${node.callId}:${suffix}`,
    taskId,
    kind: 'tool-activity',
    title: toolName(node),
    text: toolText(node),
    createdAt: isoTime(node.time),
    status: settled ? (node.isError ? 'failed' : 'completed') : 'running',
  }
}

function projectNode(taskId: string, node: ConversationNode): LingTimelineItem | undefined {
  const base = {
    itemId: `${taskId}:conversation:${String(node.seq)}:${node.kind}`,
    taskId,
    createdAt: isoTime(node.time),
  }
  switch (node.kind) {
    case 'user':
    case 'steering':
      return {
        ...base,
        kind: 'user-message',
        text: contentText(node.content),
        ...(node.kind === 'steering' ? { title: '追加指令' } : {}),
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
      return projectTool(taskId, node, String(node.seq))
    case 'command':
      return {
        ...base,
        kind: 'tool-activity',
        title: node.name === null ? '命令' : `/${node.name}`,
        text: commandText(node),
        status: node.outcome === null ? 'running' : node.outcome.kind === 'success' ? 'completed' : 'failed',
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
        status: node.retryState === 'cancelled' ? 'failed' : 'running',
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

export function projectConversation(taskId: string, snapshot: ChatSnapshot): readonly LingTimelineItem[] {
  const items = snapshot.legacy.nodes.flatMap(node => {
    const item = projectNode(taskId, node)
    return item === undefined || (!item.text && item.kind !== 'tool-activity') ? [] : [item]
  })

  for (const call of snapshot.legacy.runningCalls) {
    items.push(projectTool(taskId, call, 'running'))
  }

  const partial = snapshot.legacy.partial
  if (partial !== null) {
    const text = assistantText(partial.blocks)
    const detail = assistantReasoning(partial.blocks)
    if (text || detail) {
      items.push({
        itemId: `${taskId}:assistant:${String(partial.turn)}:${String(partial.step)}:stream`,
        taskId,
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
      })
    }
  }

  return items
}

export function createDshConversationProjection(conversation: Pick<UiConversation, 'binding'>) {
  const sources = new WeakMap<SessionBinding, {
    getSnapshot(): readonly LingTimelineItem[]
    subscribe(listener: () => void): () => void
  }>()

  return {
    timeline(binding: SessionBinding) {
      let projected = sources.get(binding)
      if (projected === undefined) {
        const source = conversation.binding(binding).target('chat')
        const taskId = String(binding.sessionId)
        projected = {
          getSnapshot: () => {
            const snapshot = source.getSnapshot()
            return snapshot === undefined ? [] : projectConversation(taskId, snapshot)
          },
          subscribe: listener => source.subscribe(listener),
        }
        sources.set(binding, projected)
      }
      return projected
    },
  }
}
