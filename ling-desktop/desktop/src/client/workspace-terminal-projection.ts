import type { Context } from '@deepseek-ai/cordis'
import type { ClientTerminals, TerminalRemote } from '@deepseek-ai/dsh-api-terminal-controller/client'
import type { LingTerminalService } from 'ling-desktop/runtime'
import { LING_WORKSPACE_TERMINAL_REMOTE, type LingWorkspaceTerminalRemote } from '../workspace-terminal-contract.ts'
import { createDshTerminalProjection } from './terminal-projection.ts'

const PREFIX = 'ling-workspace:'

/** Route owner identities explicitly; saved task cleanup keeps using the original namespace. */
export function workspaceTerminalRemote(ctx: Context, mounted: Promise<unknown>): TerminalRemote {
  const resolve = async (owner: string) => {
    if (!owner.startsWith(PREFIX)) return { remote: ctx.remote.terminal, owner }
    await mounted
    const remote = ctx.get('remote.lingWorkspaceTerminals') as unknown as LingWorkspaceTerminalRemote | undefined
    if (!remote) throw new Error('工作区终端服务暂不可用。')
    return { remote, owner: owner.slice(PREFIX.length) }
  }
  return new Proxy({} as TerminalRemote, {
    get(_target, method: keyof TerminalRemote) {
      if (method === 'follow' || method === 'retain') return async function* (owner: string, ...args: unknown[]) {
        const target = await resolve(owner)
        const call = target.remote[method] as unknown as (owner: string, ...args: unknown[]) => AsyncIterable<unknown>
        yield* call(target.owner, ...args)
      }
      return async (owner: string, ...args: unknown[]) => {
        const target = await resolve(owner)
        const call = target.remote[method] as unknown as (owner: string, ...args: unknown[]) => Promise<unknown>
        return call(target.owner, ...args)
      }
    },
  })
}

export function attachWorkspaceTerminals(ctx: Context, service: LingTerminalService | undefined): void {
  if (!service || typeof ctx.remote.$mount !== 'function') return
  const mounted = ctx.remote.$mount(LING_WORKSPACE_TERMINAL_REMOTE)
  ctx.effect(async () => await mounted, 'LING workspace terminal Remote')
  const remote = workspaceTerminalRemote(ctx, mounted)
  // The DSH browser package is loader-owned, not an ESM runtime export. Reuse
  // its already-mounted implementation with an isolated service scope.
  const TerminalModels = ctx.webTerminals.constructor as typeof ClientTerminals
  const models = new TerminalModels(ctx.isolate('webTerminals'), remote)
  const workspace = createDshTerminalProjection({ terminal: remote }, models).service!
  service.workspacePanel = (workspaceId, placement) => workspace.panel(`${PREFIX}${workspaceId ?? ''}`, placement)
}
