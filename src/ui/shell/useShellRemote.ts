import { useCallback, useEffect, useRef, useState } from 'react'
import type { LingServer, LingTaskServers } from '../../runtime/servers.js'
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

export function useShellRemote(props: Pick<LingShellProps, 'newTaskServerIds' | 'newTaskDevelopmentServerId' | 'screen' | 'selectedTask' | 'serverManager' | 'timeline'>) {
  const { selectedTask, timeline } = props
  const [servers, setServers] = useState<readonly LingServer[]>([])
  const [binding, setBinding] = useState<{ taskId: string; value: LingTaskServers }>()
  const [taskServersError, setTaskServersError] = useState<string>()
  const scope = useRef({ taskId: selectedTask?.taskId, service: props.serverManager, revision: 0 })
  if (scope.current.taskId !== selectedTask?.taskId || scope.current.service !== props.serverManager) {
    scope.current = { taskId: selectedTask?.taskId, service: props.serverManager, revision: 0 }
  }
  const taskServers = binding?.taskId === selectedTask?.taskId ? binding?.value : undefined
  const serverIds = selectedTask ? taskServers?.servers.map(server => server.serverId) ?? [] : props.newTaskServerIds
  const activeServerId = selectedTask ? taskServers?.developmentServerId : props.newTaskDevelopmentServerId
  const taskRemoteCwd = taskServers?.servers.find(server => server.serverId === activeServerId)?.cwd
  const taskFileBindingReady = taskServers ? selectedTask?.taskId : undefined
  const refreshTaskServers = useCallback(async () => {
    const current = scope.current
    if (!current.taskId || !current.service) return
    const revision = ++current.revision
    try {
      const result = await current.service.taskServers(current.taskId)
      if (scope.current !== current || current.revision !== revision) return
      if (result.ok) { setBinding({ taskId: current.taskId, value: result.value }); setTaskServersError(undefined) }
      else setTaskServersError(result.message)
    } catch {
      if (scope.current === current && current.revision === revision) setTaskServersError('无法读取关联服务器。')
    }
  }, [selectedTask?.taskId, props.serverManager])
  const [remoteGitBranch, setRemoteGitBranch] = useState<string | null>(null)
  const remoteGitRequest = useCallback<GitRequest>((taskId, request) => props.serverManager && activeServerId
    ? props.serverManager.gitRequest(taskId, activeServerId, request)
    : Promise.resolve({ ok: false, reason: 'runtime-unavailable', message: '远端 Git 服务不可用。', retryable: true }), [props.serverManager, activeServerId])
  const issueServerId = selectedTask ? activeServerId : undefined
  const [serverIssue, setServerIssue] = useState<RemoteIssue>()
  const [serverIssuePending, setServerIssuePending] = useState(false)
  useEffect(() => {
    if (!props.serverManager) return
    let active = true
    const refresh = () => { void props.serverManager!.list().then(result => { if (active && result.ok) setServers(result.value) }).catch(() => {}) }
    refresh()
    window.addEventListener('ling:servers-changed', refresh)
    return () => { active = false; window.removeEventListener('ling:servers-changed', refresh) }
  }, [props.serverManager, props.screen])
  useEffect(() => {
    const current = scope.current
    setBinding(undefined)
    setTaskServersError(undefined)
    setRemoteGitBranch(null)
    setServerIssue(undefined)
    void refreshTaskServers()
    const changed = (event: Event) => {
      if ((event as CustomEvent<string>).detail === selectedTask?.taskId) void refreshTaskServers()
    }
    window.addEventListener('ling:task-servers-changed', changed)
    return () => { current.revision++; window.removeEventListener('ling:task-servers-changed', changed) }
  }, [refreshTaskServers, selectedTask?.taskId])
  useEffect(() => { if (activeServerId) void refreshTaskServers() }, [activeServerId, timeline.length, refreshTaskServers])
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
    servers,
    serverIds,
    taskServers,
    taskServersError,
    refreshTaskServers,
    taskRemoteCwd,
    taskFileBindingReady,
    remoteGitBranch,
    setRemoteGitBranch,
    remoteGitRequest,
    activeServerId,
    issueServerId,
    serverIssue,
    setServerIssue,
    serverIssuePending,
    setServerIssuePending,
  }
}
