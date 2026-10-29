/** Validate the complete native matrix for manual installers or signed updates. */
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { copyFile, open, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync, inflateRawSync } from 'node:zlib'
import { RELEASE_TARGETS, targetName, updateChannel, updateMetadataName } from '../desktop/scripts/packaging/config.mjs'
import { releaseVersion } from './release-version.mjs'

const { parse, stringify } = createRequire(new URL('../desktop/package.json', import.meta.url))('yaml')
function validateMode(mode) {
  if (mode !== 'signed' && mode !== 'manual') throw new Error('Release mode must be signed or manual')
}
export function artifactNames(version, target, mode = 'signed') {
  validateMode(mode)
  const prefix = `LING-${version}-${targetName(target)}`
  const extensions = mode === 'manual'
    ? { darwin: ['dmg'], win32: ['exe'], linux: ['AppImage', 'deb'] }
    : { darwin: ['dmg', 'zip', 'dmg.blockmap', 'zip.blockmap'], win32: ['exe', 'exe.blockmap'], linux: ['AppImage', 'deb'] }
  return extensions[target.platform].map(ext => `${prefix}.${ext}`)
}
function stagedMetadata(version, target) { return `LING-${version}-${targetName(target)}-update.yml` }
async function hash(path, algorithm, encoding) {
  const digest = createHash(algorithm)
  for await (const chunk of createReadStream(path)) digest.update(chunk)
  return digest.digest(encoding)
}
function verifyBlockmap(bytes, name, embedded = false) {
  let value
  try { value = JSON.parse((embedded ? inflateRawSync(bytes) : gunzipSync(bytes)).toString('utf8')) } catch { throw new Error(`Invalid blockmap: ${name}`) }
  if (value.version !== '2' || !Array.isArray(value.files) || !value.files.length
    || value.files.some(file => !Array.isArray(file.sizes) || !file.sizes.length || file.sizes.length !== file.checksums?.length
      || file.sizes.some(size => !Number.isSafeInteger(size) || size <= 0))) throw new Error(`Invalid blockmap: ${name}`)
}
async function verifyEmbeddedBlockmap(path, size, expectedSize) {
  const handle = await open(path, 'r')
  try {
    const footer = Buffer.alloc(4)
    await handle.read(footer, 0, 4, size - 4)
    const length = footer.readUInt32BE()
    if (!length || length >= size - 4 || length > 16 * 1024 * 1024 || length !== expectedSize) throw new Error('Invalid AppImage embedded blockmap')
    const bytes = Buffer.alloc(length)
    await handle.read(bytes, 0, length, size - 4 - length)
    verifyBlockmap(bytes, path, true)
  } finally { await handle.close() }
}
async function verifyMetadata(root, version, target) {
  const metadata = parse(await readFile(join(root, stagedMetadata(version, target)), 'utf8'))
  if (metadata?.version !== version || !Array.isArray(metadata.files) || !metadata.files.length) throw new Error(`Invalid update metadata: ${targetName(target)}`)
  const installers = artifactNames(version, target).filter(name => !name.endsWith('.blockmap'))
  const seen = new Set()
  for (const file of metadata.files) {
    if (!installers.includes(file.url) || seen.has(file.url)) throw new Error(`Unexpected update artifact: ${file.url}`)
    seen.add(file.url)
    const path = join(root, file.url), info = await stat(path)
    if (file.size !== info.size || file.sha512 !== await hash(path, 'sha512', 'base64')) throw new Error(`Update artifact checksum/size mismatch: ${file.url}`)
    if (file.blockMapSize !== undefined && (!Number.isSafeInteger(file.blockMapSize) || file.blockMapSize <= 0 || file.blockMapSize >= info.size)) throw new Error(`Invalid embedded blockmap size: ${file.url}`)
    if (file.url.endsWith('.AppImage')) await verifyEmbeddedBlockmap(path, info.size, file.blockMapSize)
  }
  const required = target.platform === 'linux' ? installers.filter(name => name.endsWith('.AppImage')) : installers
  if (required.some(name => !seen.has(name))) throw new Error(`Missing updater payload: ${targetName(target)}`)
  if (metadata.path !== undefined && (!seen.has(metadata.path) || metadata.sha512 !== metadata.files.find(file => file.url === metadata.path).sha512)) throw new Error('Legacy update metadata differs from files')
  for (const name of artifactNames(version, target).filter(name => name.endsWith('.blockmap'))) verifyBlockmap(await readFile(join(root, name)), name)
  return metadata
}
export async function collectArtifacts(source, root, version, selection, mode = 'signed') {
  validateMode(mode)
  version = releaseVersion(version)
  const target = RELEASE_TARGETS.find(item => targetName(item) === selection)
  if (!target) throw new Error('Unknown release target')
  if (mode === 'manual' && (await readdir(source)).some(file => /^(?:dev|latest)(?:-mac|-linux)?\.yml$/.test(file)
    || /^LING-.+-update\.yml$/.test(file) || file === 'app-update.yml')) throw new Error('Manual releases must not contain update metadata')
  await copyFile(join(source, 'packaging-report.json'), join(root, `LING-${version}-${selection}-report.json`))
  for (const name of artifactNames(version, target, mode)) await copyFile(join(source, name), join(root, name))
  // Architecture-specific staging names prevent artifact-download overwrites.
  if (mode === 'signed') await copyFile(join(source, updateMetadataName(version, target)), join(root, stagedMetadata(version, target)))
  await qualifyArtifacts(root, version, selection, mode)
}
export async function qualifyArtifacts(directory, value, selection, mode = 'signed') {
  validateMode(mode)
  const version = releaseVersion(value), root = resolve(directory), files = await readdir(root)
  const targets = selection === '--all' ? RELEASE_TARGETS : RELEASE_TARGETS.filter(target => targetName(target) === selection)
  if (!targets.length) throw new Error('Unknown release target')
  const expected = [], metadata = new Map()
  for (const target of targets) {
    const name = targetName(target), reportName = `LING-${version}-${name}-report.json`
    const report = JSON.parse(await readFile(join(root, reportName), 'utf8'))
    const incomplete = report.version !== version || report.target?.platform !== target.platform || report.target?.arch !== target.arch
      || report.relocatedRuntime?.verified?.length !== 4 || report.updateChannel !== updateChannel(version)
    if (mode === 'signed') {
      if (incomplete || report.autoUpdate !== true
        || target.platform === 'darwin' && (report.signed !== 'developer-id' || report.notarized !== true)
        || target.platform === 'win32' && report.signed !== 'authenticode') throw new Error(`Incomplete signed update qualification: ${name}`)
      expected.push(reportName, stagedMetadata(version, target), ...artifactNames(version, target))
      metadata.set(name, await verifyMetadata(root, version, target))
    } else {
      if (incomplete || report.autoUpdate !== false || report.notarized !== false
        || report.signed !== (target.platform === 'darwin' ? 'ad-hoc' : false)) throw new Error(`Incomplete manual installer qualification: ${name}`)
      const installers = artifactNames(version, target, mode)
      for (const file of installers) {
        const info = await stat(join(root, file))
        if (!info.isFile() || info.size === 0) throw new Error(`Invalid installer payload: ${file}`)
      }
      expected.push(reportName, ...installers)
    }
  }
  const finalMetadata = mode === 'signed' ? [...new Set(targets.map(target => updateMetadataName(version, target)))] : []
  if (expected.some(file => !files.includes(file)) || files.some(file => file !== 'SHA256SUMS' && !(selection === '--all' && finalMetadata.includes(file)) && !expected.includes(file))) throw new Error('Release artifacts differ from the qualified platform matrix')
  if (selection === '--all') {
    for (const filename of finalMetadata) {
      const matching = targets.filter(target => updateMetadataName(version, target) === filename)
      const documents = matching.map(target => metadata.get(targetName(target)))
      const merged = { ...documents[0], files: documents.flatMap(document => document.files) }
      await writeFile(join(root, filename), stringify(merged))
    }
    const lines = []
    for (const file of [...expected, ...finalMetadata].sort()) lines.push(`${await hash(join(root, file), 'sha256', 'hex')}  ${file}`)
    await writeFile(join(root, 'SHA256SUMS'), `${lines.join('\n')}\n`)
  }
  return targets.length
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  const mode = args.at(-1) === '--manual' ? 'manual' : 'signed'
  if (mode === 'manual') args.pop()
  if (args[0] === '--collect' && args.length === 5) await collectArtifacts(args[1], args[2], args[3], args[4], mode)
  else if (args.length === 3) console.log(`LING ${args[1]}: ${await qualifyArtifacts(...args, mode)} native targets qualified`)
  else throw new Error('Usage: release-assets.mjs DIRECTORY VERSION TARGET|--all [--manual], or --collect SOURCE DIRECTORY VERSION TARGET [--manual]')
}
