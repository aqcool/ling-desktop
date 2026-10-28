interface NativeUpdater {
  on(event: string, listener: (...args: unknown[]) => void): unknown
  removeListener(event: string, listener: (...args: unknown[]) => void): unknown
  checkForUpdates(): void
  quitAndInstall(): void
}

/** Squirrel preparation is asynchronous; a failed handoff must revoke its eventual quit callback. */
export function createMacInstallHandoff(native: NativeUpdater, fail: (error: unknown) => void, timeoutMs = 60_000) {
  let armed = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const cancel = () => {
    armed = false
    clearTimeout(timer)
    timer = undefined
    native.removeListener('update-downloaded', completed)
    native.removeListener('error', cancel)
  }
  const completed = () => {
    if (!armed) return
    cancel()
    try { native.quitAndInstall() } catch (error) { fail(error) }
  }
  return {
    cancel,
    install() {
      if (armed) return
      armed = true
      native.on('update-downloaded', completed)
      native.on('error', cancel)
      timer = setTimeout(() => { cancel(); fail(new Error('Native update preparation timed out')) }, timeoutMs)
      timer.unref?.()
      try { native.checkForUpdates() } catch (error) { cancel(); fail(error) }
    },
  }
}
