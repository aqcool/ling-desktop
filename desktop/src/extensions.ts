import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { LingSkillsController } from './host/skill-controller.ts'
import { LingAuthorizationController } from './host/authorization-controller.ts'
import { LingServersController } from './host/server-controller.ts'
import { LingWorkspaceTerminalsController } from './host/workspace-terminal-controller.ts'
import { LingMessageActionsController } from './host/message-actions-controller.ts'
import { LingComputerControlController } from './host/computer-control-controller.ts'
import { LingAutomationController } from './host/automation-controller.ts'
import { LingSessionDeleteController } from './host/session-delete-controller.ts'
import { LingKnowledgeController } from './host/knowledge-controller.ts'
import { LingReplyController } from './host/reply-controller.ts'
import { LingHooksController } from './host/hooks-controller.ts'
import { LingWorkspaceDocumentsController } from './host/workspace-document-controller.ts'

/** The LING bundle anchors its client projections in the DSH profile. */
export const name = 'ling-desktop-host'

export function apply(ctx: Context): void {
  ctx.plugin(LingWorkspaceDocumentsController)
  ctx.plugin(LingHooksController)
  ctx.plugin(LingReplyController)
  ctx.plugin(LingAuthorizationController)
  ctx.plugin(LingSessionDeleteController)
  ctx.plugin(LingSkillsController)
  ctx.plugin(LingServersController)
  ctx.plugin(LingWorkspaceTerminalsController)
  ctx.plugin(LingMessageActionsController)
  ctx.plugin(LingComputerControlController)
  ctx.plugin(LingKnowledgeController)
  ctx.plugin(LingAutomationController)
}

export function bundledPnpmEntry(anchor: string): string {
  const require = createRequire(anchor)
  return join(dirname(require.resolve('pnpm')), 'bin', 'pnpm.mjs')
}
