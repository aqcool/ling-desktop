import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { releaseVersion, updateVersion } from './release-version.mjs'

test('release versions reject shell fragments, partial versions and invalid numeric identifiers', () => {
  for (const value of ['v1.0.0', '1.0', '01.0.0', '1.0.0-beta.01', '1.0.0;echo x', '../1.0.0']) assert.throws(() => releaseVersion(value))
  for (const value of ['0.0.0-dev.0', '0.1.0-beta.1', '1.0.0']) assert.equal(releaseVersion(value), value)
})
test('a tag must match both workspace versions; updates preserve package metadata', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ling-version-test-'))
  try {
    await mkdir(join(root, 'desktop'))
    for (const path of ['package.json', 'desktop/package.json']) await writeFile(join(root, path), JSON.stringify({ name: path, version: '0.0.0-dev.0', private: true }))
    await assert.rejects(updateVersion(root, '0.1.0-beta.1', true), /tag differs/)
    await updateVersion(root, '0.1.0-beta.1')
    await updateVersion(root, '0.1.0-beta.1', true)
    assert.equal(JSON.parse(await readFile(join(root, 'desktop/package.json'))).private, true)
    await writeFile(join(root, 'desktop/package.json'), JSON.stringify({ version: '1.0.0' }))
    await assert.rejects(updateVersion(root, '0.2.0'), /versions differ/)
  } finally { await rm(root, { recursive: true, force: true }) }
})
