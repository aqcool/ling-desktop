import { snapshotShortcuts } from 'ling-desktop/runtime'

/** One OS registration, owned by a trusted application window. */
export class SnapshotShortcut {
  private key = ''
  private owner?: number
  private callback?: () => void
  constructor(private readonly native: { register(key: string, callback: () => void): boolean; unregister(key: string): void }) {}
  set(owner: number, value: unknown, callback: () => void): void {
    if (typeof value !== 'string' || !snapshotShortcuts.some(key => key === value)) throw new Error('快照快捷键无效。')
    if (!value) { this.clearOwner(owner); return }
    if (value !== this.key) {
      if (!this.native.register(value, () => this.callback?.())) throw new Error('快捷键已被占用，请选择其他组合。')
      if (this.key) this.native.unregister(this.key)
      this.key = value
    }
    this.owner = owner; this.callback = callback
  }
  clearOwner(owner: number): void { if (owner === this.owner) this.dispose() }
  dispose(): void {
    if (this.key) this.native.unregister(this.key)
    this.key = ''; this.owner = undefined; this.callback = undefined
  }
}
