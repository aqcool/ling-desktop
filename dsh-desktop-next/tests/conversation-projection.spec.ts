import type { ChatSnapshot } from '@deepseek-ai/dsh-client-ui-chat/client'
import { describe, expect, it, vi } from 'vitest'
import {
  createDshConversationProjection,
  projectConversation,
} from '../src/client/conversation-projection.js'

function snapshot(overrides: Partial<ChatSnapshot['legacy']> = {}): ChatSnapshot {
  return {
    order: [],
    nodes: {
      get: () => undefined,
      source: () => ({ getSnapshot: () => undefined, subscribe: () => () => {} }),
      processSource: () => ({ getSnapshot: () => undefined, subscribe: () => () => {} }),
      values: () => [],
    },
    locations: { getTurn: () => [], getStep: () => [] },
    navigation: { items: () => [] },
    timeline: { turnOrder: [], turns: new Map() },
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

describe('DSH Conversation projection', () => {
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
      { kind: 'user-message', text: '继续实现' },
      { kind: 'tool-activity', title: 'terminal', text: '构建通过', status: 'completed' },
      { kind: 'assistant-message', text: '已经完成。', status: 'completed' },
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
      },
    ])
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
