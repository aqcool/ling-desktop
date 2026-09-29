import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { composeEntries, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { expect, it } from 'vitest'

it('enables local message search over the published DSH base profile', () => {
  const require = createRequire(import.meta.url)
  const basePatch = join(dirname(require.resolve('@deepseek-ai/dsh-base/package.json')), 'cordis.patch.yml')
  const hostPatch = fileURLToPath(new URL('../host.cordis.patch.yml', import.meta.url))
  const entries = composeEntries([
    loadOverlayPatches('ling-desktop-host', basePatch),
    loadOverlayPatches('ling-desktop-host', hostPatch),
  ])

  expect(entries.find(entry => entry.id === 'session-query-sqlite')).toMatchObject({
    config: { path: ':memory:', openAt: 'first-search' },
  })
})
