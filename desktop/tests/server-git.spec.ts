import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, expect, it } from 'vitest'
import { RemoteWorkspaceGit } from '../src/host/server-git.ts'

const execute = promisify(execFile)
const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })

it('uses one remote working directory for Git inspection, diff, staging, commit and branch changes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ling-remote-git-'))
  roots.push(root)
  const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' }
  const local = (args: string[]) => execute('git', ['-C', root, ...args], { env })
  await local(['init', '-q'])
  await local(['config', 'user.name', 'LING Test'])
  await local(['config', 'user.email', 'ling@example.invalid'])
  await writeFile(join(root, 'base.txt'), 'initial\n')
  await local(['add', 'base.txt'])
  await local(['commit', '-qm', 'initial'])
  const commands: string[] = []
  const git = new RemoteWorkspaceGit({ run: async (_serverId, _cwd, command) => {
    commands.push(command)
    try {
      const result = await execute('sh', ['-c', command], { env, maxBuffer: 4 * 1024 * 1024 })
      return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 }
    } catch (error) {
      const failure = error as { stdout?: string; stderr?: string; code?: number }
      return { stdout: failure.stdout ?? '', stderr: failure.stderr ?? '', exitCode: failure.code ?? 255 }
    }
  } })
  const binding = { serverId: 'opaque-server', cwd: root }
  const signal = new AbortController().signal
  const noOpen = async () => { throw new Error('unexpected worktree open') }
  expect((await git.inspect(binding, signal)).repository).toBe(true)
  await writeFile(join(root, 'new.txt'), 'remote edit\n')
  const before = await git.inspect(binding, signal)
  expect(before.files.map(file => file.path)).toContain('new.txt')
  expect((await git.handle(binding, { type: 'inspect', lineChanges: true }, signal, noOpen)).snapshot.lineChanges).toEqual({ added: 1, deleted: 0 })
  const diff = await git.handle(binding, { type: 'diff', path: 'new.txt', staged: false }, signal, noOpen)
  expect(diff.diff).toContain('remote edit')
  const staged = await git.handle(binding, { type: 'stage', paths: ['new.txt'] }, signal, noOpen)
  expect(staged.snapshot.files.find(file => file.path === 'new.txt')?.index).toBe('A')
  expect((await git.handle(binding, { type: 'inspect', lineChanges: true }, signal, noOpen)).snapshot.lineChanges).toEqual({ added: 1, deleted: 0 })
  const committed = await git.handle(binding, { type: 'commit', message: 'remote commit' }, signal, noOpen)
  expect(committed.snapshot.files).toEqual([])
  expect((await git.handle(binding, { type: 'inspect', lineChanges: true }, signal, noOpen)).snapshot.lineChanges).toEqual({ added: 0, deleted: 0 })
  const branched = await git.handle(binding, { type: 'create-branch', branch: 'remote-feature' }, signal, noOpen)
  expect(branched.snapshot.branch).toBe('remote-feature')
  expect(commands.every(command => command.includes("-C '"))).toBe(true)
  expect(commands.join('\n')).not.toContain('password')
})
