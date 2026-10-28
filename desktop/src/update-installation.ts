/** Keep installation behind a fresh user decision and a quiescent Host. */
export interface UpdateInstallationHooks {
  tasks(action: 'inspect' | 'lock' | 'unlock'): Promise<boolean>
  hasTransfers(): boolean
  validateState?(freeze: boolean): Promise<boolean>
  releaseState?(): void
  confirm(): Promise<boolean>
  busy(): Promise<void>
  saveState(): Promise<void>
  stop(): Promise<void>
  recover(): Promise<void>
}

export class UpdateInstallation {
  private stopAttempted = false
  constructor(private readonly hooks: UpdateInstallationHooks) {}

  async prepare(): Promise<boolean> {
    if (await this.hooks.tasks('inspect') || this.hooks.hasTransfers()) {
      await this.hooks.busy()
      return false
    }
    if (this.hooks.validateState && !await this.hooks.validateState(false)) return false
    if (!await this.hooks.confirm()) return false
    let stopped = false
    try {
      // Lock before draining, then recheck: work may have started in the dialog.
      if (await this.hooks.tasks('lock') || this.hooks.hasTransfers()) {
        await this.hooks.busy()
        return false
      }
      if (this.hooks.validateState && !await this.hooks.validateState(true)) return false
      await this.hooks.saveState()
      this.stopAttempted = true
      await this.hooks.stop()
      stopped = true
      return true
    } finally {
      // A timed-out lock request may still have reached the Host.
      if (!stopped) {
        try { await this.hooks.tasks('unlock') } finally { this.hooks.releaseState?.() }
      }
    }
  }

  async recover(): Promise<void> {
    if (!this.stopAttempted) return
    await this.hooks.recover()
    this.stopAttempted = false
  }
}
