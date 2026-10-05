/** Sandboxed application boot and native directory selection. */
import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from './ipc.ts'
import { markDocumentPlatform } from './preload-platform.ts'
import type { ApplicationIconSnapshot, ApplicationIconStyle } from './application-icon.ts'
import type { LingRendererFailure } from 'ling-desktop/runtime'

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
