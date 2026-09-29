import { Script } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { CREDENTIAL_HTML } from '../src/credential-window.ts'

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
})
