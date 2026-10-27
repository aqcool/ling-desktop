import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { ServerBroker } from '../src/server-broker.ts'
import { ServerStore } from '../src/server-store.ts'
import { serverEndpoint } from '../src/server-task-contract.ts'
import { serverCopyRequestSchema } from '../src/server-copy-contract.ts'

const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })

async function fixture() {
  const home = await mkdtemp(join(tmpdir(), 'ling-endpoint-'))
  cleanup.push(() => rm(home, { recursive: true, force: true }))
  const inventory = new ServerStore(join(home, 'ling-servers.json'))
  const original = await inventory.add({ name: 'Original', alias: 'original.example', port: 2222, user: 'tester', environment: 'development' })
  const changed = await inventory.configure(original.id, { name: 'Changed', alias: 'changed.example', port: 2223, user: 'other', environment: 'development' })
  const entry = { endpoint: serverEndpoint(changed), fingerprint: { algorithm: 'ssh-ed25519', sha256: 'SHA256:trusted-new-target' }, credential: { method: 'password', encrypted: 'sealed' } }
  await writeFile(join(home, 'ling-server-secrets.json'), JSON.stringify({ version: 1, entries: { [original.id]: entry } }))
  const codec = { available: vi.fn(async () => true), encrypt: vi.fn(async () => Buffer.alloc(0)), decrypt: vi.fn(async () => '{}') }
  const broker = new ServerBroker(home, codec)
  cleanup.push(() => broker.close())
  const runtime = {
    execute: vi.fn(async () => ({ stdout: 'changed target', stderr: '', exitCode: 0 })),
    readFile: vi.fn(async () => ({ path: '/srv/file', text: 'changed target', sha256: 'a'.repeat(64), truncated: false })),
    close: vi.fn(async () => {}),
  }
  const cache = broker as unknown as {
    runtimes: Map<string, { key: string; runtime: Promise<typeof runtime> }>
    sftpSessions: Map<string, Promise<{ endpoint: string; client: { end(): void; sftp: ReturnType<typeof vi.fn> }; files: { list: ReturnType<typeof vi.fn> } }>>
  }
  cache.runtimes.set(original.id, { key: JSON.stringify(entry), runtime: Promise.resolve(runtime) })
  return { broker, id: original.id, home, codec, runtime, cache, oldEndpoint: serverEndpoint(original), newEndpoint: serverEndpoint(changed) }
}

it('rejects an outdated run endpoint before reusing a trusted replacement runtime or creating a connection', async () => {
  const state = await fixture()
  await expect(state.broker.run(state.id, '/srv', 'pwd', undefined, undefined, undefined, undefined, state.oldEndpoint)).rejects.toThrow('连接目标已变化')
  expect(state.runtime.execute).not.toHaveBeenCalled()
  expect(state.codec.available).not.toHaveBeenCalled()
  expect(state.codec.decrypt).not.toHaveBeenCalled()
  await expect(state.broker.run(state.id, '/srv', 'pwd', undefined, undefined, undefined, undefined, state.newEndpoint)).resolves.toMatchObject({ stdout: 'changed target' })
  expect(state.runtime.execute).toHaveBeenCalledOnce()
})

it('rejects an outdated file endpoint even when the replacement endpoint is already trusted and cached', async () => {
  const state = await fixture()
  await expect(state.broker.readFile(state.id, '/srv/file', undefined, undefined, undefined, state.oldEndpoint)).rejects.toThrow('连接目标已变化')
  expect(state.runtime.readFile).not.toHaveBeenCalled()
  expect(state.codec.available).not.toHaveBeenCalled()
  expect(state.codec.decrypt).not.toHaveBeenCalled()
  await expect(state.broker.readFile(state.id, '/srv/file', undefined, undefined, undefined, state.newEndpoint)).resolves.toMatchObject({ text: 'changed target' })
  expect(state.runtime.readFile).toHaveBeenCalledOnce()
})

it('rejects a pooled SFTP connection from the old endpoint for both UI file access and model copy', async () => {
  const state = await fixture()
  const client = { end: vi.fn(), sftp: vi.fn() }
  const files = { list: vi.fn() }
  state.cache.sftpSessions.set(state.id, Promise.resolve({ client, files, endpoint: state.oldEndpoint }))
  await expect(state.broker.manageFiles(state.id, { type: 'list', path: '/srv' }, undefined, state.oldEndpoint)).rejects.toThrow('连接目标已变化')
  await expect(state.broker.manageFiles(state.id, { type: 'list', path: '/srv' }, undefined, state.newEndpoint)).rejects.toThrow('连接目标已变化')
  await writeFile(join(state.home, 'copy.txt'), 'copy bytes')
  await expect(state.broker.copy(state.id, serverCopyRequestSchema.parse({ root: state.home, source: 'copy.txt', destination: '/srv/copy.txt', method: 'sftp', dryRun: true, allowOutsideWorkspace: false }), new AbortController().signal, undefined, state.newEndpoint)).rejects.toThrow('连接目标已变化')
  expect(client.sftp).not.toHaveBeenCalled()
  expect(files.list).not.toHaveBeenCalled()
  expect(state.codec.available).not.toHaveBeenCalled()
})
