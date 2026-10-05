import { useCallback, useEffect, useRef, useState } from 'react'
import type { LingPresentedFile } from '../../runtime/reply-features.js'
import type { BrowserAnnotation } from '../BrowserPanel.js'
import { deliveryName } from '../DeliveryCards.js'
import type { SideTaskState } from '../SideTaskPanel.js'
import { releaseComposerAttachment } from '../attachments.js'
import { browserNavigationEvent, type BrowserNavigationRequest } from '../browser-navigation.js'
import type { LingShellProps, WorkbenchTab, WorkbenchTabKind } from './types.js'

interface WorkbenchOptions {
  readonly props: Pick<
    LingShellProps,
    'browserOpen'
    | 'composerAgentPreset'
    | 'onBrowserToggle'
    | 'onSubmit'
    | 'permission'
    | 'prompt'
    | 'screen'
    | 'selectedTask'
    | 'serverManager'
  >
  readonly activeServerId?: string
  readonly activeOperationsServerId?: string
  readonly taskServerId?: string
  readonly activeWorkspaceId?: string
  readonly workspaceLabel: string
}

function browserAnnotationText(annotations: readonly BrowserAnnotation[]): string {
  if (annotations.length === 0) return ''
  return [
    '请根据以下网页元素注释调整页面：',
    ...annotations.map((annotation, index) => [
      `${String(index + 1)}. ${annotation.note}`,
      `   页面：${annotation.url}`,
      `   元素：${annotation.element.selector}`,
      annotation.element.text ? `   当前内容：${annotation.element.text}` : '',
    ].filter(Boolean).join('\n')),
  ].join('\n')
}

/** Owns workbench tabs and browser requests, without changing task monitor visibility. */
export function useWorkbench({ props, activeServerId, activeOperationsServerId, taskServerId, activeWorkspaceId, workspaceLabel }: WorkbenchOptions) {
  const { browserOpen, screen, prompt, onSubmit, selectedTask } = props
  const [workbenchMaximized, setWorkbenchMaximized] = useState(false)
  const [workbenchTabs, setWorkbenchTabs] = useState<readonly WorkbenchTab[]>([])
  useEffect(() => {
    if (!activeServerId) return
    setWorkbenchTabs(current => current.filter(tab => tab.kind === 'browser' || tab.kind === 'files' || tab.kind === 'terminal'))
  }, [activeServerId])
  const [activeWorkbenchTabId, setActiveWorkbenchTabId] = useState<string>()
  const sideTaskSequence = useRef(0)
  const [browserInitialized, setBrowserInitialized] = useState(false)
  const [browserNavigation, setBrowserNavigation] = useState<BrowserNavigationRequest>()
  const [browserAnnotations, setBrowserAnnotations] = useState<readonly BrowserAnnotation[]>([])
  const [browserAnnotationResetKey, setBrowserAnnotationResetKey] = useState(0)
  const activeWorkbenchTab = workbenchTabs.find(tab => tab.id === activeWorkbenchTabId)
  const clearBrowserAnnotations = () => {
    setBrowserAnnotations([])
    setBrowserAnnotationResetKey(current => current + 1)
  }

  const submitWithBrowserAnnotations = (annotations: readonly BrowserAnnotation[] = browserAnnotations) => {
    const annotationText = browserAnnotationText(annotations)
    const combined = [prompt.trim(), annotationText].filter(Boolean).join('\n\n')
    if (!combined) return
    onSubmit(combined, clearBrowserAnnotations)
  }

  const openWorkbenchTab = (kind: WorkbenchTabKind, initialSideTask?: Pick<SideTaskState, 'attachments' | 'prompt'>) => {
    if (!browserOpen) props.onBrowserToggle()
    const existing = kind === 'side-task' ? undefined : workbenchTabs.find(tab => tab.kind === kind)
    if (existing) {
      setActiveWorkbenchTabId(existing.id)
      return
    }
    const id = kind === 'side-task' ? `side-task-${String(++sideTaskSequence.current)}` : kind
    const label = kind === 'side-task' ? `新任务 ${String(sideTaskSequence.current)}` : kind === 'files' ? '工作区文件' : kind === 'browser' ? '内置浏览器' : kind === 'review' ? '审阅' : '终端'
    setWorkbenchTabs(current => [...current, { id, kind, label, ...(kind === 'side-task' ? { sideTask: { workspaceId: activeWorkspaceId, workspaceLabel, agentPreset: props.composerAgentPreset, permissionPreset: props.permission?.currentValue, prompt: '', attachments: [], ...initialSideTask } } : {}) }])
    setActiveWorkbenchTabId(id)
    if (kind === 'browser') setBrowserInitialized(true)
  }

  const previewDelivery = useCallback((taskId: string, file: LingPresentedFile) => {
    if (!browserOpen) props.onBrowserToggle()
    const tab: WorkbenchTab = { id: 'document', kind: 'document', label: deliveryName(file.path), delivery: { taskId, file } }
    setWorkbenchTabs(current => current.some(item => item.id === tab.id) ? current.map(item => item.id === tab.id ? tab : item) : [...current, tab])
    setActiveWorkbenchTabId(tab.id)
  }, [browserOpen, props.onBrowserToggle])
  const closeWorkbenchTab = (id: string) => {
    const index = workbenchTabs.findIndex(tab => tab.id === id)
    if (index < 0) return
    workbenchTabs[index]?.sideTask?.attachments.forEach(releaseComposerAttachment)
    const remaining = workbenchTabs.filter(tab => tab.id !== id)
    setWorkbenchTabs(remaining)
    if (activeWorkbenchTabId === id) setActiveWorkbenchTabId(remaining[Math.min(index, remaining.length - 1)]?.id)
  }

  const closeWorkbench = () => {
    setWorkbenchMaximized(false)
    if (browserOpen) props.onBrowserToggle()
  }

  useEffect(() => {
    if (screen !== 'workspace' || (browserOpen && activeWorkbenchTab?.kind === 'browser')) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 't') return
      event.preventDefault()
      setBrowserInitialized(true)
      openWorkbenchTab('browser')
    }
    window.addEventListener('keydown', onKeyDown)
    return () => { window.removeEventListener('keydown', onKeyDown) }
  }, [activeWorkbenchTab?.kind, browserOpen, screen, workbenchTabs])

  useEffect(() => {
    const service = props.serverManager
    if (screen !== 'workspace' || !selectedTask || !(activeOperationsServerId || taskServerId) || !service) return
    let active = true
    const taskId = selectedTask.taskId
    const check = () => {
      void service.takeTerminalUiRequest(taskId).then(result => {
        if (!active || !result.ok || !result.value.open) return
        if (!browserOpen) props.onBrowserToggle()
        setWorkbenchTabs(current => current.some(tab => tab.id === 'terminal') ? current : [...current, { id: 'terminal', kind: 'terminal', label: '终端' }])
        setActiveWorkbenchTabId('terminal')
      })
    }
    check()
    const timer = window.setInterval(check, 800)
    return () => { active = false; window.clearInterval(timer) }
  }, [screen, selectedTask?.taskId, activeOperationsServerId, taskServerId, props.serverManager, browserOpen, props.onBrowserToggle])

  useEffect(() => {
    const navigate = (event: Event) => {
      const request = (event as CustomEvent<BrowserNavigationRequest>).detail
      if (!request?.id || typeof request.url !== 'string') return
      openWorkbenchTab('browser'); setBrowserInitialized(true); setBrowserNavigation(request)
    }
    window.addEventListener(browserNavigationEvent, navigate)
    return () => { window.removeEventListener(browserNavigationEvent, navigate) }
  }, [browserOpen, workbenchTabs])

  return {
    clearBrowserAnnotations,
    setBrowserAnnotations,
    workbenchMaximized,
    setWorkbenchMaximized,
    workbenchTabs,
    setWorkbenchTabs,
    activeWorkbenchTabId,
    setActiveWorkbenchTabId,
    activeWorkbenchTab,
    browserInitialized,
    browserNavigation,
    setBrowserNavigation,
    browserAnnotations,
    browserAnnotationResetKey,
    submitWithBrowserAnnotations,
    openWorkbenchTab,
    previewDelivery,
    closeWorkbenchTab,
    closeWorkbench,
  }
}
