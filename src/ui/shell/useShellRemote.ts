import { useCallback, useEffect, useState } from 'react'
import type { LingServer } from '../../runtime/servers.js'
import type { GitRequest } from '../GitPanel.js'
import type { LingShellProps } from './types.js'

interface RemoteFingerprint { readonly algorithm: string; readonly sha256: string }
interface NativeRemoteBroker {
  status(id: string): Promise<{ trusted: boolean; fingerprint?: RemoteFingerprint; credential: 'none' | 'password' | 'key' }>
  inspect(id: string): Promise<RemoteFingerprint>
  probe(id: string): Promise<{ home: string }>
  credentials(id: string): Promise<void>
}
interface RemoteIssue { readonly title: string; readonly previous?: RemoteFingerprint; readonly observed?: RemoteFingerprint }
export function nativeRemoteBroker(): NativeRemoteBroker | undefined {
  return (globalThis as { __LING_SERVER_BROKER__?: NativeRemoteBroker }).__LING_SERVER_BROKER__
}
export async function remoteIssue(serverId: string): Promise<RemoteIssue | undefined> {
  const broker = nativeRemoteBroker()
  if (!broker) return { title: '远端任务需要桌面应用' }
  const status = await broker.status(serverId)
  if (status.trusted && status.credential !== 'none') {
    try { await broker.probe(serverId); return undefined } catch { /* inspect below */ }
  }
  let observed: RemoteFingerprint | undefined
  try { observed = await broker.inspect(serverId) } catch { /* connection error */ }
  const changed = status.fingerprint && observed && (status.fingerprint.algorithm !== observed.algorithm || status.fingerprint.sha256 !== observed.sha256)
  return {
    title: changed ? '服务器指纹已变更' : !status.trusted ? '需要确认服务器指纹' : status.credential === 'none' ? '需要服务器登录凭证' : '服务器连接已中断',
    previous: changed ? status.fingerprint : undefined, observed
  }
}

export function useShellRemote(props: Pick<LingShellProps, 'newTaskOperationsServerId' | 'newTaskServerId' | 'screen' | 'selectedTask' | 'serverManager' | 'timeline'>) {
  const { selectedTask, timeline } = props
  const [servers, setServers] = useState<readonly LingServer[]>([])
  const [taskServerId, setTaskServerId] = useState<string>()
  const [taskRemoteCwd, setTaskRemoteCwd] = useState<string>()
  const [taskFileBindingReady, setTaskFileBindingReady] = useState<string>()
  const [remoteGitBranch, setRemoteGitBranch] = useState<string | null>(null)
  const remoteGitRequest = useCallback<GitRequest>((taskId, request) => props.serverManager
    ? props.serverManager.gitRequest(taskId, request)
    : Promise.resolve({ ok: false, reason: 'runtime-unavailable', message: '远端 Git 服务不可用。', retryable: true }), [props.serverManager])
  const [taskOperationsBinding, setTaskOperationsBinding] = useState<{ taskId: string; serverId: string }>()
  const activeServerId = selectedTask ? taskServerId : props.newTaskServerId
  const activeOperationsServerId = activeServerId ? undefined : selectedTask
    ? taskOperationsBinding?.taskId === selectedTask.taskId ? taskOperationsBinding.serverId : undefined
    : props.newTaskOperationsServerId
  const issueServerId = selectedTask ? taskServerId ?? activeOperationsServerId : undefined
  const [serverIssue, setServerIssue] = useState<RemoteIssue>()
  const [serverIssuePending, setServerIssuePending] = useState(false)
  useEffect(() => {
    if (!props.serverManager) return
    let active = true
    void props.serverManager.list().then(result => { if (active && result.ok) setServers(result.value) })
    return () => { active = false }
  }, [props.serverManager, props.screen])
  useEffect(() => {
    setTaskServerId(undefined)
    setTaskRemoteCwd(undefined)
    setTaskFileBindingReady(undefined)
    setRemoteGitBranch(null)
    setServerIssue(undefined)
    if (!selectedTask || !props.serverManager) return
    let active = true
    void props.serverManager.taskBinding(selectedTask.taskId).then(result => {
      if (active && result.ok) { setTaskServerId(result.value?.serverId); setTaskRemoteCwd(result.value?.cwd); setTaskFileBindingReady(selectedTask.taskId) }
    })
    return () => { active = false }
  }, [selectedTask?.taskId, props.serverManager])
  useEffect(() => {
    if (!selectedTask || !props.serverManager || !taskServerId) return
    let active = true
    void props.serverManager.taskBinding(selectedTask.taskId).then(result => {
      if (active && result.ok) setTaskRemoteCwd(result.value?.cwd)
    })
    return () => { active = false }
  }, [selectedTask?.taskId, props.serverManager, taskServerId, timeline.length])
  useEffect(() => {
    setTaskOperationsBinding(undefined)
    if (!selectedTask || !props.serverManager) return
    let active = true
    void props.serverManager.operationsBinding(selectedTask.taskId).then(result => {
      if (active && result.ok && result.value) setTaskOperationsBinding({ taskId: selectedTask.taskId, serverId: result.value.serverId })
    })
    return () => { active = false }
  }, [selectedTask?.taskId, props.serverManager])
  useEffect(() => {
    setServerIssue(undefined)
    if (!issueServerId || props.screen !== 'workspace') return
    let active = true
    let pending = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const check = async () => {
      if (!active || pending) return
      pending = true
      if (timer) clearTimeout(timer)
      try {
        const issue = await remoteIssue(issueServerId)
        if (active) setServerIssue(issue)
      } catch {
        if (active) setServerIssue({ title: '服务器连接已中断' })
      } finally {
        pending = false
        if (active) timer = setTimeout(() => { void check() }, 15000)
      }
    }
    void check()
    window.addEventListener('focus', check)
    return () => { active = false; if (timer) clearTimeout(timer); window.removeEventListener('focus', check) }
  }, [issueServerId, props.screen])
  return {
    setTaskOperationsBinding,
    servers,
    taskServerId,
    taskRemoteCwd,
    setTaskRemoteCwd,
    taskFileBindingReady,
    remoteGitBranch,
    setRemoteGitBranch,
    remoteGitRequest,
    activeServerId,
    activeOperationsServerId,
    issueServerId,
    serverIssue,
    setServerIssue,
    serverIssuePending,
    setServerIssuePending,
  }
}
