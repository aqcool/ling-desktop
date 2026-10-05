import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'

export function positionResizeMarker(event: ReactPointerEvent<HTMLDivElement>, orientation: 'vertical' | 'horizontal') {
  const bounds = event.currentTarget.getBoundingClientRect()
  const length = orientation === 'vertical' ? bounds.height : bounds.width
  const halfMarker = Math.min(144, length / 2)
  const pointerPosition = orientation === 'vertical' ? event.clientY - bounds.top : event.clientX - bounds.left
  const position = Math.max(halfMarker, Math.min(length - halfMarker, pointerPosition))
  event.currentTarget.style.setProperty(orientation === 'vertical' ? '--resize-marker-y' : '--resize-marker-x', `${String(position)}px`)
}

const sidebarStorageKey = 'ling.sidebar'
const sidebarWidthStorageKey = 'ling.sidebar-width'
export const sidebarMinWidth = 220
const sidebarMaxWidth = 440
const sidebarMaxRatio = 0.25
const workspaceMinWidth = 372
const workbenchWidthStorageKey = 'ling.workbench-width.v3'
const workbenchMinWidth = 288
const conversationMinWidth = 336
const terminalHeightStorageKey = 'ling.terminal-height'
export const terminalMinHeight = 160
const terminalMaxHeight = 560
const terminalMaxRatio = 0.55
const terminalContentMinHeight = 320

export function terminalHeightLimit(workspaceHeight: number): number {
  return Math.max(terminalMinHeight, Math.min(terminalMaxHeight, Math.floor(workspaceHeight * terminalMaxRatio), Math.floor(workspaceHeight - terminalContentMinHeight)))
}

export function clampTerminalHeight(height: number, workspaceHeight: number): number {
  const maximum = terminalHeightLimit(workspaceHeight)
  return Math.round(Math.max(terminalMinHeight, Math.min(maximum, height)))
}

export function sidebarWidthLimit(shellWidth: number): number {
  return Math.max(sidebarMinWidth, Math.min(sidebarMaxWidth, Math.floor(shellWidth * sidebarMaxRatio), shellWidth - workspaceMinWidth))
}

export function clampSidebarWidth(width: number, shell: HTMLElement): number {
  return Math.round(Math.max(sidebarMinWidth, Math.min(sidebarWidthLimit(shell.getBoundingClientRect().width), width)))
}

export function workbenchWidthBounds(workspaceWidth: number): { minimum: number; maximum: number } {
  if (workspaceWidth <= workbenchMinWidth + conversationMinWidth) return { minimum: 50, maximum: 50 }
  return {
    minimum: Math.max(19, workbenchMinWidth / workspaceWidth * 100),
    maximum: Math.min(80, (workspaceWidth - conversationMinWidth) / workspaceWidth * 100),
  }
}

export function clampWorkbenchWidth(width: number, workspaceWidth: number): number {
  const { minimum, maximum } = workbenchWidthBounds(workspaceWidth)
  return Math.round(Math.max(minimum, Math.min(maximum, width)) * 10) / 10
}


/** Owns panel dimensions, persistence and observers. */
export function useShellLayout({ shortcutBlocked }: { readonly shortcutBlocked: boolean }) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => window.localStorage.getItem(sidebarStorageKey) === 'collapsed')
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = Number(window.localStorage.getItem(sidebarWidthStorageKey))
    const initial = Number.isFinite(saved) && saved >= sidebarMinWidth ? saved : Math.min(260, Math.round(window.innerWidth * 0.15))
    return Math.round(Math.max(sidebarMinWidth, Math.min(initial, sidebarMaxWidth)))
  })
  const [sidebarAvailableWidth, setSidebarAvailableWidth] = useState(() => sidebarWidthLimit(window.innerWidth))
  const displayedSidebarWidth = Math.min(sidebarWidth, sidebarAvailableWidth)
  const sidebarDragStart = useRef<{ pointerX: number; width: number } | null>(null)
  const [terminalHeight, setTerminalHeight] = useState(() => {
    const saved = Number(window.localStorage.getItem(terminalHeightStorageKey))
    return Number.isFinite(saved) && saved >= terminalMinHeight
      ? Math.round(Math.min(saved, terminalMaxHeight))
      : clampTerminalHeight(window.innerHeight * 0.25, window.innerHeight)
  })
  const [workbenchWidth, setWorkbenchWidth] = useState(() => {
    const saved = Number(window.localStorage.getItem(workbenchWidthStorageKey))
    return Number.isFinite(saved) && saved >= 19 && saved <= 80 ? saved : 44
  })
  const [workspaceAvailableWidth, setWorkspaceAvailableWidth] = useState(() => Math.max(1, window.innerWidth - (sidebarCollapsed ? 0 : displayedSidebarWidth)))
  const [workspaceAvailableHeight, setWorkspaceAvailableHeight] = useState(() => window.innerHeight)
  const displayedWorkbenchWidth = clampWorkbenchWidth(workbenchWidth, workspaceAvailableWidth)
  const workbenchBounds = workbenchWidthBounds(workspaceAvailableWidth)
  const displayedTerminalHeight = clampTerminalHeight(terminalHeight, workspaceAvailableHeight)
  useEffect(() => {
    window.localStorage.setItem(sidebarStorageKey, sidebarCollapsed ? 'collapsed' : 'expanded')
  }, [sidebarCollapsed])

  useEffect(() => {
    const timeout = window.setTimeout(() => { window.localStorage.setItem(sidebarWidthStorageKey, String(sidebarWidth)) }, 150)
    return () => { window.clearTimeout(timeout) }
  }, [sidebarWidth])

  useEffect(() => {
    const workspace = document.querySelector<HTMLElement>('main.workspace')
    if (!workspace || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(entries => {
      const width = Math.round(entries[0]?.contentRect.width ?? workspace.getBoundingClientRect().width)
      const height = Math.round(entries[0]?.contentRect.height ?? workspace.getBoundingClientRect().height)
      setWorkspaceAvailableWidth(width)
      setWorkspaceAvailableHeight(height)
    })
    observer.observe(workspace)
    return () => { observer.disconnect() }
  }, [])

  useEffect(() => {
    const timeout = window.setTimeout(() => { window.localStorage.setItem(workbenchWidthStorageKey, String(workbenchWidth)) }, 150)
    return () => { window.clearTimeout(timeout) }
  }, [workbenchWidth])

  useEffect(() => {
    const onResize = () => {
      const shell = document.querySelector<HTMLElement>('.desktop-shell')
      if (!shell) return
      setSidebarAvailableWidth(sidebarWidthLimit(shell.getBoundingClientRect().width))
    }
    window.addEventListener('resize', onResize)
    return () => { window.removeEventListener('resize', onResize) }
  }, [])

  useEffect(() => {
    const timeout = window.setTimeout(() => { window.localStorage.setItem(terminalHeightStorageKey, String(terminalHeight)) }, 150)
    return () => { window.clearTimeout(timeout) }
  }, [terminalHeight])
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (shortcutBlocked || event.key.toLowerCase() !== 'b' || !(event.metaKey || event.ctrlKey)) return
      event.preventDefault()
      setSidebarCollapsed(current => !current)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => { window.removeEventListener('keydown', onKeyDown) }
  }, [shortcutBlocked])

  return {
    sidebarAvailableWidth,
    sidebarCollapsed,
    setSidebarCollapsed,
    sidebarWidth,
    setSidebarWidth,
    displayedSidebarWidth,
    sidebarDragStart,
    terminalHeight,
    setTerminalHeight,
    displayedTerminalHeight,
    workbenchWidth,
    setWorkbenchWidth,
    workspaceAvailableWidth,
    workspaceAvailableHeight,
    displayedWorkbenchWidth,
    workbenchBounds,
  }
}
