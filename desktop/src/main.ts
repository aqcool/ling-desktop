/** Native LING window with a private local DSH engine. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { readFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { basename, dirname, join, resolve } from 'node:path'
import { app, BrowserWindow, clipboard, dialog, globalShortcut, ipcMain, Menu, nativeImage, nativeTheme, Notification, Tray, powerSaveBlocker, protocol, safeStorage, screen, session, shell, type IpcMainInvokeEvent, type NativeImage } from 'electron'
import { DesktopHostProcess } from './host-process.ts'
import { APP_URL, IPC } from './ipc.ts'
import { readWorkspaceBranch, WorkspaceGit } from './workspace-git.ts'
import { WorkspaceTools, readApplicationIcon } from './workspace-tools.ts'
import type { LingWorkspaceToolRequest } from 'ling-desktop/runtime'
import { ensureLingProfile, LING_HOST_PACKAGE } from './profile.ts'
import { claimDesktopSingleInstance } from './single-instance.ts'
import { isTaskWindowUrl } from './task-window-url.ts'
import { authenticateWebHost, forwardWebRequest, serveWebDocument } from './web-document.ts'
import { ServerBroker, type HostFingerprint } from './server-broker.ts'
import { ServerStore } from './server-store.ts'
import { themeTokens, parseWindowAppearance, type WindowAppearance } from 'ling-desktop/theme'
import { credentialDocument } from './credential-window.ts'
import { quickNotesUrl, parseNoteWindowContext, parseNoteWindowAction } from './quick-notes-window.ts'
import { SnapshotShortcut } from './snapshot-shortcut.ts'
import { ApplicationIconController, FileApplicationIconStore, applyNativeApplicationIcon, type ApplicationIconStyle } from './application-icon.ts'
import { DesktopFailureRecovery, parseRendererFailure, type FailureSource } from './failure-recovery.ts'

const root = dirname(LING_HOST_PACKAGE)
const workspaceGit = new WorkspaceGit(path => shell.openPath(path))
const workspaceTools = new WorkspaceTools({
  icon: async path => process.platform === 'darwin'
    ? readApplicationIcon(path).catch(async () => (await app.getFileIcon(path, { size: 'small' })).toDataURL())
    : (await app.getFileIcon(path, { size: 'small' })).toDataURL(),
  openPath: path => shell.openPath(path),
})
app.setName('LING')
const home = resolve(process.env.LING_DESKTOP_HOME ?? join(app.getPath('userData'), 'runtime'))
mkdirSync(home, { recursive: true, mode: 0o700 })
const electronData = join(home, 'electron-user-data')
mkdirSync(electronData, { recursive: true, mode: 0o700 })
app.setPath('userData', electronData)
protocol.registerSchemesAsPrivileged([{ scheme: 'dsh-app', privileges: {
  standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true,
} }])

const require = createRequire(LING_HOST_PACKAGE)
const webRoot = dirname(require.resolve('@deepseek-ai/dsh-web-frontend/dist/index.html'))
const lingRoot = join(dirname(require.resolve('ling-desktop/package.json')), 'dist')
const browserPreload = join(root, 'lib', 'preload-browser.cjs')
const browserPartition = 'persist:ling-browser'
const windows = new Set<BrowserWindow>()
const applicationIconImages = new Map<ApplicationIconStyle, NativeImage>()
function applicationIconImage(style: ApplicationIconStyle): NativeImage {
  let image = applicationIconImages.get(style)
  if (!image) {
    image = nativeImage.createFromPath(join(root, 'assets', 'application-icons', `${style}.png`))
    if (image.isEmpty()) throw new Error('应用图标资源无法读取，请重新构建灵创。')
    applicationIconImages.set(style, image)
  }
  return image
}
const applicationIcon = new ApplicationIconController(new FileApplicationIconStore(join(home, 'application-icon.json')), style => {
  applyNativeApplicationIcon(process.platform, applicationIconImage(style), { dock: app.dock, windows: BrowserWindow.getAllWindows() })
})
const snapshotShortcut = new SnapshotShortcut(globalShortcut)
let notesWindow: BrowserWindow | undefined
let notesOwner: BrowserWindow | undefined
let notesContext: ReturnType<typeof parseNoteWindowContext>
let mainWindow: BrowserWindow | undefined
let host: DesktopHostProcess | undefined
let hostUrl: string | undefined
let hostCookie: string | undefined
let injections: readonly unknown[] = []
let startup: Promise<void> = Promise.resolve()
let quitting = false
let tray: Tray | undefined
let automationAwakeId: number | undefined
function setAutomationAwake(awake: boolean) {
  if (awake && automationAwakeId === undefined) automationAwakeId = powerSaveBlocker.start('prevent-app-suspension')
  if (!awake && automationAwakeId !== undefined) {
    powerSaveBlocker.stop(automationAwakeId)
    automationAwakeId = undefined
  }
}
const deliveredNotifications = new Set<string>()
const activeNotifications = new Set<Notification>()
const serverStore = new ServerStore(join(home, 'ling-servers.json'))
const serverBroker = new ServerBroker(home, {
  available: async () => {
    if (!(await safeStorage.isAsyncEncryptionAvailable())) return false
    return process.platform !== 'linux' || !['basic_text', 'unknown'].includes(safeStorage.getSelectedStorageBackend())
  },
  encrypt: value => safeStorage.encryptStringAsync(value),
  decrypt: async value => (await safeStorage.decryptStringAsync(value)).result,
}, join(root, 'lib'), {
  upload: async directory => {
    const window = BrowserWindow.getFocusedWindow() ?? mainWindow
    if (!window || window.isDestroyed()) throw new Error('请先打开灵创窗口。')
    const result = await dialog.showOpenDialog(window, { title: directory ? '上传目录' : '上传文件',
      properties: directory ? ['openDirectory'] : ['openFile', 'multiSelections'] })
    return result.canceled ? [] : result.filePaths
  },
  download: async (name, directory) => {
    const window = BrowserWindow.getFocusedWindow() ?? mainWindow
    if (!window || window.isDestroyed()) throw new Error('请先打开灵创窗口。')
    if (directory) {
      const result = await dialog.showOpenDialog(window, { title: '选择下载目录的保存位置', properties: ['openDirectory', 'createDirectory'] })
      return result.canceled ? undefined : result.filePaths[0]
    }
    const result = await dialog.showSaveDialog(window, { title: '下载文件', defaultPath: name })
    return result.canceled ? undefined : result.filePath
  },
})
let appearance: WindowAppearance = { mode: 'system', palette: 'default' }
const themeSnapshot = () => ({ ...appearance, resolved: nativeTheme.shouldUseDarkColors ? 'dark' as const : 'light' as const })
const windowColors = () => themeTokens(themeSnapshot().resolved, appearance.palette)
const credentialWindows = new Map<number, { window: BrowserWindow; serverId: string; pendingKey?: string }>()


const recovery = new DesktopFailureRecovery({
  version: app.getVersion(), platform: process.platform, arch: process.arch, home: app.getPath('home'),
  available: () => !quitting,
  show: async (notice, target) => {
    const owner = [...windows].find(window => window.id === target?.id && !window.isDestroyed())
      ?? (mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined)
    const options = { ...notice, type: 'error' as const, defaultId: 0, cancelId: 2, noLink: true }
    return (owner ? await dialog.showMessageBox(owner, options) : await dialog.showMessageBox(options)).response
  },
  copy: text => clipboard.writeText(text),
  restart: () => { app.relaunch(); app.quit() },
  failed: error => { console.error('LING recovery failed', error) },
})

function reportFailure(error: unknown, source: FailureSource = 'main', window?: BrowserWindow): void {
  console.error(error)
  void recovery.report(source, error, window)
}

function assertAppSender(event: Pick<IpcMainInvokeEvent, 'sender' | 'senderFrame'>): BrowserWindow {
  const owner = [...windows].find(window => !window.isDestroyed() && window.webContents === event.sender)
  if (!owner || event.senderFrame !== owner.webContents.mainFrame
    || !event.senderFrame.url.startsWith(APP_URL)) throw new Error('Rejected LING IPC sender')
  return owner
}

function openExternal(url: string): void {
  try {
    if (['https:', 'http:', 'mailto:'].includes(new URL(url).protocol)) void shell.openExternal(url)
  } catch {}
}

function isBrowserUrl(url: unknown): url is string {
  if (typeof url !== 'string') return false
  try { return ['https:', 'http:'].includes(new URL(url).protocol) } catch { return false }
}

function createWindow(notes = false): BrowserWindow {
  const window = new BrowserWindow({
    width: notes ? 420 : 1280, height: notes ? 760 : 840, minWidth: notes ? 340 : 800, minHeight: notes ? 480 : 580,
    ...(notes ? { useContentSize: true, maximizable: false, fullscreenable: false } : {}),
    show: false, title: notes ? 'Quick Notes' : '灵创', backgroundColor: windowColors().surface,
    ...(process.platform !== 'darwin' ? { icon: applicationIconImage(applicationIcon.snapshot().style) } : {}),
    ...(process.platform === 'darwin' ? {
      titleBarStyle: 'hiddenInset' as const,
      trafficLightPosition: { x: 16, y: 18 },
    } : {}),
    ...(process.platform === 'win32' ? {
      titleBarStyle: 'hidden' as const,
      titleBarOverlay: { height: 40, color: windowColors().surface, symbolColor: windowColors().foreground },
    } : {}),
    webPreferences: {
      preload: join(root, 'lib', 'preload-app.cjs'),
      contextIsolation: true, sandbox: true, nodeIntegration: false, webviewTag: !notes,
    },
  })
  windows.add(window)
  const contentsId = window.webContents.id
  window.on('closed', () => { recovery.closed(window); snapshotShortcut.clearOwner(contentsId); windows.delete(window) })
  window.webContents.on('did-start-navigation', details => {
    if (details.isMainFrame && !details.isSameDocument) recovery.loading(window)
  })
  window.once('ready-to-show', () => window.show())
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (!notes && isTaskWindowUrl(url) && !quitting) {
      const task = createWindow()
      void task.loadURL(url).catch(error => reportFailure(error, 'boot', task))
    } else openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(APP_URL)) { event.preventDefault(); openExternal(url) }
  })
  window.webContents.on('will-redirect', (event, url) => {
    if (!url.startsWith(APP_URL)) event.preventDefault()
  })
  window.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    if (!isBrowserUrl(params.src) || params.partition !== browserPartition) {
      event.preventDefault()
      return
    }
    webPreferences.preload = browserPreload
    webPreferences.contextIsolation = true
    webPreferences.sandbox = true
    webPreferences.nodeIntegration = false
    webPreferences.webSecurity = true
    webPreferences.allowRunningInsecureContent = false
  })
  window.webContents.on('did-attach-webview', (_event, contents) => {
    contents.setWindowOpenHandler(({ url }) => {
      if (isBrowserUrl(url)) openExternal(url)
      return { action: 'deny' }
    })
    contents.on('will-navigate', (event, url) => {
      if (!isBrowserUrl(url)) event.preventDefault()
    })
  })
  window.webContents.on('render-process-gone', (_event, details) => {
    reportFailure(new Error(`Renderer: ${details.reason}; exitCode=${details.exitCode}`), 'renderer', window)
  })
  window.webContents.on('preload-error', (_event, _path, error) => reportFailure(error, 'preload', window))
  return window
}

async function startHost(): Promise<void> {
  const projectDir = ensureLingProfile(home)
  host = new DesktopHostProcess(
    process.execPath, root, projectDir, undefined,
    { ...process.env, DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1' },
    error => {
      hostUrl = undefined; hostCookie = undefined
      setAutomationAwake(false)
      reportFailure(error, 'host')
    }, undefined, 'runtime', undefined, join(root, 'lib', 'host.js'), undefined,
    (serverId, cwd, command, signal, outputLimit, onOutput, policy) => serverBroker.run(serverId, cwd, command, signal, outputLimit, onOutput, policy),
    (serverId, root, source, destination, sha256, remoteSha256, signal) => serverBroker.upload(serverId, root, source, destination, sha256, remoteSha256, signal),
    (serverId, root, source, destination, sha256, localSha256, signal) => serverBroker.download(serverId, root, source, destination, sha256, localSha256, signal),
    (serverId, directory, signal, shallow) => serverBroker.directoryManifest(serverId, directory, signal, shallow),
    async (request, signal) => {
      if (request.action === 'open') return serverBroker.terminalOpen(request.serverId, request.cwd, request.cols, request.rows, signal)
      if (request.action === 'poll') return serverBroker.terminalPoll(request.terminalId, request.offset)
      if (request.action === 'write') await serverBroker.terminalWrite(request.terminalId, request.data)
      else if (request.action === 'resize') await serverBroker.terminalResize(request.terminalId, request.cols, request.rows)
      else await serverBroker.terminalClose(request.terminalId)
      return { ok: true as const }
    },
    async (request, signal) => {
      if (request.action === 'sftp') return serverBroker.manageFiles(request.serverId, request.request, signal)
      if (request.action === 'read') return serverBroker.readFile(request.serverId, request.path, signal, request.root, request.maxBytes)
      if (request.action === 'write') return serverBroker.writeFile(request.serverId, request.path, request.text, request.expected, request.policy, signal)
      const entries = await serverBroker.listFiles(request.serverId, request.path, signal, request.root)
      return { path: request.path, entries: entries.map(entry => ({ name: entry.name, type: entry.type })) }
    },
    setAutomationAwake,
  )
  const ready = await host.start()
  const url = new URL(ready.url)
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') throw new Error('LING Host must use loopback HTTP')
  hostCookie = await authenticateWebHost(ready.url)
  if (recovery.hasHostFailure) throw new Error('LING Host stopped during startup')
  hostUrl = ready.url
  if (!ready.injections) throw new Error('LING Host omitted Web boot injections')
  injections = ready.injections
}

async function main(): Promise<void> {
  await app.whenReady()
  await applicationIcon.restore().catch(error => console.error(error))
  await rm(join(home, 'ling-server-terminals'), { recursive: true, force: true })
  ipcMain.handle(IPC.applicationIcon, event => { assertAppSender(event); return applicationIcon.snapshot() })
  ipcMain.handle(IPC.applicationIconSet, async (event, raw: unknown) => {
    assertAppSender(event)
    const snapshot = await applicationIcon.set(raw)
    for (const window of windows) if (!window.isDestroyed()) window.webContents.send(IPC.applicationIconChanged, snapshot)
    return snapshot
  })
  function credentialSession(event: IpcMainInvokeEvent) {
    const item = credentialWindows.get(event.sender.id)
    if (!item || item.window.isDestroyed() || item.window.webContents !== event.sender
      || event.senderFrame !== item.window.webContents.mainFrame) throw new Error('Rejected credential IPC sender')
    return item
  }
  ipcMain.handle(IPC.serverStatus, (event, id: string) => { assertAppSender(event); return serverBroker.status(id) })
  ipcMain.handle(IPC.serverInspect, (event, id: string) => { assertAppSender(event); return serverBroker.inspect(id) })
  ipcMain.handle(IPC.serverProbe, (event, id: string) => { assertAppSender(event); return serverBroker.probe(id) })
  ipcMain.handle(IPC.serverDirectories, (event, id: string, path: string) => { assertAppSender(event); return serverBroker.directories(id, path) })
  ipcMain.handle(IPC.serverForget, (event, id: string) => { assertAppSender(event); return serverBroker.forget(id) })
  ipcMain.handle(IPC.serverCredentials, async (event, id: string) => {
    const owner = assertAppSender(event)
    await serverBroker.status(id)
    const existing = [...credentialWindows.values()].find(item => item.serverId === id && !item.window.isDestroyed())
    if (existing) { existing.window.focus(); return }
    const window = new BrowserWindow({ width: 560, height: 330, minWidth: 500, minHeight: 320, useContentSize: true,
      parent: owner, modal: true, show: false, title: '服务器认证', backgroundColor: windowColors().surface,
      ...(process.platform !== 'darwin' ? { icon: applicationIconImage(applicationIcon.snapshot().style) } : {}),
      webPreferences: { preload: join(root, 'lib', 'preload-credentials.cjs'), contextIsolation: true,
        sandbox: true, nodeIntegration: false, webSecurity: true, partition: 'ling-credentials' },
    })
    credentialWindows.set(window.webContents.id, { window, serverId: id })
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', event => event.preventDefault())
    window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    window.once('ready-to-show', () => window.show())
    const closed = new Promise<void>(resolve => window.once('closed', () => { credentialWindows.delete(window.webContents.id); resolve() }))
    await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(credentialDocument(appearance, themeSnapshot().resolved))}`)
    return closed
  })
  ipcMain.handle(IPC.credentialTheme, event => { credentialSession(event); return themeSnapshot() })
  ipcMain.handle(IPC.credentialInfo, async event => {
    const { serverId } = credentialSession(event)
    const server = (await serverStore.list()).find(value => value.id === serverId)
    if (!server) throw new Error('服务器已不存在。')
    return { name: server.name, address: server.alias, user: server.user, port: server.port ?? 22,
      status: await serverBroker.status(serverId) }
  })
  ipcMain.handle(IPC.credentialInspect, event => serverBroker.inspect(credentialSession(event).serverId))
  ipcMain.handle(IPC.credentialTrust, (event, value: HostFingerprint) => {
    const { serverId } = credentialSession(event)
    if (!value || typeof value.algorithm !== 'string' || typeof value.sha256 !== 'string'
      || value.algorithm.length > 128 || value.sha256.length > 128) throw new Error('主机指纹无效。')
    return serverBroker.trust(serverId, value)
  })
  ipcMain.handle(IPC.credentialPassword, (event, password: string) => {
    const { serverId } = credentialSession(event)
    if (typeof password !== 'string') throw new Error('密码无效。')
    return serverBroker.savePassword(serverId, password)
  })
  ipcMain.handle(IPC.credentialChooseKey, async event => {
    const item = credentialSession(event)
    const result = await dialog.showOpenDialog(item.window, { properties: ['openFile'], title: '选择 SSH 私钥' })
    if (result.canceled || !result.filePaths[0]) return null
    const file = result.filePaths[0]
    const contents = await readFile(file)
    if (contents.length > 131072) throw new Error('私钥文件超过大小限制。')
    item.pendingKey = contents.toString('utf8')
    return basename(file)
  })
  ipcMain.handle(IPC.credentialSaveKey, async (event, passphrase: string) => {
    const item = credentialSession(event)
    if (!item.pendingKey || typeof passphrase !== 'string') throw new Error('请先选择私钥文件。')
    await serverBroker.saveKey(item.serverId, item.pendingKey, passphrase)
    item.pendingKey = undefined
  })
  ipcMain.handle(IPC.credentialClear, event => serverBroker.clearCredential(credentialSession(event).serverId))
  ipcMain.handle(IPC.credentialTest, event => serverBroker.probe(credentialSession(event).serverId))
  ipcMain.handle(IPC.credentialClose, event => credentialSession(event).window.close())
  ipcMain.handle(IPC.credentialResize, (event, height: number) => {
    const { window } = credentialSession(event)
    if (!Number.isFinite(height)) return
    const next = Math.max(320, Math.min(560, Math.ceil(height)))
    const [width = 560, currentHeight = 0] = window.getContentSize()
    if (Math.abs(currentHeight - next) > 2) window.setContentSize(width, next)
  })
  const themePath = join(home, 'appearance.json')
  try { appearance = parseWindowAppearance(JSON.parse(readFileSync(themePath, 'utf8'))) ?? appearance }
  catch {
    try { appearance = parseWindowAppearance({ mode: readFileSync(join(home, 'appearance-mode'), 'utf8').trim(), palette: 'default' }) ?? appearance } catch {}
  }
  nativeTheme.themeSource = appearance.mode
  const updateWindows = () => {
    const colors = windowColors()
    for (const window of [...windows, ...[...credentialWindows.values()].map(item => item.window)]) {
      if (window.isDestroyed()) continue
      window.setBackgroundColor(colors.surface!)
      if (windows.has(window) && process.platform === 'win32') window.setTitleBarOverlay({ color: colors.surface, symbolColor: colors.foreground })
      if (credentialWindows.has(window.webContents.id)) window.webContents.send(IPC.themeChanged, themeSnapshot())
    }
  }
  nativeTheme.on('updated', updateWindows)
  ipcMain.handle(IPC.notesOpen, async (event, raw: unknown) => {
    const owner = assertAppSender(event)
    if (owner === notesWindow) throw new Error('Rejected Quick Notes window owner')
    notesContext = parseNoteWindowContext(raw); notesOwner = owner
    if (notesWindow && !notesWindow.isDestroyed()) {
      notesWindow.webContents.send(IPC.notesContext, notesContext)
      if (notesWindow.isMinimized()) notesWindow.restore()
      notesWindow.show(); notesWindow.focus(); return
    }
    const window = createWindow(true); notesWindow = window
    const bounds = owner.getBounds()
    const area = screen.getDisplayMatching(bounds).workArea
    const width = Math.min(420, area.width); const height = Math.min(760, area.height)
    window.setBounds({ width, height, x: Math.max(area.x, Math.min(bounds.x + bounds.width - width - 20, area.x + area.width - width)), y: Math.max(area.y, Math.min(bounds.y + 60, area.y + area.height - height)) })
    window.on('closed', () => { notesWindow = undefined; notesOwner = undefined })
    try { await window.loadURL(quickNotesUrl) } catch (error) { window.destroy(); throw error }
  })
  ipcMain.handle(IPC.notesContext, event => {
    if (assertAppSender(event) !== notesWindow) throw new Error('Rejected Quick Notes context sender')
    return notesContext
  })
  ipcMain.handle(IPC.notesAction, (event, raw: unknown) => {
    if (assertAppSender(event) !== notesWindow) throw new Error('Rejected Quick Notes action sender')
    const action = parseNoteWindowAction(raw)
    const owner = notesOwner && !notesOwner.isDestroyed() ? notesOwner : mainWindow
    if (!owner || owner.isDestroyed()) throw new Error('请先打开任务窗口。速记内容已保留。')
    if (owner.isMinimized()) owner.restore()
    owner.show(); owner.focus(); owner.webContents.send(IPC.notesAction, action)
  })
  ipcMain.handle(IPC.openExternal, async (event, url: unknown) => {
    assertAppSender(event)
    if (!isBrowserUrl(url)) throw new Error('无效的浏览器链接。')
    await shell.openExternal(url)
  })
  ipcMain.handle(IPC.snapshotShortcut, (event, value: unknown) => {
    const owner = assertAppSender(event)
    try {
      snapshotShortcut.set(event.sender.id, value, () => { if (!owner.isDestroyed()) owner.webContents.send(IPC.snapshotRequested) })
      return { ok: true, value: undefined }
    } catch (error) { return { ok: false, reason: 'runtime-unavailable', message: error instanceof Error ? error.message : '无法注册快照快捷键。', retryable: false } }
  })
  ipcMain.handle(IPC.snapshotReveal, event => {
    const owner = assertAppSender(event)
    if (owner.isMinimized()) owner.restore()
    owner.show(); owner.focus()
  })
  ipcMain.handle(IPC.theme, (event, value: unknown) => {
    assertAppSender(event)
    // Old renderers can remain open during a build; accept their mode-only payload.
    const next = parseWindowAppearance(typeof value === 'string' ? { mode: value, palette: appearance.palette } : value)
    if (!next) throw new Error('Invalid appearance')
    if (next.mode === appearance.mode && next.palette === appearance.palette) return
    appearance = next
    nativeTheme.themeSource = next.mode
    updateWindows()
    writeFileSync(themePath, JSON.stringify(next), { mode: 0o600 })
  })
  const embeddedBrowserSession = session.fromPartition(browserPartition)
  embeddedBrowserSession.setPermissionCheckHandler(() => false)
  embeddedBrowserSession.setPermissionRequestHandler((_webContents, _permission, callback) => { callback(false) })
  protocol.handle('dsh-app', async request => {
    const url = new URL(request.url)
    if (url.hostname !== 'app') return new Response(null, { status: 404 })
    if (url.pathname === '/ling-renderer.css') {
      return serveWebDocument(new Request('dsh-app://app/renderer.css', { method: request.method }), lingRoot)
    }
    if (url.pathname === '/' || url.pathname === '/index.html' || url.pathname.startsWith('/assets/')
      || ['/favicon.svg', '/manifest.webmanifest'].includes(url.pathname)) {
      return serveWebDocument(request, webRoot)
    }
    if (!hostUrl || !hostCookie) return new Response(null, { status: 503 })
    return forwardWebRequest(request, hostUrl, hostCookie)
  })
  ipcMain.handle(IPC.boot, async event => {
    assertAppSender(event)
    await startup
    if (!hostUrl) throw new Error('LING Host is unavailable')
    return { injections, streamBaseUrl: new URL(hostUrl).origin }
  })
  ipcMain.handle(IPC.failed, (event, message: unknown) => {
    const owner = assertAppSender(event)
    if (typeof message !== 'string') throw new Error('Invalid boot error')
    reportFailure(new Error(message.slice(0, 4096)), 'boot', owner)
  })
  ipcMain.handle(IPC.rendererReady, event => { recovery.ready(assertAppSender(event)) })
  ipcMain.handle(IPC.rendererFailure, (event, raw: unknown) => {
    const owner = assertAppSender(event)
    const failure = parseRendererFailure(raw)
    console.error('LING Renderer failure', failure.message)
    // Return immediately: the failure page remains interactive while the native notice is open.
    void recovery.report('renderer', new Error(failure.message), owner, failure)
  })
  ipcMain.handle(IPC.recoveryReload, event => { recovery.reload(assertAppSender(event)) })
  ipcMain.handle(IPC.recoveryCopy, (event, raw: unknown) => {
    const owner = assertAppSender(event)
    recovery.copy(parseRendererFailure(raw), owner)
  })
  let picking: Promise<string | null> | undefined
  ipcMain.handle(IPC.workspaceGit, async (event, path: unknown, request: unknown) => {
    assertAppSender(event)
    try { return { ok: true, value: await workspaceGit.handle(path, request) } }
    catch (error) { return { ok: false, reason: 'runtime-unavailable', message: error instanceof Error ? error.message : 'Git 操作失败。', retryable: true } }
  })
  ipcMain.handle(IPC.workspaceBranch, (event, path: unknown) => {
    assertAppSender(event)
    return readWorkspaceBranch(path)
  })
  ipcMain.handle(IPC.workspaceTools, async (event, path: unknown, request: LingWorkspaceToolRequest) => {
    assertAppSender(event)
    try { return { ok: true, value: await workspaceTools.handle(path, request) } }
    catch (error) { return { ok: false, reason: 'runtime-unavailable', message: error instanceof Error ? error.message : '工作区操作失败。', retryable: true } }
  })
  ipcMain.handle(IPC.directory, event => {
    const window = assertAppSender(event)
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
    picking ??= dialog.showOpenDialog(window, { properties: ['openDirectory', 'createDirectory'] })
      .then(result => result.canceled ? null : result.filePaths[0] ?? null)
      .finally(() => { picking = undefined })
    return picking
  })
  session.defaultSession.webRequest.onBeforeSendHeaders({ urls: ['ws://127.0.0.1/*'] }, (details, callback) => {
    if (!hostUrl || !hostCookie || ![...windows].some(window => !window.isDestroyed()
      && window.webContents.id === details.webContentsId)) return callback({})
    const hostAddress = new URL(hostUrl)
    if (new URL(details.url).host !== hostAddress.host) return callback({})
    const headers = Object.fromEntries(Object.entries(details.requestHeaders)
      .map(([key, value]) => [key.toLowerCase(), value]))
    if (headers.origin !== 'dsh-app://app') return callback({ cancel: true })
    callback({ requestHeaders: { ...headers, origin: hostAddress.origin, cookie: hostCookie, 'sec-fetch-site': 'same-origin' } })
  })
  Menu.setApplicationMenu(process.platform === 'win32' ? null : Menu.buildFromTemplate([
    { label: '灵创', submenu: [{ role: 'quit' }] },
    { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' },
  ]))
  startup = startHost()
  void startup.catch(error => reportFailure(error, 'host'))
  const openMain = (): void => {
    if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.show(); mainWindow.focus(); return }
    mainWindow = createWindow()
    mainWindow.on('closed', () => { mainWindow = undefined })
    const window = mainWindow
    void window.loadURL(APP_URL).catch(error => reportFailure(error, 'boot', window))
  }
  const setTray = (enabled: boolean) => {
    if (!enabled) { tray?.destroy(); tray = undefined; return }
    if (tray) return
    // A monochrome L mark, rendered at 2x for a crisp macOS template image.
    const pixels = Buffer.alloc(32 * 32 * 4)
    for (let y = 5; y < 27; y++) for (let x = 7; x < 25; x++) {
      if (x < 11 || y > 22) pixels[(y * 32 + x) * 4 + 3] = 255
    }
    const icon = nativeImage.createFromBitmap(pixels, { width: 32, height: 32, scaleFactor: 2 })
    if (process.platform === 'darwin') icon.setTemplateImage(true)
    tray = new Tray(icon)
    tray.setToolTip('灵创')
    tray.setContextMenu(Menu.buildFromTemplate([{ label: '打开灵创', click: openMain }, { type: 'separator' }, { label: '退出灵创', click: () => app.quit() }]))
    tray.on('click', openMain)
  }
  const trayPath = join(home, 'tray-enabled')
  try { setTray(readFileSync(trayPath, 'utf8').trim() === 'true') } catch {}
  ipcMain.handle(IPC.tray, (event, value: unknown) => {
    assertAppSender(event)
    if (typeof value !== 'boolean') throw new Error('Invalid tray preference')
    const previous = Boolean(tray)
    setTray(value)
    try { writeFileSync(trayPath, String(value), { mode: 0o600 }) } catch (error) { setTray(previous); throw error }
  })
  ipcMain.handle(IPC.notify, async (event, raw: unknown) => {
    const owner = assertAppSender(event)
    if (!raw || typeof raw !== 'object') throw new Error('Invalid notification')
    const value = raw as Record<string, unknown>
    for (const field of ['key', 'title', 'body', 'taskId']) if (typeof value[field] !== 'string' || (value[field] as string).length > 512) throw new Error('Invalid notification text')
    if (typeof value.backgroundOnly !== 'boolean' || !(value.taskId as string).length || (value.taskId as string).length > 256) throw new Error('Invalid notification target')
    const key = value.key as string
    if (deliveredNotifications.has(key)) return
    deliveredNotifications.add(key)
    if (deliveredNotifications.size > 512) deliveredNotifications.delete(deliveredNotifications.values().next().value!)
    if (value.backgroundOnly && [...windows].some(window => !window.isDestroyed() && window.isFocused())) return
    if (!Notification.isSupported()) throw new Error('当前系统不支持桌面通知。')
    const notification = new Notification({ title: value.title as string, body: value.body as string })
    if (activeNotifications.size >= 64) {
      const oldest = activeNotifications.values().next().value!
      oldest.close(); activeNotifications.delete(oldest)
    }
    activeNotifications.add(notification)
    notification.once('click', () => {
      if (owner.isDestroyed()) {
        const target = createWindow()
        void target.loadURL(`${APP_URL}?task=${encodeURIComponent(value.taskId as string)}`).catch(error => reportFailure(error, 'boot', target))
      } else {
        if (owner.isMinimized()) owner.restore()
        owner.show(); owner.focus(); owner.webContents.send(IPC.openTask, value.taskId)
      }
      activeNotifications.delete(notification)
    })
    notification.once('close', () => activeNotifications.delete(notification))
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { activeNotifications.delete(notification); reject(new Error('系统通知未送达，请检查系统通知权限。')) }, 8000)
      notification.once('show', () => { clearTimeout(timer); resolve() })
      notification.once('failed', () => { clearTimeout(timer); activeNotifications.delete(notification); reject(new Error('系统未能显示通知，请检查通知权限及应用签名。')) })
      notification.show()
    })
  })
  openMain()
  app.on('activate', openMain)
  app.on('window-all-closed', () => { if (process.platform !== 'darwin' && !tray) app.quit() })
}

app.on('before-quit', event => {
  if (quitting) return
  event.preventDefault()
  quitting = true
  snapshotShortcut.dispose()
  setAutomationAwake(false)
  tray?.destroy()
  for (const notification of activeNotifications) notification.close()
  workspaceTools.dispose()
  void Promise.all([host?.stop(), serverBroker.close()]).then(() => app.quit(), error => { console.error(error); app.exit(1) })
})
if (claimDesktopSingleInstance(app, () => { mainWindow?.show(); mainWindow?.focus() })) {
  process.on('uncaughtException', error => reportFailure(error))
  void main().catch(error => reportFailure(error))
}
