import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { gt, prerelease, valid } from 'semver'
import type { LingUpdateChannel, LingUpdateState } from 'ling-desktop/runtime'
import { createMacInstallHandoff } from './application-updater-mac.ts'

interface UpdateInfo { readonly version: string; readonly releaseNotes?: unknown }
interface Cancellation { cancel(): void }
interface CheckResult { readonly updateInfo: UpdateInfo; readonly cancellationToken?: Cancellation }
type UpdateListener = (...args: unknown[]) => void

/** The narrow electron-updater boundary also keeps controller tests headless. */
export interface ApplicationUpdaterBackend {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  allowDowngrade: boolean
  allowPrerelease: boolean
  logger?: unknown
  channel: string | null
  checkForUpdates(): Promise<CheckResult | null>
  downloadUpdate(token?: Cancellation): Promise<string[]>
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void
  cancelInstall?(): void
  setFeedURL?(options: { provider: 'generic'; url: string; channel?: string; useMultipleRangeRequest?: boolean }): void
  on(event: string, listener: UpdateListener): unknown
  removeListener(event: string, listener: UpdateListener): unknown
}

interface UpdaterClock {
  now(): number
  setTimeout(callback: () => void, delay: number): unknown
  clearTimeout(handle: unknown): void
}

export interface ApplicationUpdaterOptions {
  readonly currentVersion: string
  readonly isPackaged: boolean
  readonly resourcesPath: string
  readonly home: string
  readonly onState: (state: LingUpdateState) => void
  /** Confirm and drain active work. False or rejection must never authorize installation. */
  readonly prepareInstall: () => Promise<boolean>
  readonly recoverInstall?: () => Promise<void>
  readonly configureFeed?: (updater: ApplicationUpdaterBackend, channel: LingUpdateChannel) => Promise<{ available: boolean; releaseNotes?: string } | void>
  readonly updater?: ApplicationUpdaterBackend
  readonly platform?: NodeJS.Platform
  readonly appImagePath?: string
  readonly clock?: UpdaterClock
  readonly initialDelayMs?: number
  readonly checkIntervalMs?: number
}

export interface ApplicationUpdater {
  get(): LingUpdateState
  check(): Promise<LingUpdateState>
  setChannel(channel: LingUpdateChannel): Promise<LingUpdateState>
  install(): Promise<LingUpdateState>
  start(): void
  dispose(): void
}

const realClock: UpdaterClock = {
  now: () => Date.now(),
  setTimeout(callback, delay) { const timer = setTimeout(callback, delay); timer.unref(); return timer },
  clearTimeout(handle) { clearTimeout(handle as ReturnType<typeof setTimeout>) },
}

function loadBackend(platform: NodeJS.Platform): ApplicationUpdaterBackend {
  const require = createRequire(import.meta.url)
  const backend = (require('electron-updater') as { autoUpdater: ApplicationUpdaterBackend & { emit(event: string, error: unknown): void } }).autoUpdater
  if (platform !== 'darwin') return backend
  const native = (require('electron') as { autoUpdater: Parameters<typeof createMacInstallHandoff>[0] }).autoUpdater
  const handoff = createMacInstallHandoff(native, error => backend.emit('error', error))
  return new Proxy(backend, {
    get(target, key) {
      if (key === 'quitAndInstall') return handoff.install
      if (key === 'cancelInstall') return handoff.cancel
      const value: unknown = Reflect.get(target, key)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

function releaseText(value: unknown): string | undefined {
  const raw = typeof value === 'string' ? value : Array.isArray(value)
    ? value.slice(0, 10).map(item => typeof item?.note === 'string' ? item.note : '').join('\n\n') : ''
  const text = raw.slice(0, 32_768)
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<\/?(?:p|div|br|li|h[1-6])\b[^>]*>/gi, '\n').replace(/<[^>]*>/g, '')
    .replace(/!?(?:\[([^\]]*)\])\([^)]*\)/g, '$1')
    .replace(/&(?:amp|lt|gt|quot|apos|nbsp);/g, entity => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&nbsp;': ' ' })[entity]!)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/\n{3,}/g, '\n\n').trim()
  return text ? text.slice(0, 6_000) : undefined
}

/** Downloads may happen unattended; installation always requires a fresh explicit handoff. */
export function createApplicationUpdater(options: ApplicationUpdaterOptions): ApplicationUpdater {
  const clock = options.clock ?? realClock
  const settingsPath = join(options.home, 'application-update.json')
  const defaultChannel: LingUpdateChannel = valid(options.currentVersion) && prerelease(options.currentVersion) ? 'preview' : 'stable'
  let channel = defaultChannel
  try {
    const saved: unknown = JSON.parse(readFileSync(settingsPath, 'utf8'))
    if (saved && typeof saved === 'object' && 'channel' in saved && (saved.channel === 'stable' || saved.channel === 'preview')) channel = saved.channel
  } catch { /* Missing or damaged preferences use the installed version's channel. */ }

  let updater: ApplicationUpdaterBackend | undefined
  let unavailable: string | undefined
  if (!options.isPackaged) unavailable = '开发模式不支持应用更新。'
  else if (!valid(options.currentVersion)) unavailable = '当前应用版本无效，无法检查更新。'
  else if ((options.platform ?? process.platform) === 'linux' && !(options.appImagePath ?? process.env.APPIMAGE))
    unavailable = '此 Linux 安装方式不支持应用内更新，请下载新安装包升级。'
  else {
    try {
      if (!statSync(join(options.resourcesPath, 'app-update.yml')).isFile()) throw new Error('missing configuration')
      const policy = JSON.parse(readFileSync(join(options.resourcesPath, 'ling-update-policy.json'), 'utf8')) as Record<string, unknown>
      if (policy.schemaVersion !== 1 || policy.enabled !== true || policy.provider !== 'github' || policy.owner !== 'aqcool'
        || policy.repo !== 'ling-desktop' || (policy.channel !== 'dev' && policy.channel !== 'latest')) throw new Error('update policy disabled')
      updater = options.updater ?? loadBackend(options.platform ?? process.platform)
    } catch { unavailable = '此安装包采用手动更新，请下载新安装包升级。' }
  }
  let state: LingUpdateState = { currentVersion: options.currentVersion, channel, phase: unavailable ? 'unavailable' : 'idle', ...(unavailable ? { message: unavailable } : {}) }
  let disposed = false, started = false, epoch = 0
  let timer: unknown
  let checkFlight: Promise<LingUpdateState> | undefined
  let installFlight: Promise<LingUpdateState> | undefined
  let recoveryFlight: Promise<void> | undefined
  let cancellation: Cancellation | undefined
  let downloaded: { version: string; channel: LingUpdateChannel } | undefined
  let installFailed = false
  let preparing = false
  let restartRequired = false
  let installAttempt = 0, recoveredAttempt = 0
  const get = (): LingUpdateState => ({ ...state, ...(state.progress ? { progress: { ...state.progress } } : {}) })
  const publish = (next: LingUpdateState) => {
    if (disposed) return
    state = next
    try { options.onState(get()) } catch { /* A closing window must not change update eligibility. */ }
  }
  const configure = () => {
    if (!updater) return
    updater.autoDownload = false
    updater.autoInstallOnAppQuit = false
    updater.logger = null
    updater.channel = channel === 'preview' ? 'dev' : 'latest'
    // electron-updater's channel setter enables downgrades, so this assignment must follow it.
    updater.allowDowngrade = false
    updater.allowPrerelease = channel === 'preview'
  }
  configure()
  const installationFailure = (): Promise<void> => {
    installFailed = true
    restartRequired = true
    updater?.cancelInstall?.()
    downloaded = undefined
    // A confirmation dialog can still be pending. Recovery must follow preparation's final side effects.
    if (preparing) {
      publish({ ...state, phase: 'error', message: '安装更新失败，等待当前准备操作结束。' })
      return Promise.resolve()
    }
    if (recoveredAttempt === installAttempt) return recoveryFlight ?? Promise.resolve()
    recoveredAttempt = installAttempt
    publish({ ...state, phase: 'error', message: options.recoverInstall ? '安装更新失败，正在恢复当前版本。' : '安装更新失败，请重新启动 LING 后重试。' })
    recoveryFlight = Promise.resolve().then(async () => {
      if (!options.recoverInstall || disposed) return
      try {
        await options.recoverInstall()
        publish({ ...state, message: '安装更新失败，已恢复当前版本。请重新启动 LING 后重试更新。' })
      } catch { publish({ ...state, message: '安装更新失败，恢复运行未完成。请手动重新启动 LING。' }) }
    }).finally(() => { recoveryFlight = undefined })
    return recoveryFlight
  }
  const onProgress: UpdateListener = value => {
    if (disposed || state.phase !== 'downloading' || !checkFlight || !value || typeof value !== 'object') return
    const progress = value as Record<string, unknown>
    const number = (key: string) => typeof progress[key] === 'number' && Number.isFinite(progress[key]) ? Math.max(0, progress[key]) : 0
    publish({ ...state, progress: { percent: Math.min(100, number('percent')), transferred: number('transferred'), total: number('total'), bytesPerSecond: number('bytesPerSecond') } })
  }
  // Check/download promises identify their own operation. Uncorrelated late events cannot authorize a package.
  const onError: UpdateListener = () => {
    if (!disposed && state.phase === 'installing') {
      void installationFailure()
    }
  }
  updater?.on('download-progress', onProgress)
  updater?.on('error', onError)

  const check = (): Promise<LingUpdateState> => {
    if (disposed || restartRequired || !updater || installFlight || recoveryFlight || downloaded) return Promise.resolve(get())
    if (checkFlight) return checkFlight
    const run = ++epoch
    const backend = updater
    const active = () => !disposed && run === epoch
    checkFlight = Promise.resolve().then(async () => {
      publish({ currentVersion: options.currentVersion, channel, phase: 'checking', lastCheckedAt: state.lastCheckedAt })
      try {
        configure()
        const feed = options.configureFeed ? await options.configureFeed(backend, channel) : undefined
        if (!active()) return get()
        if (feed?.available === false) {
          publish({ currentVersion: options.currentVersion, channel, phase: 'idle', lastCheckedAt: clock.now(), message: '当前已是此渠道的最新版本。' })
          return get()
        }
        const result = await backend.checkForUpdates()
        if (!active()) return get()
        const lastCheckedAt = clock.now()
        const info = result?.updateInfo
        if (!info || !valid(info.version) || !gt(info.version, options.currentVersion) || (channel === 'stable' && prerelease(info.version))) {
          publish({ currentVersion: options.currentVersion, channel, phase: 'idle', lastCheckedAt, message: '当前已是此渠道的最新版本。' })
          return get()
        }
        cancellation = result.cancellationToken
        publish({ currentVersion: options.currentVersion, channel, phase: 'downloading', version: info.version, releaseNotes: releaseText(info.releaseNotes ?? feed?.releaseNotes), lastCheckedAt })
        const files = await backend.downloadUpdate(cancellation)
        if (!active()) return get()
        if (files.length === 0) throw new Error('No verified update artifact')
        downloaded = { version: info.version, channel }
        publish({ ...state, phase: 'downloaded', progress: undefined, message: undefined })
      } catch {
        if (active()) {
          downloaded = undefined
          publish({ ...state, phase: 'error', progress: undefined, lastCheckedAt: clock.now(), message: state.phase === 'downloading'
            ? '下载更新失败，当前版本仍可继续使用。请稍后重试。' : '检查更新失败，请稍后重试。' })
        }
      } finally {
        cancellation = undefined
        checkFlight = undefined
      }
      return get()
    })
    return checkFlight
  }

  const setChannel = (next: LingUpdateChannel): Promise<LingUpdateState> => {
    if (disposed || restartRequired || !updater || next === channel) return Promise.resolve(get())
    if (next !== 'stable' && next !== 'preview') return Promise.resolve(get())
    if (checkFlight || installFlight || recoveryFlight || state.phase === 'installing') {
      publish({ ...state, message: '请等待当前更新操作完成后再切换渠道。' })
      return Promise.resolve(get())
    }
    const temporary = `${settingsPath}.${randomUUID()}.tmp`
    try {
      mkdirSync(options.home, { recursive: true })
      writeFileSync(temporary, JSON.stringify({ channel: next }) + '\n', { flag: 'wx', mode: 0o600 })
      renameSync(temporary, settingsPath)
    } catch {
      publish({ ...state, message: '无法保存更新渠道，请稍后重试。' })
      return Promise.resolve(get())
    } finally { try { rmSync(temporary, { force: true }) } catch { /* Best-effort removal after a failed settings write. */ } }
    channel = next
    ++epoch
    downloaded = undefined
    configure()
    publish({ currentVersion: options.currentVersion, channel, phase: 'idle', lastCheckedAt: state.lastCheckedAt })
    return check()
  }

  const install = (): Promise<LingUpdateState> => {
    if (installFlight) return installFlight
    if (disposed || !updater || !downloaded || downloaded.channel !== channel || state.phase !== 'downloaded') return Promise.resolve(get())
    const candidate = downloaded
    const backend = updater
    installFailed = false
    ++installAttempt
    installFlight = Promise.resolve().then(async () => {
      publish({ ...state, phase: 'installing', message: undefined })
      try {
        preparing = true
        let prepared: boolean
        try { prepared = await options.prepareInstall() }
        finally { preparing = false }
        if (disposed) return get()
        if (installFailed) { await installationFailure(); return get() }
        if (!prepared) { publish({ ...state, phase: 'downloaded' }); return get() }
        if (downloaded !== candidate || candidate.channel !== channel) throw new Error('Update changed during handoff')
        backend.autoInstallOnAppQuit = false
        backend.allowDowngrade = false
        backend.quitAndInstall(false, true)
        if (installFailed) await recoveryFlight
      } catch {
        if (!disposed) await installationFailure()
      } finally { installFlight = undefined }
      return get()
    })
    return installFlight
  }
  const schedule = (delay: number) => {
    if (disposed || !started || !updater) return
    timer = clock.setTimeout(() => {
      timer = undefined
      void check().finally(() => schedule(options.checkIntervalMs ?? 6 * 60 * 60 * 1_000))
    }, delay)
  }
  return {
    get, check, setChannel, install,
    start() { if (started || disposed || !updater) return; started = true; schedule(options.initialDelayMs ?? 20_000) },
    dispose() {
      if (disposed) return
      disposed = true
      ++epoch
      if (timer !== undefined) clock.clearTimeout(timer)
      cancellation?.cancel()
      if (updater) {
        updater.autoInstallOnAppQuit = false
        updater.cancelInstall?.()
        updater.removeListener('download-progress', onProgress)
        updater.removeListener('error', onError)
      }
    },
  }
}
