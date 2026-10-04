/** Pair the LING Session Host adapter with the unchanged published Client face. */
import type { Context } from '@deepseek-ai/cordis'
import * as sessionClient from '@deepseek-ai/dsh-api-session-controller/client'
import * as renderer from './index.ts'

export const inject = sessionClient.inject
export function apply(ctx: Context): void {
  ctx.plugin(sessionClient)
  ctx.plugin(renderer)
}
