import { execFile } from 'node:child_process'
import { isAbsolute } from 'node:path'
import { promisify } from 'node:util'

const execute = promisify(execFile)

export async function readWorkspaceBranch(path: unknown): Promise<string | null> {
  if (typeof path !== 'string' || !isAbsolute(path) || path.includes('\0')) return null
  const git = async (args: string[]) => (await execute('git', ['-C', path, ...args], {
    timeout: 2500, maxBuffer: 16 * 1024, windowsHide: true,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
  })).stdout.trim()
  try {
    return await git(['symbolic-ref', '--quiet', '--short', 'HEAD']) || null
  } catch {
    try { return `${await git(['rev-parse', '--short', 'HEAD'])} (detached)` }
    catch { return null }
  }
}

import { lstat, readFile, readlink, realpath } from 'node:fs/promises'
import { relative, resolve, sep } from 'node:path'
import type { LingGitFile, LingGitRequest, LingGitResult, LingGitSnapshot, LingGitWorktree } from 'ling-desktop/runtime'

function pathValue(value: unknown): string {
  if (typeof value !== 'string' || !isAbsolute(value) || value.includes('\0')) throw new Error('请选择有效的本地目录。')
  return value
}
function textValue(value: unknown, label: string, limit = 4096): string {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0') || value.length > limit) throw new Error(`${label}无效。`)
  return value
}
async function git(path: string, args: readonly string[], network = false): Promise<string> {
  try {
    return (await execute('git', ['--literal-pathspecs', '-C', path, ...args], {
      timeout: network ? 60_000 : 30_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', GIT_SSH_COMMAND: 'ssh -o BatchMode=yes', LC_ALL: 'C' },
    })).stdout
  } catch (error) {
    const failure = error as { stderr?: string; killed?: boolean; message?: string }
    if (failure.killed) throw new Error('Git 操作超时，请刷新状态后再试。')
    throw new Error((failure.stderr || failure.message || 'Git 操作失败。').trim().slice(0, 4000))
  }
}

function parseFiles(raw: string): LingGitFile[] {
  const parts = raw.split('\0'), files: LingGitFile[] = []
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!
    if (!part) continue
    const index = part[0]!, worktree = part[1]!, path = part.slice(3)
    const originalPath = index === 'R' || index === 'C' || worktree === 'R' || worktree === 'C' ? parts[++i] : undefined
    files.push({ path, index, worktree, ...(originalPath ? { originalPath } : {}), conflict: ['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'].includes(index + worktree) })
  }
  return files
}
function parseWorktrees(raw: string): LingGitWorktree[] {
  return raw.split('\0\0').filter(Boolean).map((record, index) => {
    const fields = record.split('\0')
    const value = (name: string) => fields.find(field => field.startsWith(`${name} `))?.slice(name.length + 1) ?? ''
    return { path: value('worktree'), branch: value('branch').replace(/^refs\/heads\//, '') || null, head: value('HEAD'), main: index === 0, locked: fields.some(f => f === 'locked' || f.startsWith('locked ')), prunable: fields.some(f => f === 'prunable' || f.startsWith('prunable ')) }
  }).filter(item => item.path)
}
async function inspect(path: string): Promise<LingGitSnapshot> {
  const empty: LingGitSnapshot = { repository: false, root: path, branch: null, detached: false, unborn: false, upstream: null, ahead: 0, behind: 0, files: [], branches: [], remotes: [], worktrees: [] }
  let root: string
  try { root = (await git(path, ['rev-parse', '--show-toplevel'])).trim() }
  catch (error) { if (error instanceof Error && error.message.includes('not a git repository')) return empty; throw error }
  const results = await Promise.all([
    git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']),
    git(root, ['symbolic-ref', '--quiet', '--short', 'HEAD']).catch(() => ''),
    git(root, ['rev-parse', '--verify', 'HEAD']).catch(() => ''),
    git(root, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']).catch(() => ''),
    git(root, ['for-each-ref', '--format=%(refname:short)', 'refs/heads/']),
    git(root, ['remote']),
    git(root, ['worktree', 'list', '--porcelain', '-z']),
  ])
  const [status, branch, head, upstream, branches, remotes, worktrees] = results as [string, string, string, string, string, string, string]
  const counts = upstream ? (await git(root, ['rev-list', '--left-right', '--count', 'HEAD...@{upstream}'])).trim().split(/\s+/).map(Number) : [0, 0]
  return { repository: true, root, branch: branch.trim() || head.trim().slice(0, 8) || null, detached: !branch.trim() && !!head.trim(), unborn: !head.trim(), upstream: upstream.trim() || null, ahead: counts[0] ?? 0, behind: counts[1] ?? 0, files: parseFiles(status), branches: branches.trim().split('\n').filter(Boolean), remotes: remotes.trim().split('\n').filter(Boolean), worktrees: parseWorktrees(worktrees) }
}

/** Serialize writes across windows and linked worktrees without exposing arbitrary commands. */
export class WorkspaceGit {
  private readonly queues = new Map<string, Promise<unknown>>()
  constructor(private readonly openPath: (path: string) => Promise<string> = async () => '无法打开目录。') {}

  async handle(path: unknown, input: unknown): Promise<LingGitResult> {
    const directory = await realpath(pathValue(path))
    if (!input || typeof input !== 'object' || !('type' in input)) throw new Error('无效的 Git 操作。')
    const request = input as LingGitRequest
    if (request.type === 'inspect') return { snapshot: await inspect(directory) }
    const common = (await git(directory, ['rev-parse', '--git-common-dir'])).trim()
    const key = await realpath(resolve(directory, common))
    const previous = this.queues.get(key) ?? Promise.resolve()
    const next = previous.catch(() => {}).then(() => this.execute(directory, request))
    this.queues.set(key, next)
    try { return await next } finally { if (this.queues.get(key) === next) this.queues.delete(key) }
  }

  private async execute(directory: string, request: LingGitRequest): Promise<LingGitResult> {
    const state = await inspect(directory)
    if (!state.repository) throw new Error('当前目录不是 Git 仓库。')
    const root = state.root
    let message: string | undefined
    switch (request.type) {
      case 'diff': {
        const file = state.files.find(file => file.path === request.path)
        if (!file || typeof request.staged !== 'boolean') throw new Error('文件状态已变化，请刷新。')
        if (file.index === '?') {
          const target = resolve(root, file.path), info = await lstat(target)
          if (info.isSymbolicLink()) return { snapshot: state, diff: `符号链接 → ${await readlink(target)}` }
          if (!info.isFile() || info.size > 512 * 1024) return { snapshot: state, diff: '文件过大或无法作为文本预览。' }
          const buffer = await readFile(target)
          return { snapshot: state, diff: buffer.includes(0) ? '二进制文件' : `新增文件：${file.path}\n${buffer.toString('utf8').split('\n').map(line => `+${line}`).join('\n')}` }
        }
        const diff = await git(root, ['diff', '--no-ext-diff', '--no-textconv', '--no-color', ...(request.staged ? ['--cached'] : []), '--', file.path, ...(file.originalPath ? [file.originalPath] : [])])
        return { snapshot: state, diff: diff || '没有可显示的文本差异。' }
      }
      case 'stage':
      case 'unstage': {
        if (!Array.isArray(request.paths) || !request.paths.length || request.paths.length > 5000) throw new Error('请选择文件。')
        const paths = new Set<string>()
        for (const path of request.paths) {
          const file = state.files.find(file => file.path === path)
          if (!file) throw new Error('文件状态已变化，请刷新。')
          paths.add(file.path)
          if (file.originalPath) paths.add(file.originalPath)
        }
        await git(root, request.type === 'stage' ? ['add', '--', ...paths] : state.unborn ? ['rm', '--cached', '-r', '-f', '--', ...paths] : ['reset', '--quiet', 'HEAD', '--', ...paths])
        break
      }
      case 'commit': {
        if (state.files.some(file => file.conflict)) throw new Error('请先解决冲突并暂存。')
        if (!state.files.some(file => file.index !== ' ' && file.index !== '?')) throw new Error('没有已暂存的更改。')
        await git(root, ['commit', '-m', textValue(request.message, '提交说明', 20_000)])
        message = '提交成功'; break
      }
      case 'create-branch':
      case 'switch': {
        const branch = textValue(request.branch, '分支名', 255)
        await git(root, ['check-ref-format', '--branch', branch])
        if (request.type === 'switch' && !state.branches.includes(branch)) throw new Error('分支不存在，请刷新。')
        await git(root, ['switch', ...(request.type === 'create-branch' ? ['-c'] : []), branch])
        message = `已切换到 ${branch}`; break
      }
      case 'fetch':
        if (!state.remotes.length) throw new Error('尚未配置远程仓库。')
        await git(root, ['fetch', '--all'], true); message = '已获取远程更新'; break
      case 'pull':
        if (!state.upstream) throw new Error('当前分支尚未设置上游，请先推送并设置上游。')
        if (state.files.length) throw new Error('请先提交或自行保存工作区更改，再拉取。')
        await git(root, ['pull', '--ff-only'], true); message = '已拉取更新'; break
      case 'push': {
        if (state.detached || state.unborn || !state.branch) throw new Error('请先创建分支并提交。')
        if (state.upstream) {
          const remote = (await git(root, ['config', '--get', `branch.${state.branch}.remote`])).trim()
          const target = (await git(root, ['config', '--get', `branch.${state.branch}.merge`])).trim()
          if (!state.remotes.includes(remote) || !target.startsWith('refs/heads/')) throw new Error('当前上游不是可推送的远程分支。')
          await git(root, ['push', '--', remote, `HEAD:${target}`], true)
        } else {
          if (!request.remote || !state.remotes.includes(request.remote)) throw new Error('请选择推送远程。')
          await git(root, ['push', '--set-upstream', '--', request.remote, `refs/heads/${state.branch}:refs/heads/${state.branch}`], true)
        }
        message = '推送成功'; break
      }
      case 'worktree-add': {
        if (state.unborn) throw new Error('请先完成首次提交，再创建 Worktree。')
        const target = resolve(pathValue(request.path)), branch = textValue(request.branch, '分支名', 255)
        if (typeof request.newBranch !== 'boolean') throw new Error('请选择分支方式。')
        const rel = relative(root, target)
        if (!rel || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))) throw new Error('请在当前工作区之外创建 Worktree。')
        await git(root, ['check-ref-format', '--branch', branch])
        if (!request.newBranch && !state.branches.includes(branch)) throw new Error('分支不存在。')
        await git(root, ['worktree', 'add', ...(request.newBranch ? ['-b', branch] : []), '--', target, ...(request.newBranch ? [] : [branch])])
        message = 'Worktree 已创建'; break
      }
      case 'worktree-remove':
      case 'worktree-open': {
        const target = state.worktrees.find(item => item.path === request.path)
        if (!target) throw new Error('Worktree 不存在，请刷新。')
        if (request.type === 'worktree-open') {
          const error = await this.openPath(target.path)
          if (error) throw new Error(error)
          break
        }
        if (target.main || resolve(target.path) === resolve(root) || target.locked || target.prunable) throw new Error('无法移除主工作区、当前工作区、已锁定或不可用的 Worktree。')
        await git(root, ['worktree', 'remove', '--', target.path])
        message = 'Worktree 已移除'; break
      }
      default: throw new Error('不支持的 Git 操作。')
    }
    return { snapshot: await inspect(root), ...(message ? { message } : {}) }
  }
}
