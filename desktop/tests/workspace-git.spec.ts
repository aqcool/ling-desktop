import { execFileSync } from 'node:child_process'
import { existsSync, realpathSync, readFileSync, symlinkSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WorkspaceGit, readWorkspaceBranch } from '../src/workspace-git.ts'

describe('workspace branch', () => {
  let root: string
  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { stdio: 'pipe' }).toString().trim()
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'ling-git-')) })
  afterEach(() => { rmSync(root, { recursive: true, force: true }) })

  it('omits non-repositories and invalid paths', async () => {
    expect(await readWorkspaceBranch(root)).toBeNull()
    expect(await readWorkspaceBranch('relative')).toBeNull()
    expect(await readWorkspaceBranch(null)).toBeNull()
  })

  it('reads an unborn branch and follows branch switches', async () => {
    git('init', '-b', 'main')
    expect(await readWorkspaceBranch(root)).toBe('main')
    git('checkout', '-b', 'feature/footer')
    expect(await readWorkspaceBranch(root)).toBe('feature/footer')
  })

  it('reads worktree branches and detached HEAD without inventing a branch', async () => {
    git('init', '-b', 'main')
    git('-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '--allow-empty', '-m', 'fixture')
    const worktree = join(root, 'linked')
    git('worktree', 'add', '-b', 'feature/worktree', worktree)
    expect(await readWorkspaceBranch(worktree)).toBe('feature/worktree')
    git('checkout', '--detach')
    expect(await readWorkspaceBranch(root)).toBe(`${git('rev-parse', '--short', 'HEAD')} (detached)`)
  })
})

describe('workspace Git operations', () => {
  let root: string
  let service: WorkspaceGit
  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { stdio: 'pipe' }).toString().trim()
  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'ling-git-ops-')))
    git('init', '-b', 'main')
    git('config', 'user.name', 'Test')
    git('config', 'user.email', 'test@example.test')
    service = new WorkspaceGit(async () => '')
  })
  afterEach(() => { rmSync(root, { recursive: true, force: true }) })
  const seed = () => { writeFileSync(join(root, 'file.txt'), 'one\ntwo\n'); git('add', '.'); git('commit', '-m', 'initial') }

  it('counts current tracked and untracked lines against HEAD without changing the index', async () => {
    seed()
    writeFileSync(join(root, 'file.txt'), 'replacement\n')
    git('add', 'file.txt')
    writeFileSync(join(root, 'file.txt'), 'one\ntwo\nthird\n')
    writeFileSync(join(root, 'new [a]\nfile.txt'), 'new\nlast')
    writeFileSync(join(root, 'binary.dat'), Buffer.from([0, 1, 2]))
    const index = readFileSync(join(root, '.git', 'index'))
    expect((await service.handle(root, { type: 'inspect', lineChanges: true })).snapshot.lineChanges).toEqual({ added: 3, deleted: 0 })
    expect(readFileSync(join(root, '.git', 'index'))).toEqual(index)
    git('mv', 'file.txt', 'renamed.txt')
    expect((await service.handle(root, { type: 'inspect', lineChanges: true })).snapshot.lineChanges).toEqual({ added: 3, deleted: 0 })
    rmSync(join(root, 'renamed.txt'))
    expect((await service.handle(root, { type: 'inspect', lineChanges: true })).snapshot.lineChanges).toEqual({ added: 2, deleted: 2 })
  })

  it('counts the current contents of an unborn repository and omits stats unless requested', async () => {
    writeFileSync(join(root, 'new.txt'), 'staged\n')
    git('add', 'new.txt')
    writeFileSync(join(root, 'new.txt'), 'current\nsecond\n')
    expect((await service.handle(root, { type: 'inspect' })).snapshot.lineChanges).toBeUndefined()
    expect((await service.handle(root, { type: 'inspect', lineChanges: true })).snapshot.lineChanges).toEqual({ added: 2, deleted: 0 })
    rmSync(join(root, 'new.txt'))
    expect((await service.handle(root, { type: 'inspect', lineChanges: true })).snapshot.lineChanges).toEqual({ added: 0, deleted: 0 })
  })

  it('stages literal filenames and unstages an unborn index without removing newer contents', async () => {
    const name = '中文 [a]*\nfile.txt'
    writeFileSync(join(root, name), 'first')
    const state = await service.handle(root, { type: 'inspect' })
    expect(state.snapshot).toMatchObject({ unborn: true, branch: 'main', files: [{ path: name, index: '?' }] })
    await service.handle(root, { type: 'stage', paths: [name] })
    writeFileSync(join(root, name), 'second')
    await service.handle(root, { type: 'unstage', paths: [name] })
    expect(readFileSync(join(root, name), 'utf8')).toBe('second')
    expect(git('diff', '--cached', '--name-only')).toBe('')
  })

  it('commits only the index and leaves later working changes intact', async () => {
    seed()
    writeFileSync(join(root, 'file.txt'), 'staged\n')
    await service.handle(root, { type: 'stage', paths: ['file.txt'] })
    writeFileSync(join(root, 'file.txt'), 'working\n')
    expect((await service.handle(root, { type: 'diff', path: 'file.txt', staged: true })).diff).toContain('+staged')
    expect((await service.handle(root, { type: 'diff', path: 'file.txt', staged: false })).diff).toContain('+working')
    const result = await service.handle(root, { type: 'commit', message: 'only staged' })
    expect(git('show', 'HEAD:file.txt')).toBe('staged')
    expect(result.snapshot.files).toMatchObject([{ index: ' ', worktree: 'M' }])
    expect(readFileSync(join(root, 'file.txt'), 'utf8')).toBe('working\n')
  })

  it('handles staged renames and restores both index paths when unstaging', async () => {
    seed(); git('mv', 'file.txt', 'renamed.txt')
    expect((await service.handle(root, { type: 'inspect' })).snapshot.files).toMatchObject([{ path: 'renamed.txt', originalPath: 'file.txt', index: 'R' }])
    await service.handle(root, { type: 'unstage', paths: ['renamed.txt'] })
    expect(git('diff', '--cached', '--name-only')).toBe('')
    expect(readFileSync(join(root, 'renamed.txt'), 'utf8')).toContain('one')
  })

  it('rejects arbitrary paths, commands and invalid branch names', async () => {
    seed()
    await expect(service.handle(root, { type: 'stage', paths: ['../secret'] })).rejects.toThrow('文件状态')
    await expect(service.handle(root, { type: 'diff', path: '../secret', staged: false })).rejects.toThrow('文件状态')
    await expect(service.handle(root, { type: 'create-branch', branch: '--force' })).rejects.toThrow()
    await expect(service.handle(root, { type: 'reset-hard' })).rejects.toThrow('不支持')
    await expect(service.handle('relative', { type: 'inspect' })).rejects.toThrow('本地目录')
  })

  it('does not read a symlink target when previewing an untracked file', async () => {
    symlinkSync('/etc/hosts', join(root, 'link'))
    expect((await service.handle(root, { type: 'diff', path: 'link', staged: false })).diff).toBe('符号链接 → /etc/hosts')
  })

  it('switches branches without discarding conflicting local edits', async () => {
    seed()
    await service.handle(root, { type: 'create-branch', branch: 'feature/test' })
    writeFileSync(join(root, 'file.txt'), 'feature\n'); git('commit', '-am', 'feature')
    await service.handle(root, { type: 'switch', branch: 'main' })
    writeFileSync(join(root, 'file.txt'), 'unsaved\n')
    await expect(service.handle(root, { type: 'switch', branch: 'feature/test' })).rejects.toThrow()
    expect(readFileSync(join(root, 'file.txt'), 'utf8')).toBe('unsaved\n')
    expect(await readWorkspaceBranch(root)).toBe('main')
  })

  it('creates linked worktrees and refuses removal of dirty, locked or current worktrees', async () => {
    seed()
    const parent = realpathSync(mkdtempSync(join(tmpdir(), 'ling-linked-'))), tree = join(parent, 'feature')
    try {
      const result = await service.handle(root, { type: 'worktree-add', path: tree, branch: 'feature/tree', newBranch: true })
      expect(result.snapshot.worktrees).toHaveLength(2)
      expect(result.snapshot.worktrees[1]).toMatchObject({ path: tree, branch: 'feature/tree', main: false })
      await expect(service.handle(tree, { type: 'worktree-remove', path: tree })).rejects.toThrow('当前工作区')
      writeFileSync(join(tree, 'untracked'), 'keep')
      await expect(service.handle(root, { type: 'worktree-remove', path: tree })).rejects.toThrow()
      expect(readFileSync(join(tree, 'untracked'), 'utf8')).toBe('keep')
      rmSync(join(tree, 'untracked'))
      git('worktree', 'lock', tree)
      await expect(service.handle(root, { type: 'worktree-remove', path: tree })).rejects.toThrow('锁定')
      git('worktree', 'unlock', tree)
      await service.handle(root, { type: 'worktree-remove', path: tree })
      expect(existsSync(tree)).toBe(false)
      expect(git('branch', '--list', 'feature/tree')).toContain('feature/tree')
      await expect(service.handle(root, { type: 'worktree-remove', path: root })).rejects.toThrow('主工作区')
    } finally { rmSync(parent, { recursive: true, force: true }) }
  })

  it('pushes with upstream setup and fast-forwards from a local bare remote', async () => {
    seed()
    const parent = mkdtempSync(join(tmpdir(), 'ling-remote-')), remote = join(parent, 'remote.git'), peer = join(parent, 'peer')
    try {
      execFileSync('git', ['init', '--bare', '-b', 'main', remote], { stdio: 'pipe' })
      git('remote', 'add', 'origin', remote)
      const pushed = await service.handle(root, { type: 'push', remote: 'origin' })
      expect(pushed.snapshot).toMatchObject({ upstream: 'origin/main', ahead: 0, behind: 0 })
      git('branch', 'other')
      git('push', 'origin', 'other')
      git('switch', 'other')
      git('commit', '--allow-empty', '-m', 'not for pushing')
      const otherHead = git('rev-parse', 'HEAD')
      git('switch', 'main')
      git('config', 'push.default', 'matching')
      git('config', 'remote.origin.push', 'refs/heads/other:refs/heads/other')
      git('commit', '--allow-empty', '-m', 'current branch only')
      await service.handle(root, { type: 'push' })
      expect(git('ls-remote', 'origin', 'refs/heads/other')).not.toContain(otherHead)
      expect((await service.handle(root, { type: 'inspect' })).snapshot.ahead).toBe(0)
      execFileSync('git', ['clone', remote, peer], { stdio: 'pipe' })
      writeFileSync(join(peer, 'new.txt'), 'remote change')
      execFileSync('git', ['-C', peer, 'add', '.'])
      execFileSync('git', ['-C', peer, '-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '-m', 'peer'], { stdio: 'pipe' })
      execFileSync('git', ['-C', peer, 'push'], { stdio: 'pipe' })
      expect((await service.handle(root, { type: 'fetch' })).snapshot.behind).toBe(1)
      const pulled = await service.handle(root, { type: 'pull' })
      expect(pulled.snapshot.behind).toBe(0)
      expect(readFileSync(join(root, 'new.txt'), 'utf8')).toBe('remote change')
    } finally { rmSync(parent, { recursive: true, force: true }) }
  })
})
