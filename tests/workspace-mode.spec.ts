import { describe, expect, it } from 'vitest'
import type { LingGitSnapshot } from '../src/runtime/contract.js'
import { workspaceEnvironment } from '../src/ui/WorkspaceModeMenu.js'

const snapshot: LingGitSnapshot = {
  repository: true, root: '/repo', branch: 'main', detached: false, unborn: false,
  upstream: null, ahead: 0, behind: 0, files: [], branches: ['main'], remotes: [],
  worktrees: [
    { path: '/repo', branch: 'main', head: 'abc', main: true, locked: false, prunable: false },
    { path: '/tree', branch: null, head: 'def', main: false, locked: false, prunable: false },
  ],
}
describe('workspace execution location', () => {
  it('distinguishes the main checkout from linked worktrees, including detached HEAD', () => {
    expect(workspaceEnvironment(snapshot)).toEqual({ linked: false, mainPath: '/repo' })
    expect(workspaceEnvironment({ ...snapshot, root: '/tree', detached: true })).toEqual({ linked: true, mainPath: '/repo' })
  })
  it('does not invent a main checkout when loading or when its path is unavailable', () => {
    expect(workspaceEnvironment(undefined)).toEqual({ linked: false, mainPath: undefined })
    expect(workspaceEnvironment({ ...snapshot, root: '/tree', worktrees: snapshot.worktrees.map(tree => ({ ...tree, prunable: tree.main })) })).toEqual({ linked: true, mainPath: undefined })
  })
})
