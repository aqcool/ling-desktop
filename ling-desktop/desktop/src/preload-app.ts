/** Sandboxed application boot and native directory selection. */
import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from './ipc.ts'
import { markDocumentPlatform } from './preload-platform.ts'

if (location.protocol === 'dsh-app:' && location.hostname === 'app') {
  markDocumentPlatform()
  contextBridge.exposeInMainWorld('__LING_EXTERNAL_LINKS__', {
    open: (url: string) => ipcRenderer.invoke(IPC.openExternal, url),
  })
  contextBridge.exposeInMainWorld('__LING_THEME__', { set: (mode: string) => ipcRenderer.invoke(IPC.theme, mode) })
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
