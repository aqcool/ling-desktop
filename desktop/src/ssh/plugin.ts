import type { Context } from '@deepseek-ai/cordis'
import { SshFileSystem } from '@deepseek-ai/dsh-fs-ssh'
import { SshSubprocessRuntime } from '@deepseek-ai/dsh-subprocess-ssh'
import { SshSandboxProvider } from '@deepseek-ai/dsh-sandbox-ssh'

/** Ordinary DSH composition: mount stock dsh-ssh + sandboxPolicy, then this plugin. */
export const name = 'ling-ssh-providers'
export const inject = ['ssh', 'sandboxPolicy']
export function apply(ctx: Context): void {
  ctx.plugin(SshFileSystem)
  ctx.plugin(SshSubprocessRuntime)
  ctx.plugin(SshSandboxProvider)
}
