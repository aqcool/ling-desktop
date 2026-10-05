// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RendererBoundary } from '../src/ui/RendererBoundary.js'
import { redactDiagnostic, rendererFailure } from '../src/runtime/diagnostics.js'

let container: HTMLDivElement, root: Root
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.spyOn(console, 'error').mockImplementation(() => {})
  container = document.createElement('div'); document.body.append(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount()); container.remove()
  delete window.__LING_RECOVERY__
  vi.restoreAllMocks(); vi.unstubAllGlobals()
})
function Broken(): never { throw new Error('render failure api_key="test-secret"') }
function bridge() {
  const value = { ready: vi.fn(async () => {}), report: vi.fn(async () => {}), copy: vi.fn(async () => {}), reload: vi.fn(async () => {}) }
  window.__LING_RECOVERY__ = value
  return value
}
function click(text: string) {
  const button = [...container.querySelectorAll('button')].find(value => value.textContent === text)!
  expect(button).toBeDefined()
  act(() => button.click())
}

describe('LING rendering failure boundary', () => {
  it('renders a usable initial-failure page, reports once, and copies through the native bridge', async () => {
    const native = bridge()
    act(() => root.render(<RendererBoundary><Broken /></RendererBoundary>))
    expect(container.querySelector('h1')?.textContent).toBe('当前窗口加载失败')
    expect(container.textContent).not.toContain('test-secret')
    expect(native.ready).not.toHaveBeenCalled()
    expect(native.report).toHaveBeenCalledOnce()
    expect(native.report.mock.calls[0]).toEqual([expect.objectContaining({ message: 'render failure api_key=[redacted]', componentStack: expect.stringContaining('Broken') })])
    await act(async () => { click('复制诊断信息') })
    expect(native.copy).toHaveBeenCalledOnce()
    expect(container.textContent).toContain('诊断信息已复制')
    expect(native.reload).not.toHaveBeenCalled()
  })

  it('identifies a runtime failure after mounting, and reloads only on user action', async () => {
    const native = bridge()
    act(() => root.render(<RendererBoundary><p>正常界面</p></RendererBoundary>))
    expect(native.ready).toHaveBeenCalledOnce()
    act(() => root.render(<RendererBoundary><Broken /></RendererBoundary>))
    expect(container.querySelector('h1')?.textContent).toBe('当前窗口发生错误')
    expect(native.reload).not.toHaveBeenCalled()
    await act(async () => { click('重新加载窗口') })
    expect(native.reload).toHaveBeenCalledOnce()
  })

  it('keeps details accessible when the recovery IPC or clipboard fails', async () => {
    const native = bridge()
    native.copy.mockRejectedValueOnce(new Error('clipboard unavailable'))
    native.reload.mockRejectedValueOnce(new Error('IPC unavailable'))
    native.report.mockRejectedValueOnce(new Error('IPC unavailable'))
    await act(async () => root.render(<RendererBoundary><Broken /></RendererBoundary>))
    await act(async () => { click('复制诊断信息') })
    expect(container.textContent).toContain('可以展开错误详情手动复制')
    expect(container.querySelector('details pre')?.textContent).toContain('render failure')
    await act(async () => { click('重新加载窗口') })
    expect(container.textContent).toContain('请尝试重新启动应用')
    expect(container.querySelector('button')?.disabled).toBe(false)
  })

  it('uses a browser clipboard fallback with redacted diagnostics', async () => {
    const writeText = vi.fn(async (_text: string) => {})
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    act(() => root.render(<RendererBoundary><Broken /></RendererBoundary>))
    await act(async () => { click('复制诊断信息') })
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('LING Renderer'))
    expect(writeText.mock.calls[0]?.[0]).not.toContain('test-secret')
  })
})

describe('shareable failure diagnostics', () => {
  it('removes credentials, private keys and URL authentication before bounding the output', () => {
    const raw = 'Authorization: Bearer bearer-secret\npassword="secret with spaces" api_key=abc123\n'
      + 'https://user:pass@example.test/path?token=secret&prompt=private#session\n'
      + 'sk-abcdefghijklmnop eyJhbGciOi.xxxxx.yyyyy\n'
      + '-----BEGIN RSA PRIVATE KEY-----\nkey material\n-----END RSA PRIVATE KEY-----\n/Users/test/app.ts'
    const diagnostic = redactDiagnostic(raw, '/Users/test')
    for (const value of ['bearer-secret', 'secret with spaces', 'abc123', 'user:pass', 'prompt=private', 'sk-abcdefghijklmnop', 'eyJhbGciOi', 'key material', '/Users/test']) {
      expect(diagnostic).not.toContain(value)
    }
    expect(diagnostic).toContain('~/app.ts')
    expect(redactDiagnostic('x'.repeat(20_000))).toHaveLength(12_000)
    expect(rendererFailure(new Error('password=secret'), 'at Component')).toMatchObject({ message: 'password=[redacted]', componentStack: 'at Component' })
  })
})
