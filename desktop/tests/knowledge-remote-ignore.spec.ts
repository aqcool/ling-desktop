import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { KnowledgeScope } from '../src/knowledge/engine.ts'
const { file } = vi.hoisted(() => ({ file: vi.fn() }))
vi.mock('../src/host/server-bridge.ts', () => ({ getServerBridge: () => ({ file }) }))
import { indexRemoteCode, listRemoteCodePaths } from '../src/knowledge/remote-code.ts'
const scope: KnowledgeScope = { id: 'remote-a', workspaceId: 'a', label: 'SSH', root: '/project', remote: { serverId: 'server', taskId: 'task' } }
const directory = (name: string) => ({ name, type: 'directory' })
const regular = (name: string) => ({ name, type: 'file' })
beforeEach(() => {
  file.mockReset().mockImplementation(async ({ action, path }) => {
    if (action === 'list') return { entries: path === '/project' ? [regular('.gitignore'), directory('.git'), directory('cache'), directory('src')] : [regular('.gitignore'), regular('kept.ts'), regular('nested.ts'), regular('ignored.ts')] }
    if (path.endsWith('.gitignore')) return { text: path === '/project/.gitignore' ? 'cache/\n*.ts\n!src/kept.ts\n' : '!nested.ts\n', truncated: false }
    return { text: 'export const test = 1', sha256: 'hash', truncated: false }
  })
})
describe('SSH knowledge ignore rules', () => {
  it('applies nested .gitignore before listing directories or reading source', async () => {
    const signal = new AbortController().signal
    expect(await listRemoteCodePaths(scope, signal)).toEqual(['src/kept.ts', 'src/nested.ts'])
    expect(file.mock.calls.some(([input]) => input.path.includes('/cache') || input.path.includes('/.git/'))).toBe(false)
    file.mockClear()
    expect((await indexRemoteCode(scope, [], signal)).map(value => value.path)).toEqual(['src/kept.ts', 'src/nested.ts'])
    expect(file.mock.calls.some(([input]) => input.path.endsWith('ignored.ts'))).toBe(false)
    expect(file.mock.calls.every(([input]) => input.root === '/project' && input.serverId === 'server')).toBe(true)
  })
  it('does not publish a partial index when ignore rules cannot be read completely', async () => {
    file.mockImplementation(async ({ action }) => action === 'list' ? { entries: [regular('.gitignore'), regular('private.ts')] } : { text: 'private', truncated: true })
    await expect(indexRemoteCode(scope, [], new AbortController().signal)).rejects.toThrow('忽略规则读取失败')
    expect(file.mock.calls.some(([input]) => input.path.endsWith('private.ts'))).toBe(false)
  })
})
