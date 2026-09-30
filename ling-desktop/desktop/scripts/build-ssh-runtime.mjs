import { createRequire } from 'node:module'
import { cp, mkdir, readFile, readdir, rm, writeFile, utimes } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { createGzip } from 'node:zlib'

// Package the installed, pinned upstream artifacts unchanged, including runner/native files.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const destination = join(root, 'lib', 'ssh-runtime')
await rm(destination, { recursive: true, force: true })
await mkdir(join(destination, 'node_modules'), { recursive: true })
const versions = new Map()
const visit = async (name, anchor, optional = false) => {
  let path
  try {
    const require = createRequire(anchor)
    try { path = require.resolve(`${name}/package.json`) }
    catch {
      for (const parent of require.resolve.paths(name) ?? []) {
        const candidate = join(parent, name, 'package.json')
        try { await readFile(candidate); path = candidate; break } catch {}
      }
      if (!path) throw new Error(`Missing SSH runtime dependency ${name}`)
    }
  }
  catch (error) { if (optional) return; throw error }
  const pkg = JSON.parse(await readFile(path, 'utf8'))
  if (versions.has(name)) {
    if (versions.get(name) !== pkg.version) throw new Error(`SSH runtime has conflicting versions of ${name}`)
    return
  }
  versions.set(name, pkg.version)
  const target = join(destination, 'node_modules', name)
  await mkdir(target, { recursive: true })
  for (const entry of (await readdir(dirname(path))).sort()) {
    if (['node_modules', '.git', 'test', 'tests', 'example', 'examples'].includes(entry)) continue
    await cp(join(dirname(path), entry), join(target, entry), { recursive: true, dereference: true })
  }
  for (const child of Object.keys({ ...pkg.dependencies, ...pkg.peerDependencies })) {
    await visit(child, path, !!pkg.peerDependenciesMeta?.[child]?.optional)
  }
  for (const child of Object.keys(pkg.optionalDependencies ?? {})) await visit(child, path, true)
}
await visit('@deepseek-ai/dsh-ssh', join(root, 'package.json'))
const helper = 'node_modules/@deepseek-ai/dsh-ssh/lib/helper.js'
const hash = createHash('sha256').update(await readFile(join(destination, helper))).digest('hex')
await writeFile(join(destination, 'package.json'), JSON.stringify({ private: true, type: 'module' }))
// Stable contents produce the same cache key across rebuilds.
const archiveEntries = ['.']
async function normalizeTimes(path, relative = '.') {
  for (const entry of (await readdir(path, { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : 1)) {
    const child = join(path, entry.name)
    const childRelative = `${relative}/${entry.name}`
    archiveEntries.push(childRelative)
    if (entry.isDirectory()) await normalizeTimes(child, childRelative)
    else await utimes(child, 0, 0)
  }
  await utimes(path, 0, 0)
}
await normalizeTimes(destination)
for (const os of ['linux', 'darwin']) for (const cpu of ['x64', 'arm64']) {
  // Fail at build time instead of shipping a helper missing a target's native code.
  for (const name of [`@koromix/koffi-${os}-${cpu}`, `@deepseek-ai/node-addon-system-${os}-${cpu}`]) {
    if (!versions.has(name)) throw new Error(`SSH runtime missing ${name}; install with repository supportedArchitectures`)
  }
  await readFile(join(destination, 'node_modules/node-pty/prebuilds', `${os}-${cpu}`, 'pty.node'))
}
const archive = join(root, 'lib', 'ssh-runtime.tar.gz')
const uncompressed = join(root, 'lib', 'ssh-runtime.tar')
try {
  execFileSync('tar', ['--format=ustar', '--no-recursion', '-cf', uncompressed, '-C', destination, '--null', '-T', '-'],
    { input: archiveEntries.join('\0') + '\0' })
  // Node's gzip header has no wall-clock timestamp, unlike BSD tar -z.
  await pipeline(createReadStream(uncompressed), createGzip(), createWriteStream(archive))
} finally { await rm(uncompressed, { force: true }) }
const archiveHash = createHash('sha256').update(await readFile(archive)).digest('hex')
await writeFile(join(root, 'lib', 'ssh-runtime.json'), JSON.stringify({ version: 1, helper, hash, archiveHash,
  packages: Object.fromEntries(versions) }, null, 2))
console.log(`SSH runtime: ${versions.size} pinned packages`)
