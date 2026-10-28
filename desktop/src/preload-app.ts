/** Sandboxed application boot and native directory selection. */
import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from './ipc.ts'
import { markDocumentPlatform } from './preload-platform.ts'
import type { ApplicationIconSnapshot, ApplicationIconStyle } from './application-icon.ts'
import type { LingRendererFailure, LingUpdateBridge, LingUpdateChannel, LingUpdateState } from 'ling-desktop/runtime'

declare global {
  interface Window {
    __LING_APP_ICON__?: {
      get(): Promise<ApplicationIconSnapshot>
      set(style: ApplicationIconStyle): Promise<ApplicationIconSnapshot>
      subscribe(callback: (snapshot: ApplicationIconSnapshot) => void): () => void
    }
  }
}

if (location.protocol === 'dsh-app:' && location.hostname === 'app') {
  markDocumentPlatform()
  const updateChecks = new Set<() => string | undefined>()
  let updateFrozen = false
  let previouslyInert = false
  const freezeForUpdate = (freeze: boolean) => {
    if (freeze === updateFrozen) return
    if (freeze) previouslyInert = document.body.inert
    document.body.inert = freeze || previouslyInert
    updateFrozen = freeze
  }
  for (const event of ['keydown', 'keyup', 'beforeinput', 'pointerdown', 'click', 'dblclick', 'contextmenu', 'drop', 'paste', 'cut', 'submit']) {
    window.addEventListener(event, input => {
      if (!updateFrozen) return
      input.preventDefault()
      input.stopImmediatePropagation()
    }, { capture: true })
  }
  ipcRenderer.on(IPC.updateUnlock, () => freezeForUpdate(false))
  ipcRenderer.on(IPC.updatePrepare, (_event, token: unknown, freeze: unknown) => {
    if (typeof token !== 'string') return
    let reason: string | undefined
    try {
      for (const check of updateChecks) {
        reason = check()
        if (reason) break
      }
      if (!reason && freeze === true) freezeForUpdate(true)
    } catch { reason = '窗口内容尚未保存，请稍后重试更新。' }
    void ipcRenderer.invoke(IPC.updatePrepared, token, reason).catch(() => undefined)
  })
  contextBridge.exposeInMainWorld('__LING_UPDATE__', {
    beforeInstall: (check: () => string | undefined) => { updateChecks.add(check); return () => { updateChecks.delete(check) } },
    get: () => ipcRenderer.invoke(IPC.updateGet),
    check: () => ipcRenderer.invoke(IPC.updateCheck),
    setChannel: (channel: LingUpdateChannel) => ipcRenderer.invoke(IPC.updateChannel, channel),
    install: () => ipcRenderer.invoke(IPC.updateInstall),
    subscribe: (callback: (state: LingUpdateState) => void) => {
      const listener = (_event: unknown, state: LingUpdateState) => callback(state)
      ipcRenderer.on(IPC.updateChanged, listener)
      return () => ipcRenderer.removeListener(IPC.updateChanged, listener)
    },
  } satisfies LingUpdateBridge)
  contextBridge.exposeInMainWorld('__LING_RECOVERY__', {
    ready: () => ipcRenderer.invoke(IPC.rendererReady),
    report: (failure: LingRendererFailure) => ipcRenderer.invoke(IPC.rendererFailure, failure),
    reload: () => ipcRenderer.invoke(IPC.recoveryReload),
    copy: (failure: LingRendererFailure) => ipcRenderer.invoke(IPC.recoveryCopy, failure),
  })
  contextBridge.exposeInMainWorld('__LING_QUICK_NOTES__', {
    open: (origin?: unknown) => ipcRenderer.invoke(IPC.notesOpen, origin),
    context: () => ipcRenderer.invoke(IPC.notesContext),
    onContext: (callback: (origin?: unknown) => void) => {
      const listener = (_event: unknown, origin?: unknown) => callback(origin)
      ipcRenderer.on(IPC.notesContext, listener)
      return () => ipcRenderer.removeListener(IPC.notesContext, listener)
    },
    send: (action: unknown) => ipcRenderer.invoke(IPC.notesAction, action),
    onAction: (callback: (action: unknown) => void) => {
      const listener = (_event: unknown, action: unknown) => callback(action)
      ipcRenderer.on(IPC.notesAction, listener)
      return () => ipcRenderer.removeListener(IPC.notesAction, listener)
    },
  })
  contextBridge.exposeInMainWorld('__LING_COMPUTER_SNAPSHOT__', {
    setShortcut: (value: string) => ipcRenderer.invoke(IPC.snapshotShortcut, value),
    subscribe: (callback: () => void) => {
      const listener = () => callback()
      ipcRenderer.on(IPC.snapshotRequested, listener)
      return () => ipcRenderer.removeListener(IPC.snapshotRequested, listener)
    },
    reveal: () => ipcRenderer.invoke(IPC.snapshotReveal),
  })
  contextBridge.exposeInMainWorld('__LING_EXTERNAL_LINKS__', {
    open: (url: string) => ipcRenderer.invoke(IPC.openExternal, url),
  })
  contextBridge.exposeInMainWorld('__LING_THEME__', { set: (appearance: unknown) => ipcRenderer.invoke(IPC.theme, appearance) })
  contextBridge.exposeInMainWorld('__LING_APP_ICON__', {
    get: () => ipcRenderer.invoke(IPC.applicationIcon),
    set: (style: ApplicationIconStyle) => ipcRenderer.invoke(IPC.applicationIconSet, style),
    subscribe: (callback: (snapshot: ApplicationIconSnapshot) => void) => {
      const listener = (_event: unknown, snapshot: ApplicationIconSnapshot) => callback(snapshot)
      ipcRenderer.on(IPC.applicationIconChanged, listener)
      return () => ipcRenderer.removeListener(IPC.applicationIconChanged, listener)
    },
  })
  contextBridge.exposeInMainWorld('__LING_BEHAVIOR__', {
    setTray: (value: boolean) => ipcRenderer.invoke(IPC.tray, value),
    notify: (value: unknown) => ipcRenderer.invoke(IPC.notify, value),
    onOpenTask: (callback: (taskId: string) => void) => {
      const listener = (_event: unknown, taskId: string) => callback(taskId)
      ipcRenderer.on(IPC.openTask, listener)
      return () => ipcRenderer.removeListener(IPC.openTask, listener)
    },
  })
  contextBridge.exposeInMainWorld('dshDesktop', { protocolVersion: 1 })
  contextBridge.exposeInMainWorld('dshDesktopBoot', {
    ready: () => ipcRenderer.invoke(IPC.boot),
    failed: (message: string) => ipcRenderer.invoke(IPC.failed, message),
  })
  contextBridge.exposeInMainWorld('__DSH_DIRECTORY_PICKER__', { pick: () => ipcRenderer.invoke(IPC.directory) })
  contextBridge.exposeInMainWorld('__LING_WORKSPACE_GIT__', { branch: (path: string) => ipcRenderer.invoke(IPC.workspaceBranch, path), request: (path: string, request: unknown) => ipcRenderer.invoke(IPC.workspaceGit, path, request) })
  contextBridge.exposeInMainWorld('__LING_WORKSPACE_TOOLS__', { request: (path: string, request: unknown) => ipcRenderer.invoke(IPC.workspaceTools, path, request) })
  contextBridge.exposeInMainWorld('__LING_SERVER_BROKER__', {
    status: (id: string) => ipcRenderer.invoke(IPC.serverStatus, id),
    inspect: (id: string) => ipcRenderer.invoke(IPC.serverInspect, id),
    probe: (id: string) => ipcRenderer.invoke(IPC.serverProbe, id),
    directories: (id: string, path: string) => ipcRenderer.invoke(IPC.serverDirectories, id, path),
    credentials: (id: string) => ipcRenderer.invoke(IPC.serverCredentials, id),
    forget: (id: string) => ipcRenderer.invoke(IPC.serverForget, id),
  })
}
