import type { LingTaskGoal } from '../runtime/contract.js'

/** DSH counts admitted automatic continuations, excluding human input turns. */
export function goalRoundPresentation(goal: LingTaskGoal): { label: string; title: string } {
  return {
    label: goal.phase === 'complete'
      ? goal.roundsStarted === 0 ? '未自动续跑' : `自动续跑 ${goal.roundsStarted} 轮`
      : `自动续跑 ${goal.roundsStarted}/${goal.maxGoalRounds} 轮`,
    title: `仅统计系统为目标自动发起并已启动的回合，不包含普通用户消息触发的回合；自动续跑上限为 ${goal.maxGoalRounds} 轮，并非任务完成进度。`,
  }
}
