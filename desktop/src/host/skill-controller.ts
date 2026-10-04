import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent-presets/types'
import { isUserInvocable } from '@deepseek-ai/dsh-skill'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { LING_SKILLS_HOST } from '../skill-contract.ts'

declare module '@deepseek-ai/cordis' {
  interface Context { lingSkills: LingSkillsController }
}
/** The same registry/scope as DSH skills/list, before a draft has a session. */
export class LingSkillsController extends TypertRemoteService {
  static inject = ['skills', 'workspaceRegistry', 'typert']
  constructor(ctx: Context) {
    super(ctx, 'lingSkills')
    ctx.effect(() => ctx.typert.register(LING_SKILLS_HOST), 'LING draft skill catalog')
  }
  async list(workspaceId: string | null, agentPreset: string | null, signal: AbortSignal) {
    const workspace = workspaceId === null ? undefined : this.ctx.workspaceRegistry.get(WorkspaceId(workspaceId))
    if (workspaceId !== null && !workspace) throw new RemoteError('workspace/not-found', '工作区已不存在。', { workspaceId: WorkspaceId(workspaceId) })
    const scope = await this.ctx.get('agentPresets')?.standingKeyFor(agentPreset ?? undefined)
    const skills = await this.ctx.skills.list({ cwd: workspace?.path, scope, signal })
    return skills.filter(isUserInvocable).map(skill => ({
      name: skill.name, description: skill.description, modelInvocable: skill.invocation.modelInvocable,
      ...(skill.path === undefined ? {} : { path: skill.path }),
      ...(skill.whenToUse === undefined ? {} : { whenToUse: skill.whenToUse }),
    }))
  }
}
// Register explicitly, as with the desktop authorization bridge (no decorator transform).
const prototype = LingSkillsController.prototype
const receiver = Object.create(prototype) as LingSkillsController
const decorate = Remote as unknown as (implementation: (...args: never[]) => unknown, context: {
  name: string; private: boolean; static: boolean; addInitializer(initializer: (this: LingSkillsController) => void): void
}) => void
decorate(prototype.list as (...args: never[]) => unknown, {
  name: 'list', private: false, static: false, addInitializer(initializer) { initializer.call(receiver) },
})
