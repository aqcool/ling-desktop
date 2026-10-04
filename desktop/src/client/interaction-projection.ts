import type { PendingApproval } from '@deepseek-ai/dsh-client-ui-approval/client'
import { decodeApprovalDetails } from '../approval-details.ts'
import type {
  SessionPendingInteraction,
  SessionStatusSnapshot,
  UiSession,
} from '@deepseek-ai/dsh-client-ui-session/client'
import type { PendingQuestion } from '@deepseek-ai/dsh-client-ui-user-questions/client'
import type {
  LingPendingInteraction,
  LingRuntimeCommand,
} from 'ling-desktop/runtime'

type InteractionCommand = Extract<LingRuntimeCommand, {
  type: 'interaction.answer-approval' | 'interaction.answer-question' | 'interaction.cancel'
}>

function isApproval(interaction: SessionPendingInteraction): interaction is PendingApproval {
  return interaction.kind === 'approval'
    && 'toolName' in interaction
    && 'answer' in interaction
}

function isQuestion(interaction: SessionPendingInteraction): interaction is PendingQuestion {
  return (interaction.kind === 'question' || interaction.kind === 'plan-review')
    && 'questions' in interaction
    && 'answer' in interaction
}

function projectInteraction(interaction: SessionPendingInteraction): LingPendingInteraction | undefined {
  if (isApproval(interaction)) {
    const details = decodeApprovalDetails(interaction.reason)
    return {
      interactionId: interaction.key,
      taskId: String(interaction.sessionId),
      kind: 'approval',
      toolName: interaction.toolName,
      ...(interaction.callId === undefined ? {} : { callId: String(interaction.callId) }),
      ...(details ? { details } : interaction.reason === undefined ? {} : { reason: interaction.reason.startsWith('ling:approval:') ? '请确认这次操作。' : interaction.reason }),
    }
  }
  if (isQuestion(interaction)) {
    return {
      interactionId: interaction.key,
      taskId: String(interaction.sessionId),
      kind: interaction.kind,
      questions: interaction.questions.map(question => ({
        questionId: question.id,
        prompt: question.question,
        ...(question.detail === undefined ? {} : { detail: question.detail }),
        ...(question.header === undefined ? {} : { header: question.header }),
        options: (question.options ?? []).map(option => ({ ...option })),
        multiple: question.multiSelect === true,
      })),
    }
  }
  return undefined
}

export function projectPendingInteractions(snapshot: SessionStatusSnapshot): readonly LingPendingInteraction[] {
  return [...snapshot.values()].flatMap(status => {
    if (status.pendingInteraction === undefined) return []
    const projected = projectInteraction(status.pendingInteraction)
    return projected === undefined ? [] : [projected]
  })
}

function findInteraction(snapshot: SessionStatusSnapshot, interactionId: string): SessionPendingInteraction | undefined {
  for (const status of snapshot.values()) {
    if (status.pendingInteraction?.key === interactionId) return status.pendingInteraction
  }
  return undefined
}

export function createDshInteractionProjection(uiSession: Pick<UiSession, 'sessionStatus'>) {
  return {
    list: {
      getSnapshot: () => projectPendingInteractions(uiSession.sessionStatus.getSnapshot()),
      subscribe: (listener: () => void) => uiSession.sessionStatus.subscribe(listener),
    },
    async respond(command: InteractionCommand): Promise<boolean> {
      const pending = findInteraction(uiSession.sessionStatus.getSnapshot(), command.interactionId)
      if (pending === undefined) return false

      if (command.type === 'interaction.answer-approval') {
        if (!isApproval(pending)) return false
        await pending.answer(command.decision)
        return true
      }
      if (command.type === 'interaction.answer-question') {
        if (!isQuestion(pending)) return false
        await pending.answer({
          answers: command.answers.map(answer => ({
            id: answer.questionId,
            selected: [...answer.selected],
            ...(answer.custom === undefined ? {} : { custom: answer.custom }),
          })),
        })
        return true
      }
      if (isQuestion(pending)) await pending.cancel()
      else if (isApproval(pending)) await pending.answer('rejected')
      else return false
      return true
    },
  }
}
