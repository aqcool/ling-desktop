import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type {
  LingCommandResult,
  LingDiscoveredModel,
  LingFileDiff,
  LingModelProvider,
  LingModelSelection,
  LingModelSettings,
  LingPluginEntry,
  LingReadResult,
  LingRuntimeConnection,
  LingSkill,
  LingSubagentCatalog,
  LingTaskAgentPreset,
  LingTaskChanges,
  LingTaskGoal,
  LingTaskMode,
  LingTaskPermission,
  LingTaskSearchMatch,
  LingTimelineItem,
  LingWorkspaceDirectory,
  LingWorkspaceDocument,
  LingWorkspaceEntry,
  LingWorkspaceSummary,
} from '../src/runtime/contract.js'
import { ChangeReview, ConversationChangeSummary } from '../src/ui/ChangeReview.js'
import { AgentPresetPicker } from '../src/ui/AgentPresetPicker.js'
import { Composer, isComposerCommand } from '../src/ui/Composer.js'
import { ComposerNotice, retryPending } from '../src/ui/ComposerNotice.js'
import { Conversation, conversationAnchors, displayTimeline, groupTimeline, placeSelectionToolbar, retrySource, failureSummary } from '../src/ui/Conversation.js'
import { ExtensionSettings } from '../src/ui/ExtensionSettings.js'
import { DocumentBody, FileBrowser, ordered, parentPath, sizeLabel } from '../src/ui/FileBrowser.js'
import { gitDiffRows } from '../src/ui/GitPanel.js'
import { GeneralSettings } from '../src/ui/GeneralSettings.js'
import { SubagentList } from '../src/ui/LingShell.js'
import { Markdown } from '../src/ui/Markdown.js'
import { placeList } from '../src/ui/Menu.js'
import { ModelSettings } from '../src/ui/ModelSettings.js'
import { TaskSearch } from '../src/ui/TaskSearch.js'
import { tw } from '../src/ui/tailwind.js'
import { InteractionPanel } from '../src/ui/InteractionPanel.js'

describe('state-dependent Tailwind utilities', () => {
  it('keeps the selected background and its hover state over the base row', () => {
    const classes = tw('sidebar-task bg-transparent hover:bg-[var(--surface-hover)]', false, 'bg-[var(--surface-selected)] hover:bg-[var(--surface-selected)]')
    expect(classes).not.toContain('bg-transparent')
    expect(classes).not.toContain('hover:bg-[var(--surface-hover)]')
    expect(classes).toContain('sidebar-task bg-[var(--surface-selected)]')
  })

  it('lets maximized workbench columns replace the split while retaining mobile rules', () => {
    const classes = tw('grid grid-cols-[minmax(0,1fr)_minmax(0,44%)] max-[700px]:grid-cols-1', 'grid-cols-[minmax(0,1fr)]')
    expect(classes).not.toContain('grid-cols-[minmax(0,1fr)_minmax(0,44%)]')
    expect(classes).toContain('max-[700px]:grid-cols-1')
    expect(classes).toContain('grid-cols-[minmax(0,1fr)]')
  })
})

const item: LingTimelineItem = {
  itemId: 'item-1',
  taskId: 'task-1',
  kind: 'assistant-message',
  text: '已完成改动。',
  createdAt: '2026-09-22T00:00:00.000Z',
  status: 'completed',
}

describe('conversation message anchors', () => {
  it('groups assistant fragments by user turn and excludes runtime and tool details', () => {
    const timeline: LingTimelineItem[] = [
      { ...item, itemId: 'orphan', text: 'Earlier reply' },
      { ...item, itemId: 'first', kind: 'user-message', text: '请问**更新**了吗？' },
      { ...item, itemId: 'context', kind: 'system-notice', text: 'Private runtime context' },
      { ...item, itemId: 'reply-1', text: '已经更新 `adapter`。' },
      { ...item, itemId: 'tool', kind: 'tool-activity', text: 'Tool output' },
      { ...item, itemId: 'reply-2', text: '通过了[检查](https://example.com)。' },
      { ...item, itemId: 'second', kind: 'user-message', text: '再检查布局' },
      { ...item, itemId: 'reply-3', text: '正在检查。', streaming: true },
    ]
    expect(conversationAnchors(timeline)).toEqual([
      { itemId: 'first', title: '请问更新了吗？', excerpt: '已经更新 adapter。 通过了检查。' },
      { itemId: 'second', title: '再检查布局', excerpt: '正在检查。' },
    ])
    expect(timeline[1]?.text).toBe('请问**更新**了吗？')
  })

  it('retains stable targets when older rounds arrive and names attachment-only messages', () => {
    const attachment: LingTimelineItem = { ...item, itemId: 'image', kind: 'user-message', text: '', attachments: [{ attachmentId: 'a', kind: 'image', name: '界面.png' }] }
    const older: LingTimelineItem = { ...item, itemId: 'older', kind: 'user-message', text: '上一轮' }
    expect(conversationAnchors([older, attachment]).at(-1)).toEqual(conversationAnchors([attachment])[0])
    expect(conversationAnchors([attachment])[0]?.title).toBe('界面.png')
  })

  it('bounds long previews and supports unanswered rounds without placeholder replies', () => {
    expect(conversationAnchors([{ ...item, kind: 'user-message', text: '问题' }])[0]?.excerpt).toBe('')
    const anchors = conversationAnchors([{ ...item, kind: 'user-message', text: '问题' }, { ...item, text: '长'.repeat(2000) }])
    expect(anchors[0]?.excerpt.length).toBe(400)
  })
})

const failed: LingRuntimeConnection = { phase: 'failed', message: 'Host 连接中断。' }

const renderConversation = (
  items: readonly LingTimelineItem[],
  connection: LingRuntimeConnection,
  running = false,
) => renderToStaticMarkup(
  <Conversation
    connection={connection}
    demo={false}
    hasOlder={false}
    items={items}
    loadingOlder={false}
    onLoadOlder={() => {}}
    onReconnect={() => {}}
    running={running}
    onForkAt={() => {}}
    onEditMessage={async () => {}}
    onRetryMessage={async () => {}}
    threadKey="task-1"
  />,
)

describe('message edit and retry actions', () => {
  it('keeps computer actions and screenshots inside the existing process disclosure', () => {
    const markup = renderConversation([{ ...item, itemId: 'desktop', kind: 'tool-activity', title: 'cua_driver_native__get_window_state', text: 'window state', status: 'completed', attachments: [{ attachmentId: 'screen', kind: 'image', name: '窗口截图', mediaType: 'image/png' }] }], { phase: 'ready' })
    expect(markup).toContain('电脑操作 · 查看窗口')
    expect(markup).toContain('窗口截图')
    expect(markup).not.toContain('cua_driver_native__')
  })
  const user: LingTimelineItem = { ...item, itemId: 'user', kind: 'user-message', seq: 1, text: '检查服务' }
  const failure: LingTimelineItem = { ...item, itemId: 'failure', kind: 'system-notice', status: 'failed', text: 'fetch failed' }

  it('offers retry and edit on the latest failed turn only', () => {
    const oldFailure = { ...failure, itemId: 'old-failure' }
    const markup = renderConversation([user, oldFailure, { ...user, itemId: 'new-user', seq: 4 }, failure], { phase: 'ready' })
    expect(markup.match(/aria-label="重试这轮消息"/g)).toHaveLength(1)
    expect(markup).not.toContain('编辑后重试')
    expect(markup.match(/aria-label="编辑问题"/g)).toHaveLength(2)
    expect(retrySource([user, failure])).toEqual({ failureId: 'failure', message: user })
  })

  it('does not retry an earlier turn or a recovered tool failure', () => {
    expect(retrySource([user, failure, { ...user, itemId: 'new' }])).toBeUndefined()
    expect(retrySource([user, { ...failure, kind: 'tool-activity' }, { ...item, turnComplete: true }])).toBeUndefined()
    expect(retrySource([user, failure, { ...item, turnComplete: true }])).toBeUndefined()
    expect(retrySource([failure])).toBeUndefined()
    expect(renderConversation([{ ...item, turnComplete: true }], { phase: 'ready' })).not.toContain('编辑问题')
  })

  it('uses explicit turn ownership and hides retries when the opening question is not loaded', () => {
    const question = { ...user, turn: 2 }
    const failedTurn = { ...failure, turn: 2, retrySourceId: question.itemId }
    expect(retrySource([question, failedTurn])).toEqual({ failureId: failure.itemId, message: question })
    expect(retrySource([question, { ...failedTurn, retrySourceId: undefined }])).toBeUndefined()
    expect(retrySource([{ ...question, turn: 1 }, failedTurn])).toBeUndefined()
    expect(retrySource([question, { ...question, itemId: 'steering' }, failedTurn])).toBeUndefined()
  })

  it('shows a readable failure reason without expanding the technical payload', () => {
    expect(failureSummary({ title: 'TRANSPORT', text: 'fetch failed' })).toBe('连接失败，请检查网络后重试')
    expect(failureSummary({ title: 'TIMEOUT', text: 'timeout' })).toBe('请求超时，请重试')
    expect(failureSummary({ text: 'Error: 远端命令超时。' })).toBe('请求超时，请重试')
    expect(failureSummary({ text: 'Error: invalid arguments: missing required property' })).toBe('工具参数不完整，展开查看详情')
    expect(failureSummary({ title: 'MISSING_CREDENTIAL', text: 'key' })).toBe('请先配置模型凭据')
    expect(renderConversation([user, { ...failure, title: 'TRANSPORT' }], { phase: 'ready' })).toContain('连接失败，请检查网络后重试')
  })

  it('disables message changes while running or disconnected', () => {
    for (const markup of [renderConversation([user, failure], { phase: 'ready' }, true), renderConversation([user, failure], failed)]) {
      expect(markup).toMatch(/<button[^>]*aria-label="重试这轮消息"[^>]*disabled|<button[^>]*disabled[^>]*aria-label="重试这轮消息"/)
      expect(markup).toMatch(/<button[^>]*aria-label="编辑问题"[^>]*disabled|<button[^>]*disabled[^>]*aria-label="编辑问题"/)
    }
  })
})

describe('remote execution and approval UI', () => {
  it('shows plain-language purpose, target, impact and exact command without an opaque call ID', () => {
    const markup = renderToStaticMarkup(<InteractionPanel interactions={[{
      interactionId: 'approval', taskId: 'task', kind: 'approval', toolName: 'server_exec', callId: 'opaque-call-id',
      details: { summary: '重启网站服务以加载新版本', server: '生产服务器', cwd: '/srv/app', impact: '访问可能短暂中断。', command: 'sudo systemctl restart nginx\nsystemctl status nginx --no-pager' },
    }]} onApprove={() => {}} onAnswer={() => {}} onCancel={() => {}} />)
    for (const label of ['重启网站服务以加载新版本', '生产服务器', '/srv/app', '访问可能短暂中断', '查看完整命令', 'sudo systemctl restart nginx', '允许一次', '拒绝']) expect(markup).toContain(label)
    expect(markup).not.toContain('opaque-call-id')
  })

  it('opens the active command and output even when tool details are collapsed by default', () => {
    const execution = { callId: 'call', summary: '构建项目', server: '测试服务器', cwd: '/srv/app', command: 'make', output: 'building 25%\n', status: 'running' as const }
    const markup = renderConversation([{ ...item, kind: 'tool-activity', status: 'running', execution }], { phase: 'ready' }, true)
    expect(markup).toContain('正在执行中')
    expect(markup).toContain('building 25%')
    expect(markup.match(/<details[^>]*open=""/g)).toHaveLength(2)
    const failure = renderConversation([{ ...item, kind: 'tool-activity', status: 'failed', execution: { ...execution, status: 'failed', exitCode: 2 } }], { phase: 'ready' })
    expect(failure).toContain('执行失败')
    expect(failure).toContain('退出码 2')
    expect(failure).toContain('building 25%')
    expect(failure).not.toContain('正在处理')
  })
})

describe('reply actions', () => {
  it('keeps actions on the final response instead of every tool preamble', () => {
    const markup = renderConversation([
      { ...item, itemId: 'progress', seq: 1, text: '先检查。', turnComplete: false },
      { ...item, itemId: 'tool', kind: 'tool-activity', text: '读取文件' },
      { ...item, itemId: 'final', seq: 3, turnComplete: true },
    ], { phase: 'ready' })
    expect(markup.match(/aria-label="复制消息"/g)).toHaveLength(1)
    expect(markup.match(/aria-label="从这条消息分叉"/g)).toHaveLength(1)
    expect(markup.indexOf('复制消息')).toBeGreaterThan(markup.indexOf('已完成改动。'))
  })

  it('retains completed history while suppressing the active turn, including steering', () => {
    const markup = renderConversation([
      { ...item, itemId: 'history', turnComplete: true },
      { ...item, itemId: 'progress', turnComplete: false },
      { ...item, itemId: 'steering', kind: 'user-message', text: '' },
      { ...item, itemId: 'partial', streaming: true, turnComplete: false },
    ], { phase: 'ready' }, true)
    expect(markup.match(/aria-label="复制消息"/g)).toHaveLength(1)
  })

  it('handles adapters without turn metadata and reasoning-only tails', () => {
    expect(renderConversation([item], { phase: 'ready' }, true)).not.toContain('复制消息')
    expect(renderConversation([item, { ...item, itemId: 'last' }], { phase: 'ready' }).match(/aria-label="复制消息"/g)).toHaveLength(1)
    expect(renderConversation([{ ...item, text: '', detail: '检查中' }], { phase: 'ready' })).not.toContain('复制消息')
  })
})

describe('assistant reasoning disclosure', () => {
  it('keeps collapsed reasoning before the answer and renders its Markdown', () => {
    const markup = renderConversation([{ ...item, detail: '**检查实现**\n\n- 确认顺序' }], { phase: 'ready' })
    expect(markup.indexOf('data-reasoning')).toBeLessThan(markup.indexOf('已完成改动。'))
    expect(markup).toContain('已思考')
    expect(markup).toContain('data-state="completed"')
    expect(markup).toMatch(/<strong[^>]*>检查实现<\/strong>/)
    expect(markup).toMatch(/<ul[^>]*>/)
    expect(markup).toMatch(/<details class="timeline-process[^>]*open=""/)
    expect(markup).not.toMatch(/<details class="timeline-activity[^>]*open=""/)
  })

  it('shows the newest thinking line only while the reasoning tail is streaming', () => {
    const thinking = renderConversation([{ ...item, status: 'running', text: '', detail: '第一步\n**最新一步**\n', streaming: true, reasoningStreaming: true }], { phase: 'ready' }, true)
    expect(thinking).toContain('正在思考')
    expect(thinking).toMatch(/<summary[^>]*>.*最新一步.*<\/summary>/)
    const answering = renderConversation([{ ...item, status: 'running', detail: '第一步\n最新一步', streaming: true, reasoningStreaming: false }], { phase: 'ready' }, true)
    const answerSummary = answering.match(/<summary data-reasoning[^>]*>.*?<\/summary>/)?.[0]
    expect(answerSummary).not.toContain('正在思考')
    expect(answerSummary).toContain('已思考')
    expect(answerSummary).toContain('第一步')
  })

  it('omits empty reasoning without hiding the answer', () => {
    const markup = renderConversation([{ ...item, detail: '  \n' }], { phase: 'ready' })
    expect(markup).not.toContain('data-reasoning')
    expect(markup).toContain('已完成改动。')
  })

  it('keeps an attachment-only answer separate from its reasoning preview', () => {
    const attachment = { attachmentId: 'image', name: '结果.png', kind: 'image' as const }
    const events = [{ ...item, text: '', detail: '检查截图', attachments: [attachment] }]
    const groups = displayTimeline(events, false, false)
    expect(groups[0]?.items[0]?.attachments).toBeUndefined()
    expect(groups[1]?.items[0]?.attachments).toEqual([attachment])
    const markup = renderConversation(events, { phase: 'ready' })
    expect(markup.match(/timeline-item__attachment-name/g)).toHaveLength(1)
    expect(markup).toContain('结果.png')
  })
})

const renderComposer = (
  disabled: boolean,
  permission?: LingTaskPermission,
  mode?: LingTaskMode,
  value = '继续修复测试',
  recordedAttachments?: readonly import('../src/runtime/contract.js').LingTimelineAttachment[],
) => renderToStaticMarkup(
  <Composer
    attachments={[]}
    recordedAttachments={recordedAttachments}
    disabled={disabled}
    hasTask
    modelLabel="DeepSeek Chat"
    taskScoped={false}
    mode={mode}
    onChange={() => {}}
    onAddFiles={() => {}}
    onGoalAction={() => {}}
    onPlanModeToggle={() => {}}
    onRemoveAttachment={() => {}}
    onSelectModel={() => {}}
    onOpenModelSettings={() => {}}
    onSelectPermission={() => {}}
    onSubmit={() => {}}
    onStop={() => {}}
    permission={permission}
    running={false}
    taskId="task-1"
    value={value}
  />,
)

describe('edited message composer', () => {
  it('shows retained original attachments with removal and enables attachment-only sending', () => {
    const markup = renderComposer(false, undefined, undefined, '', [{ attachmentId: 'original-file', kind: 'file', name: '原文件.txt', bytes: 1024 }])
    expect(markup).toContain('原文件.txt')
    expect(markup).toContain('1.0 KB')
    expect(markup).toContain('aria-label="移除附件"')
    expect(markup).not.toMatch(/<button[^>]*aria-label="发送消息"[^>]*disabled|<button[^>]*disabled[^>]*aria-label="发送消息"/)
  })
})

describe('conversation connection affordance', () => {
  it('keeps the reconnect entry visible while an existing conversation is disconnected', () => {
    const markup = renderConversation([item], failed)

    expect(markup).toContain('connection-strip')
    expect(markup).toContain('Host 连接中断。')
    expect(markup).toContain('重新连接')
    expect(markup).toContain('timeline-item')
  })

  it('shows the same entry on the new-task screen and hides it once ready', () => {
    expect(renderConversation([], failed)).toContain('connection-strip')
    expect(renderConversation([item], { phase: 'ready' })).not.toContain('connection-strip')
    expect(renderConversation([], { phase: 'ready' })).not.toContain('connection-strip')
  })
})

describe('conversation process disclosure', () => {
  it('joins reasoning-only messages with adjacent tools while keeping the answer and its actions separate', () => {
    const thought = { ...item, itemId: 'thought', text: '', detail: '先检查文件' }
    const tool = { ...item, itemId: 'tool', kind: 'tool-activity' as const, text: '文件内容' }
    const answer = { ...item, itemId: 'answer', detail: '汇总检查结果', turnComplete: true }
    const events = [thought, tool, answer]
    for (const collapse of [false, true]) {
      const groups = displayTimeline(events, false, collapse)
      expect(groups.map(group => [group.process, group.items.map(event => [event.itemId, event.presentation])])).toEqual([
        [true, [['thought', 'reasoning'], ['tool', undefined], ['answer', 'reasoning']]],
        [false, [['answer', undefined]]],
      ])
      expect(groups[1]?.items[0]?.text).toBe(answer.text)
      expect(groups[1]?.items[0]?.detail).toBeUndefined()
    }
    expect(answer.detail).toBe('汇总检查结果')
    const markup = renderConversation(events, { phase: 'ready' })
    expect(markup.match(/class="timeline-process/g)).toHaveLength(1)
    expect(markup.match(/aria-label="复制消息"/g)).toHaveLength(1)
    expect(markup.match(/data-conversation-message="answer"/g)).toHaveLength(1)
  })

  it('opens the current process preview without exposing the entire tool result by default', () => {
    const markup = renderConversation([{ ...item, kind: 'tool-activity', status: 'running', title: 'Shell', text: 'ls src\n完整输出' }], { phase: 'ready' }, true)
    expect(markup).toMatch(/<details class="timeline-process[^>]*open=""/)
    expect(markup).not.toMatch(/<details class="timeline-activity[^>]*open=""/)
    expect(markup).toContain('Shell 运行中')
    const summary = markup.match(/<details class="timeline-activity[^>]*><summary[^>]*>(.*?)<\/summary>/)?.[1]
    expect(summary).toContain('ls src')
    expect(summary).not.toContain('完整输出')
    expect(markup).toContain('完整输出')
  })

  it('groups adjacent context and tool events without swallowing messages or failures', () => {
    const events: readonly LingTimelineItem[] = [
      { ...item, itemId: 'user', kind: 'user-message', text: '检查项目' },
      { ...item, itemId: 'context', kind: 'system-notice', title: 'AGENTS.md', text: '完整项目约束' },
      { ...item, itemId: 'tool', kind: 'tool-activity', text: '读取文件' },
      { ...item, itemId: 'failure', kind: 'system-notice', status: 'failed', title: 'MISSING_CREDENTIAL', text: '错误原文' },
      item,
    ]
    const groups = groupTimeline(events)
    expect(groups.map(group => [group.process, group.items.map(event => event.itemId)])).toEqual([
      [false, ['user']], [true, ['context', 'tool']], [false, ['failure']], [false, ['item-1']],
    ])
    const markup = renderConversation(events, { phase: 'ready' })
    expect(markup).toMatch(/<details class="timeline-process[^>]*><summary/)
    expect(markup).toContain('完整项目约束')
    expect(markup).toContain('模型尚未配置')
    expect(markup).toContain('查看错误详情')
    expect(markup).toContain('错误原文')
  })

  it('stops presenting stale processing after a failed turn while keeping new activity live', () => {
    const failedTurn: LingTimelineItem[] = [
      { ...item, itemId: 'user-failed', kind: 'user-message', text: '查看服务器状态' },
      { ...item, itemId: 'old-process', kind: 'system-notice', status: 'running', text: '正在检查' },
      { ...item, itemId: 'failure', kind: 'system-notice', status: 'failed', title: 'TRANSPORT', text: 'DeepSeek Messages transport failed' },
    ]
    for (const running of [false, true]) {
      const markup = renderConversation(failedTurn, { phase: 'ready' }, running)
      expect(markup).not.toContain('正在执行中')
      expect(markup).not.toContain('进行中')
      expect(markup).toContain('任务未能完成')
    }

    const newTurn: LingTimelineItem[] = [
      ...failedTurn,
      { ...item, itemId: 'user-new', kind: 'user-message', text: '重试' },
      { ...item, itemId: 'new-process', kind: 'system-notice', status: 'running', text: '重新检查' },
    ]
    const markup = renderConversation(newTurn, { phase: 'ready' }, true)
    expect(markup.match(/正在执行中/g)).toHaveLength(1)
    expect(markup.match(/进行中/g)).toHaveLength(1)
  })
})

describe('composer send gating', () => {
  it('refuses to send while the runtime is not ready and states why', () => {
    const markup = renderComposer(true)

    expect(markup).toMatch(/class="composer__send\b[^"]*"[^>]*disabled/)
    expect(markup).toContain('运行时未连接，暂时无法发送')
  })

  it('sends when the runtime is ready and a message exists', () => {
    const markup = renderComposer(false)

    expect(markup).not.toMatch(/class="composer__send\b[^"]*"[^>]*disabled/)
  })

  it('keeps the draft editable while sending is blocked', () => {
    const markup = renderComposer(true)

    expect(markup).toContain('继续修复测试')
    expect(markup).not.toMatch(/class="composer__textarea\b[^"]*"[^>]*disabled/)
  })
})

describe('composer permission preset', () => {
  it.each([
    ['read-only', '只读'],
    ['workspace-write', '询问审批'],
    ['danger-full-access', '完全访问'],
  ])('localizes the runtime preset %s without exposing its configuration name', (value, label) => {
    const markup = renderComposer(false, { currentValue: value, options: [{ value, label: value }] })
    expect(markup).toContain(label)
    expect(markup).not.toContain(`>${value}<`)
  })

  it('keeps a custom preset display name supplied by the runtime', () => {
    const markup = renderComposer(false, { currentValue: 'custom-safe', options: [{ value: 'custom-safe', label: '团队审批' }] })
    expect(markup).toContain('团队审批')
  })

  const presets: LingTaskPermission = {
    currentValue: 'auto',
    options: [
      { label: '只读', value: 'read-only' },
      { label: '自动放行', value: 'auto' },
    ],
  }

  it('hides the preset pill when the runtime exposes no catalog', () => {
    expect(renderComposer(false)).not.toContain('切换权限预设')
  })

  it('shows the current preset name once a catalog exists', () => {
    const markup = renderComposer(false, presets)

    expect(markup).toContain('切换权限预设')
    expect(markup).toContain('自动审批')
    expect(markup).not.toContain('完全访问')
  })

  it('falls back to the raw value when the current preset is not in the catalog', () => {
    const markup = renderComposer(false, { ...presets, currentValue: 'sandbox' })

    expect(markup).toContain('sandbox')
  })
})

describe('composer plan and goal mode', () => {
  const goal: LingTaskGoal = {
    goalId: 'goal-1',
    revision: 3,
    objective: '修复全部失败的门禁',
    phase: 'active',
    roundsStarted: 2,
    maxGoalRounds: 8,
  }

  it('hides the plan pill and goal bar when the runtime exposes no mode', () => {
    const markup = renderComposer(false)

    expect(markup).not.toContain('切换计划模式')
    expect(markup).not.toContain('composer__goal')
  })

  it('keeps the toolbar free of inactive mode controls', () => {
    const markup = renderComposer(false, undefined, { planActive: false, planPending: false })

    expect(markup).not.toContain('关闭计划模式')
    expect(markup).not.toContain('composer__mode')
  })

  it('marks the plan pill active while plan mode runs', () => {
    const markup = renderComposer(false, undefined, { planActive: true, planPending: false })

    expect(markup).toContain('关闭计划模式')
    expect(markup).toContain('composer__mode')
    expect(markup.indexOf('composer__mode')).toBeLessThan(markup.indexOf('composer__submit'))
    expect(markup).toContain('aria-pressed="true"')
  })

  it('shows draft modes as chips without leaking command syntax into the textarea', () => {
    for (const [mode, label] of [['goal', '目标'], ['plan', '计划']]) {
      const markup = renderComposer(false, undefined, undefined, `/${mode} 保留这段草稿`)
      expect(markup).toContain(`关闭${label}模式`)
      expect(markup).toMatch(/<textarea[^>]*>保留这段草稿<\/textarea>/u)
      expect(markup).not.toContain(`/${mode} `)
    }
  })

  it('does not turn the explicit plan exit command into a mode draft', () => {
    const markup = renderComposer(false, undefined, undefined, '/plan off')
    expect(markup).not.toContain('关闭计划模式')
    expect(markup).toContain('/plan off')
  })

  it('presents the goal objective, phase and round counter', () => {
    const markup = renderComposer(false, undefined, { goal })

    expect(markup).toContain('修复全部失败的门禁')
    expect(markup).toContain('进行中')
    expect(markup).toContain('轮次 2/8')
    expect(markup).toContain('暂停')
    expect(markup).toContain('完成')
    expect(markup).not.toContain('继续</button>')
  })

  it('offers resume and remove only for a paused goal', () => {
    const markup = renderComposer(false, undefined, { goal: { ...goal, phase: 'paused' } })

    expect(markup).toContain('已暂停')
    expect(markup).toContain('继续</button>')
    expect(markup).toContain('移除')
    expect(markup).not.toContain('暂停</button>')
  })

  it('shows the blocked reason through the objective title', () => {
    const markup = renderComposer(false, undefined, {
      goal: { ...goal, phase: 'blocked', blockedReason: '缺少凭据' },
    })

    expect(markup).toContain('受阻')
    expect(markup).toContain('title="缺少凭据"')
  })

  it('keeps only remove for a completed goal', () => {
    const markup = renderComposer(false, undefined, { goal: { ...goal, phase: 'complete' } })

    expect(markup).toContain('已完成')
    expect(markup).toContain('移除')
    expect(markup).not.toContain('完成</button>')
  })
})

const effortProvider: LingModelProvider = {
  providerId: 'deepseek-official',
  displayName: 'DeepSeek',
  active: true,
  configurable: true,
  configured: true,
  credential: 'configured',
  canStoreApiKey: true,
  models: [
    { id: 'deepseek-chat', name: 'DeepSeek Chat' },
    {
      id: 'deepseek-reasoner',
      name: 'DeepSeek Reasoner',
      efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High', description: '深度推理' }],
    },
  ],
}

const renderTaskModelPill = (taskScoped: boolean, taskModel?: LingModelSelection) => renderToStaticMarkup(
  <Composer
    attachments={[]}
    disabled={false}
    hasTask
    modelLabel="DeepSeek Reasoner"
    modelSettings={{
      defaultSelection: { provider: 'deepseek-official', model: 'deepseek-chat' },
      providers: [effortProvider],
      writable: true,
    }}
    onChange={() => {}}
    onAddFiles={() => {}}
    onGoalAction={() => {}}
    onPlanModeToggle={() => {}}
    onRemoveAttachment={() => {}}
    onSelectModel={() => {}}
    onOpenModelSettings={() => {}}
    onSelectPermission={() => {}}
    onSubmit={() => {}}
    onStop={() => {}}
    running={false}
    taskModel={taskModel}
    taskScoped={taskScoped}
    taskId="task-1"
    value="继续修复测试"
  />,
)

describe('composer reasoning effort', () => {
  it('shows the selected task effort on the model pill', () => {
    const markup = renderTaskModelPill(true, {
      provider: 'deepseek-official',
      model: 'deepseek-reasoner',
      reasoningEffort: 'high',
    })

    expect(markup).toContain('DeepSeek Reasoner')
    expect(markup).toMatch(/>高<\/span>/)
  })

  it('leaves the pill unmarked while the provider default effort applies', () => {
    const markup = renderTaskModelPill(true, {
      provider: 'deepseek-official',
      model: 'deepseek-reasoner',
    })

    expect(markup).toContain('DeepSeek Reasoner')
    expect(markup).not.toMatch(/>高<\/span>/)
  })

  it('ignores efforts for a model that declares none', () => {
    const markup = renderTaskModelPill(true, {
      provider: 'deepseek-official',
      model: 'deepseek-chat',
      reasoningEffort: 'high',
    })

    expect(markup).not.toMatch(/>高<\/span>/)
  })

  it('keeps effort out of the global default model pill', () => {
    const markup = renderTaskModelPill(false, {
      provider: 'deepseek-official',
      model: 'deepseek-reasoner',
      reasoningEffort: 'high',
    })

    expect(markup).not.toMatch(/>高<\/span>/)
  })
})

describe('conversation message meta', () => {
  it('shows when a message was authored', () => {
    const markup = renderConversation([{ ...item, createdAt: '2026-09-22T01:05:00.000Z' }], { phase: 'ready' })

    expect(markup).toMatch(/<time[^>]*dateTime="2026-09-22T01:05:00\.000Z"/)
    expect(markup).toMatch(/<time[^>]*>\d{2}:\d{2}<\/time>/)
  })

  it('shows no time when the runtime did not provide one', () => {
    expect(renderConversation([{ ...item, createdAt: '' }], { phase: 'ready' })).not.toContain('<time')
  })
})

describe('conversation content structure', () => {
  it('keeps nested bullets under the correct numbered item across blank lines', () => {
    const markup = renderToStaticMarkup(<Markdown chat source={'1. 第一项\n\n   继续说明\n   - 子项 A\n   - 子项 B\n\n2. 第二项\n   - 子项 C'} />)
    expect(markup.match(/<ol /g)).toHaveLength(1)
    expect(markup.match(/<ul /g)).toHaveLength(2)
    expect(markup).toMatch(/子项 B<\/li>\s*<\/ul>\s*<\/li>\s*<li/)
    expect(markup).not.toContain('- 子项')
  })

  it('preserves an explicit starting number and nested emphasis with inline code', () => {
    const markup = renderToStaticMarkup(<Markdown source={'4. **检查 `main` 分支**\n5. *继续*'} />)
    expect(markup).toContain('start="4"')
    expect(markup).toMatch(/<strong[^>]*>检查 <code[^>]*>main<\/code> 分支<\/strong>/)
    expect(markup).toContain('>继续</em>')
  })

  it('renders an unfinished streaming fence as code and keeps HTML inert', () => {
    const markup = renderToStaticMarkup(<Markdown source={'<script>alert(1)</script>\n\n```ts\nconst value = 1'} />)
    expect(markup).not.toContain('<script>')
    expect(markup).toContain('md__pre-wrap')
    expect(markup).toContain('const value = 1')
  })

  it('uses real change totals and initially shows only the first three files', () => {
    const files = Array.from({ length: 5 }, (_, index) => ({ path: `file-${index}.ts`, display: `file-${index}.ts`, added: index, deleted: 0 }))
    const markup = renderToStaticMarkup(<ConversationChangeSummary change={{ taskId: 'task-1', turn: 2, seq: 12, total: 5, added: 10, deleted: 0, files }} onSelect={() => undefined} />)
    expect(markup).toContain('第 2 轮文件变更')
    expect(markup).toContain('再显示 2 个文件')
    expect(markup).toContain('file-2.ts')
    expect(markup).not.toContain('file-3.ts')
    expect(markup).toContain('审阅')
  })

  it('keeps soft lines in one paragraph and separates paragraphs at blank lines', () => {
    const markup = renderToStaticMarkup(<Markdown chat source={'第一行\n第二行\n\n下一段\n\n- 项目一\n- 项目二'} />)
    expect(markup.match(/<p /g)).toHaveLength(2)
    expect(markup).toContain('第一行\n第二行')
    expect(markup.match(/<li/g)).toHaveLength(2)
  })

  it('preserves user text literally instead of interpreting Markdown instructions', () => {
    const markup = renderConversation([{ ...item, kind: 'user-message', text: '# 请保留标题语法\n**原文**' }], { phase: 'ready' })
    expect(markup).toContain('# 请保留标题语法\n**原文**')
    expect(markup).not.toContain('md__h')
    expect(markup).toContain('复制消息')
  })

  it('counts tools without counting injected context as tool executions', () => {
    const markup = renderConversation([
      { ...item, itemId: 'context', kind: 'system-notice', text: '上下文' },
      { ...item, itemId: 'tool', kind: 'tool-activity', text: '读取文件' },
    ], { phase: 'ready' })
    expect(markup).toContain('执行工具 1 次')
    expect(markup).not.toContain('执行工具 2 次')
  })
})

describe('markdown media', () => {
  it('renders an https image with its alt text', () => {
    const markup = renderToStaticMarkup(<Markdown source={'构建结果：\n\n![失败输出](https://img.example.com/a.png)'} />)

    expect(markup).toContain('src="https://img.example.com/a.png"')
    expect(markup).toContain('alt="失败输出"')
  })

  it('refuses to load media over a non-http protocol', () => {
    const markup = renderToStaticMarkup(<Markdown source={'![x](javascript:alert(1))'} />)

    expect(markup).not.toContain('<img')
    expect(markup).toContain('![x]')
  })

  it('keeps links and images in the same line', () => {
    const markup = renderToStaticMarkup(<Markdown source={'参考 [文档](https://example.com/d) 中的 ![图](https://example.com/i.png)'} />)

    expect(markup).toMatch(/<a class="md__link\b/)
    expect(markup).toContain('<img alt="图"')
  })
})

describe('markdown tables', () => {
  it('renders header and body cells', () => {
    const markup = renderToStaticMarkup(
      <Markdown source={'| 文件 | 状态 |\n| --- | --- |\n| Composer.tsx | 已改 |\n| Menu.tsx | 已改 |'} />,
    )

    expect(markup).toMatch(/<table class="md__table\b/)
    expect(markup).toContain('<th')
    expect((markup.match(/<td/gu) ?? []).length).toBe(4)
    expect(markup).toContain('Composer.tsx')
    expect(markup).toContain('已改')
  })

  it('applies the column alignment from the delimiter row', () => {
    const markup = renderToStaticMarkup(<Markdown source={'| 名称 | 数量 |\n| :--- | ---: |\n| 任务 | 12 |'} />)

    expect(markup).toMatch(/class="md__cell--right\b/)
    expect(markup).not.toContain('md__cell--center')
  })

  it('keeps an escaped pipe inside one cell', () => {
    const markup = renderToStaticMarkup(<Markdown source={'| 表达式 |\n| --- |\n| a \\|\\| b |'} />)

    expect(markup).toContain('a || b')
    expect(markup).not.toContain('\u0000')
  })

  it('pads a short row to the header column count', () => {
    const markup = renderToStaticMarkup(<Markdown source={'| a | b | c |\n| --- | --- | --- |\n| 1 | 2 |'} />)

    expect((markup.match(/<td/gu) ?? []).length).toBe(3)
  })

  it('ends the table at the first line without a pipe', () => {
    const markup = renderToStaticMarkup(
      <Markdown source={'| a | b |\n| --- | --- |\n| 1 | 2 |\n\n后续说明'} />,
    )

    expect(markup).toMatch(/<table class="md__table\b/)
    expect(markup).toMatch(/<p class="md__p\b[^"]*">后续说明<\/p>/)
  })

  it('leaves a pipe-bearing sentence as plain text', () => {
    const markup = renderToStaticMarkup(<Markdown source={'运行 yarn check | tee 输出'} />)

    expect(markup).not.toContain('<table')
    expect(markup).toMatch(/<p class="md__p\b/)
  })
})

describe('task search attribution', () => {
  const workspaces: readonly LingWorkspaceSummary[] = [
    { label: 'ling-desktop', locationLabel: '~/Desktop/ling-desktop', workspaceId: 'ws-ling' },
  ]
  const match: LingTaskSearchMatch = {
    snippet: '把投影逻辑收敛到 adapter',
    taskId: 'task-9',
    title: '收敛投影',
    workspaceId: 'ws-ling',
  }

  const renderSearch = (results: readonly LingTaskSearchMatch[]) => renderToStaticMarkup(
    <TaskSearch
      hasMore={false}
      isLoading={false}
      onClose={() => {}}
      onQueryChange={() => {}}
      onSelect={() => {}}
      open
      query="投影"
      results={results}
      workspaces={workspaces}
    />,
  )

  it('names the workspace each result belongs to', () => {
    expect(renderSearch([match])).toContain('ling-desktop')
  })

  it('shows no workspace label for a result outside every known workspace', () => {
    expect(renderSearch([{ ...match, workspaceId: 'ws-removed' }])).not.toContain('ling-desktop')
  })
})

describe('menu list placement', () => {
  const viewport = { height: 900, width: 1440 }
  const list = { height: 200, width: 200 }

  it('opens below the trigger with full height while the viewport has room', () => {
    expect(placeList({ bottom: 400, left: 100, right: 300, top: 370 }, list, viewport, 'start'))
      .toEqual({ left: 100, maxHeight: 200, top: 406 })
  })

  it('opens above the trigger when the list would fall below the viewport', () => {
    const placement = placeList({ bottom: 880, left: 100, right: 300, top: 848 }, list, viewport, 'start')

    expect(placement.top).toBe(642)
    expect(placement.top + placement.maxHeight).toBeLessThanOrEqual(viewport.height)
  })

  it('keeps a right-aligned list inside a narrow viewport', () => {
    expect(placeList({ bottom: 400, left: 20, right: 60, top: 370 }, list, { height: 900, width: 80 }, 'end').left)
      .toBe(8)
  })
})

describe('conversation selection toolbar placement', () => {
  const bounds = { bottom: 700, left: 100, right: 900, top: 100 }
  const toolbar = { height: 56, width: 320 }

  it('centers above the complete selection bounds', () => {
    expect(placeSelectionToolbar({ bottom: 340, left: 300, right: 700, top: 250 }, toolbar, bounds))
      .toEqual({ left: 340, side: 'top', top: 190 })
  })

  it('uses the union bounds of a multi-line selection rather than its first line', () => {
    const placement = placeSelectionToolbar({ bottom: 420, left: 220, right: 780, top: 250 }, toolbar, bounds)

    expect(placement.left + toolbar.width / 2).toBe(500)
  })

  it('uses the nearest selection edge when centering would hit a horizontal boundary', () => {
    expect(placeSelectionToolbar({ bottom: 340, left: 110, right: 170, top: 250 }, toolbar, bounds).left).toBe(110)
    expect(placeSelectionToolbar({ bottom: 340, left: 830, right: 890, top: 250 }, toolbar, bounds).left).toBe(570)
  })

  it('moves below a selection when the top safe area has no room', () => {
    expect(placeSelectionToolbar({ bottom: 130, left: 300, right: 700, top: 110 }, toolbar, bounds))
      .toEqual({ left: 340, side: 'bottom', top: 134 })
  })
})

describe('composer notice', () => {
  const rejected = (retryable: boolean): LingCommandResult => ({
    accepted: false,
    message: 'Host 连接中断。',
    reason: 'runtime-unavailable',
    requestId: 'req-1',
    retryable,
  })
  const runner = async (): Promise<LingCommandResult> => rejected(false)

  it('states the rejection without a retry affordance when the action cannot be re-run', () => {
    const markup = renderToStaticMarkup(<ComposerNotice message='任务不存在。' />)

    expect(markup).toMatch(/<p class="composer-notice\b[^"]*" role="status">/)
    expect(markup).toContain('任务不存在。')
    expect(markup).not.toContain('<button')
  })

  it('offers 重试 when the rejected action can be re-run', () => {
    const markup = renderToStaticMarkup(<ComposerNotice message='Host 连接中断。' onRetry={() => {}} />)

    expect(markup).toMatch(/class="composer-notice__retry\b/)
    expect(markup).toContain('重试')
  })

  it('gates the retry affordance on the retryable flag and a runner', () => {
    expect(retryPending(rejected(true), runner)).toBe(true)
    expect(retryPending(rejected(false), runner)).toBe(false)
    expect(retryPending(rejected(true), undefined)).toBe(false)
    expect(retryPending({ accepted: true, requestId: 'req-1' }, runner)).toBe(false)
  })
})

const hostedProvider: LingModelProvider = {
  providerId: 'runtime-host',
  displayName: 'Runtime Host',
  active: true,
  configurable: false,
  configured: true,
  credential: 'not-required',
  canStoreApiKey: false,
  models: [{ id: 'host-model', name: 'Host Model', description: '长上下文，支持工具调用' }],
}

const editableProvider: LingModelProvider = {
  providerId: 'openai',
  displayName: 'OpenAI',
  active: true,
  configurable: true,
  configured: false,
  credential: 'missing',
  canStoreApiKey: true,
  models: [{ id: 'gpt', name: 'GPT' }],
}

const customProvider: LingModelProvider = {
  ...editableProvider,
  providerId: 'acme',
  displayName: 'Acme',
  configured: true,
  canEdit: true,
  canDelete: true,
  canTest: true,
  draft: {
    providerId: 'acme',
    baseUrl: 'https://api.acme.test/v1',
    protocol: 'openai-responses',
    models: [{ id: 'acme-code', name: 'Acme Code' }],
  },
  models: [{ id: 'acme-code', name: 'Acme Code' }],
}

const testOnlyProvider: LingModelProvider = {
  ...customProvider,
  canEdit: false,
  canDelete: false,
}

const accepted: LingCommandResult = { accepted: true, requestId: 'req-1' }
const runCommand = async (): Promise<LingCommandResult> => accepted
const readModels = async (): Promise<LingReadResult<readonly LingDiscoveredModel[]>> => ({ ok: true, value: [] })

const renderModelSettings = (
  providers: readonly LingModelProvider[],
  defaultSelection: LingModelSelection,
) => renderToStaticMarkup(
  <ModelSettings
    loading={false}
    onCreateCustomProvider={runCommand}
    onDeleteProvider={runCommand}
    onRefresh={() => {}}
    onSaveApiKey={runCommand}
    onSelectDefault={runCommand}
    onModelEnabledChange={async () => undefined}
    onTestProvider={readModels}
    onUpdateCustomProvider={runCommand}
    settings={{ defaultSelection, providers, writable: true }}
  />,
)

describe('model settings catalog', () => {
  it('renders each available model as a compact row without marketing copy', () => {
    const markup = renderModelSettings([hostedProvider, editableProvider], {
      model: 'host-model',
      provider: 'runtime-host',
    })

    expect(markup).toMatch(/class="model-provider__row\b/)
    expect(markup).toContain('Host Model')
    expect(markup).toContain('Runtime Host')
    expect(markup).not.toContain('长上下文，支持工具调用')
    expect(markup).toContain('model-provider__default--selected')
    expect(markup).toContain('aria-label="启用Host Model"')
  })

  it('keeps a disabled model in management while removing its default action', () => {
    const provider = { ...hostedProvider, models: hostedProvider.models.map(model => ({ ...model, enabled: false })) }
    const markup = renderModelSettings([provider], { model: 'another-model', provider: 'runtime-host' })

    expect(markup).toContain('Host Model')
    expect(markup).toContain('aria-label="启用Host Model"')
    expect(markup).not.toContain('将Host Model设为默认模型')
  })

  it('hides empty unconfigured providers from the main model list', () => {
    const emptyProvider = { ...editableProvider, models: [] }
    const markup = renderModelSettings([hostedProvider, emptyProvider], {
      model: 'host-model',
      provider: 'runtime-host',
    })

    expect(markup).toContain('Host Model')
    expect(markup).not.toContain('OpenAI')
    expect(markup).not.toContain('runtime-host-api-key')
    expect(markup).not.toContain('openai-api-key')
  })

  it('flags a default model that is not in the discovered catalog', () => {
    const markup = renderModelSettings([editableProvider], { model: 'removed-model', provider: 'openai' })

    expect(markup).toContain('model-settings__warning')
    expect(markup).toContain('当前默认模型已不可用')
  })

  it('keeps provider operations behind one compact action per provider', () => {
    const markup = renderModelSettings([customProvider, testOnlyProvider], { model: 'acme-code', provider: 'acme' })

    expect(markup.match(/aria-label="管理Acme连接"/g)).toHaveLength(2)
    expect(markup).not.toContain('model-provider__actions-row')
    expect(markup).not.toContain('测试连接')
  })
})

const changedFile = { path: 'src/runtime/a.ts', display: 'src/runtime/a.ts', added: 3, deleted: 1 }

const changeList: readonly LingTaskChanges[] = [{
  taskId: 'task-1',
  turn: 1,
  seq: 1,
  files: [changedFile],
  total: 1,
  added: 3,
  deleted: 1,
}]

type TextDiff = Extract<LingFileDiff, { kind: 'text' }>

const textDiff: TextDiff = {
  kind: 'text',
  path: changedFile.path,
  display: changedFile.display,
  before: true,
  after: true,
  hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 3, lines: ['-old', '+new', '+again'] }],
  coarse: false,
}

const renderDiff = (diff: LingFileDiff) => renderToStaticMarkup(
  <ChangeReview
    changes={changeList}
    diff={diff}
    diffLoading={false}
    loading={false}
    onCloseDiff={() => {}}
    onSelect={() => {}}
    selection={{ index: 0, seq: 1 }}
  />,
)

describe('change review diff', () => {
  it('names a file the turn created from the diff existence flags', () => {
    const markup = renderDiff({ ...textDiff, before: false })

    expect(markup).toMatch(/class="[^"]*\bchange-review__file-tag--added\b/)
    expect(markup).toContain('本轮新增')
    expect(markup).not.toContain('本轮删除')
  })

  it('names a file the turn removed', () => {
    const markup = renderDiff({ ...textDiff, after: false })

    expect(markup).toMatch(/class="[^"]*\bchange-review__file-tag--deleted\b/)
    expect(markup).toContain('本轮删除')
    expect(markup).not.toContain('本轮新增')
  })

  it('marks a whole-file replacement without lifecycle tags for an edited file', () => {
    const markup = renderDiff({ ...textDiff, coarse: true })

    expect(markup).toContain('简化比较')
    expect(markup).not.toMatch(/class="[^"]*\bchange-review__file-tag--added\b/)
    expect(markup).not.toMatch(/class="[^"]*\bchange-review__file-tag--deleted\b/)
  })

  it('states a binary file instead of hunks', () => {
    const markup = renderDiff({ kind: 'binary', path: changedFile.path, display: changedFile.display })

    expect(markup).toContain('这是二进制文件')
    expect(markup).not.toMatch(/class="[^"]*\bchange-review__file-tag--/)
  })
})

const idleDirectory: LingReadResult<LingWorkspaceDirectory> = {
  ok: true,
  value: { path: '', entries: [], truncated: false },
}
const idleDocument: LingReadResult<LingWorkspaceDocument> = {
  ok: true,
  value: { path: '', kind: 'text', mediaType: 'text/plain', text: '', lines: 0, truncated: false },
}

describe('workspace file browser', () => {
  it('keeps the file tree beside an empty preview while loading the workspace root', () => {
    const markup = renderToStaticMarkup(
      <FileBrowser
        loadDirectory={async () => idleDirectory}
        loadDocument={async () => idleDocument}
        taskId="session-1"
      />,
    )

    expect(markup).toContain('workspace-files__preview')
    expect(markup).toContain('workspace-files__sidebar')
    expect(markup).toContain('选择一个文件')
    expect(markup).toContain('正在读取目录')
    expect(markup).not.toContain('workspace-files__entry')
  })

  it('steps back one directory at a time from the selected path', () => {
    expect(parentPath('src/client/index.ts')).toBe('src/client')
    expect(parentPath('notes')).toBe('')
  })

  it('keeps directories ahead of files in the order the host reported', () => {
    const entries: LingWorkspaceEntry[] = [
      { name: 'zest.ts', path: 'zest.ts', kind: 'file' },
      { name: 'notes', path: 'notes', kind: 'directory' },
      { name: 'plan.md', path: 'plan.md', kind: 'file' },
    ]

    expect(ordered(entries).map(entry => entry.name)).toEqual(['notes', 'plan.md', 'zest.ts'])
  })

  it('sizes only the entries whose listing carried a byte count', () => {
    expect(sizeLabel(undefined)).toBe('')
    expect(sizeLabel(900)).toBe('900 B')
    expect(sizeLabel(2048)).toBe('2 KB')
    expect(sizeLabel(3 * 1024 * 1024)).toBe('3.0 MB')
  })

  it('renders markdown documents as rich text and notes the preview limit', () => {
    const markup = renderToStaticMarkup(
      <DocumentBody document={{ path: 'plan.md', kind: 'markdown', mediaType: 'text/markdown', text: '# 计划', lines: 600, truncated: true }} />,
    )

    expect(markup).toContain('md__h-1')
    expect(markup).toContain('计划')
    expect(markup).toContain('文件较大，此处只读取了前 600 行。')
    expect(markup).not.toContain('file-browser__line')
  })

  it('renders image and PDF documents as embedded previews', () => {
    const image = renderToStaticMarkup(
      <DocumentBody document={{ path: 'shot.png', kind: 'image', mediaType: 'image/png', data: 'AAAA', bytes: 4 }} />,
    )
    expect(image).toContain('document-preview__image')
    expect(image).toContain('data:image/png;base64,AAAA')

    const pdf = renderToStaticMarkup(
      <DocumentBody document={{ path: 'report.docx', kind: 'pdf', mediaType: 'application/pdf', data: 'BBBB', converted: true, missingFonts: ['Fancy Sans'] }} />,
    )
    expect(pdf).toContain('document-preview__pdf')
    expect(pdf).toContain('data:application/pdf;base64,BBBB')
    expect(pdf).toContain('Office 文档已转换为 PDF 预览。')
    expect(pdf).toContain('转换时缺少字体：Fancy Sans')
  })

  it('states an unviewable document instead of a broken preview', () => {
    const markup = renderToStaticMarkup(
      <DocumentBody document={{ path: 'tool.zip', kind: 'unsupported', mediaType: 'application/octet-stream', bytes: 2048 }} />,
    )

    expect(markup).toContain('此文件类型暂不支持预览。')
    expect(markup).toContain('2 KB')
  })
})

const extensionReads = {
  listPlugins: async (): Promise<LingReadResult<readonly LingPluginEntry[]>> => ({ ok: true, value: [] }),
  onSelectPreset: async (): Promise<LingCommandResult> => ({ accepted: true, requestId: 'req-1' }),
  readAgentPresets: async (): Promise<LingReadResult<LingTaskAgentPreset>> => ({
    ok: true,
    value: { options: [{ id: 'default', isDefault: true, label: '默认', trust: 'system' }], currentValue: 'default' },
  }),
  readSkills: async (): Promise<LingReadResult<readonly LingSkill[]>> => ({
    ok: true,
    value: [{ description: '整理会议记录', modelInvocable: true, name: 'minutes' }],
  }),
}

const renderExtensions = (taskId?: string) => renderToStaticMarkup(
  <ExtensionSettings {...extensionReads} taskId={taskId} />,
)

describe('extension capability settings', () => {
  it('keeps skill browsing in extension settings', () => {
    const markup = renderExtensions()

    expect(markup).toContain('扩展能力')
    expect(markup).toContain('打开一个任务后可查看技能目录。')
    expect(markup).not.toContain('Agent 预设')
  })

  it('removes the duplicate host plugin inventory from extensions', () => {
    const markup = renderExtensions()

    expect(markup).not.toContain('宿主已加载的插件与运行状态。')
    expect(markup).toContain('刷新扩展能力')
  })

  it('drops the task hints once a task is selected', () => {
    const markup = renderExtensions('task-1')

    expect(markup).not.toContain('打开一个任务后可查看技能目录。')
    expect(markup).not.toContain('打开一个任务后可编辑 Agent 预设。')
  })
})

const renderGeneralSettings = (
  localePreference: 'zh' | 'en' | undefined,
  localeLoading = false,
  localeMessage?: string,
) => renderToStaticMarkup(
  <GeneralSettings
    section="appearance"
    localeLoading={localeLoading}
    localeMessage={localeMessage}
    localePreference={localePreference}
    onLocaleChange={() => {}}
    onThemeChange={() => {}}
    theme="light"
    version="1.2.3"
  />,
)

describe('general settings language row', () => {
  it('offers follow-browser, Chinese and English and marks the stored preference', () => {
    const markup = renderGeneralSettings('zh')

    expect(markup).toContain('跟随浏览器')
    expect(markup).toContain('中文')
    expect(markup).toContain('English')
    expect(markup).toMatch(/aria-label="语言"[^>]*>[\s\S]*?class="select__value[^"]*"[^>]*>简体中文/)
    expect(markup).toMatch(/<option value="zh" selected="">简体中文<\/option>/)
    expect(markup).not.toMatch(/<option value="en" selected="">English<\/option>/)
  })

  it('follows the browser once the stored preference is cleared', () => {
    const markup = renderGeneralSettings(undefined)

    expect(markup).toMatch(/<option value="browser" selected="">跟随浏览器<\/option>/)
  })

  it('disables the language choices while a save is in flight', () => {
    const markup = renderGeneralSettings('en', true)

    expect(markup.match(/<button[^>]*aria-label="语言"[^>]*>/)?.[0]).toContain('disabled')
  })

  it('shows the save failure beside the language choices', () => {
    const markup = renderGeneralSettings('zh', false, '语言偏好保存失败。')

    expect(markup).toContain('general-settings__error')
    expect(markup).toContain('语言偏好保存失败。')
  })
})

const subagentCatalog: LingSubagentCatalog = {
  state: 'ready',
  subagents: [
    { sessionId: 'sub-1', title: '调研附件交互', activity: 'running', mode: 'continuable', hasChildren: false },
    { sessionId: 'sub-2', title: '整理测试清单', activity: 'inactive', mode: 'one-shot', hasChildren: false },
    { sessionId: 'sub-3', title: '梳理改动要点', activity: 'inactive', mode: 'continuable', hasChildren: false },
  ],
  unreadable: [],
}

const renderSubagents = () => renderToStaticMarkup(
  <SubagentList
    catalog={subagentCatalog}
    onInterrupt={async () => ({ accepted: true })}
    onPrompt={async () => ({ accepted: true })}
  />,
)

describe('subagent row actions', () => {
  it('offers 追加指令 on continuable subagents and 中断 only while they run', () => {
    const markup = renderSubagents()

    expect(markup).toContain('向子任务 调研附件交互 追加指令')
    expect(markup).toContain('向子任务 梳理改动要点 追加指令')
    expect(markup).toContain('中断子任务 调研附件交互')
    expect(markup).not.toContain('向子任务 整理测试清单 追加指令')
    expect(markup).not.toContain('中断子任务 整理测试清单')
    expect(markup).not.toContain('中断子任务 梳理改动要点')
  })

  it('hides the row actions when the runtime exposes no subagent operations', () => {
    const markup = renderToStaticMarkup(<SubagentList catalog={subagentCatalog} />)

    expect(markup).not.toContain('subagent-list__action')
    expect(markup).toContain('调研附件交互')
  })
})


describe('Git review line numbers', () => {
  it('skips patch metadata and advances old/new lines independently across hunks', () => {
    const rows = gitDiffRows('diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -2,2 +2,2 @@\n same\n-old\n+new\n@@ -8 +9 @@\n---content\n+++content\n\\ No newline at end of file\n')
    expect(rows.filter(row => row.kind !== 'note')).toEqual([
      { text: 'same', kind: 'context', old: 2, next: 2 },
      { text: 'old', kind: 'deleted', old: 3 },
      { text: 'new', kind: 'added', next: 3 },
      { text: '--content', kind: 'deleted', old: 8 },
      { text: '++content', kind: 'added', next: 9 },
    ])
    expect(rows.at(-1)?.text).toBe('\\ No newline at end of file')
  })
  it('numbers untracked content and keeps non-text or mode-only notices readable', () => {
    expect(gitDiffRows('新增文件：任务.md\n+一\n+二')).toEqual([
      { text: '一', kind: 'added', next: 1 }, { text: '二', kind: 'added', next: 2 },
    ])
    expect(gitDiffRows('二进制文件')).toEqual([{ text: '二进制文件', kind: 'note' }])
    expect(gitDiffRows('old mode 100644\nnew mode 100755\n')).toHaveLength(2)
  })
})


describe('DSH composer command routing', () => {
  const commands = [{ name: 'plan' }, { name: 'compact' }]
  it('sends skill invocations and ordinary paths as user prompts', () => {
    expect(isComposerCommand('/review 检查当前改动', commands)).toBe(false)
    expect(isComposerCommand('/compact-helper 检查', commands)).toBe(false)
    expect(isComposerCommand('/tmp/project', commands)).toBe(false)
    expect(isComposerCommand('请执行 /compact', commands)).toBe(false)
  })
  it('lets registered commands claim the exact leading name, including skill name collisions', () => {
    expect(isComposerCommand('/compact', commands)).toBe(true)
    expect(isComposerCommand('/plan 检查改动', commands)).toBe(true)
    expect(isComposerCommand('/review 检查', [...commands, { name: 'review' }])).toBe(true)
  })
})


describe('agent preset picker', () => {
  it('hides selection and ignores a stale draft choice when host policy disables it', () => {
    const html = renderToStaticMarkup(<AgentPresetPicker
      catalog={{ modeSelectionEnabled: false, currentValue: 'standard', options: [
        { id: 'standard', label: '标准模式', trust: 'system', isDefault: true },
        { id: 'minimal', label: '极简模式', trust: 'system', isDefault: false },
      ] }} value="minimal" editable loading={false} pending={false} onSelect={() => {}} onRetry={() => {}} />)
    expect(html).toContain('标准模式')
    expect(html).not.toContain('极简模式')
    expect(html).not.toContain('<button')
  })
  const props = { catalog: { currentValue: 'reviewer', options: [{ id: 'reviewer', label: '评审助手', isDefault: false, trust: 'user' as const }] }, loading: false, pending: false, onSelect: () => {}, onRetry: () => {} }
  it('offers selection before the first turn', () => {
    const html = renderToStaticMarkup(<AgentPresetPicker {...props} editable />)
    expect(html).toContain('aria-label="选择智能体"')
    expect(html).toContain('评审助手')
  })
  it('offers a new-task action instead of claiming to switch an established conversation', () => {
    const html = renderToStaticMarkup(<AgentPresetPicker {...props} editable={false} />)
    expect(html).toContain('在新任务中选择智能体')
    expect(html).toContain('评审助手')
    expect(html).not.toContain('aria-label="选择智能体"')
  })
})
