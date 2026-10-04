import { mkdtempSync, statSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceTools } from '../src/workspace-tools.ts'

describe('workspace tools', () => {
  let root: string
  let tools: WorkspaceTools
  const openPath = vi.fn(async () => '')
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'ling-workspace-tools-'))
    tools = new WorkspaceTools({ icon: async () => '', openPath })
  })
  afterEach(() => { tools.dispose(); rmSync(root, { recursive: true, force: true }) })

  it('inspection does not execute commands or open an application', async () => {
    const snapshot = await tools.handle(root, { type: 'inspect' })
    expect(snapshot.runs).toEqual([])
    expect(snapshot.applications.length).toBeGreaterThan(0)
    expect(openPath).not.toHaveBeenCalled()
    await expect(tools.handle(root, { type: 'open', applicationId: 'arbitrary-executable' })).rejects.toThrow('未找到')
  })

  it('runs only an explicit command in the chosen workspace and retains output', async () => {
    const snapshot = await tools.handle(root, { type: 'run', name: '验证', command: `"${process.execPath}" -e "console.log(process.cwd());process.exit(3)"` })
    expect(snapshot.runs).toHaveLength(1)
    await vi.waitFor(async () => {
      const current = await tools.handle(root, { type: 'inspect' })
      expect(current.runs[0]?.running).toBe(false)
      expect(statSync(current.runs[0]!.output.trim()).ino).toBe(statSync(root).ino)
      expect(current.runs[0]?.exitCode).toBe(3)
    }, { timeout: 5000 })
  })

  it('stops a long running command and rejects unknown run identities', async () => {
    const snapshot = await tools.handle(root, { type: 'run', name: '等待', command: `"${process.execPath}" -e "setInterval(()=>{},1000)"` })
    await tools.handle(root, { type: 'stop', runId: snapshot.runs[0]!.id })
    await vi.waitFor(async () => {
      expect((await tools.handle(root, { type: 'inspect' })).runs[0]?.running).toBe(false)
    }, { timeout: 5000 })
    await expect(tools.handle(root, { type: 'stop', runId: 'missing' })).rejects.toThrow('未找到')
  })
})
