import { redactDiagnostic, type LingRendererFailure } from 'ling-desktop/runtime'

export type FailureSource = 'main' | 'host' | 'renderer' | 'preload' | 'boot'
export interface RecoveryWindow {
  readonly id: number
  isDestroyed(): boolean
  reload(): void
}
export interface RecoveryNotice {
  readonly title: string
  readonly message: string
  readonly detail: string
  readonly buttons: string[]
}
interface RecoveryPorts {
  readonly version: string
  readonly platform: string
  readonly arch: string
  readonly home: string
  available(): boolean
  show(notice: RecoveryNotice, window?: RecoveryWindow): Promise<number>
  copy(text: string): void
  restart(): void
  failed(error: unknown): void
}

export function parseRendererFailure(value: unknown): LingRendererFailure {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid renderer failure')
  const candidate = value as Record<string, unknown>
  if (typeof candidate.message !== 'string' || candidate.message.length > 4096
    || (candidate.stack !== undefined && (typeof candidate.stack !== 'string' || candidate.stack.length > 8192))
    || (candidate.componentStack !== undefined && (typeof candidate.componentStack !== 'string' || candidate.componentStack.length > 4096))) {
    throw new Error('Invalid renderer failure')
  }
  return { message: candidate.message, stack: candidate.stack as string | undefined, componentStack: candidate.componentStack as string | undefined }
}

/** Native recovery is usable even when Chromium or the preload cannot render any UI. */
export class DesktopFailureRecovery {
  private readonly readyWindows = new Set<number>()
  private readonly shown = new Set<string>()
  private readonly pending = new Map<string, Promise<void>>()
  private hostFailed = false
  private started = false
  constructor(private readonly ports: RecoveryPorts) {}

  ready(window: RecoveryWindow) { this.readyWindows.add(window.id); this.started = true }
  loading(window: RecoveryWindow) { this.shown.delete(`window:${window.id}`) }
  closed(window: RecoveryWindow) { this.readyWindows.delete(window.id); this.shown.delete(`window:${window.id}`) }
  get hasHostFailure() { return this.hostFailed }

  diagnostic(source: FailureSource, failure: LingRendererFailure, window?: RecoveryWindow): string {
    return redactDiagnostic([
      `LING ${this.ports.version}`,
      `Platform: ${this.ports.platform} ${this.ports.arch}`,
      `Time: ${new Date().toISOString()}`,
      `Source: ${source}`,
      `Phase: ${(window ? this.readyWindows.has(window.id) : this.started) ? 'runtime' : 'startup'}`,
      failure.stack ?? failure.message,
      ...(failure.componentStack ? [`Component: ${failure.componentStack}`] : []),
    ].join('\n'), this.ports.home)
  }

  copy(failure: LingRendererFailure, window: RecoveryWindow) {
    this.ports.copy(this.diagnostic('renderer', failure, window))
  }

  reload(window: RecoveryWindow) {
    if (!this.ports.available() || window.isDestroyed()) return
    this.loading(window)
    window.reload()
  }

  report(source: FailureSource, error: unknown, window?: RecoveryWindow, extra?: LingRendererFailure): Promise<void> {
    if (!this.ports.available() || window?.isDestroyed()) return Promise.resolve()
    // Failed boot is a consequence of the already-reported Host outage.
    if (source === 'boot' && this.hostFailed) return Promise.resolve()
    if (source === 'host') this.hostFailed = true
    const key = window && source !== 'host' && source !== 'main' ? `window:${window.id}` : 'application'
    const pending = this.pending.get(key)
    if (pending) return pending
    if (this.shown.has(key)) return Promise.resolve()
    this.shown.add(key)
    const failure = extra ?? {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    }
    const operation = this.present(source, failure, window).catch(error => this.ports.failed(error)).finally(() => this.pending.delete(key))
    this.pending.set(key, operation)
    return operation
  }

  private async present(source: FailureSource, failure: LingRendererFailure, window?: RecoveryWindow) {
    const runtime = window ? this.readyWindows.has(window.id) : this.started
    const restart = source === 'host' || source === 'main' || !window
    const message = source === 'host' ? runtime ? '本地服务已中断' : '本地服务启动失败'
      : restart ? runtime ? '灵创运行中发生错误' : '灵创启动失败'
      : runtime ? '当前窗口发生错误' : '当前窗口加载失败'
    const detail = restart
      ? '重新启动后可查看已保存的会话。中断的任务需要手动继续；未保存的输入与编辑内容可能丢失。'
      : '重新加载只刷新当前窗口，后台任务继续运行，不会重新发送消息。未保存的输入与编辑内容可能丢失。'
    const diagnostic = this.diagnostic(source, failure, window)
    let status = ''
    while (this.ports.available() && !window?.isDestroyed()) {
      const response = await this.ports.show({ title: '灵创', message,
        detail: `${detail}\n\n${status ? `${status}\n\n` : ''}${redactDiagnostic(failure.message, this.ports.home).split('\n')[0]?.slice(0, 300) ?? ''}`,
        buttons: [restart ? '重新启动应用' : '重新加载窗口', '复制诊断信息', '稍后'],
      }, window)
      if (!this.ports.available() || window?.isDestroyed()) return
      if (response === 1) {
        try { this.ports.copy(diagnostic); status = '诊断信息已复制。' }
        catch (error) { this.ports.failed(error); status = '复制诊断信息失败，请尝试重新加载或重新启动应用。' }
        continue
      }
      if (response === 0) {
        if (restart) this.ports.restart()
        else this.reload(window!)
      }
      return
    }
  }
}
