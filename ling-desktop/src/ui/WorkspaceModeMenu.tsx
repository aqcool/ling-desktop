import { useEffect, useRef, useState } from 'react'
import { Modal } from '@heroui/react/modal'
import type { LingCommandResult, LingGitSnapshot } from '../runtime/contract.js'
import type { LingServer } from '../runtime/servers.js'
import { GitPanel, type GitRequest } from './GitPanel.js'
import { Menu, MenuItem, MenuLabel, MenuSeparator } from './Menu.js'
import { Icon } from './Icon.js'
import { tw } from './tailwind.js'

export function workspaceEnvironment(snapshot: LingGitSnapshot | undefined) {
  const current = snapshot?.worktrees.find(tree => tree.path === snapshot.root)
  return { linked: Boolean(current && !current.main), mainPath: snapshot?.worktrees.find(tree => tree.main && !tree.prunable)?.path }
}

export function WorkspaceModeMenu({ workspaceId, request, interactive, taskSelected, onSelectWorkspace, serverId, servers = [], onSelectServer, onSelectLocal }: {
  workspaceId?: string
  request?: GitRequest
  interactive: boolean
  taskSelected: boolean
  onSelectWorkspace: (path: string) => Promise<LingCommandResult>
  serverId?: string
  servers?: readonly LingServer[]
  onSelectServer?: (serverId: string) => void
  onSelectLocal?: () => void
}) {
  const [snapshot, setSnapshot] = useState<LingGitSnapshot>()
  const [error, setError] = useState('')
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const mounted = useRef(true)
  useEffect(() => {
    if (!workspaceId || !request) return
    let pending = false
    mounted.current = true
    const refresh = async () => {
      if (pending) return
      pending = true
      try {
        const result = await request(workspaceId, { type: 'inspect' })
        if (!mounted.current) return
        if (result.ok) { setSnapshot(result.value.snapshot); setError('') }
        else { setSnapshot(undefined); setError(result.message) }
      } catch { if (mounted.current) { setSnapshot(undefined); setError('无法读取运行目录。') } }
      finally { pending = false }
    }
    void refresh()
    window.addEventListener('focus', refresh)
    window.addEventListener('ling:git-changed', refresh)
    return () => { mounted.current = false; window.removeEventListener('focus', refresh); window.removeEventListener('ling:git-changed', refresh) }
  }, [workspaceId, request])
  const { linked, mainPath } = workspaceEnvironment(snapshot)
  const select = async (path: string) => {
    setBusy(true)
    try {
      const result = await onSelectWorkspace(path)
      if (mounted.current) {
        if (result.accepted) setOpen(false)
        else setError(result.message)
      }
      return result
    } finally { if (mounted.current) setBusy(false) }
  }
  const label = <><Icon name={serverId ? 'globe' : linked ? 'branch' : 'desktop'} size={14} /><span>{serverId ? '服务器' : snapshot ? linked ? 'Worktree' : '本地' : '运行位置'}</span></>
  return <>
    {interactive ? <Menu align="start" triggerAriaLabel="切换运行位置" triggerClassName="h-6 min-h-0 gap-1.5 rounded-md px-0.5 text-xs" listClassName="w-44 min-w-44" triggerLabel={label}>
      <MenuItem icon="desktop" checked={!serverId && !linked} disabled={busy || (!serverId && linked && !mainPath)} onPress={() => {
        if (serverId) onSelectLocal?.()
        else if (linked && mainPath) setOpen(true)
      }}>本地模式</MenuItem>
      <MenuItem icon="branch" checked={!serverId && linked} disabled={busy || !workspaceId || !request} onPress={() => setOpen(true)}>Worktree 模式</MenuItem>
      {servers.length ? <><MenuSeparator /><MenuLabel>服务器</MenuLabel>{servers.map(server => (
        <MenuItem key={server.id} icon="globe" checked={serverId === server.id} disabled={busy} onPress={() => onSelectServer?.(server.id)}>{server.name}</MenuItem>
      ))}</> : null}
    </Menu> : <span className={tw('inline-flex h-6 items-center gap-1.5')}>{label}</span>}
    {workspaceId && request ? <Modal.Backdrop isOpen={open} onOpenChange={(value: boolean) => { if (!busy) setOpen(value) }}><Modal.Container size="lg"><Modal.Dialog>
      {!busy ? <Modal.CloseTrigger /> : null}
      <Modal.Header><Modal.Heading>选择运行目录</Modal.Heading>{taskSelected ? <p className={tw('mb-0 mt-1 text-xs text-[var(--text-secondary)]')}>将在所选目录中新建任务，当前会话保留。</p> : null}</Modal.Header>
      <Modal.Body className={tw('gap-3')}>
        {error ? <p role="alert" className={tw('m-0 text-xs text-[var(--danger)]')}>{error}</p> : null}
        <GitPanel workspaceId={workspaceId} request={request} view="worktrees" onSelectWorkspace={select} onBusyChange={setBusy} />
      </Modal.Body>
    </Modal.Dialog></Modal.Container></Modal.Backdrop> : null}
  </>
}
