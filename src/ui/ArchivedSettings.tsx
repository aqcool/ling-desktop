import { CompactButton as Button } from './SettingsControls.js'
import { Modal } from '@heroui/react/modal'
import { useRef, useState } from 'react'
import type { LingCommandResult, LingTaskSummary, LingWorkspaceSummary } from '../runtime/contract.js'
import { Icon } from './Icon.js'
import { tw } from './tailwind.js'

interface ArchivedSettingsProps {
  readonly tasks: readonly LingTaskSummary[]
  readonly workspaces: readonly LingWorkspaceSummary[]
  readonly archivedWorkspaceIds: readonly string[]
  readonly onOpenTask: (taskId: string) => void
  readonly onRestoreTask: (taskId: string) => void
  readonly onRestoreWorkspace: (workspaceId: string) => void
  readonly onRemoveWorkspace: (workspace: LingWorkspaceSummary) => void
  readonly onDeleteTask?: (taskId: string) => Promise<LingCommandResult>
}

export function ArchivedSettings({ tasks, workspaces, archivedWorkspaceIds, onOpenTask, onRestoreTask, onRestoreWorkspace, onRemoveWorkspace, onDeleteTask }: ArchivedSettingsProps) {
  const [deleteTaskId, setDeleteTaskId] = useState<string>()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()
  const deleting = useRef(false)
  const deleteTarget = tasks.find(task => task.taskId === deleteTaskId && task.archived)
  const dismissDelete = () => {
    if (deleting.current) return
    setDeleteTaskId(undefined)
    setError(undefined)
  }
  const confirmDelete = async () => {
    if (!deleteTarget || !onDeleteTask || deleting.current) return
    deleting.current = true
    setPending(true)
    setError(undefined)
    try {
      const result = await onDeleteTask(deleteTarget.taskId)
      if (result.accepted) setDeleteTaskId(undefined)
      else setError(result.message ?? '删除失败，请重试。')
    } catch {
      setError('删除失败，请重试。')
    } finally {
      deleting.current = false
      setPending(false)
    }
  }
  const sortedTasks = tasks.filter(task => task.archived).sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
  const workspaceNames = new Map(workspaces.map(workspace => [workspace.workspaceId, workspace.label]))
  const archivedWorkspaces = workspaces.filter(workspace => archivedWorkspaceIds.includes(workspace.workspaceId))

  return (
    <section aria-label="已归档" className={tw("archived-settings w-full min-w-0 max-w-3xl")}>
      <h1 className={tw("mt-0 mb-6 text-xl font-semibold")}>已归档</h1>
      {sortedTasks.length === 0 && archivedWorkspaces.length === 0 ? <p className={tw("archived-settings__empty m-0 [color:var(--text-secondary)] text-compact")}>暂无已归档内容。</p> : null}
      {archivedWorkspaces.length > 0 ? (
        <div className={tw("mb-7")}>
          <h2 className={tw("mb-2 text-xs font-medium text-[var(--text-secondary)]")}>工作区</h2>
          <div className={tw("overflow-hidden rounded-xl border border-[var(--panel-border)] bg-[var(--surface)]")}>
            {archivedWorkspaces.map((workspace, index) => (
              <div className={tw("flex min-h-14 items-center gap-3 px-4 py-2", index > 0 && "border-t border-[var(--separator)]")} key={workspace.workspaceId}>
                <Icon className={tw("shrink-0 text-[var(--text-secondary)]")} name="folder" size={16} />
                <span className={tw("min-w-0 flex-1 truncate text-compact")} title={workspace.label}>{workspace.label}</span>
                <Button aria-label={`恢复${workspace.label}`} onPress={() => { onRestoreWorkspace(workspace.workspaceId) }} variant="outline">恢复</Button>
                <Button aria-label={`移除${workspace.label}`} className={tw("size-control-sm min-w-0 shrink-0 rounded-md p-0 text-[var(--text-secondary)] hover:bg-[color-mix(in_oklab,var(--danger)_8%,transparent)] hover:text-[var(--danger)]")} isIconOnly onPress={() => { onRemoveWorkspace(workspace) }} title="移除工作区" variant="ghost"><Icon name="trash" size={16} /></Button>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {sortedTasks.length > 0 ? (
        <div>
          <h2 className={tw("mb-2 text-xs font-medium text-[var(--text-secondary)]")}>任务</h2>
          <div className={tw("archived-settings__list overflow-hidden [border:1px_solid_var(--panel-border)] rounded-xl [background:var(--surface)]")}>
            {sortedTasks.map((task, index) => (
              <div className={tw("archived-settings__row flex min-h-17 items-center gap-3 px-4 py-2", index > 0 && "border-t border-[var(--separator)]")} key={task.taskId}>
                <button className={tw("archived-settings__task group grid min-w-0 flex-1 gap-1 border-0 bg-transparent p-0 text-left text-[var(--foreground)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus)]")} onClick={() => { onOpenTask(task.taskId) }} type="button">
                  <strong className={tw("overflow-hidden text-ellipsis whitespace-nowrap text-compact font-medium group-hover:underline")}>{task.title}</strong>
                  {task.workspaceId && workspaceNames.has(task.workspaceId) ? <span className={tw("flex items-center gap-1.5 text-xs text-[var(--text-secondary)]")}><Icon name="folder" size={14} />{workspaceNames.get(task.workspaceId)}</span> : null}
                </button>
                <Button aria-label={`恢复${task.title}`} variant="outline" onPress={() => { onRestoreTask(task.taskId) }}>恢复</Button>
                <Button aria-label={`彻底删除${task.title}`} className={tw("size-control-sm min-w-0 shrink-0 rounded-md p-0 text-[var(--text-secondary)] hover:bg-[color-mix(in_oklab,var(--danger)_8%,transparent)] hover:text-[var(--danger)]")} isIconOnly onPress={() => { setError(undefined); setDeleteTaskId(task.taskId) }} title="彻底删除" variant="ghost"><Icon name="trash" size={16} /></Button>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      <Modal.Backdrop isDismissable={!pending} isKeyboardDismissDisabled={pending} isOpen={deleteTarget !== undefined} onOpenChange={(open: boolean) => { if (!open) dismissDelete() }}>
        <Modal.Container size="sm">
          <Modal.Dialog className={tw("gap-4 rounded-2xl p-5")}>
            <Modal.Header><Modal.Heading className={tw("text-base font-semibold")}>彻底删除会话？</Modal.Heading></Modal.Header>
            <Modal.Body className={tw("gap-2")}>
              <p className={tw("m-0 break-words text-sm text-[var(--foreground)]")}>{deleteTarget?.title}</p>
              <p className={tw("m-0 text-xs text-[var(--text-secondary)]")}>删除后无法恢复。项目文件、速记和 Wiki 会保留。</p>
              {!onDeleteTask ? <p className={tw("m-0 text-xs text-[var(--text-tertiary)]")}>当前运行时暂不支持彻底删除。</p> : null}
              {error ? <p className={tw("m-0 text-xs text-[var(--danger)]")} role="alert">{error}</p> : null}
            </Modal.Body>
            <Modal.Footer className={tw("gap-2")}>
              <Button autoFocus isDisabled={pending} onPress={dismissDelete} variant="ghost">取消</Button>
              <Button isDisabled={!onDeleteTask} isPending={pending} onPress={() => { void confirmDelete() }} variant="danger">彻底删除</Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </section>
  )
}
