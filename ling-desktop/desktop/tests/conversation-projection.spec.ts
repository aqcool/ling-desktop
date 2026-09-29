import type { ChatConversationViewNode, ChatSnapshot } from '@deepseek-ai/dsh-client-ui-chat/client'
import { describe, expect, it, vi } from 'vitest'
import {
  createDshConversationProjection,
  projectConversation,
} from '../src/client/conversation-projection.js'

function snapshot(
  overrides: Partial<ChatSnapshot['legacy']> = {},
  turns: ChatSnapshot['timeline']['turns'] = new Map(),
  keyed: readonly ChatConversationViewNode[] = [],
): ChatSnapshot {
  const byKey = new Map(keyed.map(node => [node.key, node]))
  return {
    order: keyed.map(node => node.key),
    nodes: {
      get: key => byKey.get(key),
      source: () => ({ getSnapshot: () => undefined, subscribe: () => () => {} }),
      processSource: () => ({ getSnapshot: () => undefined, subscribe: () => () => {} }),
      values: () => [...byKey.values()],
    },
    locations: { getTurn: () => [], getStep: () => [] },
    navigation: { items: () => [] },
    timeline: { turnOrder: [...turns.keys()], turns },
    legacy: {
      nodes: [],
      turnTimings: new Map(),
      turnEnds: new Map(),
      partial: null,
      runningCalls: [],
      ...overrides,
    },
  }
}

function stoppedTurn(turn: number, startSeq: number, endSeq: number): ChatSnapshot['timeline']['turns'] {
  return new Map([[turn, {
    turn,
    start: { seq: startSeq, data: { turn } },
    end: { seq: endSeq, data: { turn, reason: { kind: 'aborted', reason: { kind: 'user' } } } },
  } as never]])
}

describe('DSH Conversation projection', () => {
  it('polls remote output while subscribed and stops when the task view closes', async () => {
    vi.useFakeTimers()
    try {
      const live = snapshot({ runningCalls: [{ callId: 'remote', name: 'server_exec', time: 1000 } as never] })
      const read = vi.fn(async () => [{ callId: 'remote', summary: '查看日志', server: '测试', cwd: '/srv', command: 'tail -f app.log', output: 'first line', status: 'running' as const }])
      const listener = vi.fn()
      const unsubscribe = vi.fn()
      const source = { getSnapshot: () => live, subscribe: () => unsubscribe }
      const projection = createDshConversationProjection({ binding: () => ({ target: () => source }) } as never, read)
      const timeline = projection.timeline({ sessionId: 'task' } as never)
      const close = timeline.subscribe(listener)
      await vi.advanceTimersByTimeAsync(0)
      expect(timeline.getSnapshot()[0]).toMatchObject({ text: 'first line', status: 'running' })
      expect(listener).toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(350)
      expect(read).toHaveBeenCalledTimes(2)
      close()
      await vi.advanceTimersByTimeAsync(1000)
      expect(read).toHaveBeenCalledTimes(2)
      expect(unsubscribe).toHaveBeenCalledOnce()
    } finally { vi.useRealTimers() }
  })

  it('finds a remote command nested under an orchestration tool', () => {
    const running = snapshot({ runningCalls: [{ callId: 'root', name: 'run_code', time: 1000,
      subCalls: [{ callId: 'remote', name: 'server_exec', parentCallId: 'root', time: 1100, subCalls: [] }],
    } as never] })
    const result = projectConversation('task', running, [{ callId: 'remote', summary: '检查服务', server: '测试', cwd: '/srv', command: 'systemctl status nginx', output: 'active', status: 'running' }])
    expect(result).toHaveLength(2)
    expect(result[1]).toMatchObject({ title: '检查服务', text: 'active', status: 'running' })
  })
  it('merges live and failed output into one stable remote tool row', () => {
    const execution = { callId: 'remote', summary: '构建服务', server: '测试服务器', cwd: '/srv/app', command: 'make', output: 'step 1\n', status: 'running' as const }
    const running = snapshot({ runningCalls: [{ callId: 'remote', name: 'server_exec', time: 1000 } as never] })
    const live = projectConversation('task', running, [execution])
    expect(live).toHaveLength(1)
    expect(live[0]).toMatchObject({ itemId: 'task:server:remote', title: '构建服务', text: 'step 1\n', status: 'running', execution })
    const ended = snapshot({ nodes: [{ kind: 'tool-result', seq: 4, time: 2000, callId: 'remote', call: { name: 'server_exec', argsRaw: '{}' }, callTime: 1000, content: [{ type: 'text', text: 'error' }], isError: true, subCalls: [] }] })
    const failed = projectConversation('task', ended, [{ ...execution, status: 'failed', error: 'SSH disconnected' }])
    expect(failed).toHaveLength(1)
    expect(failed[0]).toMatchObject({ itemId: live[0]!.itemId, text: 'step 1\n', status: 'failed' })
    expect(projectConversation('task', ended, [execution])[0]?.status).toBe('failed')
  })
  it('marks only the last visible reply of a settled runtime turn for actions', () => {
    const nodes: ChatSnapshot['legacy']['nodes'] = [
      { kind: 'assistant', seq: 2, time: 1000, turn: 1, step: 1, blocks: [{ kind: 'text', text: '检查中' }] },
      { kind: 'assistant', seq: 4, time: 2000, turn: 1, step: 2, blocks: [{ kind: 'text', text: '已停止' }] },
    ]
    const settled = stoppedTurn(1, 1, 5)
    expect(projectConversation('task', snapshot({ nodes }, settled))).toMatchObject([
      { text: '检查中', turnComplete: false }, { text: '已停止', turnComplete: true },
    ])
    const active = new Map([...settled].map(([id, location]) => [id, { ...location, end: undefined }]))
    expect(projectConversation('task', snapshot({ nodes }, active))).toMatchObject([
      { turnComplete: false }, { turnComplete: false },
    ])
  })

  it('projects assembled messages and settled tools without replaying events', () => {
    const result = projectConversation('session-1', snapshot({
      nodes: [
        {
          kind: 'user',
          seq: 1,
          time: 1_758_412_800_000,
          source: { kind: 'user' },
          content: [{ type: 'text', text: '继续实现' }],
        },
        {
          kind: 'tool-result',
          seq: 2,
          time: 1_758_412_801_000,
          callId: 'call-1',
          call: { name: 'terminal', argsRaw: '{}' },
          callTime: 1_758_412_800_500,
          content: [{ type: 'text', text: '构建通过' }],
          isError: false,
          subCalls: [],
        },
        {
          kind: 'assistant',
          seq: 3,
          time: 1_758_412_802_000,
          turn: 1,
          step: 1,
          blocks: [{ kind: 'text', text: '已经完成。' }],
        },
      ],
    }))

    expect(result).toMatchObject([
      { kind: 'user-message', text: '继续实现', seq: 1 },
      { kind: 'tool-activity', title: 'terminal', text: '构建通过', status: 'completed', seq: 2 },
      { kind: 'assistant-message', text: '已经完成。', status: 'completed', seq: 3 },
    ])
  })

  it('projects workflow run nodes at their anchor with phase members', () => {
    const result = projectConversation('session-1', snapshot({
      nodes: [
        {
          kind: 'user',
          seq: 1,
          time: 1_758_412_800_000,
          source: { kind: 'user' },
          content: [{ type: 'text', text: '运行工作流' }],
        },
        {
          kind: 'tool-result',
          seq: 6,
          time: 1_758_412_806_000,
          callId: 'call-workflow',
          call: { name: 'workflow', argsRaw: '{}' },
          callTime: 1_758_412_801_000,
          content: [{ type: 'text', text: 'workflow "echo-two-step-parallel" completed (2 agents)' }],
          isError: false,
          subCalls: [],
        },
        {
          kind: 'assistant',
          seq: 7,
          time: 1_758_412_807_000,
          turn: 1,
          step: 1,
          blocks: [{ kind: 'text', text: '完成。' }],
        },
      ],
    }, new Map(), [{
      key: 'workflow-run:run-1',
      kind: 'workflow-run',
      id: 'run-1',
      target: 'chat',
      anchorSeq: 2,
      location: { kind: 'session' },
      visibility: 'visible',
      data: {
        name: 'echo-two-step-parallel',
        status: 'completed',
        phases: [
          { key: 'step-1', phase: 'step-1', members: [{ seq: 3, label: 'echo step-1', childId: 'child-1', status: 'completed' }] },
          { key: 'step-2', phase: 'step-2', members: [{ seq: 4, label: 'echo step-2', childId: 'child-2', status: 'completed' }] },
        ],
      },
    }]))

    expect(result).toMatchObject([
      { kind: 'user-message', seq: 1 },
      { kind: 'tool-activity', title: '工作流 echo-two-step-parallel', seq: 2, status: 'completed', text: '2 个执行项' },
      { kind: 'tool-activity', title: 'workflow', seq: 6, status: 'completed' },
      { kind: 'assistant-message', seq: 7 },
    ])
    expect(result[1]?.detail).toContain('阶段 step-1')
    expect(result[1]?.detail).toContain('echo step-1 · 已完成')
    expect(result[1]?.detail).toContain('echo step-2 · 已完成')
    expect(result[1]?.createdAt).toBe(new Date(1_758_412_800_000).toISOString())
  })

  it('skips workflow run nodes without a readable payload', () => {
    const result = projectConversation('session-1', snapshot({}, new Map(), [{
      key: 'workflow-run:run-2',
      kind: 'workflow-run',
      id: 'run-2',
      target: 'chat',
      anchorSeq: 1,
      location: { kind: 'session' },
      visibility: 'visible',
      data: null,
    }]))

    expect(result).toEqual([])
  })

  it('marks settled work of a user-stopped turn as interrupted and keeps real failures failed', () => {
    const result = projectConversation('session-1', snapshot({
      nodes: [
        {
          kind: 'tool-result',
          seq: 3,
          time: 1_758_412_801_000,
          callId: 'call-aborted',
          call: { name: 'bash', argsRaw: '{"command":"sleep 20"}' },
          callTime: 1_758_412_800_500,
          content: [{ type: 'text', text: 'Error: tool call aborted' }],
          isError: true,
          subCalls: [],
        },
        {
          kind: 'tool-result',
          seq: 12,
          time: 1_758_412_810_000,
          callId: 'call-failed',
          call: { name: 'bash', argsRaw: '{"command":"false"}' },
          callTime: 1_758_412_809_000,
          content: [{ type: 'text', text: 'exit code 1' }],
          isError: true,
          subCalls: [],
        },
      ],
    }, stoppedTurn(1, 1, 5)))

    expect(result).toMatchObject([
      { kind: 'tool-activity', title: 'bash', text: '已停止', status: 'interrupted' },
      { kind: 'tool-activity', title: 'bash', text: 'exit code 1', status: 'failed' },
    ])
  })

  it('projects attachment refs on user messages without placeholder text', () => {
    const result = projectConversation('session-1', snapshot({
      nodes: [
        {
          kind: 'user',
          seq: 1,
          time: 1_758_412_800_000,
          source: { kind: 'user' },
          content: [
            { type: 'text', text: '看看这个文件' },
            { type: 'file', attachment: { attachmentId: 'sha256:aa' as never, name: 'report.txt', bytes: 2048 } },
            { type: 'image', attachment: { attachmentId: 'sha256:bb' as never, mediaType: 'image/png', bytes: 100, width: 4, height: 4 } },
          ],
        },
        {
          kind: 'user',
          seq: 2,
          time: 1_758_412_801_000,
          source: { kind: 'user' },
          content: [
            { type: 'file', attachment: { attachmentId: 'sha256:cc' as never, name: 'only.bin', bytes: 7 } },
          ],
        },
      ],
    }))

    expect(result).toMatchObject([
      {
        kind: 'user-message',
        text: '看看这个文件',
        attachments: [
          { attachmentId: 'sha256:aa', kind: 'file', name: 'report.txt', bytes: 2048 },
          { attachmentId: 'sha256:bb', kind: 'image', name: '图片', bytes: 100, mediaType: 'image/png' },
        ],
      },
      { kind: 'user-message', text: '', attachments: [{ kind: 'file', name: 'only.bin' }] },
    ])
  })

  it('keeps running calls and partial reasoning in the live tail', () => {
    const result = projectConversation('session-1', snapshot({
      runningCalls: [{
        callId: 'call-running',
        name: 'bash',
        argsRaw: '{"command":"yarn test"}',
        turn: 1,
        step: 1,
        time: 1_758_412_803_000,
        subCalls: [],
      }],
      partial: {
        turn: 1,
        step: 1,
        blocks: [
          { kind: 'reasoning', text: '检查测试结果' },
          { kind: 'text', text: '正在处理。' },
        ],
      },
    }))

    expect(result).toMatchObject([
      { kind: 'tool-activity', title: 'bash', status: 'running' },
      {
        kind: 'assistant-message',
        text: '正在处理。',
        detail: '检查测试结果',
        status: 'running',
        streaming: true,
        reasoningStreaming: false,
      },
    ])
  })

  it('marks only a trailing reasoning block as thinking, including after earlier text', () => {
    const result = projectConversation('session-1', snapshot({
      partial: { turn: 1, step: 1, blocks: [
        { kind: 'text', text: '先检查项目。' },
        { kind: 'reasoning', text: '继续检查依赖' },
      ] },
    }))
    expect(result.at(-1)).toMatchObject({ streaming: true, reasoningStreaming: true, detail: '继续检查依赖' })
  })

  it('keeps one projected source for each retained Session binding', () => {
    const current = snapshot({
      nodes: [{
        kind: 'user',
        seq: 1,
        time: 1_758_412_800_000,
        source: { kind: 'user' },
        content: [{ type: 'text', text: '继续实现' }],
      }],
    })
    const target = vi.fn(() => ({
      getSnapshot: () => current,
      subscribe: () => () => {},
    }))
    const conversation = {
      binding: vi.fn(() => ({ target })),
    }
    const binding = { sessionId: 'session-1' }
    const projection = createDshConversationProjection(conversation as never)

    const first = projection.timeline(binding as never)
    const second = projection.timeline(binding as never)

    expect(second).toBe(first)
    expect(conversation.binding).toHaveBeenCalledOnce()
    expect(target).toHaveBeenCalledWith('chat')
    expect(first.getSnapshot()).toMatchObject([{ taskId: 'session-1', text: '继续实现' }])
  })
})
