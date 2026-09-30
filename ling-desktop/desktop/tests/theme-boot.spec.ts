import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { themeTokens } from 'ling-desktop/theme'
import { serveWebDocument } from '../src/web-document.ts'

describe('theme before renderer boot', () => {
  it('uses the stored palette before the stylesheet/React load and rejects unknown palette keys', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ling-theme-boot-'))
    try {
      await writeFile(join(root, 'index.html'), '<html><head></head><body></body></html>')
      const response = await serveWebDocument(new Request('http://localhost/'), root)
      const script = (await response.text()).match(/<script>([\s\S]*?)<\/script>/)![1]!
      for (const palette of ['forest', '__proto__', 'constructor']) {
        const element = { dataset: {} as Record<string, string>, style: {} as Record<string, string>, classList: { toggle() {} } }
        const context = { document: { documentElement: element }, localStorage: { getItem: (key: string) => key === 'ling.theme' ? 'system' : palette }, matchMedia: () => ({ matches: true }) }
        runInNewContext(script, context)
        const expectedPalette = palette === 'forest' ? 'forest' : 'default'
        expect(element.dataset).toEqual({ theme: 'dark', palette: expectedPalette })
        expect(element.style.backgroundColor).toBe(themeTokens('dark', expectedPalette).surface)
      }
    } finally { await rm(root, { recursive: true, force: true }) }
  })
})
