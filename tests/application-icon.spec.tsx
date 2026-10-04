import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi, afterEach } from 'vitest'
import { GeneralSettings } from '../src/ui/GeneralSettings.js'
import { applicationIconOptions, applicationIconPreview } from '../src/ui/application-icon.js'

const render = () => renderToStaticMarkup(<GeneralSettings section="appearance" theme="light" onThemeChange={() => {}} version="test" localePreference="zh" localeLoading={false} onLocaleChange={() => {}} />)
afterEach(() => vi.unstubAllGlobals())
describe('application icon settings', () => {
  it('shows all four approved previews and disables native choices outside desktop', () => {
    const markup = render()
    for (const style of ['fold-coral', 'fold-indigo', 'relay-dark', 'relay-light'] as const) {
      const option = applicationIconOptions.find(option => option.value === style)!
      expect(markup).toContain(applicationIconPreview(style))
      expect(markup).toContain(`aria-label="使用${option.label}图标"`)
      expect(markup.match(new RegExp(`<button[^>]*aria-label="使用${option.label}图标"[^>]*>`))?.[0]).toContain('disabled')
    }
    expect(markup).toContain('应用图标切换需要桌面客户端')
  })
  it('enables choices when the native icon bridge is available', () => {
    vi.stubGlobal('window', { matchMedia: () => ({ matches: false }), __LING_APP_ICON__: { get: vi.fn(), set: vi.fn(), subscribe: vi.fn() } })
    const markup = render()
    const buttons = markup.match(/<button[^>]*aria-label="使用[^"]+图标"[^>]*>/g)!
    expect(buttons).toHaveLength(4)
    for (const button of buttons) expect(button).not.toContain('disabled')
  })
})
