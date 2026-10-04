import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ServerAudit } from '../src/server-audit.ts'

describe('server operation audit', () => {
  it('persists completed and failed actions without copying command text or credentials', async () => {
    const home = await mkdtemp(join(tmpdir(), 'ling-audit-'))
    try {
      const audit = new ServerAudit(home)
      await expect(audit.perform('task-1', 'server-1', 'exec', 'printf secret-password', async () => 42)).resolves.toBe(42)
      await expect(audit.perform('task-1', 'server-1', 'exec', 'false', async () => { throw new Error('failed') })).rejects.toThrow('failed')
      const path = join(home, 'ling-server-operations.jsonl')
      const events = (await readFile(path, 'utf8')).trim().split('\n').map(line => JSON.parse(line) as { state: string; operationId: string })
      expect(events.map(event => event.state)).toEqual(['started', 'succeeded', 'started', 'failed'])
      expect(events[0]!.operationId).toBe(events[1]!.operationId)
      expect(events[2]!.operationId).toBe(events[3]!.operationId)
      expect(await readFile(path, 'utf8')).not.toContain('secret-password')
      // Windows exposes synthetic mode bits; Unix mode assertions do not test its ACLs.
      if (process.platform !== 'win32') expect((await stat(path)).mode & 0o777).toBe(0o600)
    } finally { await rm(home, { recursive: true, force: true }) }
  })
})
