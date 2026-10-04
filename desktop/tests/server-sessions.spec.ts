import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ServerSessions } from '../src/server-sessions.ts'

describe('remote task binding', () => {
  it('persists one non-secret server and working directory per task', async () => {
    const home = await mkdtemp(join(tmpdir(), 'ling-server-sessions-'))
    try {
      const file = join(home, 'bindings.json')
      const sessions = new ServerSessions(file)
      const serverId = '4a26673e-b38d-4e92-bfb8-0e7fd886e445'
      await expect(sessions.bind('task-1', serverId, '/home/tester')).resolves.toEqual({ serverId, cwd: '/home/tester' })
      await expect(sessions.bind('task-1', serverId, '/other')).rejects.toThrow('已经绑定')
      await expect(sessions.changeDirectory('task-1', '/home/tester/project')).resolves.toEqual({ serverId, cwd: '/home/tester/project' })
      await expect(sessions.changeDirectory('task-1', 'relative')).rejects.toThrow('目录无效')
      await expect(new ServerSessions(file).get('task-1')).resolves.toEqual({ serverId, cwd: '/home/tester/project' })
      expect(await readFile(file, 'utf8')).not.toContain('password')
    } finally { await rm(home, { recursive: true, force: true }) }
  })
})
