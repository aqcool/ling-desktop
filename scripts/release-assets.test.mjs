import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { gzipSync, deflateRawSync } from 'node:zlib'
import { RELEASE_TARGETS, targetName, updateChannel, updateMetadataName } from '../desktop/scripts/packaging/config.mjs'
import { artifactNames, collectArtifacts, qualifyArtifacts } from './release-assets.mjs'
const { parse, stringify } = createRequire(new URL('../desktop/package.json', import.meta.url))('yaml')

async function fixture(root, version, mode = 'signed') {
  for (const target of RELEASE_TARGETS) {
    const name = targetName(target), prefix = `LING-${version}-${name}`
    await writeFile(join(root, `${prefix}-report.json`), JSON.stringify({ version, target, autoUpdate: mode === 'signed', updateChannel: updateChannel(version),
      signed: target.platform === 'darwin' ? mode === 'signed' ? 'developer-id' : 'ad-hoc' : target.platform === 'win32' && mode === 'signed' ? 'authenticode' : false,
      notarized: target.platform === 'darwin' && mode === 'signed', relocatedRuntime: { verified: ['pnpm', 'native', 'preview', 'host'] } }))
    const files = []
    for (const file of artifactNames(version, target, mode)) {
      if (file.endsWith('.blockmap')) {
        await writeFile(join(root, file), gzipSync(JSON.stringify({ version: '2', files: [{ name: 'file', offset: 0, sizes: [17], checksums: ['test'] }] })))
      } else {
        let data = Buffer.from(`installer fixture ${file}`), blockMapSize
        if (file.endsWith('.AppImage')) {
          const blockmap = deflateRawSync(Buffer.from(JSON.stringify({ version: '2', files: [{ name: 'file', sizes: [data.length], checksums: ['test'] }] })))
          const footer = Buffer.alloc(4)
          footer.writeUInt32BE(blockmap.length)
          data = Buffer.concat([data, blockmap, footer]); blockMapSize = blockmap.length
        }
        await writeFile(join(root, file), data)
        files.push({ url: file, size: data.length, sha512: createHash('sha512').update(data).digest('base64'), ...(blockMapSize ? { blockMapSize } : {}) })
      }
    }
    if (mode === 'signed') await writeFile(join(root, `${prefix}-update.yml`), stringify({ version, files, path: files[0].url, sha512: files[0].sha512 }))
  }
}
for (const version of ['0.1.0-dev.11', '0.1.0']) test(`publishes a complete ${updateChannel(version)} feed with both macOS architectures`, async () => {
  const root = await mkdtemp(join(tmpdir(), 'ling-release-assets-'))
  try {
    await fixture(root, version)
    assert.equal(await qualifyArtifacts(root, version, '--all'), 4)
    const feed = parse(await readFile(join(root, updateMetadataName(version, RELEASE_TARGETS[0])), 'utf8'))
    assert.equal(feed.files.filter(file => file.url.endsWith('.zip')).length, 2)
    assert.equal((await readFile(join(root, 'SHA256SUMS'), 'utf8')).trim().split('\n').length, 23)
    assert.equal(await qualifyArtifacts(root, version, '--all'), 4)
    await rm(join(root, `LING-${version}-win-x64.exe`))
    await assert.rejects(qualifyArtifacts(root, version, '--all'))
  } finally { await rm(root, { recursive: true, force: true }) }
})
test('rejects unsigned qualification, changed payloads, invalid blockmaps and cross-channel feeds', async () => {
  const version = '0.1.0-dev.11', root = await mkdtemp(join(tmpdir(), 'ling-release-assets-'))
  try {
    await fixture(root, version)
    const reportPath = join(root, `LING-${version}-mac-arm64-report.json`), report = JSON.parse(await readFile(reportPath, 'utf8'))
    await writeFile(reportPath, JSON.stringify({ ...report, notarized: false }))
    await assert.rejects(qualifyArtifacts(root, version, '--all'), /Incomplete signed/)
    await fixture(root, version)
    await writeFile(join(root, `LING-${version}-win-x64.exe`), 'tampered')
    await assert.rejects(qualifyArtifacts(root, version, '--all'), /checksum\/size/)
    await fixture(root, version)
    await writeFile(join(root, `LING-${version}-mac-arm64.zip.blockmap`), 'broken')
    await assert.rejects(qualifyArtifacts(root, version, '--all'), /Invalid blockmap/)
    await fixture(root, version)
    await writeFile(join(root, 'latest.yml'), 'version: 0.1.0-dev.11')
    await assert.rejects(qualifyArtifacts(root, version, '--all'), /differ from/)
  } finally { await rm(root, { recursive: true, force: true }) }
})
test('native collection stages architecture-specific metadata without overwriting another runner', async () => {
  const version = '0.1.0-dev.11', root = await mkdtemp(join(tmpdir(), 'ling-release-collection-'))
  try {
    const source = join(root, 'source'), output = join(root, 'output'), target = RELEASE_TARGETS[0]
    await mkdir(source); await mkdir(output); await fixture(source, version)
    await copyFile(join(source, `LING-${version}-${targetName(target)}-report.json`), join(source, 'packaging-report.json'))
    await copyFile(join(source, `LING-${version}-${targetName(target)}-update.yml`), join(source, updateMetadataName(version, target)))
    await collectArtifacts(source, output, version, targetName(target))
    assert.equal(await qualifyArtifacts(output, version, targetName(target)), 1)
    await assert.rejects(readFile(join(output, updateMetadataName(version, target))))
    await assert.rejects(qualifyArtifacts(output, version, '--all'))
  } finally { await rm(root, { recursive: true, force: true }) }
})

for (const version of ['0.1.0-dev.13', '0.1.0']) test(`manual ${version} publishes native installers and checksums without an update feed`, async () => {
  const root = await mkdtemp(join(tmpdir(), 'ling-manual-release-'))
  try {
    await fixture(root, version, 'manual')
    assert.equal(await qualifyArtifacts(root, version, '--all', 'manual'), 4)
    const files = await readdir(root)
    assert.equal(files.some(file => file.endsWith('.yml') || file.endsWith('.blockmap') || file.endsWith('.zip')), false)
    assert.equal((await readFile(join(root, 'SHA256SUMS'), 'utf8')).trim().split('\n').length, 9)
    const result = await promisify(execFile)(process.execPath, [fileURLToPath(new URL('./release-assets.mjs', import.meta.url)), root, version, '--all', '--manual'])
    assert.match(result.stdout, /4 native targets qualified/)
    await rm(join(root, `LING-${version}-win-x64.exe`))
    await assert.rejects(qualifyArtifacts(root, version, '--all', 'manual'))
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('manual qualification rejects mixed signing modes, updater metadata, empty installers and missing runtime gates', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ling-manual-rejections-')), version = '0.1.0-dev.13'
  try {
    await fixture(root, version, 'manual')
    const reportPath = join(root, `LING-${version}-mac-arm64-report.json`)
    const report = JSON.parse(await readFile(reportPath, 'utf8'))
    for (const patch of [{ autoUpdate: true }, { signed: 'developer-id' }, { notarized: true }, { relocatedRuntime: { verified: [] } }]) {
      await writeFile(reportPath, JSON.stringify({ ...report, ...patch }))
      await assert.rejects(qualifyArtifacts(root, version, '--all', 'manual'), /Incomplete manual/)
    }
    await writeFile(reportPath, JSON.stringify(report))
    await assert.rejects(qualifyArtifacts(root, version, '--all'), /Incomplete signed/)
    for (const name of ['dev-mac.yml', `LING-${version}-mac-arm64-update.yml`]) {
      await writeFile(join(root, name), 'version: 0.1.0-dev.13')
      await assert.rejects(qualifyArtifacts(root, version, '--all', 'manual'), /differ from/)
      await rm(join(root, name))
    }
    await writeFile(join(root, `LING-${version}-win-x64.exe`), '')
    await assert.rejects(qualifyArtifacts(root, version, '--all', 'manual'), /Invalid installer payload/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('manual collection ignores Builder diagnostics but rejects source update feeds', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ling-manual-collection-')), version = '0.1.0-dev.13'
  try {
    const source = join(root, 'source'), output = join(root, 'output'), target = RELEASE_TARGETS[0]
    await mkdir(source); await mkdir(output); await fixture(source, version, 'manual')
    await copyFile(join(source, `LING-${version}-${targetName(target)}-report.json`), join(source, 'packaging-report.json'))
    await writeFile(join(source, 'builder-debug.yml'), 'diagnostics: true')
    await collectArtifacts(source, output, version, targetName(target), 'manual')
    assert.deepEqual((await readdir(output)).sort(), [`LING-${version}-mac-arm64-report.json`, `LING-${version}-mac-arm64.dmg`].sort())
    assert.equal(await qualifyArtifacts(output, version, targetName(target), 'manual'), 1)
    await assert.rejects(qualifyArtifacts(output, version, '--all', 'manual'))
    await writeFile(join(source, 'dev-mac.yml'), 'version: 0.1.0-dev.13')
    await assert.rejects(collectArtifacts(source, output, version, targetName(target), 'manual'), /must not contain update metadata/)
  } finally { await rm(root, { recursive: true, force: true }) }
})
