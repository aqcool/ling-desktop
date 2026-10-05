import { describe, expect, it, vi } from 'vitest'
import { DesktopFailureRecovery, parseRendererFailure, type RecoveryNotice } from '../src/failure-recovery.ts'

function fixture() {
  const window = { id: 10, isDestroyed: vi.fn(() => false), reload: vi.fn() }
  const ports = {
    version: '0.0.0-test', platform: 'darwin', arch: 'arm64', home: '/Users/test',
    available: vi.fn(() => true), show: vi.fn(async (_notice: RecoveryNotice) => 2),
    copy: vi.fn(), restart: vi.fn(), failed: vi.fn(),
  }
  return { recovery: new DesktopFailureRecovery(ports), ports, window }
}

describe('native desktop failure recovery', () => {
  it('distinguishes initial load failures from runtime failures and reloads only the failed window', async () => {
    const { recovery, ports, window } = fixture()
    ports.show.mockResolvedValueOnce(0)
    await recovery.report('preload', new Error('cannot load preload'), window)
    expect(ports.show.mock.calls[0]![0]).toMatchObject({ message: '当前窗口加载失败', buttons: ['重新加载窗口', '复制诊断信息', '稍后'] })
    expect(window.reload).toHaveBeenCalledOnce()
    expect(ports.restart).not.toHaveBeenCalled()
    recovery.ready(window)
    await recovery.report('renderer', new Error('Renderer: crashed'), window)
    expect(ports.show.mock.calls[1]![0]).toMatchObject({ message: '当前窗口发生错误' })
    expect(ports.show.mock.calls[1]![0].detail).toContain('后台任务继续运行')
  })

  it('coalesces overlapping failures and suppresses repeated notices until another navigation', async () => {
    const { recovery, ports, window } = fixture()
    let resolve!: (response: number) => void
    ports.show.mockImplementationOnce(() => new Promise<number>(value => { resolve = value }))
    const first = recovery.report('renderer', new Error('crashed'), window)
    const duplicate = recovery.report('boot', new Error('consequential load failure'), window)
    expect(duplicate).toBe(first)
    expect(ports.show).toHaveBeenCalledOnce()
    resolve(2)
    await first
    await recovery.report('preload', new Error('another report'), window)
    expect(ports.show).toHaveBeenCalledOnce()
    recovery.loading(window)
    await recovery.report('boot', new Error('reload failed'), window)
    expect(ports.show).toHaveBeenCalledTimes(2)
  })

  it('copies bounded diagnostics and keeps recovery available without automatically reloading', async () => {
    const { recovery, ports, window } = fixture()
    recovery.ready(window)
    ports.show.mockResolvedValueOnce(1).mockResolvedValueOnce(2)
    await recovery.report('renderer', new Error('password="local secret" /Users/test/app.ts'), window)
    const diagnostic = ports.copy.mock.calls[0]![0]
    expect(diagnostic).toContain('LING 0.0.0-test')
    expect(diagnostic).toContain('darwin arm64')
    expect(diagnostic).toContain('Phase: runtime')
    expect(diagnostic).toContain('~/app.ts')
    expect(diagnostic).not.toContain('local secret')
    expect(ports.show.mock.calls[1]![0].detail).toContain('诊断信息已复制')
    expect(window.reload).not.toHaveBeenCalled()
    expect(ports.restart).not.toHaveBeenCalled()
  })

  it('provides a manual application restart for a Host outage without resubmitting tasks', async () => {
    const { recovery, ports, window } = fixture()
    recovery.ready(window)
    ports.show.mockResolvedValueOnce(0)
    await recovery.report('host', new Error('Host exited'))
    expect(ports.show.mock.calls[0]![0]).toMatchObject({ message: '本地服务已中断' })
    expect(ports.show.mock.calls[0]![0].detail).toContain('中断的任务需要手动继续')
    expect(ports.restart).toHaveBeenCalledOnce()
    expect(window.reload).not.toHaveBeenCalled()
    await recovery.report('boot', new Error('Host is unavailable'), window)
    expect(ports.show).toHaveBeenCalledOnce()
  })

  it('does not mislabel Host startup or initial application failures as runtime crashes', async () => {
    const first = fixture()
    await first.recovery.report('host', new Error('missing bundle'))
    expect(first.ports.show.mock.calls[0]![0].message).toBe('本地服务启动失败')
    const second = fixture()
    await second.recovery.report('main', new Error('main setup failed'))
    expect(second.ports.show.mock.calls[0]![0].message).toBe('灵创启动失败')
  })

  it('keeps failure state per window and ignores recovery after closing or quitting', async () => {
    const { recovery, ports, window } = fixture()
    recovery.ready(window)
    await recovery.report('renderer', new Error('first failure'), window)
    const other = { ...window, id: 11 }
    await recovery.report('renderer', new Error('second failure'), other)
    expect(ports.show).toHaveBeenCalledTimes(2)
    expect(ports.show.mock.calls[1]![0].message).toBe('当前窗口加载失败')
    recovery.loading(window)
    ports.show.mockImplementationOnce(async () => { window.isDestroyed.mockReturnValue(true); return 0 })
    await recovery.report('renderer', new Error('late failure'), window)
    expect(window.reload).not.toHaveBeenCalled()
    ports.available.mockReturnValue(false)
    recovery.reload(other)
    await recovery.report('main', new Error('during shutdown'))
    expect(ports.show).toHaveBeenCalledTimes(3)
    expect(ports.restart).not.toHaveBeenCalled()
  })

  it('handles failed native notices without leaving a rejected recovery promise', async () => {
    const { recovery, ports, window } = fixture()
    ports.show.mockRejectedValueOnce(new Error('dialog unavailable'))
    await expect(recovery.report('renderer', new Error('failure'), window)).resolves.toBeUndefined()
    expect(ports.failed).toHaveBeenCalledOnce()
  })

  it('still offers recovery if copying the native diagnostic fails', async () => {
    const { recovery, ports, window } = fixture()
    ports.copy.mockImplementationOnce(() => { throw new Error('clipboard unavailable') })
    ports.show.mockResolvedValueOnce(1).mockResolvedValueOnce(0)
    await recovery.report('renderer', new Error('crashed'), window)
    expect(ports.show.mock.calls[1]![0].detail).toContain('复制诊断信息失败')
    expect(window.reload).toHaveBeenCalledOnce()
  })

  it('validates untrusted diagnostic IPC payloads and excludes arbitrary properties', () => {
    expect(parseRendererFailure({ message: 'failure', stack: 'stack', componentStack: 'at App', env: { token: 'secret' } })).toEqual({ message: 'failure', stack: 'stack', componentStack: 'at App' })
    for (const payload of [null, [], 'error', { message: 3 }, { message: 'x'.repeat(4097) }, { message: 'x', stack: {} }, { message: 'x', componentStack: 'x'.repeat(4097) }]) {
      expect(() => parseRendererFailure(payload)).toThrow('Invalid renderer failure')
    }
  })
})
