import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { localDeploymentDirectory, localDeploymentFile, localDownloadTarget, parseRemoteFileHash,
  remoteDeploymentDirectory, remoteDeploymentPath, remoteFileHashCommand } from '../src/server-deployment.ts'

const cleanup: string[] = []
afterEach(async () => { for (const path of cleanup.splice(0)) await rm(path, { recursive: true, force: true }) })

describe('server deployment file boundary', () => {
  it('hashes a workspace file and rejects paths or symlinks escaping the workspace', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ling-deploy-'))
    const outside = await mkdtemp(join(tmpdir(), 'ling-outside-'))
    cleanup.push(root, outside)
    await writeFile(join(root, 'app.txt'), 'new release\n')
    await writeFile(join(outside, 'secret.txt'), 'outside')
    await symlink(join(outside, 'secret.txt'), join(root, 'escape.txt'))
    const file = await localDeploymentFile(root, 'app.txt')
    expect(file).toMatchObject({ bytes: 12, sha256: createHash('sha256').update('new release\n').digest('hex') })
    await expect(localDeploymentFile(root, '../outside/secret.txt')).rejects.toThrow('工作区')
    await expect(localDeploymentFile(root, 'escape.txt')).rejects.toThrow('工作区')
    await expect(localDeploymentFile(root, '.')).rejects.toThrow('工作区')
  })

  it('accepts only absolute file destinations and parses remote version checks', () => {
    expect(remoteDeploymentPath('/srv/app/release.txt')).toBe('/srv/app/release.txt')
    expect(() => remoteDeploymentPath('/srv/app/../other')).toThrow('绝对文件路径')
    expect(() => remoteDeploymentPath('/srv/app/')).toThrow('绝对文件路径')
    expect(remoteFileHashCommand("/srv/app/a'b")).toContain("'/srv/app/a'\\''b'")
    expect(parseRemoteFileHash('__LING_ABSENT__\n')).toBeNull()
    expect(parseRemoteFileHash(`__LING_FILE__ ${'a'.repeat(64)}\n`)).toBe('a'.repeat(64))
    expect(() => parseRemoteFileHash('__LING_NOT_FILE__\n')).toThrow('普通文件')
  })

  it('snapshots a directory and prevents download or directory symlink escapes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ling-deploy-dir-'))
    const outside = await mkdtemp(join(tmpdir(), 'ling-deploy-outside-'))
    cleanup.push(root, outside)
    await mkdir(join(root, 'dist', 'assets'), { recursive: true })
    await writeFile(join(root, 'dist', 'index.html'), 'hello')
    await writeFile(join(root, 'dist', 'assets', 'app.js'), 'code')
    expect((await localDeploymentDirectory(root, 'dist')).map(file => file.relative)).toEqual(['assets/app.js', 'index.html'])
    expect((await localDownloadTarget(root, 'copy.txt')).sha256).toBeNull()
    await writeFile(join(root, 'copy.txt'), 'copy')
    expect((await localDownloadTarget(root, 'copy.txt')).sha256).toBe(createHash('sha256').update('copy').digest('hex'))
    await symlink(outside, join(root, 'link'))
    await symlink(join(outside, 'escape'), join(root, 'dist', 'escape'))
    await expect(localDeploymentDirectory(root, 'dist')).rejects.toThrow('符号链接')
    await expect(localDownloadTarget(root, 'link/escape')).rejects.toThrow('工作区')
    expect(remoteDeploymentDirectory('/srv/app')).toBe('/srv/app')
    expect(() => remoteDeploymentDirectory('/srv/app/')).toThrow('绝对路径')
  })
})
