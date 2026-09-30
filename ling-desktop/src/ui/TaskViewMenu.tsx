import { Dropdown } from '@heroui/react/dropdown'
import { Label } from '@heroui/react/label'
import { Separator } from '@heroui/react/separator'
import { useState } from 'react'
import type { LingWorkspaceSummary } from '../runtime/contract.js'
import { Icon } from './Icon.js'
import type { TaskView } from './task-view.js'
import { tw } from './tailwind.js'

interface TaskViewMenuProps {
  readonly className?: string
  readonly view: TaskView
  readonly workspaces: readonly LingWorkspaceSummary[]
  readonly onChange: (view: TaskView) => void
}

const groupLabels = { workspace: '按工作区', custom: '按自定义分组', activity: '按活动日期' } as const
const sortLabels = { manual: '手动', updated: '最近更新', name: '名称', created: '创建时间' } as const
const recencyLabels = { all: '全部', today: '今天', '7days': '最近 7 天', '30days': '最近 30 天' } as const

export function TaskViewMenu({ className, view, workspaces, onChange }: TaskViewMenuProps) {
  const [open, setOpen] = useState(false)
  const set = (change: Partial<TaskView>) => { onChange({ ...view, ...change }); setOpen(false) }
  const workspaceLabel = view.workspaceId === 'all' ? '全部' : view.workspaceId === 'none' ? '无工作区' :
    workspaces.find(workspace => workspace.workspaceId === view.workspaceId)?.label ?? '全部'

  return (
    <span className={tw("task-view-menu inline-flex flex-none", className)}>
      <Dropdown isOpen={open} onOpenChange={setOpen}>
        <Dropdown.Trigger aria-label="自定义任务视图" className={tw("sidebar-projects__tool inline-flex items-center justify-center border-0 bg-transparent [color:var(--text-secondary)] cursor-pointer [width:1.65rem] [height:1.65rem] flex-none rounded-md hover:[background:var(--surface-hover)] hover:[color:var(--foreground)] focus-visible:[outline:2px_solid_var(--focus)] focus-visible:[outline-offset:1px]")}><Icon name="sort" size={16} /></Dropdown.Trigger>
        <Dropdown.Popover className={tw("task-view-menu__popover w-55 min-w-55 max-h-[min(24rem,calc(100vh-1rem))] max-w-[min(13.75rem,calc(100vw-1rem))] rounded-xl border border-[var(--panel-border)] bg-[var(--surface)] text-sm text-[var(--foreground)] shadow-[var(--overlay-shadow)]")} crossOffset={-112} offset={5} placement="bottom start">
          <Dropdown.Menu aria-label="自定义任务视图" className={tw("task-view-menu__list")}>
            <Dropdown.SubmenuTrigger>
              <Dropdown.Item id="group-by" textValue="分组方式">
                <Label>分组方式</Label><span className={tw("task-view-menu__value [max-width:7rem] ml-auto mr-4.5 overflow-hidden [color:var(--foreground)] text-ellipsis whitespace-nowrap")}>{groupLabels[view.groupBy]}</span><Dropdown.SubmenuIndicator />
              </Dropdown.Item>
              <Dropdown.Popover className={tw("task-view-menu__popover task-view-menu__popover--sub w-42 min-w-42 max-h-[min(24rem,calc(100vh-1rem))] max-w-[min(10.5rem,calc(100vw-1rem))] rounded-xl border border-[var(--panel-border)] bg-[var(--surface)] text-sm text-[var(--foreground)] shadow-[var(--overlay-shadow)]")} placement="right top">
                <Dropdown.Menu aria-label="分组方式" selectedKeys={[view.groupBy]} selectionMode="single">
                  <Dropdown.Item id="workspace" onAction={() => { set({ groupBy: 'workspace', sortBy: 'manual' }) }} textValue="按工作区"><Label>按工作区</Label><Dropdown.ItemIndicator /></Dropdown.Item>
                  <Dropdown.Item id="custom" onAction={() => { set({ groupBy: 'custom', sortBy: 'updated', workspaceId: 'all' }) }} textValue="按自定义分组"><Label>按自定义分组</Label><Dropdown.ItemIndicator /></Dropdown.Item>
                  <Dropdown.Item id="activity" onAction={() => { set({ groupBy: 'activity', sortBy: 'updated', workspaceId: 'all' }) }} textValue="按活动日期"><Label>按活动日期</Label><Dropdown.ItemIndicator /></Dropdown.Item>
                </Dropdown.Menu>
              </Dropdown.Popover>
            </Dropdown.SubmenuTrigger>
            <Dropdown.SubmenuTrigger>
              <Dropdown.Item id="sort-by" textValue="排序方式">
                <Label>排序方式</Label><span className={tw("task-view-menu__value [max-width:7rem] ml-auto mr-4.5 overflow-hidden [color:var(--foreground)] text-ellipsis whitespace-nowrap")}>{sortLabels[view.sortBy]}</span><Dropdown.SubmenuIndicator />
              </Dropdown.Item>
              <Dropdown.Popover className={tw("task-view-menu__popover task-view-menu__popover--sub w-42 min-w-42 max-h-[min(24rem,calc(100vh-1rem))] max-w-[min(10.5rem,calc(100vw-1rem))] rounded-xl border border-[var(--panel-border)] bg-[var(--surface)] text-sm text-[var(--foreground)] shadow-[var(--overlay-shadow)]")} placement="right top">
                <Dropdown.Menu aria-label="排序方式" selectedKeys={[view.sortBy]} selectionMode="single">
                  {view.groupBy === 'workspace' ? <Dropdown.Item id="manual" onAction={() => { set({ sortBy: 'manual' }) }} textValue="手动"><Label>手动</Label><Dropdown.ItemIndicator /></Dropdown.Item> : null}
                  <Dropdown.Item id="updated" onAction={() => { set({ sortBy: 'updated' }) }} textValue="最近更新"><Label>最近更新</Label><Dropdown.ItemIndicator /></Dropdown.Item>
                  <Dropdown.Item id="name" onAction={() => { set({ sortBy: 'name' }) }} textValue="名称"><Label>名称</Label><Dropdown.ItemIndicator /></Dropdown.Item>
                  <Dropdown.Item id="created" onAction={() => { set({ sortBy: 'created' }) }} textValue="创建时间"><Label>创建时间</Label><Dropdown.ItemIndicator /></Dropdown.Item>
                </Dropdown.Menu>
              </Dropdown.Popover>
            </Dropdown.SubmenuTrigger>
            <Separator className={tw("mx-1.5 my-1 w-auto bg-[var(--separator)]")} />
            {view.groupBy === 'workspace' ? (
              <Dropdown.SubmenuTrigger>
                <Dropdown.Item id="workspace-filter" textValue="工作区">
                  <Label>工作区</Label><span className={tw("task-view-menu__value [max-width:7rem] ml-auto mr-4.5 overflow-hidden [color:var(--foreground)] text-ellipsis whitespace-nowrap")}>{workspaceLabel}</span><Dropdown.SubmenuIndicator />
                </Dropdown.Item>
                <Dropdown.Popover className={tw("task-view-menu__popover task-view-menu__popover--sub w-42 min-w-42 max-h-[min(24rem,calc(100vh-1rem))] max-w-[min(10.5rem,calc(100vw-1rem))] rounded-xl border border-[var(--panel-border)] bg-[var(--surface)] text-sm text-[var(--foreground)] shadow-[var(--overlay-shadow)]")} placement="right top">
                  <Dropdown.Menu aria-label="工作区" selectedKeys={[view.workspaceId]} selectionMode="single">
                    <Dropdown.Item id="all" onAction={() => { set({ workspaceId: 'all' }) }} textValue="全部"><Label>全部</Label><Dropdown.ItemIndicator /></Dropdown.Item>
                    <Dropdown.Item id="none" onAction={() => { set({ workspaceId: 'none' }) }} textValue="无工作区"><Label>无工作区</Label><Dropdown.ItemIndicator /></Dropdown.Item>
                    {workspaces.map(workspace => (
                      <Dropdown.Item id={workspace.workspaceId} key={workspace.workspaceId} onAction={() => { set({ workspaceId: workspace.workspaceId }) }} textValue={workspace.label}>
                        <Label>{workspace.label}</Label><Dropdown.ItemIndicator />
                      </Dropdown.Item>
                    ))}
                  </Dropdown.Menu>
                </Dropdown.Popover>
              </Dropdown.SubmenuTrigger>
            ) : null}
            <Dropdown.SubmenuTrigger>
              <Dropdown.Item id="recency" textValue="最近活动">
                <Label>最近活动</Label><span className={tw("task-view-menu__value [max-width:7rem] ml-auto mr-4.5 overflow-hidden [color:var(--foreground)] text-ellipsis whitespace-nowrap")}>{recencyLabels[view.recency]}</span><Dropdown.SubmenuIndicator />
              </Dropdown.Item>
              <Dropdown.Popover className={tw("task-view-menu__popover task-view-menu__popover--sub w-42 min-w-42 max-h-[min(24rem,calc(100vh-1rem))] max-w-[min(10.5rem,calc(100vw-1rem))] rounded-xl border border-[var(--panel-border)] bg-[var(--surface)] text-sm text-[var(--foreground)] shadow-[var(--overlay-shadow)]")} placement="right top">
                <Dropdown.Menu aria-label="最近活动" selectedKeys={[view.recency]} selectionMode="single">
                  <Dropdown.Item id="all" onAction={() => { set({ recency: 'all' }) }} textValue="全部"><Label>全部</Label><Dropdown.ItemIndicator /></Dropdown.Item>
                  <Dropdown.Item id="today" onAction={() => { set({ recency: 'today' }) }} textValue="今天"><Label>今天</Label><Dropdown.ItemIndicator /></Dropdown.Item>
                  <Dropdown.Item id="7days" onAction={() => { set({ recency: '7days' }) }} textValue="最近 7 天"><Label>最近 7 天</Label><Dropdown.ItemIndicator /></Dropdown.Item>
                  <Dropdown.Item id="30days" onAction={() => { set({ recency: '30days' }) }} textValue="最近 30 天"><Label>最近 30 天</Label><Dropdown.ItemIndicator /></Dropdown.Item>
                </Dropdown.Menu>
              </Dropdown.Popover>
            </Dropdown.SubmenuTrigger>
            <Separator className={tw("mx-1.5 my-1 w-auto bg-[var(--separator)]")} />
            <Dropdown.Item id="reset" onAction={() => { onChange({ groupBy: 'workspace', sortBy: 'manual', workspaceId: 'all', recency: 'all' }); setOpen(false) }} textValue="恢复默认"><Label>恢复默认</Label></Dropdown.Item>
          </Dropdown.Menu>
        </Dropdown.Popover>
      </Dropdown>
    </span>
  )
}
