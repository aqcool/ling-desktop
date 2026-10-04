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
    config: { path: { __jsExpr: "dshHomePath('ling-session-search.sqlite')" }, openAt: 'first-search' },
  })
})

it('composes LING session lifecycle adapters instead of the original owners', () => {
  const require = createRequire(import.meta.url)
  const patch = (name: string) => join(dirname(require.resolve(name + '/package.json')), 'cordis.patch.yml')
  const entries = composeEntries([
    loadOverlayPatches('ling-desktop-host', patch('@deepseek-ai/dsh-base')),
    loadOverlayPatches('ling-desktop-host', patch('@deepseek-ai/dsh-web-app')),
    loadOverlayPatches('ling-desktop-host', fileURLToPath(new URL('../host.cordis.patch.yml', import.meta.url))),
  ])
  for (const id of ['agent-loop', 'session-persistence-jsonl', 'session-controller']) {
    expect(entries.find(entry => entry.id === id)?.disabled).toBe(true)
  }
  for (const [id, name] of [['ling-session-lifecycle', 'session-lifecycle'], ['ling-session-storage', 'session-storage'], ['ling-session-controller', 'session-controller']]) {
    expect(entries.find(entry => entry.id === id)).toMatchObject({ name: 'ling-desktop-host/' + name })
  }
  expect(entries.find(entry => entry.id === 'ling-session-storage')?.config).toEqual({ root: { __jsExpr: "dshHomePath('sessions')" } })
})


it('registers compaction settings while keeping the published Web engine ownership', () => {
  const require = createRequire(import.meta.url)
  const patch = (name: string) => join(dirname(require.resolve(name + '/package.json')), 'cordis.patch.yml')
  const entries = composeEntries([
    loadOverlayPatches('ling-desktop-host', patch('@deepseek-ai/dsh-base')),
    loadOverlayPatches('ling-desktop-host', patch('@deepseek-ai/dsh-web-app')),
    loadOverlayPatches('ling-desktop-host', fileURLToPath(new URL('../host.cordis.patch.yml', import.meta.url))),
  ])
  expect(entries.find(entry => entry.id === 'compaction-basic')).toMatchObject({ disabled: true, name: '@deepseek-ai/dsh-compaction-basic' })
  expect(entries.find(entry => entry.id === 'ling-compaction-settings')).toMatchObject({ name: 'ling-desktop-host/compaction' })
})
