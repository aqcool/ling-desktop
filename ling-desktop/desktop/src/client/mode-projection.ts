import type { ClientRemote } from '@deepseek-ai/dsh-api-remotes/client'
import type { SessionBinding } from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-goal/remote'
import type { GoalId, GoalView } from '@deepseek-ai/dsh-goal/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { LingCommandRejectionReason, LingReadResult, LingTaskGoal } from 'ling-desktop/runtime'

type GoalAction = 'pause' | 'resume' | 'complete' | 'clear'

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
      : /invalid|bad-request|validation|conflict|stale/i.test(error.code)
        ? 'invalid-command'
        : 'runtime-unavailable'
  return rejected(reason, error.message?.trim() || '任务目标操作失败。', /transport|connection|timeout|unavailable/i.test(error.code))
}

function projectGoal(view: GoalView): LingTaskGoal {
  return {
    goalId: String(view.id),
    revision: view.revision,
    objective: view.objective,
    phase: view.phase,
    roundsStarted: view.roundsStarted,
    maxGoalRounds: view.maxGoalRounds,
    ...(view.blockedReason === undefined ? {} : { blockedReason: view.blockedReason.message }),
  }
}

export function createDshModeProjection(remote: ClientRemote) {
  return {
    async createGoal(taskId: string, objective: string, maxGoalRounds: number): Promise<LingReadResult<void>> {
      try {
        const result = await remote.goals.create(taskId as SessionId, { objective, maxGoalRounds })
        return result.ok ? { ok: true, value: undefined } : remoteFailure(result.error)
      } catch { return rejected('runtime-unavailable', '无法创建任务目标。', true) }
    },
    plan(binding: SessionBinding): { active: boolean; pending: boolean } | undefined {
      try {
        const selection = binding.session.projections.faceOf('plan').getSnapshot() as
          { active?: unknown; pending?: unknown } | undefined
        return typeof selection?.active === 'boolean'
          ? { active: selection.active, pending: selection.pending === true }
          : undefined
      } catch {
        return undefined
      }
    },
    async goal(taskId: string): Promise<LingReadResult<LingTaskGoal | undefined>> {
      try {
        const result = await remote.goals.get(taskId as SessionId)
        if (!result.ok) return remoteFailure(result.error)
        return { ok: true, value: result.value === undefined ? undefined : projectGoal(result.value) }
      } catch {
        return rejected('runtime-unavailable', '任务目标暂时不可用。', true)
      }
    },
    async goalAction(
      taskId: string,
      action: GoalAction,
      goalId: string,
      revision: number,
    ): Promise<LingReadResult<void>> {
      try {
        const result = await remote.goals[action](taskId as SessionId, {
          id: goalId as GoalId,
          revision,
        })
        if (!result.ok) return remoteFailure(result.error)
        return { ok: true, value: undefined }
      } catch {
        return rejected('runtime-unavailable', '任务目标操作暂时不可用。', true)
      }
    },
  }
}
