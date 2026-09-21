import { useCallback, useEffect, useState } from 'react'
import { createOfflineRuntimeAdapter } from './runtime/offline-adapter.js'
import type {
  LingFileDiff,
  LingRuntimeAdapter,
  LingTaskChanges,
  LingTaskSearchMatch,
} from './runtime/contract.js'
import { useLingRuntime } from './runtime/use-ling-runtime.js'
import type { ChangeSelection } from './ui/ChangeReview.js'
import { LingShell } from './ui/LingShell.js'
import {
  lingUiExtensions,
  useLingUiSlots,
  type LingUiExtensionRegistry,
} from './ui/registry.js'
import type { LingUiSlots } from './ui/slots.js'

const offlineRuntime = createOfflineRuntimeAdapter('LING 暂时无法连接。')

interface AppProps {
  readonly extensions?: LingUiExtensionRegistry
  readonly runtime?: LingRuntimeAdapter
  readonly slots?: LingUiSlots
}

export function App({ extensions = lingUiExtensions, runtime = offlineRuntime, slots }: AppProps) {
  const [environmentOpen, setEnvironmentOpen] = useState(true)
  const [notice, setNotice] = useState('')
  const [prompt, setPrompt] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<readonly LingTaskSearchMatch[]>([])
  const [searchHasMore, setSearchHasMore] = useState(false)
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchMessage, setSearchMessage] = useState<string>()
  const [changes, setChanges] = useState<readonly LingTaskChanges[]>([])
  const [changesLoading, setChangesLoading] = useState(false)
  const [changesMessage, setChangesMessage] = useState<string>()
  const [selectedChange, setSelectedChange] = useState<ChangeSelection>()
  const [changeDiff, setChangeDiff] = useState<LingFileDiff>()
  const [changeDiffLoading, setChangeDiffLoading] = useState(false)
  const [changeDiffMessage, setChangeDiffMessage] = useState<string>()
  const [forkPending, setForkPending] = useState(false)
  const {
    connection,
    forkTask,
    getTaskChanges,
    getTaskFileDiff,
    reconnect: reconnectRuntime,
    searchTasks,
    selectedTask,
    selectTask,
    startNewTask: startNewTaskRuntime,
    submit: submitRuntime,
    tasks,
    timeline,
    workspaces,
  } = useLingRuntime(runtime)
  const resolvedSlots = useLingUiSlots(extensions, slots)

  useEffect(() => {
    const media = window.matchMedia('(max-width: 980px)')
    const closeInspectorOnNarrowLayout = () => {
      if (media.matches) setEnvironmentOpen(false)
    }
    closeInspectorOnNarrowLayout()
    media.addEventListener('change', closeInspectorOnNarrowLayout)
    return () => { media.removeEventListener('change', closeInspectorOnNarrowLayout) }
  }, [])

  useEffect(() => {
    if (!searchOpen) return
    const query = searchQuery.trim()
    if (!query) {
      setSearchResults([])
      setSearchHasMore(false)
      setSearchMessage(undefined)
      setSearchLoading(false)
      return
    }
    const abort = new AbortController()
    const timer = window.setTimeout(() => {
      void searchTasks(query, abort.signal).then(result => {
        if (abort.signal.aborted) return
        if (result.ok) {
          setSearchResults(result.value.items)
          setSearchHasMore(result.value.hasMore)
          setSearchMessage(undefined)
        } else {
          setSearchResults([])
          setSearchHasMore(false)
          setSearchMessage(result.message)
        }
        setSearchLoading(false)
      }).catch(() => {
        if (!abort.signal.aborted) {
          setSearchResults([])
          setSearchHasMore(false)
          setSearchLoading(false)
          setSearchMessage('无法搜索任务。')
        }
      })
    }, 140)
    setSearchLoading(true)
    setSearchMessage(undefined)
    return () => {
      abort.abort()
      window.clearTimeout(timer)
    }
  }, [searchTasks, searchOpen, searchQuery])

  const selectedTaskId = selectedTask?.taskId
  const selectedTaskStatus = selectedTask?.status

  useEffect(() => {
    setSelectedChange(undefined)
    setChangeDiff(undefined)
    setChangeDiffMessage(undefined)
    if (selectedTaskId === undefined) {
      setChanges([])
      setChangesLoading(false)
      setChangesMessage(undefined)
      return
    }
    const abort = new AbortController()
    setChangesLoading(true)
    setChangesMessage(undefined)
    void getTaskChanges(selectedTaskId, abort.signal).then(result => {
      if (abort.signal.aborted) return
      if (result.ok) {
        setChanges(result.value)
        setChangesMessage(undefined)
      } else {
        setChanges([])
        setChangesMessage(result.message)
      }
      setChangesLoading(false)
    }).catch(() => {
      if (!abort.signal.aborted) {
        setChanges([])
        setChangesLoading(false)
        setChangesMessage('无法读取文件变更。')
      }
    })
    return () => { abort.abort() }
  }, [getTaskChanges, selectedTaskId, selectedTaskStatus])

  useEffect(() => {
    if (selectedTaskId === undefined || selectedChange === undefined) {
      setChangeDiff(undefined)
      setChangeDiffLoading(false)
      setChangeDiffMessage(undefined)
      return
    }
    const abort = new AbortController()
    setChangeDiff(undefined)
    setChangeDiffLoading(true)
    setChangeDiffMessage(undefined)
    void getTaskFileDiff(selectedTaskId, selectedChange.seq, selectedChange.index, abort.signal).then(result => {
      if (abort.signal.aborted) return
      if (result.ok) {
        setChangeDiff(result.value)
        setChangeDiffMessage(undefined)
      } else {
        setChangeDiff(undefined)
        setChangeDiffMessage(result.message)
      }
      setChangeDiffLoading(false)
    }).catch(() => {
      if (!abort.signal.aborted) {
        setChangeDiff(undefined)
        setChangeDiffLoading(false)
        setChangeDiffMessage('无法读取文件差异。')
      }
    })
    return () => { abort.abort() }
  }, [getTaskFileDiff, selectedChange, selectedTaskId])

  const startNewTask = useCallback(() => {
    startNewTaskRuntime()
    setNotice('')
    setPrompt('')
  }, [startNewTaskRuntime])

  const submit = useCallback(async () => {
    const text = prompt.trim()
    if (!text) return
    try {
      const result = await submitRuntime(text)
      setNotice(result.accepted ? '' : result.message)
      if (result.accepted) setPrompt('')
    } catch {
      setNotice('无法发送任务。')
    }
  }, [prompt, submitRuntime])

  const reconnect = useCallback(async () => {
    try {
      const result = await reconnectRuntime()
      setNotice(result.accepted ? '正在重新连接…' : result.message)
    } catch {
      setNotice('无法重新连接。')
    }
  }, [reconnectRuntime])

  const fork = useCallback(async () => {
    if (selectedTask === undefined || forkPending) return
    setForkPending(true)
    try {
      const result = await forkTask(selectedTask.taskId)
      setNotice(result.accepted ? '已创建分叉任务。' : result.message)
    } catch {
      setNotice('无法创建分叉任务。')
    } finally {
      setForkPending(false)
    }
  }, [forkPending, forkTask, selectedTask])

  const openSearch = useCallback(() => { setSearchOpen(true) }, [])
  const closeSearch = useCallback(() => {
    setSearchOpen(false)
    setSearchLoading(false)
  }, [])
  const selectSearchResult = useCallback((taskId: string) => {
    selectTask(taskId)
    setSearchOpen(false)
    setNotice('')
  }, [selectTask])
  const selectChange = useCallback((selection: ChangeSelection) => {
    setSelectedChange(selection)
    setEnvironmentOpen(true)
  }, [])
  const closeChangeDiff = useCallback(() => { setSelectedChange(undefined) }, [])

  return (
    <LingShell
      changeDiff={changeDiff}
      changeDiffLoading={changeDiffLoading}
      changeDiffMessage={changeDiffMessage}
      changes={changes}
      changesLoading={changesLoading}
      changesMessage={changesMessage}
      connection={connection}
      environmentOpen={environmentOpen}
      forkPending={forkPending}
      notice={notice}
      onChangeDiffClose={closeChangeDiff}
      onChangeSelect={selectChange}
      onEnvironmentToggle={() => { setEnvironmentOpen(current => !current) }}
      onFork={() => { void fork() }}
      onNewTask={startNewTask}
      onPromptChange={value => { setPrompt(value); setNotice('') }}
      onReconnect={() => { void reconnect() }}
      onSearchClose={closeSearch}
      onSearchOpen={openSearch}
      onSearchQueryChange={setSearchQuery}
      onSearchSelect={selectSearchResult}
      onSelectTask={selectTask}
      onSubmit={() => { void submit() }}
      prompt={prompt}
      searchHasMore={searchHasMore}
      searchLoading={searchLoading}
      searchMessage={searchMessage}
      searchOpen={searchOpen}
      searchQuery={searchQuery}
      searchResults={searchResults}
      selectedChange={selectedChange}
      selectedTask={selectedTask}
      slots={resolvedSlots}
      tasks={tasks}
      timeline={timeline}
      workspaces={workspaces}
    />
  )
}
