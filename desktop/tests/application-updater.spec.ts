import { EventEmitter } from 'node:events'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApplicationUpdater, type ApplicationUpdater, type ApplicationUpdaterBackend, type ApplicationUpdaterOptions } from '../src/application-updater.ts'
import { createMacInstallHandoff } from '../src/application-updater-mac.ts'
import { UpdateInstallation } from '../src/update-installation.ts'
import { AppUpdater } from 'electron-updater/out/AppUpdater.js'

class FakeUpdater extends EventEmitter implements ApplicationUpdaterBackend {
  autoDownload = true
  autoInstallOnAppQuit = true
  allowDowngrade = true
  allowPrerelease = false
  logger: unknown
  private selected = 'latest'
  get channel() { return this.selected }
  set channel(value: string) { this.selected = value; this.allowDowngrade = true }
  info: { version: string; releaseNotes?: unknown } = { version: '1.2.0' }
  token = { cancel: vi.fn() }
  checkForUpdates = vi.fn(async () => ({ updateInfo: this.info, cancellationToken: this.token }))
  downloadUpdate = vi.fn(async () => ['/verified-update.zip'])
  quitAndInstall = vi.fn((_silent?: boolean, _forceRun?: boolean) => {})
}

const controllers: ApplicationUpdater[] = []
const directories: string[] = []
function fixture(overrides: Partial<ApplicationUpdaterOptions> = {}, configured = true) {
  const directory = mkdtempSync(join(tmpdir(), 'ling-update-test-'))
  directories.push(directory)
  if (configured) {
    writeFileSync(join(directory, 'app-update.yml'), 'provider: github\n')
    writeFileSync(join(directory, 'ling-update-policy.json'), JSON.stringify({ schemaVersion: 1, enabled: true, provider: 'github', owner: 'aqcool', repo: 'ling-desktop', channel: 'latest' }))
  }
  const backend = new FakeUpdater()
  const onState = vi.fn()
  const prepareInstall = vi.fn(async () => true)
  const options: ApplicationUpdaterOptions = { currentVersion: '1.1.0', isPackaged: true, platform: 'darwin', resourcesPath: directory, home: directory,
    updater: backend, onState, prepareInstall, ...overrides }
  const controller = createApplicationUpdater(options)
  controllers.push(controller)
  return { controller, backend, onState, prepareInstall, options, directory }
}
afterEach(() => {
  for (const controller of controllers.splice(0)) controller.dispose()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
  vi.useRealTimers()
})

describe('application update lifecycle', () => {
  it.each([false, true])('is unavailable without a production update configuration (packaged=%s)', isPackaged => {
    const { controller, backend } = fixture({ isPackaged }, false)
    expect(controller.get().phase).toBe('unavailable')
    controller.start()
    void controller.check()
    expect(backend.checkForUpdates).not.toHaveBeenCalled()
    expect(backend.quitAndInstall).not.toHaveBeenCalled()
  })

  it('defaults prerelease installations to dev and stable installations to latest, always forbidding downgrade', () => {
    const preview = fixture({ currentVersion: '0.0.0-dev.11' })
    const stable = fixture()
    expect(preview.controller.get().channel).toBe('preview')
    expect(preview.backend.channel).toBe('dev')
    expect(preview.backend.allowPrerelease).toBe(true)
    expect(stable.backend.channel).toBe('latest')
    expect(stable.backend.allowPrerelease).toBe(false)
    for (const { backend } of [preview, stable]) {
      expect(backend.allowDowngrade).toBe(false)
      expect(backend.autoDownload).toBe(false)
      expect(backend.autoInstallOnAppQuit).toBe(false)
      expect(backend.logger).toBeNull()
    }
  })

  it('disables unsigned local packages and Linux packages without AppImage support', () => {
    const original = fixture()
    writeFileSync(join(original.directory, 'ling-update-policy.json'), JSON.stringify({ schemaVersion: 1, enabled: false }))
    const unsigned = createApplicationUpdater(original.options)
    controllers.push(unsigned)
    expect(unsigned.get().phase).toBe('unavailable')
    const linux = fixture({ platform: 'linux', appImagePath: '' })
    expect(linux.controller.get()).toMatchObject({ phase: 'unavailable', message: expect.stringContaining('Linux') })
  })

  it('coalesces duplicate checks and reports bounded download progress and checked time', async () => {
    const download = Promise.withResolvers<string[]>()
    const { controller, backend } = fixture({ clock: { now: () => 1234, setTimeout: () => 0, clearTimeout: () => {} } })
    backend.downloadUpdate.mockReturnValue(download.promise)
    const first = controller.check(), second = controller.check()
    expect(first).toBe(second)
    await Promise.resolve(); await Promise.resolve()
    expect(controller.get()).toMatchObject({ phase: 'downloading', version: '1.2.0', lastCheckedAt: 1234 })
    backend.emit('download-progress', { percent: 150, transferred: 8, total: 16, bytesPerSecond: 4 })
    expect(controller.get().progress).toEqual({ percent: 100, transferred: 8, total: 16, bytesPerSecond: 4 })
    download.resolve(['/verified-update.zip'])
    expect((await first).phase).toBe('downloaded')
    expect(backend.checkForUpdates).toHaveBeenCalledTimes(1)
    expect(backend.downloadUpdate).toHaveBeenCalledTimes(1)
    expect(backend.quitAndInstall).not.toHaveBeenCalled()
  })

  it.each(['1.0.0', '1.1.0', '1.2.0-dev.1', 'not-a-version'])('refuses stable-channel download of %s', async version => {
    const { controller, backend } = fixture()
    backend.info = { version }
    expect((await controller.check()).phase).toBe('idle')
    expect(backend.downloadUpdate).not.toHaveBeenCalled()
    await controller.install()
    expect(backend.quitAndInstall).not.toHaveBeenCalled()
  })

  it('turns release notes into bounded plain text', async () => {
    const { controller, backend } = fixture()
    backend.info.releaseNotes = [{ note: '<p>Changes</p><script>doBadThing()</script>[Read more](https://example.com)\n' + 'a'.repeat(7_000) }]
    const state = await controller.check()
    expect(state.releaseNotes).toContain('Changes\nRead more')
    expect(state.releaseNotes).not.toMatch(/<|doBadThing|https:\/\//)
    expect(state.releaseNotes?.length).toBeLessThanOrEqual(6_000)
  })

  it('keeps the installed version after a failed download and ignores a late downloaded event', async () => {
    const { controller, backend } = fixture()
    backend.downloadUpdate.mockRejectedValue(new Error('https://secret.example/?token=private /Users/private/build'))
    const state = await controller.check()
    expect(state).toMatchObject({ currentVersion: '1.1.0', phase: 'error' })
    expect(state.message).not.toMatch(/secret|token|Users|private/)
    backend.emit('update-downloaded', { version: '1.2.0' })
    await controller.install()
    expect(controller.get().phase).toBe('error')
    expect(backend.quitAndInstall).not.toHaveBeenCalled()
  })

  it('uses the real updater download wrapper: a Mac staging callback returning [] still yields the ZIP path', async () => {
    const { directory } = fixture()
    const zip = join(directory, 'ling.zip')
    writeFileSync(zip, 'cached fixture')
    const done = vi.fn(async () => [])
    const info = { version: '1.2.0', files: [{ url: 'ling.zip' }] }
    const backend = {
      updateInfoAndProvider: { info, provider: {} }, downloadPromise: null,
      _logger: { info() {}, warn() {} }, listenerCount: () => 0,
      computeRequestHeaders: () => null,
      getOrCreateDownloadHelper: async () => ({ cacheDirForPendingUpdate: directory, cacheDir: directory,
        validateDownloadedPath: async () => zip, setDownloadedFile: async () => {} }),
      doDownloadUpdate(downloadUpdateOptions: unknown) {
        return (AppUpdater.prototype as unknown as { executeDownload(options: unknown): Promise<unknown> }).executeDownload.call(this, {
          fileExtension: 'zip', fileInfo: { url: new URL('https://example.invalid/ling.zip'), info: { url: 'ling.zip' } },
          downloadUpdateOptions, done,
        })
      },
    }
    const files = await AppUpdater.prototype.downloadUpdate.call(backend as unknown as AppUpdater)
    expect(done).toHaveBeenCalledTimes(1)
    expect(files).toEqual([zip])
  })

  it('does not install on ordinary quit or disposal even with a downloaded package', async () => {
    const { controller, backend, prepareInstall } = fixture()
    await controller.check()
    expect(backend.autoInstallOnAppQuit).toBe(false)
    controller.dispose()
    await controller.install()
    expect(prepareInstall).not.toHaveBeenCalled()
    expect(backend.quitAndInstall).not.toHaveBeenCalled()
    expect(backend.autoInstallOnAppQuit).toBe(false)
  })

  it('coalesces install clicks and calls the installer only after a successful handoff', async () => {
    const handoff = Promise.withResolvers<boolean>()
    const { controller, backend, prepareInstall } = fixture()
    await controller.check()
    prepareInstall.mockReturnValue(handoff.promise)
    const first = controller.install(), second = controller.install()
    expect(first).toBe(second)
    await Promise.resolve()
    expect(controller.get().phase).toBe('installing')
    expect(backend.quitAndInstall).not.toHaveBeenCalled()
    handoff.resolve(true)
    await first
    await controller.install()
    expect(prepareInstall).toHaveBeenCalledTimes(1)
    expect(backend.quitAndInstall).toHaveBeenCalledExactlyOnceWith(false, true)
  })

  it('keeps the downloaded package when the user declines, and can ask again', async () => {
    const { controller, backend, prepareInstall } = fixture()
    await controller.check()
    prepareInstall.mockResolvedValueOnce(false)
    expect((await controller.install()).phase).toBe('downloaded')
    expect(backend.quitAndInstall).not.toHaveBeenCalled()
    await controller.install()
    expect(backend.quitAndInstall).toHaveBeenCalledTimes(1)
  })

  it.each(['prepare', 'installer', 'event'])('does not retry or fall through to install after %s failure', async failure => {
    const { controller, backend, prepareInstall } = fixture()
    await controller.check()
    if (failure === 'prepare') prepareInstall.mockRejectedValue(new Error('secret'))
    if (failure === 'installer') backend.quitAndInstall.mockImplementation(() => { throw new Error('secret') })
    if (failure === 'event') prepareInstall.mockImplementation(async () => { backend.emit('error', new Error('secret')); return true })
    const state = await controller.install()
    expect(state.phase).toBe('error')
    expect(state.message).not.toContain('secret')
    const calls = backend.quitAndInstall.mock.calls.length
    expect(calls).toBe(failure === 'installer' ? 1 : 0)
    await controller.install()
    expect(backend.quitAndInstall).toHaveBeenCalledTimes(calls)
    expect(backend.autoInstallOnAppQuit).toBe(false)
  })

  it('recovers once after a late installation error and prevents a second update before restart', async () => {
    const recovery = Promise.withResolvers<void>()
    const recoverInstall = vi.fn(() => recovery.promise)
    const { controller, backend } = fixture({ recoverInstall })
    await controller.check()
    await controller.install()
    backend.emit('error', new Error('native install failed with secret path'))
    backend.emit('error', new Error('duplicate native error'))
    await Promise.resolve()
    expect(recoverInstall).toHaveBeenCalledTimes(1)
    expect(controller.get().phase).toBe('error')
    recovery.resolve()
    await recovery.promise; await Promise.resolve()
    await controller.check()
    await controller.setChannel('preview')
    await controller.install()
    expect(backend.checkForUpdates).toHaveBeenCalledTimes(1)
    expect(backend.quitAndInstall).toHaveBeenCalledTimes(1)
    expect(controller.get().channel).toBe('stable')
  })

  it('recovers after preparation finishes when an error arrives while the confirmation dialog is open', async () => {
    const confirm = Promise.withResolvers<boolean>()
    const events: string[] = []
    const installation = new UpdateInstallation({
      tasks: async action => { events.push(action); return false }, hasTransfers: () => false,
      confirm: () => confirm.promise, busy: async () => {}, saveState: async () => { events.push('save') },
      stop: async () => { events.push('stop') }, recover: async () => { events.push('recover') },
    })
    const { controller, backend } = fixture({ prepareInstall: () => installation.prepare(), recoverInstall: () => installation.recover() })
    await controller.check()
    const installing = controller.install()
    await Promise.resolve(); await Promise.resolve()
    backend.emit('error', new Error('failure while confirming'))
    expect(events).toEqual(['inspect'])
    confirm.resolve(true)
    await installing
    expect(events).toEqual(['inspect', 'lock', 'save', 'stop', 'recover'])
    expect(backend.quitAndInstall).not.toHaveBeenCalled()
    expect(controller.get().phase).toBe('error')
  })

  it('skips unavailable feeds and uses release discovery notes when metadata omits them', async () => {
    const configureFeed = vi.fn(async () => ({ available: false, releaseNotes: '<p>Release notes</p>' }))
    const { controller, backend } = fixture({ configureFeed })
    expect((await controller.check()).phase).toBe('idle')
    expect(backend.checkForUpdates).not.toHaveBeenCalled()
    configureFeed.mockResolvedValue({ available: true, releaseNotes: '<p>Release notes</p>' })
    expect((await controller.check()).releaseNotes).toBe('Release notes')
  })

  it('forbids channel changes during a download', async () => {
    const download = Promise.withResolvers<string[]>()
    const { controller, backend, directory } = fixture()
    backend.downloadUpdate.mockReturnValue(download.promise)
    const checking = controller.check()
    await Promise.resolve(); await Promise.resolve()
    const state = await controller.setChannel('preview')
    expect(state).toMatchObject({ channel: 'stable', phase: 'downloading' })
    expect(backend.channel).toBe('latest')
    expect(() => readFileSync(join(directory, 'application-update.json'))).toThrow()
    download.resolve(['/verified-update.zip'])
    await checking
  })

  it('persists a new channel and invalidates the previous package before checking it', async () => {
    const { controller, backend, directory, options } = fixture()
    await controller.check()
    const next = Promise.withResolvers<Awaited<ReturnType<FakeUpdater['checkForUpdates']>>>()
    backend.checkForUpdates.mockReturnValue(next.promise)
    const switching = controller.setChannel('preview')
    await Promise.resolve()
    backend.emit('update-downloaded', { version: '1.2.0' })
    await controller.install()
    expect(backend.quitAndInstall).not.toHaveBeenCalled()
    expect(controller.get()).toMatchObject({ channel: 'preview', phase: 'checking' })
    expect(controller.get().version).toBeUndefined()
    expect(backend.channel).toBe('dev')
    expect(backend.allowDowngrade).toBe(false)
    expect(JSON.parse(readFileSync(join(directory, 'application-update.json'), 'utf8'))).toEqual({ channel: 'preview' })
    next.resolve({ updateInfo: { version: '1.1.0' }, cancellationToken: backend.token })
    await switching
    await controller.install()
    expect(backend.quitAndInstall).not.toHaveBeenCalled()
    controller.dispose()
    const restored = createApplicationUpdater({ ...options, updater: new FakeUpdater() })
    controllers.push(restored)
    expect(restored.get().channel).toBe('preview')
  })

  it('discards late results and cancels an in-progress download on disposal', async () => {
    const download = Promise.withResolvers<string[]>()
    const { controller, backend, onState } = fixture()
    backend.downloadUpdate.mockReturnValue(download.promise)
    const checking = controller.check()
    await Promise.resolve(); await Promise.resolve()
    controller.dispose()
    const count = onState.mock.calls.length
    download.resolve(['/verified-update.zip'])
    await checking
    backend.emit('update-downloaded', { version: '1.2.0' })
    await controller.install()
    expect(backend.token.cancel).toHaveBeenCalledTimes(1)
    expect(onState).toHaveBeenCalledTimes(count)
    expect(backend.quitAndInstall).not.toHaveBeenCalled()
  })

  it('starts one periodic check timer and stops it on disposal', async () => {
    vi.useFakeTimers()
    const { controller, backend } = fixture({ initialDelayMs: 50, checkIntervalMs: 100 })
    backend.info.version = '1.1.0'
    controller.start(); controller.start()
    await vi.advanceTimersByTimeAsync(49)
    expect(backend.checkForUpdates).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(backend.checkForUpdates).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(100)
    expect(backend.checkForUpdates).toHaveBeenCalledTimes(2)
    controller.dispose()
    await vi.advanceTimersByTimeAsync(1000)
    expect(backend.checkForUpdates).toHaveBeenCalledTimes(2)
  })
})

describe('macOS native update handoff', () => {
  function nativeFixture() {
    const native = Object.assign(new EventEmitter(), { checkForUpdates: vi.fn(), quitAndInstall: vi.fn() })
    const fail = vi.fn()
    const handoff = createMacInstallHandoff(native, fail)
    return { native, fail, handoff }
  }
  it('waits for native staging, then installs exactly once', () => {
    const { native, handoff } = nativeFixture()
    handoff.install(); handoff.install()
    expect(native.checkForUpdates).toHaveBeenCalledTimes(1)
    expect(native.quitAndInstall).not.toHaveBeenCalled()
    native.emit('update-downloaded')
    native.emit('update-downloaded')
    expect(native.quitAndInstall).toHaveBeenCalledTimes(1)
  })
  it.each(['error', 'dispose'])('revokes installation on %s so late downloaded events cannot quit', reason => {
    const { native, handoff } = nativeFixture()
    handoff.install()
    if (reason === 'error') native.emit('error', new Error('native failure'))
    else handoff.cancel()
    native.emit('update-downloaded')
    expect(native.quitAndInstall).not.toHaveBeenCalled()
    expect(native.listenerCount('update-downloaded')).toBe(0)
  })
  it('reports a synchronous native failure and removes the armed callback', () => {
    const { native, handoff, fail } = nativeFixture()
    native.checkForUpdates.mockImplementation(() => { throw new Error('native failure') })
    handoff.install()
    native.emit('update-downloaded')
    expect(fail).toHaveBeenCalledTimes(1)
    expect(native.quitAndInstall).not.toHaveBeenCalled()
  })
  it('times out native staging and ignores completion after the deadline', async () => {
    vi.useFakeTimers()
    const { native, handoff, fail } = nativeFixture()
    handoff.install()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(fail).toHaveBeenCalledTimes(1)
    native.emit('update-downloaded')
    expect(native.quitAndInstall).not.toHaveBeenCalled()
    expect(native.listenerCount('update-downloaded')).toBe(0)
  })
})
