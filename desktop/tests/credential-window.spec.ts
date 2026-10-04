import { Script } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { CREDENTIAL_HTML, credentialDocument } from '../src/credential-window.ts'
import { themeStylesheet } from 'ling-desktop/theme'

describe('isolated credential view', () => {
  it('has a valid script, a close action and no remote resource permissions', () => {
    const script = CREDENTIAL_HTML.match(/<script>([\s\S]*?)<\/script>/)?.[1]
    expect(script).toBeTruthy()
    expect(() => new Script(script!)).not.toThrow()
    expect(CREDENTIAL_HTML).toContain("default-src 'none'")
    expect(CREDENTIAL_HTML).toContain("connect-src 'none'")
    expect(CREDENTIAL_HTML).toContain('id="close"')
    expect(CREDENTIAL_HTML).toContain('id="trust"')
  })
  it('starts with the selected appearance without exposing credentials to the main renderer', () => {
    const html = credentialDocument({ mode: 'dark', palette: 'forest' }, 'dark')
    expect(html).toContain('data-theme="dark" data-palette="forest"')
    expect(html).toContain(themeStylesheet())
    expect(html).toContain('api.onTheme(applyTheme)')
    expect(html).not.toContain('localStorage')
    expect(html).not.toContain('__DSH_')
    expect(html).toContain("connect-src 'none'")
  })
  it('does not interpolate unknown palette data into the document', () => {
    const html = credentialDocument({ mode: 'dark', palette: '"><script>bad()</script>' } as never, 'dark')
    expect(html).toContain('data-palette="default"')
    expect(html).not.toContain('bad()')
  })
})
