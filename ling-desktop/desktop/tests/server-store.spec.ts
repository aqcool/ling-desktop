import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ServerStore } from '../src/server-store.ts'

const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))) })

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'ling-servers-test-'))
  directories.push(root)
  const file = join(root, 'nested', 'servers.json')
  return { file, store: new ServerStore(file) }
}

describe('server metadata store', () => {
  it('persists only metadata and restores it across store instances', async () => {
    const { file, store } = await fixture()
    const saved = await store.add({ name: 'Preview', alias: 'ling-preview', environment: 'staging' })
    expect(saved.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(await new ServerStore(file).list()).toEqual([saved])
    const document = await readFile(file, 'utf8')
    expect(document).not.toMatch(/password|privateKey|passphrase|apiKey/i)
    await store.remove(saved.id)
    expect(await new ServerStore(file).list()).toEqual([])
  })

  it('serializes concurrent additions and rejects duplicate aliases', async () => {
    const { store } = await fixture()
    const first = { name: 'First', alias: 'ling-prod', environment: 'production' as const }
    const second = { name: 'Second', alias: 'LING-PROD', environment: 'staging' as const }
    const results = await Promise.allSettled([store.add(first), store.add(second)])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1)
    expect(await store.list()).toHaveLength(1)
  })

  it('updates an existing address with a login account and port without changing its identity', async () => {
    const { file, store } = await fixture()
    const saved = await store.add({ name: 'Production', alias: '114.55.34.58', environment: 'production' })
    const updated = await store.configure(saved.id, { name: 'Production', alias: '114.55.34.58', user: 'deploy', port: 2222, environment: 'production' })
    expect(updated.id).toBe(saved.id)
    expect(await new ServerStore(file).list()).toEqual([updated])
    const document = await readFile(file, 'utf8')
    expect(document).not.toMatch(/password|privateKey|passphrase|apiKey/i)
    await expect(store.configure(saved.id, { name: 'Bad', alias: 'host', user: '-bad', environment: 'development' })).rejects.toThrow()
    expect(await store.list()).toEqual([updated])
  })

  it('rejects unknown metadata fields, including credential input', async () => {
    const { store } = await fixture()
    await expect(store.add({ name: 'Bad', alias: 'bad', environment: 'development', password: 'secret' } as never)).rejects.toThrow()
    expect(await store.list()).toEqual([])
  })
})
