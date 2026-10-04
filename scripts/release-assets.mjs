/** Refuse a partial/mismatched release; checksum every installer and report. */
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { RELEASE_TARGETS, targetName } from '../desktop/scripts/packaging/config.mjs'
import { releaseVersion } from './release-version.mjs'

const [directory, value, selection] = process.argv.slice(2)
const version = releaseVersion(value)
const root = resolve(directory), files = await readdir(root)
const targets = selection === '--all' ? RELEASE_TARGETS : RELEASE_TARGETS.filter(target => targetName(target) === selection)
if (!targets.length) throw new Error('Unknown release target')
const expected = []
for (const target of targets) {
  const name = targetName(target), prefix = `LING-${version}-${name}`
  const reportName = `${prefix}-report.json`
  const report = JSON.parse(await readFile(join(root, reportName), 'utf8'))
  if (report.version !== version || report.target.platform !== target.platform || report.target.arch !== target.arch
    || report.relocatedRuntime?.verified?.length !== 4) throw new Error(`Incomplete qualification: ${name}`)
  expected.push(reportName, ...({ darwin: ['dmg'], win32: ['exe'], linux: ['AppImage', 'deb'] }[target.platform]).map(ext => `${prefix}.${ext}`))
}
if (expected.some(file => !files.includes(file)) || files.some(file => file !== 'SHA256SUMS' && !expected.includes(file))) throw new Error('Release artifacts differ from the qualified platform matrix')
if (selection === '--all') {
  const lines = []
  for (const file of expected.sort()) {
    const hash = createHash('sha256')
    for await (const chunk of createReadStream(join(root, file))) hash.update(chunk)
    lines.push(`${hash.digest('hex')}  ${file}`)
  }
  await writeFile(join(root, 'SHA256SUMS'), `${lines.join('\n')}\n`)
}
console.log(`LING ${version}: ${targets.length} native targets qualified`)
