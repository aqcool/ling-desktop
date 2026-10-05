import { useEffect, useState } from 'react'
import type { LingGitSnapshot, LingServerService } from '../../runtime/contract.js'
import type { GitRequest } from '../GitPanel.js'
import type { LingShellProps } from './types.js'

interface WorkspaceGitOptions {
  readonly taskId?: string
  readonly activeWorkspaceId?: string
  readonly activeServerId?: string
  readonly monitorOpen: boolean
  readonly workspaceGitRequest?: GitRequest
  readonly remoteGitRequest: GitRequest
  readonly remoteGitBranch: string | null
  readonly setRemoteGitBranch: (branch: string | null) => void
  readonly setTaskRemoteCwd: (cwd: string | undefined) => void
  readonly serverManager?: LingServerService
  readonly loadWorkspaceBranch?: LingShellProps['loadWorkspaceBranch']
}

export function useShellGit({
  taskId,
  activeWorkspaceId,
  activeServerId,
  monitorOpen,
  workspaceGitRequest,
  remoteGitRequest,
  remoteGitBranch,
  setRemoteGitBranch,
  setTaskRemoteCwd,
  serverManager,
  loadWorkspaceBranch,
}: WorkspaceGitOptions) {
  const [workspaceGit, setWorkspaceGit] = useState<{ workspaceId: string; branch: string | null }>()
  const [monitorGit, setMonitorGit] = useState<{ id: string; request: GitRequest; lineChanges: LingGitSnapshot['lineChanges'] }>()
  const workspaceBranch = workspaceGit?.workspaceId === activeWorkspaceId ? workspaceGit?.branch : null
  const activeGitId = activeServerId ? taskId : activeWorkspaceId
  const activeGitRequest = activeServerId ? remoteGitRequest : workspaceGitRequest
  const gitBranch = activeServerId ? remoteGitBranch : workspaceBranch
  const gitLineChanges = monitorGit?.id === activeGitId && monitorGit?.request === activeGitRequest ? monitorGit?.lineChanges : undefined
  useEffect(() => {
    if (!monitorOpen || !activeGitId || !activeGitRequest) return
    let active = true, pending = false
    const id = activeGitId, request = activeGitRequest
    const refresh = async () => {
      if (pending || document.visibilityState === 'hidden') return
      pending = true
      try {
        const result = await request(id, { type: 'inspect', lineChanges: true })
        if (active) setMonitorGit({ id, request, lineChanges: result.ok ? result.value.snapshot.lineChanges : undefined })
      } catch { if (active) setMonitorGit({ id, request, lineChanges: undefined }) }
      finally { pending = false }
    }
    const changed = (event: Event) => { if ((event as CustomEvent<string>).detail === id) void refresh() }
    void refresh()
    const timer = window.setInterval(() => { void refresh() }, 5000)
    window.addEventListener('focus', refresh)
    window.addEventListener('ling:git-changed', changed)
    document.addEventListener('visibilitychange', refresh)
    return () => { active = false; window.clearInterval(timer); window.removeEventListener('focus', refresh); window.removeEventListener('ling:git-changed', changed); document.removeEventListener('visibilitychange', refresh) }
  }, [monitorOpen, activeGitId, activeGitRequest])
  const onGitChanged = (branch: string | null) => {
    if (activeServerId) {
      setRemoteGitBranch(branch)
      if (taskId && serverManager) void serverManager.taskBinding(taskId).then(result => {
        if (result.ok) setTaskRemoteCwd(result.value?.cwd)
      })
    } else if (activeWorkspaceId) setWorkspaceGit({ workspaceId: activeWorkspaceId, branch })
  }
  useEffect(() => {
    if (!activeServerId || !taskId || !serverManager) return
    let active = true
    void serverManager.gitRequest(taskId, { type: 'inspect' }).then(result => {
      if (active && result.ok) setRemoteGitBranch(result.value.snapshot.branch)
    })
    return () => { active = false }
  }, [activeServerId, taskId, serverManager])
  useEffect(() => {
    if (!activeWorkspaceId || !loadWorkspaceBranch) return
    let active = true
    let pending = false
    const refresh = async () => {
      if (pending || document.visibilityState === 'hidden') return
      pending = true
      try {
        const branch = await loadWorkspaceBranch!(activeWorkspaceId)
        if (active) setWorkspaceGit({ workspaceId: activeWorkspaceId, branch })
      } catch {
        if (active) setWorkspaceGit({ workspaceId: activeWorkspaceId, branch: null })
      } finally { pending = false }
    }
    void refresh()
    const timer = window.setInterval(() => { void refresh() }, 5000)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      active = false
      window.clearInterval(timer)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [activeWorkspaceId, loadWorkspaceBranch])

  return { workspaceBranch, activeGitId, activeGitRequest, gitBranch, gitLineChanges, onGitChanged }
}
