import { mkdtemp, open, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { ServerSessions } from '../src/server-sessions.ts'
vi.mock('node:fs/promises', async importOriginal => {
  const fs = await importOriginal<typeof import('node:fs/promises')>()
  return { ...fs, readFile: vi.fn(fs.readFile), rename: vi.fn(fs.rename) }
})
const a = '4a26673e-b38d-4e92-bfb8-0e7fd886e445'
const b = '8c77cad8-c7f8-414d-88ba-20716896efce'
async function fixture(run: (sessions: ServerSessions, file: string, home: string) => Promise<void>) {
  const home = await mkdtemp(join(tmpdir(), 'ling-task-servers-'))
  try { const file = join(home, 'ling-task-servers.json'); await run(new ServerSessions(file), file, home) }
  finally { await rm(home, { recursive: true, force: true }) }
}
describe('multiple non-secret task servers', () => {
  it('persists offline associations, independent directories and the explicit primary with revision checks', async () => fixture(async (sessions, file) => {
    expect(await sessions.get('task')).toEqual({ revision: 0, servers: [] })
    expect(await sessions.set('task', { expectedRevision: 0, serverIds: [a, b], developmentServerId: a }))
      .toEqual({ revision: 1, developmentServerId: a, servers: [{ serverId: a }, { serverId: b }] })
    await sessions.changeDirectory('task', a, '/srv/app')
    await sessions.changeDirectory('task', b, '/opt/ops')
    const stored = await new ServerSessions(file).get('task')
    expect(stored.servers).toEqual([{ serverId: a, cwd: '/srv/app' }, { serverId: b, cwd: '/opt/ops' }])
    await expect(sessions.set('task', { expectedRevision: 0, serverIds: [] })).rejects.toThrow('已变化')
    const next = await sessions.set('task', { expectedRevision: stored.revision, serverIds: [b] })
    expect(next).toEqual({ revision: 2, servers: [{ serverId: b, cwd: '/opt/ops' }] })
    await expect(sessions.changeDirectory('task', a, '/srv/removed')).rejects.toThrow('未关联')
    expect(await readFile(file, 'utf8')).not.toContain('password')
  }))
  it('rejects duplicate/invalid targets and never consumes legacy binding files', async () => fixture(async (sessions, _file, home) => {
    await writeFile(join(home, 'ling-server-sessions.json'), JSON.stringify({ version: 1, sessions: { task: { serverId: a, cwd: '/legacy' } } }))
    expect(await sessions.get('task')).toEqual({ revision: 0, servers: [] })
    await expect(sessions.set('task', { expectedRevision: 0, serverIds: [a, a] })).rejects.toThrow('重复')
    await expect(sessions.set('task', { expectedRevision: 0, serverIds: [a], developmentServerId: b })).rejects.toThrow('必须已关联')
    await sessions.set('task', { expectedRevision: 0, serverIds: [a] })
    await expect(sessions.changeDirectory('task', a, '/srv/../outside')).rejects.toThrow('目录无效')
  }))
  it('serializes competing mutations and refuses a stale directory snapshot', async () => fixture(async sessions => {
    const updates = await Promise.allSettled([sessions.set('task', { expectedRevision: 0, serverIds: [a] }), sessions.set('task', { expectedRevision: 0, serverIds: [b] })])
    expect(updates.filter(item => item.status === 'fulfilled')).toHaveLength(1)
    await sessions.changeDirectory('task', a, '/one', undefined, true)
    const state = await sessions.get('task')
    await sessions.changeDirectory('task', a, '/two')
    await expect(sessions.changeDirectory('task', a, '/three', { revision: state.revision, cwd: '/one' })).rejects.toThrow('已变化')
    expect((await sessions.get('task')).servers).toEqual([{ serverId: a, cwd: '/two' }])
  }))
  it('orders reads with concurrent directory initialization and continues after a rejected mutation', async () => fixture(async sessions => {
    await sessions.set('task', { expectedRevision: 0, serverIds: [a, b] })
    const first = sessions.changeDirectory('task', a, '/srv/alpha', { revision: 1 }, true)
    const afterFirst = sessions.get('task')
    const second = sessions.changeDirectory('task', b, '/srv/beta', { revision: 1 }, true)
    const afterBoth = sessions.get('task')
    await Promise.all([first, second])
    expect((await afterFirst).servers).toEqual([{ serverId: a, cwd: '/srv/alpha' }, { serverId: b }])
    expect((await afterBoth).servers).toEqual([{ serverId: a, cwd: '/srv/alpha' }, { serverId: b, cwd: '/srv/beta' }])
    const rejected = sessions.set('task', { expectedRevision: 0, serverIds: [] })
    const afterFailure = sessions.get('task')
    await expect(rejected).rejects.toThrow('已变化')
    expect(await afterFailure).toEqual(await afterBoth)
  }))
  it('waits for an open read handle before replacing the task record', async () => fixture(async (sessions, file) => {
    await sessions.set('task', { expectedRevision: 0, serverIds: [a] })
    let opened!: () => void, release!: () => void
    const started = new Promise<void>(resolve => { opened = resolve })
    const held = new Promise<void>(resolve => { release = resolve })
    vi.mocked(readFile).mockClear().mockImplementationOnce(async () => {
      const handle = await open(file, 'r')
      try { opened(); await held; return await handle.readFile('utf8') }
      finally { await handle.close() }
    })
    vi.mocked(rename).mockClear()
    const reading = sessions.get('task')
    await started
    const writing = sessions.changeDirectory('task', a, '/srv/app')
    try {
      await Promise.resolve()
      expect(readFile).toHaveBeenCalledOnce()
      expect(rename).not.toHaveBeenCalled()
    } finally {
      release()
      await Promise.all([reading, writing])
    }
    expect((await sessions.get('task')).servers).toEqual([{ serverId: a, cwd: '/srv/app' }])
    expect(rename).toHaveBeenCalledOnce()
  }))
  it('copies all fork directories and the primary atomically with an independent target revision', async () => fixture(async (sessions, file) => {
    await sessions.set('source', { expectedRevision: 0, serverIds: [a, b], developmentServerId: a })
    await sessions.changeDirectory('source', a, '/srv/project/.worktrees/feature')
    await sessions.changeDirectory('source', b, '/opt/ops')
    await sessions.set('source', { expectedRevision: 1, serverIds: [a, b], developmentServerId: a })
    await sessions.set('source', { expectedRevision: 2, serverIds: [a, b], developmentServerId: a })
    await sessions.set('fork', { expectedRevision: 0, serverIds: [] })
    const [, copied] = await Promise.all([
      sessions.changeDirectory('source', b, '/opt/ops/current'),
      sessions.copy('source', 'fork'),
    ])
    expect(copied).toEqual({ revision: 2, developmentServerId: a,
      servers: [{ serverId: a, cwd: '/srv/project/.worktrees/feature' }, { serverId: b, cwd: '/opt/ops/current' }] })
    expect(await new ServerSessions(file).get('fork')).toEqual(copied)
    await sessions.changeDirectory('source', a, '/srv/other')
    expect((await sessions.get('fork')).servers).toEqual(copied.servers)
  }))
  it('refuses to overwrite a fork target that already has server bindings', async () => fixture(async sessions => {
    await sessions.set('source', { expectedRevision: 0, serverIds: [a], developmentServerId: a })
    await sessions.changeDirectory('source', a, '/srv/source')
    const target = await sessions.set('fork', { expectedRevision: 0, serverIds: [b] })
    await expect(sessions.copy('source', 'fork')).rejects.toThrow('无法覆盖')
    expect(await sessions.get('fork')).toEqual(target)
    await expect(sessions.copy('source', 'source')).rejects.toThrow('原会话')
    await expect(sessions.copy('', 'fork')).rejects.toThrow()
  }))
  it('keeps offline directories unresolved and refuses caller-supplied directories in normal association updates', async () => fixture(async sessions => {
    await sessions.set('source', { expectedRevision: 0, serverIds: [a, b], developmentServerId: a })
    await sessions.changeDirectory('source', a, '/srv/app')
    expect(await sessions.copy('source', 'fork')).toEqual({ revision: 1, developmentServerId: a,
      servers: [{ serverId: a, cwd: '/srv/app' }, { serverId: b }] })
    await expect(sessions.set('other', { expectedRevision: 0, serverIds: [a], cwd: '/untrusted' } as never)).rejects.toThrow()
    await expect(sessions.set('other', { expectedRevision: 0, serverIds: [a], servers: [{ serverId: a, cwd: '/untrusted' }] } as never)).rejects.toThrow()
    expect(await sessions.get('other')).toEqual({ revision: 0, servers: [] })
  }))
})
