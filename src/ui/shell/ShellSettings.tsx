import { useEffect, useState, type Dispatch, type SetStateAction } from 'react'
import { AgentPresetSettings, BuiltinPluginSettings } from '../AgentSettings.js'
import { ArchivedSettings } from '../ArchivedSettings.js'
import { BehaviorSettings } from '../BehaviorSettings.js'
import { CatalogSettings } from '../CatalogSettings.js'
import { ComputerControlSettings } from '../ComputerControlSettings.js'
import { ExtensionSettings } from '../ExtensionSettings.js'
import { GeneralSettings } from '../GeneralSettings.js'
import { GitPanel, GitSettings } from '../GitPanel.js'
import { HooksSettings } from '../HooksSettings.js'
import { MemorySettings } from '../MemorySettings.js'
import { ModelSettings } from '../ModelSettings.js'
import type { MonitorPreferences } from '../monitor-preferences.js'
import { MonitorSettings } from '../MonitorSettings.js'
import { ServerSettings } from '../ServerSettings.js'
import { CompactSelect } from '../SettingsControls.js'
import { tw } from '../tailwind.js'
import type { TaskViewState } from '../task-view.js'
import { UsageSettings } from '../UsageSettings.js'
import type { DialogState, LingShellProps } from './types.js'

interface ShellSettingsProps {
  readonly settings: Pick<
    LingShellProps,
    'computerControl'
    | 'extensions'
    | 'hooks'
    | 'knowledge'
    | 'localeLoading'
    | 'localeMessage'
    | 'localePreference'
    | 'modelSettings'
    | 'modelSettingsLoading'
    | 'modelSettingsMessage'
    | 'onCreateWorkspace'
    | 'onDeleteTask'
    | 'onLocaleChange'
    | 'onModelDefaultSelect'
    | 'onModelEnabledChange'
    | 'onModelSettingsRefresh'
    | 'onProviderModelsRefresh'
    | 'onProviderAuthorize'
    | 'onProviderCreate'
    | 'onProviderDelete'
    | 'onProviderSaveApiKey'
    | 'onProviderSignOut'
    | 'onProviderTest'
    | 'onProviderUpdate'
    | 'onSelectTask'
    | 'onSettingsTabChange'
    | 'onThemeChange'
    | 'onToggleTaskArchive'
    | 'onWorkspaceOpen'
    | 'selectedTask'
    | 'serverManager'
    | 'settingsTab'
    | 'supportsGoalLimit'
    | 'tasks'
    | 'theme'
    | 'version'
    | 'workspaceGit'
    | 'workspaces'
  >
  readonly activeWorkspaceId?: string
  readonly memoryRecapRequested: boolean
  readonly setMemoryRecapRequested: Dispatch<SetStateAction<boolean>>
  readonly settingsGitWorkspace?: string
  readonly setSettingsGitWorkspace: Dispatch<SetStateAction<string | undefined>>
  readonly remoteTaskId?: string
  readonly remoteLabel?: string
  readonly taskViewState: TaskViewState
  readonly setTaskViewState: Dispatch<SetStateAction<TaskViewState>>
  readonly monitorPreferences: MonitorPreferences
  readonly setMonitorPreferences: Dispatch<SetStateAction<MonitorPreferences>>
  readonly onOpenDialog: (dialog: DialogState) => void
  readonly onBrowseServerFiles: (id: string) => void
}

export function ShellSettings({
  onBrowseServerFiles,
  settings: props,
  activeWorkspaceId,
  memoryRecapRequested,
  setMemoryRecapRequested,
  settingsGitWorkspace,
  setSettingsGitWorkspace,
  remoteTaskId,
  remoteLabel,
  taskViewState,
  setTaskViewState,
  monitorPreferences,
  setMonitorPreferences,
  onOpenDialog,
}: ShellSettingsProps) {
  const { selectedTask, tasks, workspaces, theme, onThemeChange } = props
  const gitSettingsWorkspaceId = workspaces.find(workspace => workspace.workspaceId === settingsGitWorkspace)?.workspaceId ?? activeWorkspaceId ?? workspaces[0]?.workspaceId
  return (
    <div className={tw("settings-layout min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain [scrollbar-gutter:stable]")}>
      <div className={tw("settings-body mx-auto min-h-full w-[min(100%,58rem)] min-w-0 px-20 pb-12 pt-2.5 max-[980px]:px-5 max-[980px]:pb-8 max-[700px]:px-3 max-[700px]:pb-8", props.settingsTab === 'control' && 'w-[min(100%,38rem)] px-6 pb-6 max-[980px]:px-6 max-[980px]:pb-6 max-[700px]:px-4 max-[700px]:pb-6')}>
        {props.settingsTab === 'general' || props.settingsTab === 'modes' ? <BehaviorSettings section={props.settingsTab} supportsGoalLimit={props.supportsGoalLimit} pluginManager={props.extensions?.manager} /> : props.settingsTab === 'git' ? <GitSettings /> : props.settingsTab === 'worktrees' ? <section className={tw('flex min-h-[32rem] flex-col gap-5')}>
          <h1 className={tw('m-0 text-xl font-semibold')}>Worktrees</h1>
          <div className={tw('flex items-center gap-3 text-xs text-[var(--text-secondary)]')}>工作区<CompactSelect label="Worktrees 工作区" className={tw('w-full flex-1')} onChange={setSettingsGitWorkspace} value={gitSettingsWorkspaceId ?? ''} options={workspaces.map(workspace => ({ value: workspace.workspaceId, label: workspace.label }))} /></div>
          {gitSettingsWorkspaceId && props.workspaceGit ? <GitPanel onAddWorkspace={props.onCreateWorkspace} view="worktrees" key={gitSettingsWorkspaceId} request={props.workspaceGit} workspaceId={gitSettingsWorkspaceId} /> : <p className={tw('text-sm text-[var(--text-tertiary)]')}>先添加本地工作区</p>}
        </section> : props.settingsTab === 'usage' ? (
          <UsageSettings selectedTask={selectedTask} tasks={tasks} />
        ) : props.settingsTab === 'models' ? (
          <ModelSettings
            loading={props.modelSettingsLoading}
            message={props.modelSettingsMessage}
            onCreateCustomProvider={props.onProviderCreate}
            onDeleteProvider={props.onProviderDelete}
            onAuthorizeProvider={props.onProviderAuthorize}
            onRefresh={props.onModelSettingsRefresh}
            onRefreshProviderModels={props.onProviderModelsRefresh}
            onSaveApiKey={props.onProviderSaveApiKey}
            onSelectDefault={props.onModelDefaultSelect}
            onModelEnabledChange={props.onModelEnabledChange}
            onSignOutProvider={props.onProviderSignOut}
            onTestProvider={props.onProviderTest}
            onUpdateCustomProvider={props.onProviderUpdate}
            settings={props.modelSettings}
          />
        ) : props.settingsTab === 'monitor' ? (
          <MonitorSettings onChange={setMonitorPreferences} preferences={monitorPreferences} onOpenRecapSettings={() => { setMemoryRecapRequested(true); props.onSettingsTabChange('memory') }} />
        ) : props.settingsTab === 'agent-presets' ? (
          <AgentPresetSettings service={props.extensions?.settings} onChanged={props.extensions?.onSettingsChanged ?? (async () => { })} onCreate={props.extensions?.onCreatePreset ?? (() => { })} />
        ) : props.settingsTab === 'builtin-plugins' ? (
          <BuiltinPluginSettings service={props.extensions?.settings} />
        ) : props.settingsTab === 'extensions' && props.extensions !== undefined ? (
          <ExtensionSettings
            manager={props.extensions.manager}
            readSkills={props.extensions.readSkills}
            taskId={selectedTask?.taskId}
          />
        ) : props.settingsTab === 'appearance' || props.settingsTab === 'shortcuts' ? (
          <GeneralSettings
            section={props.settingsTab}
            localeLoading={props.localeLoading}
            localeMessage={props.localeMessage}
            localePreference={props.localePreference}
            onLocaleChange={props.onLocaleChange}
            onThemeChange={onThemeChange}
            theme={theme}
            version={props.version}
          />
        ) : props.settingsTab === 'archived' ? (
          <ArchivedSettings
            onDeleteTask={props.onDeleteTask}
            archivedWorkspaceIds={taskViewState.archivedWorkspaceIds}
            onOpenTask={taskId => { props.onWorkspaceOpen(); props.onSelectTask(taskId) }}
            onRestoreTask={taskId => { props.onToggleTaskArchive(taskId, false) }}
            onRestoreWorkspace={workspaceId => { setTaskViewState(current => ({ ...current, archivedWorkspaceIds: current.archivedWorkspaceIds.filter(id => id !== workspaceId) })) }}
            onRemoveWorkspace={workspace => { onOpenDialog({ kind: 'delete-workspace', id: workspace.workspaceId, initial: workspace.label }) }}
            tasks={tasks.filter(task => task.archived)}
            workspaces={workspaces}
          />
        ) : props.settingsTab === 'connections' ? (
          <ServerSettings service={props.serverManager} onBrowseFiles={onBrowseServerFiles} />
        ) : props.settingsTab === 'memory' ? (
          <MemorySettings service={props.knowledge} models={props.modelSettings} workspaces={workspaces} remoteTaskId={remoteTaskId} remoteLabel={remoteLabel} initialRecapSettings={memoryRecapRequested} onOpenTask={taskId => { props.onWorkspaceOpen(); props.onSelectTask(taskId) }} />
        ) : props.settingsTab === 'hooks' ? (
          <HooksSettings service={props.hooks} onOpenTask={taskId => { props.onWorkspaceOpen(); props.onSelectTask(taskId) }} />
        ) : props.settingsTab === 'control' ? (
          <ComputerControlSettings service={props.extensions?.manager} computer={props.computerControl} />
        ) : (
          <CatalogSettings tab={props.settingsTab} modelSettings={props.modelSettings} onTestProvider={props.onProviderTest} />
        )}
      </div>
    </div>
  )
}

export function useShellSettingsRouting(tab: LingShellProps['settingsTab']) {
  const [settingsGitWorkspace, setSettingsGitWorkspace] = useState<string>()
  const [memoryRecapRequested, setMemoryRecapRequested] = useState(false)
  useEffect(() => { if (tab !== 'memory') setMemoryRecapRequested(false) }, [tab])
  return { settingsGitWorkspace, setSettingsGitWorkspace, memoryRecapRequested, setMemoryRecapRequested }
}
