import { posix } from 'node:path'
import type { LingGitFile, LingGitRequest, LingGitResult, LingGitSnapshot, LingGitWorktree } from 'ling-desktop/runtime'
import type { ServerCommandResult } from '../server-broker.ts'
import { shellQuote } from '../server-deployment.ts'

export interface RemoteGitConnection {
  run(serverId: string, cwd: string, command: string, signal: AbortSignal, outputLimit?: number): Promise<ServerCommandResult>
}
export interface RemoteGitBinding { readonly serverId: string; readonly cwd: string }

function parseFiles(raw: string): LingGitFile[] {
  const parts = raw.split('\0'), files: LingGitFile[] = []
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index]!
    if (!part) continue
    const staged = part[0]!, worktree = part[1]!, path = part.slice(3)
    const originalPath = ['R', 'C'].includes(staged) || ['R', 'C'].includes(worktree) ? parts[++index] : undefined
    files.push({ path, index: staged, worktree, ...(originalPath ? { originalPath } : {}),
      conflict: ['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'].includes(staged + worktree) })
  }
  return files
}
function parseWorktrees(raw: string): LingGitWorktree[] {
  return raw.split('\0\0').filter(Boolean).map((record, index) => {
    const fields = record.split('\0')
    const value = (name: string) => fields.find(field => field.startsWith(`${name} `))?.slice(name.length + 1) ?? ''
    return { path: value('worktree'), branch: value('branch').replace(/^refs\/heads\//, '') || null,
      head: value('HEAD'), main: index === 0,
      locked: fields.some(field => field === 'locked' || field.startsWith('locked ')),
      prunable: fields.some(field => field === 'prunable' || field.startsWith('prunable ')) }
  }).filter(tree => tree.path)
}
function value(input: unknown, label: string, limit = 4096): string {
  if (typeof input !== 'string' || !input.trim() || input.includes('\0') || input.length > limit) throw new Error(`${label}无效。`)
  return input
}

/** Git UI operations use the task's pinned SSH binding and current remote directory. */
export class RemoteWorkspaceGit {
  constructor(private readonly connection: RemoteGitConnection) {}

  private async git(binding: RemoteGitBinding, args: readonly string[], signal: AbortSignal,
    allowedCodes: readonly number[] = [0]): Promise<string> {
    const command = `GIT_TERMINAL_PROMPT=0 GCM_INTERACTIVE=never GIT_OPTIONAL_LOCKS=0 LC_ALL=C GIT_SSH_COMMAND='ssh -o BatchMode=yes' git --literal-pathspecs -C ${shellQuote(binding.cwd)} ${args.map(shellQuote).join(' ')}`
    const result = await this.connection.run(binding.serverId, '/', command, signal, 4 * 1024 * 1024)
    if (!allowedCodes.includes(result.exitCode)) throw new Error((result.stderr || '远端 Git 操作失败。').trim().slice(0, 4000))
    return result.stdout
  }

  async inspect(binding: RemoteGitBinding, signal: AbortSignal): Promise<LingGitSnapshot> {
    const empty: LingGitSnapshot = { repository: false, root: binding.cwd, branch: null, detached: false, unborn: false,
      upstream: null, ahead: 0, behind: 0, files: [], branches: [], remotes: [], worktrees: [] }
    let root: string
    try { root = (await this.git(binding, ['rev-parse', '--show-toplevel'], signal)).trim() }
    catch (error) { if (error instanceof Error && error.message.includes('not a git repository')) return empty; throw error }
    const atRoot = { ...binding, cwd: root }
    const [status, branch, head] = await Promise.all([
      this.git(atRoot, ['status', '--porcelain=v1', '-z', '--untracked-files=all'], signal),
      this.git(atRoot, ['symbolic-ref', '--quiet', '--short', 'HEAD'], signal).catch(() => ''),
      this.git(atRoot, ['rev-parse', '--verify', 'HEAD'], signal).catch(() => ''),
    ])
    const [upstream, branches, remotes] = await Promise.all([
      this.git(atRoot, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], signal).catch(() => ''),
      this.git(atRoot, ['for-each-ref', '--format=%(refname:short)', 'refs/heads/'], signal),
      this.git(atRoot, ['remote'], signal),
    ])
    const worktrees = await this.git(atRoot, ['worktree', 'list', '--porcelain', '-z'], signal)
    const counts = upstream ? (await this.git(atRoot, ['rev-list', '--left-right', '--count', 'HEAD...@{upstream}'], signal)).trim().split(/\s+/).map(Number) : [0, 0]
    return { repository: true, root, branch: branch.trim() || head.trim().slice(0, 8) || null,
      detached: !branch.trim() && !!head.trim(), unborn: !head.trim(), upstream: upstream.trim() || null,
      ahead: counts[0] ?? 0, behind: counts[1] ?? 0, files: parseFiles(status),
      branches: branches.trim().split('\n').filter(Boolean), remotes: remotes.trim().split('\n').filter(Boolean),
      worktrees: parseWorktrees(worktrees) }
  }

  async handle(binding: RemoteGitBinding, request: LingGitRequest, signal: AbortSignal,
    onOpenWorktree: (path: string) => Promise<void>): Promise<LingGitResult> {
    const state = await this.inspect(binding, signal)
    if (request.type === 'inspect') return { snapshot: state }
    if (!state.repository) throw new Error('当前远端目录不是 Git 仓库。')
    const atRoot = { ...binding, cwd: state.root }
    const git = (args: readonly string[], allowed?: readonly number[]) => this.git(atRoot, args, signal, allowed)
    let message: string | undefined
    switch (request.type) {
      case 'diff': {
        const file = state.files.find(item => item.path === request.path)
        if (!file || typeof request.staged !== 'boolean') throw new Error('文件状态已变化，请刷新。')
        const diff = file.index === '?'
          ? await git(['diff', '--no-index', '--no-ext-diff', '--no-color', '--', '/dev/null', file.path], [0, 1])
          : await git(['diff', '--no-ext-diff', '--no-textconv', '--no-color', ...(request.staged ? ['--cached'] : []), '--', file.path, ...(file.originalPath ? [file.originalPath] : [])])
        return { snapshot: state, diff: diff || '没有可显示的文本差异。' }
      }
      case 'stage': case 'unstage': {
        if (!Array.isArray(request.paths) || !request.paths.length || request.paths.length > 5000) throw new Error('请选择文件。')
        const paths = new Set<string>()
        for (const path of request.paths) {
          const file = state.files.find(item => item.path === path)
          if (!file) throw new Error('文件状态已变化，请刷新。')
          paths.add(file.path)
          if (file.originalPath) paths.add(file.originalPath)
        }
        await git(request.type === 'stage' ? ['add', '--', ...paths]
          : state.unborn ? ['rm', '--cached', '-r', '-f', '--', ...paths] : ['reset', '--quiet', 'HEAD', '--', ...paths])
        break
      }
      case 'commit':
        if (state.files.some(file => file.conflict)) throw new Error('请先解决冲突并暂存。')
        if (!state.files.some(file => file.index !== ' ' && file.index !== '?')) throw new Error('没有已暂存的更改。')
        await git(['commit', '-m', value(request.message, '提交说明', 20_000)]); message = '提交成功'; break
      case 'switch': case 'create-branch': {
        const branch = value(request.branch, '分支名', 255)
        await git(['check-ref-format', '--branch', branch])
        if (request.type === 'switch' && !state.branches.includes(branch)) throw new Error('分支不存在，请刷新。')
        await git(['switch', ...(request.type === 'create-branch' ? ['-c'] : []), branch]); message = `已切换到 ${branch}`; break
      }
      case 'fetch':
        if (!state.remotes.length) throw new Error('尚未配置远程仓库。')
        await git(['fetch', '--all']); message = '已获取远程更新'; break
      case 'pull':
        if (!state.upstream) throw new Error('当前分支尚未设置上游。')
        if (state.files.length) throw new Error('请先提交或保存工作区更改，再拉取。')
        await git(['pull', '--ff-only']); message = '已拉取更新'; break
      case 'push': {
        if (state.detached || state.unborn || !state.branch) throw new Error('请先创建分支并提交。')
        if (state.upstream) {
          const remote = (await git(['config', '--get', `branch.${state.branch}.remote`])).trim()
          const target = (await git(['config', '--get', `branch.${state.branch}.merge`])).trim()
          if (!state.remotes.includes(remote) || !target.startsWith('refs/heads/')) throw new Error('当前上游不是可推送的远程分支。')
          await git(['push', '--', remote, `HEAD:${target}`])
        } else {
          if (!request.remote || !state.remotes.includes(request.remote)) throw new Error('请选择推送远程。')
          await git(['push', '--set-upstream', '--', request.remote, `refs/heads/${state.branch}:refs/heads/${state.branch}`])
        }
        message = '推送成功'; break
      }
      case 'worktree-add': {
        if (state.unborn) throw new Error('请先完成首次提交。')
        const path = posix.resolve(value(request.path, '目录')), branch = value(request.branch, '分支名', 255)
        if (!posix.isAbsolute(request.path) || path === state.root || path.startsWith(`${state.root}/`)) throw new Error('请在当前仓库之外创建 Worktree。')
        await git(['check-ref-format', '--branch', branch])
        if (!request.newBranch && !state.branches.includes(branch)) throw new Error('分支不存在。')
        await git(['worktree', 'add', ...(request.newBranch ? ['-b', branch] : []), '--', path, ...(request.newBranch ? [] : [branch])])
        message = 'Worktree 已创建'; break
      }
      case 'worktree-remove': case 'worktree-open': {
        const target = state.worktrees.find(tree => tree.path === request.path)
        if (!target) throw new Error('Worktree 不存在，请刷新。')
        if (request.type === 'worktree-open') { await onOpenWorktree(target.path); return { snapshot: await this.inspect({ ...binding, cwd: target.path }, signal) } }
        if (target.main || target.path === state.root || target.locked || target.prunable) throw new Error('无法移除主工作区、当前工作区或已锁定的 Worktree。')
        await git(['worktree', 'remove', '--', target.path]); message = 'Worktree 已移除'; break
      }
      default: throw new Error('不支持的 Git 操作。')
    }
    return { snapshot: await this.inspect(binding, signal), ...(message ? { message } : {}) }
  }
}
