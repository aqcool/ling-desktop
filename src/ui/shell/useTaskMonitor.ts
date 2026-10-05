import { useEffect, useReducer, useRef, useState } from 'react'
import { effectiveMonitorPresentation, monitorPreferencesStorageKey, readMonitorPreferences } from '../monitor-preferences.js'
import { initialMonitorState, monitorReducer } from '../monitor-state.js'
import type { MonitorSections } from '../MonitorSection.js'
import type { LingShellProps } from './types.js'

interface MonitorOptions {
  readonly screen: LingShellProps['screen']
  readonly taskId?: string
  readonly workbenchOpen: boolean
  readonly workbenchMaximized: boolean
  readonly workspaceAvailableWidth: number
}

/** Monitor visibility and section collapse survive presentation changes independently of the workbench. */
export function useTaskMonitor({ screen, taskId, workbenchOpen, workbenchMaximized, workspaceAvailableWidth }: MonitorOptions) {
  const [monitorPreferences, setMonitorPreferences] = useState(() => readMonitorPreferences(window.localStorage.getItem(monitorPreferencesStorageKey)))
  const [monitorState, dispatchMonitor] = useReducer(monitorReducer, initialMonitorState)
  const [monitorSections, setMonitorSections] = useState<Record<string, Record<string, boolean>>>({})
  const monitorContext = taskId ?? 'new-task'
  const monitorRef = useRef<HTMLElement>(null)
  const monitorPresentation = effectiveMonitorPresentation(monitorPreferences.presentation, workbenchOpen, workspaceAvailableWidth)
  const monitorOpen = monitorState.open && screen === 'workspace' && !workbenchMaximized && !(workbenchOpen && window.innerWidth <= 700)
  const monitorFloating = monitorOpen && monitorPresentation === 'floating'
  const monitorFixed = monitorOpen && !monitorFloating
  useEffect(() => { window.localStorage.setItem(monitorPreferencesStorageKey, JSON.stringify(monitorPreferences)) }, [monitorPreferences])

  useEffect(() => {
    if (screen !== 'workspace') return
    dispatchMonitor({ type: 'enter', context: monitorContext, defaultOpen: workbenchOpen ? monitorState.open : Boolean(taskId && monitorPreferences.presentation === 'fixed' && monitorPreferences.showByDefault && workspaceAvailableWidth >= 800) })
  }, [screen, monitorContext, taskId, workbenchOpen, monitorState.open, monitorPreferences.presentation, monitorPreferences.showByDefault, workspaceAvailableWidth])

  useEffect(() => {
    if (!monitorFloating || monitorState.pinned) return
    const dismiss = () => { dispatchMonitor({ type: 'dismiss', presentation: monitorPresentation }) }
    const pointer = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Element) || monitorRef.current?.contains(target) || target.closest('[aria-controls="task-monitor"], [role="dialog"], [role="menu"], [role="listbox"], [data-overlay-container]')) return
      dismiss()
    }
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || document.querySelector('[role="dialog"], [role="menu"], [role="listbox"]')) return
      event.preventDefault()
      dismiss()
      document.querySelector<HTMLButtonElement>('[aria-controls="task-monitor"]')?.focus()
    }
    document.addEventListener('pointerdown', pointer)
    document.addEventListener('keydown', key)
    return () => { document.removeEventListener('pointerdown', pointer); document.removeEventListener('keydown', key) }
  }, [monitorFloating, monitorState.pinned, monitorPresentation])

  const toggleLocalStatus = () => {
    dispatchMonitor({ type: 'toggle' })
    if (!monitorOpen && monitorPresentation === 'floating') window.requestAnimationFrame(() => { monitorRef.current?.querySelector<HTMLButtonElement>('button')?.focus() })
  }
  const toggleMonitorPin = () => {
    dispatchMonitor({ type: 'pin' })
    if (monitorState.pinned) window.requestAnimationFrame(() => { document.querySelector<HTMLButtonElement>('[aria-controls="task-monitor"]')?.focus() })
  }

  const sections: MonitorSections = {
    values: monitorSections[monitorContext] ?? {},
    set: (title, open) => { setMonitorSections(current => ({ ...current, [monitorContext]: { ...current[monitorContext], [title]: open } })) },
  }
  return {
    monitorPreferences,
    setMonitorPreferences,
    monitorState,
    monitorRef,
    monitorPresentation,
    monitorOpen,
    monitorFloating,
    monitorFixed,
    toggleLocalStatus,
    toggleMonitorPin,
    sections,
  }
}
