import { Button } from '@heroui/react/button'
import { Card } from '@heroui/react/card'
import { TextArea } from '@heroui/react/textarea'
import { Fragment, useEffect, type ChangeEvent, type KeyboardEvent, type ReactNode } from 'react'
import type {
  LingFileDiff,
  LingRuntimeConnection,
  LingTaskChanges,
  LingTaskSearchMatch,
  LingTaskStatus,
  LingTaskSummary,
  LingTimelineItem,
  LingWorkspaceSummary,
} from '../runtime/contract.js'
import { ChangeReview, type ChangeSelection } from './ChangeReview.js'
import { Icon } from './Icon.js'
import type { LingUiSlots } from './slots.js'
import { TaskSearch } from './TaskSearch.js'

const connectionLabels: Record<LingRuntimeConnection['phase'], string> = {
  offline: '未连接',
  connecting: '正在连接',
  ready: '已连接',
  failed: '连接失败',
}

const statusLabels: Record<LingTaskStatus, string> = {
  queued: '排队中',
  running: '进行中',
  'waiting-for-input': '等待输入',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
}

const timelineStatusLabels = {
  running: '进行中',
  completed: '已完成',
  failed: '失败',
  interrupted: '已停止',
} as const

interface LingShellProps {
  readonly changeDiff?: LingFileDiff
  readonly changeDiffLoading: boolean
  readonly changeDiffMessage?: string
  readonly changes: readonly LingTaskChanges[]
  readonly changesLoading: boolean
  readonly changesMessage?: string
  readonly connection: LingRuntimeConnection
  readonly environmentOpen: boolean
  readonly forkPending: boolean
  readonly notice: string
  readonly onChangeDiffClose: () => void
  readonly onChangeSelect: (selection: ChangeSelection) => void
  readonly onEnvironmentToggle: () => void
  readonly onFork: () => void
  readonly onNewTask: () => void
  readonly onPromptChange: (value: string) => void
  readonly onReconnect: () => void
  readonly onSearchClose: () => void
  readonly onSearchOpen: () => void
  readonly onSearchQueryChange: (value: string) => void
  readonly onSearchSelect: (taskId: string) => void
  readonly onSelectTask: (taskId: string) => void
  readonly onSubmit: () => void
  readonly prompt: string
  readonly searchHasMore: boolean
  readonly searchLoading: boolean
  readonly searchMessage?: string
  readonly searchOpen: boolean
  readonly searchQuery: string
  readonly searchResults: readonly LingTaskSearchMatch[]
  readonly selectedChange?: ChangeSelection
  readonly selectedTask?: LingTaskSummary
  readonly slots?: LingUiSlots
  readonly tasks: readonly LingTaskSummary[]
  readonly timeline: readonly LingTimelineItem[]
  readonly workspaces: readonly LingWorkspaceSummary[]
}

function SlotItems({ items, prefix }: { readonly items?: readonly ReactNode[]; readonly prefix: string }) {
  return items?.map((item, index) => (
    <Fragment key={`${prefix}-${String(index)}`}>{item}</Fragment>
  ))
}

function Tasks({
  onSelectTask,
  selectedTask,
  tasks,
}: {
  readonly onSelectTask: (taskId: string) => void
  readonly selectedTask?: LingTaskSummary
  readonly tasks: readonly LingTaskSummary[]
}) {
  if (tasks.length === 0) return null

  return (
    <div className="sidebar-tasks">
      {tasks.map(task => (
        <button
          className={`sidebar-task${selectedTask?.taskId === task.taskId ? ' sidebar-task--active' : ''}`}
          key={task.taskId}
          onClick={() => { onSelectTask(task.taskId) }}
          type="button"
        >
          <span>{task.title}</span>
          <small>{task.preview ?? statusLabels[task.status]}</small>
        </button>
      ))}
    </div>
  )
}

function WorkspaceList({
  onSelectTask,
  selectedTask,
  tasks,
  workspaces,
}: Pick<LingShellProps, 'onSelectTask' | 'selectedTask' | 'tasks' | 'workspaces'>) {
  if (workspaces.length === 0) {
    return (
      <section className="sidebar-project">
        <div className="sidebar-project__heading">
          <Icon name="folder" size={17} />
          <span>ling-desktop</span>
        </div>
        <Tasks onSelectTask={onSelectTask} selectedTask={selectedTask} tasks={tasks} />
      </section>
    )
  }

  const unassignedTasks = tasks.filter(task => !task.workspaceId)

  return (
    <>
      {workspaces.map(workspace => (
        <section className="sidebar-project" key={workspace.workspaceId}>
          <div className="sidebar-project__heading">
            <Icon name="folder" size={17} />
            <span>{workspace.label}</span>
          </div>
          <Tasks
            onSelectTask={onSelectTask}
            selectedTask={selectedTask}
            tasks={tasks.filter(task => task.workspaceId === workspace.workspaceId)}
          />
        </section>
      ))}
      {unassignedTasks.length > 0 ? (
        <section className="sidebar-project">
          <div className="sidebar-project__heading">
            <Icon name="folder" size={17} />
            <span>其他任务</span>
          </div>
          <Tasks onSelectTask={onSelectTask} selectedTask={selectedTask} tasks={unassignedTasks} />
        </section>
      ) : null}
    </>
  )
}

function Conversation({ slots, timeline }: { readonly slots: LingUiSlots; readonly timeline: readonly LingTimelineItem[] }) {
  if (timeline.length === 0) {
    return (
      <div className="conversation-empty">
        {slots['conversation.hero.brand.mark'] ?? <div className="conversation-empty__mark">L</div>}
        <h1>新对话</h1>
        <p>描述你想完成的工作。</p>
        {slots['conversation.hero.workspace']}
        {slots['conversation.hero.agentPreset']}
      </div>
    )
  }

  return (
    <div className="conversation-stream">
      {timeline.map(item => (
        <article
          className={`timeline-item timeline-item--${item.kind}`}
          data-status={item.status}
          key={item.itemId}
        >
          {item.kind === 'tool-activity' ? <Icon name="terminal" size={16} /> : null}
          <div className="timeline-item__body">
            {item.title || item.status ? (
              <div className="timeline-item__heading">
                {item.title ? <strong>{item.title}</strong> : null}
                {item.status ? <span>{timelineStatusLabels[item.status]}</span> : null}
              </div>
            ) : null}
            {item.text ? <p>{item.text}</p> : null}
            {item.detail ? (
              <details className="timeline-item__detail">
                <summary>思考过程</summary>
                <p>{item.detail}</p>
              </details>
            ) : null}
          </div>
          {item.streaming ? <span className="streaming-caret" aria-hidden="true" /> : null}
        </article>
      ))}
    </div>
  )
}

function EnvironmentPanel({
  changeDiff,
  changeDiffLoading,
  changeDiffMessage,
  changes,
  changesLoading,
  changesMessage,
  connection,
  onChangeDiffClose,
  onChangeSelect,
  onReconnect,
  selectedChange,
  selectedTask,
  workspaces,
}: {
  readonly changeDiff?: LingFileDiff
  readonly changeDiffLoading: boolean
  readonly changeDiffMessage?: string
  readonly changes: readonly LingTaskChanges[]
  readonly changesLoading: boolean
  readonly changesMessage?: string
  readonly connection: LingRuntimeConnection
  readonly onChangeDiffClose: () => void
  readonly onChangeSelect: (selection: ChangeSelection) => void
  readonly onReconnect: () => void
  readonly selectedChange?: ChangeSelection
  readonly selectedTask?: LingTaskSummary
  readonly workspaces: readonly LingWorkspaceSummary[]
}) {
  const activeWorkspace = workspaces.find(workspace => workspace.workspaceId === selectedTask?.workspaceId)
  const changedFiles = changes.reduce((total, change) => total + change.total, 0)

  return (
    <Card className="environment-panel" variant="secondary">
      <Card.Header className="environment-panel__header">
        <Card.Title>环境信息</Card.Title>
        <Button aria-label="添加环境" isIconOnly size="sm" variant="ghost">
          <Icon name="plus" size={19} />
        </Button>
      </Card.Header>
      <Card.Content className="environment-panel__content">
        <div className="environment-row">
          <Icon name="change" size={18} />
          <strong>变更</strong>
          <span>{String(changedFiles)}</span>
        </div>
        <div className="environment-row">
          <Icon name="panel" size={18} />
          <strong>本地</strong>
          <button className="environment-row__action" onClick={onReconnect} type="button">
            {connectionLabels[connection.phase]}
            <Icon name="chevronDown" size={15} />
          </button>
        </div>
        <div className="environment-row">
          <Icon name="branch" size={18} />
          <strong>{activeWorkspace?.label ?? workspaces[0]?.label ?? 'ling-desktop'}</strong>
          <Icon name="chevronDown" size={15} />
        </div>
        {selectedTask ? (
          <div className="environment-row">
            <Icon name="terminal" size={18} />
            <strong>{statusLabels[selectedTask.status]}</strong>
            <span />
          </div>
        ) : null}
        <div className="environment-panel__changes">
          <div className="environment-panel__changes-heading">
            <span>文件变更</span>
            {selectedTask ? <small>{selectedTask.title}</small> : null}
          </div>
          <ChangeReview
            changes={changes}
            diff={changeDiff}
            diffLoading={changeDiffLoading}
            diffMessage={changeDiffMessage}
            loading={changesLoading}
            message={changesMessage}
            onCloseDiff={onChangeDiffClose}
            onSelect={onChangeSelect}
            selection={selectedChange}
          />
        </div>
      </Card.Content>
    </Card>
  )
}

export function LingShell(props: LingShellProps) {
  const {
    changeDiff,
    changeDiffLoading,
    changeDiffMessage,
    changes,
    changesLoading,
    changesMessage,
    connection,
    environmentOpen,
    forkPending,
    notice,
    onChangeDiffClose,
    onChangeSelect,
    onEnvironmentToggle,
    onFork,
    onNewTask,
    onPromptChange,
    onReconnect,
    onSearchClose,
    onSearchOpen,
    onSearchQueryChange,
    onSearchSelect,
    onSelectTask,
    onSubmit,
    prompt,
    searchHasMore,
    searchLoading,
    searchMessage,
    searchOpen,
    searchQuery,
    searchResults,
    selectedChange,
    selectedTask,
    slots = {},
    tasks,
    timeline,
    workspaces,
  } = props

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      onSubmit()
    }
  }

  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        onSearchOpen()
      }
      if (event.key === 'Escape' && searchOpen) onSearchClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => { window.removeEventListener('keydown', handleKeyDown) }
  }, [onSearchClose, onSearchOpen, searchOpen])

  return (
    <div className="desktop-shell">
      <aside className="sidebar">
        <div className="window-controls">
          <span className="window-control window-control--close" />
          <span className="window-control window-control--minimize" />
          <span className="window-control window-control--expand" />
          <button aria-label="切换侧边栏" className="window-button" type="button"><Icon name="panel" size={16} /></button>
          <button aria-label="返回" className="window-button" type="button"><Icon name="back" size={17} /></button>
          <button aria-label="前进" className="window-button" type="button"><Icon name="forward" size={17} /></button>
        </div>

        <div className="sidebar-brand">
          <button className="sidebar-brand__identity" type="button">
            <span className="sidebar-brand__mark-wrap">
              {slots['sidebar.brand.mark'] ?? <span className="sidebar-brand__mark">L</span>}
              {slots['sidebar.toggle.badge']}
            </span>
            {slots['sidebar.brand.name'] ?? <strong>LING</strong>}
            <Icon name="chevronDown" size={14} />
          </button>
          <div className="sidebar-brand__actions">
            <button aria-label="搜索" className="icon-button" onClick={onSearchOpen} type="button"><Icon name="search" size={18} /></button>
            <button aria-label="通知" className="icon-button" type="button"><Icon name="bell" size={18} /></button>
          </div>
        </div>

        <nav className="sidebar-nav" aria-label="导航">
          <button className="sidebar-nav__item sidebar-nav__item--primary" onClick={onNewTask} type="button">
            <Icon name="compose" size={18} />
            <span>新对话</span>
            <kbd>⌘ N</kbd>
          </button>
          <SlotItems items={slots['sidebar.panellist']} prefix="sidebar-panel" />
        </nav>

        <div className="sidebar-projects">
          <p className="sidebar-section-label">项目</p>
          {slots['sidebar.workspaces'] ?? (
            <WorkspaceList
              onSelectTask={onSelectTask}
              selectedTask={selectedTask}
              tasks={tasks}
              workspaces={workspaces}
            />
          )}
        </div>

        <div className="sidebar-footer">
          {slots['sidebar.settings'] ?? (
            <button className="sidebar-footer__account" type="button">
              <span className="sidebar-footer__avatar">L</span>
              <span>LING</span>
            </button>
          )}
          <SlotItems items={slots['sidebar.footer.action']} prefix="sidebar-footer" />
          <button aria-label="帮助" className="icon-button" type="button"><Icon name="help" size={18} /></button>
        </div>
      </aside>

      <main className="workspace">
        <header className="workspace-header">
          <div className="workspace-header__title">
            {slots['conversation.session.header.leading']}
            <Icon name="folder" size={18} />
            {slots['conversation.session.header.lineage'] ?? <strong>{selectedTask?.title ?? '新对话'}</strong>}
          </div>
          <div className="workspace-header__actions">
            <SlotItems items={slots['conversation.session.header.actions']} prefix="header-action" />
            <SlotItems items={slots['conversation.session.header.utilities']} prefix="header-utility" />
            {slots['conversation.session.header.corner']}
            {selectedTask ? (
              <Button className="workspace-header__fork" isPending={forkPending} onPress={onFork} size="sm" variant="ghost">
                {forkPending ? '正在分叉' : <><Icon name="fork" size={16} /> 分叉</>}
              </Button>
            ) : null}
            <button aria-label="更多" className="icon-button workspace-header__more" type="button">···</button>
            <button className="workspace-header__share" type="button"><Icon name="external" size={16} />分享</button>
            <button
              aria-label="环境信息"
              className={`icon-button${environmentOpen ? ' icon-button--active' : ''}`}
              onClick={onEnvironmentToggle}
              type="button"
            >
              <Icon name="change" size={18} />
            </button>
          </div>
        </header>

        <section className="conversation-canvas">
          <Conversation slots={slots} timeline={timeline} />
          <SlotItems items={slots['conversation.view']} prefix="conversation-view" />
        </section>

        <div className="composer-wrap">
          {notice ? <p className="composer-notice" role="status">{notice}</p> : null}
          <SlotItems items={slots['conversation.input.dock']} prefix="input-dock" />
          {slots['conversation.composer.bar'] ?? (
            <Card className="composer" variant="secondary">
              <Card.Content className="composer__content">
                {slots['conversation.input.attachments']}
                <TextArea
                  aria-label="消息"
                  className="composer__textarea"
                  maxLength={4000}
                  onChange={(event: ChangeEvent<HTMLTextAreaElement>) => { onPromptChange(event.target.value) }}
                  onKeyDown={handleComposerKeyDown}
                  placeholder="随心输入"
                  rows={2}
                  value={prompt}
                  variant="secondary"
                />
                <SlotItems items={slots['conversation.input.overlay']} prefix="input-overlay" />
              </Card.Content>
              <Card.Footer className="composer__footer">
                <div className="composer__tools">
                  <Button aria-label="添加" isIconOnly size="sm" variant="ghost"><Icon name="plus" size={19} /></Button>
                  <SlotItems items={slots['conversation.input.left']} prefix="input-left" />
                  {slots['conversation.input.plan']}
                  {slots['conversation.input.permission'] ?? (
                    <button className="composer__mode" type="button">本地 <Icon name="chevronDown" size={14} /></button>
                  )}
                </div>
                <div className="composer__submit">
                  {slots['conversation.input.model'] ?? (
                    <button className="composer__model" type="button">DeepSeek <Icon name="chevronDown" size={14} /></button>
                  )}
                  <SlotItems items={slots['conversation.input.right']} prefix="input-right" />
                  <button aria-label="语音输入" className="icon-button" type="button"><Icon name="mic" size={18} /></button>
                  <Button aria-label="发送" className="composer__send" isIconOnly onPress={onSubmit} size="sm">
                    <Icon name="send" size={17} />
                  </Button>
                </div>
              </Card.Footer>
            </Card>
          )}
          <SlotItems items={slots['conversation.composer.dock']} prefix="composer-dock" />
        </div>

        {environmentOpen ? (
          slots['rightbar.session'] ?? (
            <EnvironmentPanel
              changeDiff={changeDiff}
              changeDiffLoading={changeDiffLoading}
              changeDiffMessage={changeDiffMessage}
              changes={changes}
              changesLoading={changesLoading}
              changesMessage={changesMessage}
              connection={connection}
              onChangeDiffClose={onChangeDiffClose}
              onChangeSelect={onChangeSelect}
              onReconnect={onReconnect}
              selectedChange={selectedChange}
              selectedTask={selectedTask}
              workspaces={workspaces}
            />
          )
        ) : null}
        <TaskSearch
          hasMore={searchHasMore}
          isLoading={searchLoading}
          message={searchMessage}
          onClose={onSearchClose}
          onQueryChange={onSearchQueryChange}
          onSelect={onSearchSelect}
          open={searchOpen}
          query={searchQuery}
          results={searchResults}
        />
        <SlotItems items={slots['shell.overlay']} prefix="shell-overlay" />
      </main>
    </div>
  )
}
