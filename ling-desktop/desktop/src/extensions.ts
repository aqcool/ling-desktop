import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { LingSkillsController } from './host/skill-controller.ts'
import { LingAuthorizationController } from './host/authorization-controller.ts'
import { LingServersController } from './host/server-controller.ts'

/** The LING bundle anchors its client projections in the DSH profile. */
export const name = 'ling-desktop-host'

export function apply(ctx: Context): void {
  ctx.plugin(LingAuthorizationController)
  ctx.plugin(LingSkillsController)
  ctx.plugin(LingServersController)
}

export function bundledPnpmEntry(anchor: string): string {
  const require = createRequire(anchor)
  return join(dirname(require.resolve('pnpm')), 'bin', 'pnpm.mjs')
}
