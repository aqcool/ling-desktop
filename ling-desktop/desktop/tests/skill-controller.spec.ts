import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { LingSkillsController } from '../src/host/skill-controller.ts'

function catalog() {
  const ctx = new Context()
  const scope = {}
  const list = vi.fn(async () => [
    { name: 'review', description: '项目技能', path: '/project/.agents/skills/review/SKILL.md', invocation: { userInvocable: true, modelInvocable: true } },
    { name: 'release', description: '仅用户调用', invocation: { userInvocable: true, modelInvocable: false } },
    { name: 'internal', description: '不可手动调用', invocation: { userInvocable: false, modelInvocable: true } },
  ])
  const standingKeyFor = vi.fn(async () => scope)
  ctx.provide('skills', { list } as never)
  ctx.provide('workspaceRegistry', { get: (id: string) => id === 'project' ? { path: '/project' } : undefined } as never)
  ctx.provide('agentPresets', { standingKeyFor } as never)
  ctx.provide('typert', { register: () => () => {} } as never)
  return { controller: new LingSkillsController(ctx), list, scope, standingKeyFor }
}

describe('draft skill catalog', () => {
  it('reads the DSH registry with workspace cwd and default preset, retaining user-only skills', async () => {
    const { controller, list, scope, standingKeyFor } = catalog()
    const signal = new AbortController().signal
    const skills = await controller.list('project', null, signal)
    expect(list).toHaveBeenCalledWith({ cwd: '/project', scope, signal })
    expect(standingKeyFor).toHaveBeenCalledWith(undefined)
    expect(skills).toEqual([
      { name: 'review', description: '项目技能', path: '/project/.agents/skills/review/SKILL.md', modelInvocable: true },
      { name: 'release', description: '仅用户调用', modelInvocable: false },
    ])
  })
  it('uses the staged agent scope for a new conversation skill list', async () => {
    const { controller, standingKeyFor, list, scope } = catalog()
    const signal = new AbortController().signal
    await controller.list('project', 'reviewer', signal)
    expect(standingKeyFor).toHaveBeenCalledWith('reviewer')
    expect(list).toHaveBeenCalledWith({ cwd: '/project', scope, signal })
  })
  it('does not silently read another directory when the workspace is gone', async () => {
    const { controller, list } = catalog()
    await expect(controller.list('gone', null, new AbortController().signal)).rejects.toThrow('工作区已不存在')
    expect(list).not.toHaveBeenCalled()
  })
  it('supports unassigned drafts without inventing a session or workspace', async () => {
    const { controller, list, scope } = catalog()
    const signal = new AbortController().signal
    await controller.list(null, null, signal)
    expect(list).toHaveBeenCalledWith({ cwd: undefined, scope, signal })
  })
})
