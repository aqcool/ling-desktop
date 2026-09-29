import { describe, expect, it, vi } from 'vitest'
import { encodeApprovalDetails, decodeApprovalDetails } from '../src/approval-details.ts'
import {
  createDshInteractionProjection,
  projectPendingInteractions,
} from '../src/client/interaction-projection.js'

function status(interaction: unknown) {
  return {
    running: true,
    pendingInteraction: interaction,
    completionUnread: false,
  }
}

describe('DSH pending interaction projection', () => {
  it('projects exact command and purpose without exposing wire metadata', () => {
    const details = { summary: '重启网站服务以加载新版本', server: '生产服务器', cwd: '/srv/app',
      impact: '访问可能短暂中断。', command: 'sudo systemctl restart nginx\nsystemctl status nginx --no-pager' }
    const reason = encodeApprovalDetails(details)
    const result = projectPendingInteractions(new Map([['task', status({ key: 'approval', kind: 'approval', sessionId: 'task', toolName: 'server_exec', reason, answer: vi.fn() })]]) as never)
    expect(result[0]).toMatchObject({ details })
    expect(result[0]).not.toHaveProperty('reason')
    expect(decodeApprovalDetails('ling:approval:v1\n{broken')).toBeUndefined()
    expect(decodeApprovalDetails('普通提示')).toBeUndefined()
    expect(decodeApprovalDetails('ling:approval:v1\n' + JSON.stringify({ ...details, unrelatedSecret: 'discard' }))).toEqual(details)
  })
  it('projects approvals and question batches into LING-owned values', () => {
    const answerApproval = vi.fn()
    const answerQuestion = vi.fn()
    const snapshot = new Map([
      ['session-1', status({
        key: 'approval-1',
        kind: 'approval',
        sessionId: 'session-1',
        toolName: 'bash',
        callId: 'call-1',
        reason: '需要运行构建',
        answer: answerApproval,
      })],
      ['session-2', status({
        key: 'question-1',
        kind: 'question',
        sessionId: 'session-2',
        questions: [{
          id: 'target',
          question: '选择目标平台',
          header: '平台',
          options: [{ label: 'macOS', description: '构建 DMG' }],
          multiSelect: false,
        }],
        answer: answerQuestion,
        cancel: vi.fn(),
      })],
    ])

    expect(projectPendingInteractions(snapshot as never)).toEqual([
      {
        interactionId: 'approval-1',
        taskId: 'session-1',
        kind: 'approval',
        toolName: 'bash',
        callId: 'call-1',
        reason: '需要运行构建',
      },
      {
        interactionId: 'question-1',
        taskId: 'session-2',
        kind: 'question',
        questions: [{
          questionId: 'target',
          prompt: '选择目标平台',
          header: '平台',
          options: [{ label: 'macOS', description: '构建 DMG' }],
          multiple: false,
        }],
      },
    ])
  })

  it('settles the current DSH carrier and refuses stale identities', async () => {
    const answer = vi.fn(async () => {})
    const pending = {
      key: 'question-1',
      kind: 'plan-review',
      sessionId: 'session-1',
      questions: [{
        id: 'review',
        question: '执行这个计划吗？',
        options: [{ label: '同意' }, { label: '修改' }],
      }],
      answer,
      cancel: vi.fn(async () => {}),
    }
    const getSnapshot = vi.fn(() => new Map([['session-1', status(pending)]]))
    const subscribe = vi.fn(() => () => {})
    const projection = createDshInteractionProjection({
      sessionStatus: { getSnapshot, subscribe },
    } as never)

    await expect(projection.respond({
      type: 'interaction.answer-question',
      requestId: 'response-1',
      interactionId: 'question-1',
      answers: [{ questionId: 'review', selected: ['同意'] }],
    })).resolves.toBe(true)
    expect(answer).toHaveBeenCalledWith({
      answers: [{ id: 'review', selected: ['同意'] }],
    })

    await expect(projection.respond({
      type: 'interaction.cancel',
      requestId: 'response-2',
      interactionId: 'stale',
    })).resolves.toBe(false)
  })

  it('answers an approval through its current one-shot carrier', async () => {
    const answer = vi.fn(async () => {})
    const pending = {
      key: 'approval-1',
      kind: 'approval',
      sessionId: 'session-1',
      toolName: 'bash',
      answer,
    }
    const projection = createDshInteractionProjection({
      sessionStatus: {
        getSnapshot: () => new Map([['session-1', status(pending)]]),
        subscribe: () => () => {},
      },
    } as never)

    await expect(projection.respond({
      type: 'interaction.answer-approval',
      requestId: 'response-1',
      interactionId: 'approval-1',
      decision: 'allowed-once',
    })).resolves.toBe(true)
    expect(answer).toHaveBeenCalledWith('allowed-once')
  })
})
