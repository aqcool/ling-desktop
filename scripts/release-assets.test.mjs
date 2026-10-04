import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { RELEASE_TARGETS, targetName } from '../desktop/scripts/packaging/config.mjs'

const script = new URL('./release-assets.mjs', import.meta.url)
test('publication rejects a missing target and checksums the complete installer matrix', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ling-release-assets-'))
  const version = '0.1.0-beta.1'
  const run = () => execFileSync(process.execPath, [fileURLToPath(script), root, version, '--all'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  try {
    for (const target of RELEASE_TARGETS) {
      const prefix = `LING-${version}-${targetName(target)}`
      await writeFile(join(root, `${prefix}-report.json`), JSON.stringify({ version, target, relocatedRuntime: { verified: ['pnpm', 'native', 'preview', 'host'] } }))
      for (const ext of { darwin: ['dmg'], win32: ['exe'], linux: ['AppImage', 'deb'] }[target.platform]) await writeFile(join(root, `${prefix}.${ext}`), 'installer fixture')
    }
    assert.match(run(), /4 native targets qualified/)
    const sums = (await readFile(join(root, 'SHA256SUMS'), 'utf8')).trim().split('\n')
    assert.equal(sums.length, 9)
    assert.ok(sums.every(line => /^[a-f0-9]{64}  LING-/.test(line)))
    await rm(join(root, `LING-${version}-win-x64.exe`))
    assert.throws(run, /Command failed/)
  } finally { await rm(root, { recursive: true, force: true }) }
})
