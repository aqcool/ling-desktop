import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { gzipSync, deflateRawSync } from 'node:zlib'
import { RELEASE_TARGETS, targetName, updateChannel, updateMetadataName } from '../desktop/scripts/packaging/config.mjs'
import { artifactNames, collectArtifacts, qualifyArtifacts } from './release-assets.mjs'
const { parse, stringify } = createRequire(new URL('../desktop/package.json', import.meta.url))('yaml')

async function fixture(root, version) {
  for (const target of RELEASE_TARGETS) {
    const name = targetName(target), prefix = `LING-${version}-${name}`
    await writeFile(join(root, `${prefix}-report.json`), JSON.stringify({ version, target, autoUpdate: true, updateChannel: updateChannel(version),
      signed: target.platform === 'darwin' ? 'developer-id' : target.platform === 'win32' ? 'authenticode' : false,
      notarized: target.platform === 'darwin', relocatedRuntime: { verified: ['pnpm', 'native', 'preview', 'host'] } }))
    const files = []
    for (const file of artifactNames(version, target)) {
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
    await writeFile(join(root, `${prefix}-update.yml`), stringify({ version, files, path: files[0].url, sha512: files[0].sha512 }))
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
