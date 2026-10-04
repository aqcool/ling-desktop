/** Materialize the Yarn-locked production graph, following official Desktop's
 * target filtering, dereferenced resources and hash-manifest preparation.
 * No install or version resolution occurs here; the immutable Yarn install is
 * the source of truth, including patches and nested dependency versions.
 */
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { cp, mkdir, readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, relative, resolve, sep } from 'node:path'

export const HOST_NAME = 'ling-desktop-host'
export const RENDERER_NAME = 'ling-desktop'
export const RUNTIME_MANIFEST = 'ling-runtime.json'
export const BOOTSTRAP = "// LING code and native plugins live in the immutable physical runtime.\nimport '../runtime/node_modules/ling-desktop-host/lib/main.js'\n"

export async function json(path) { return JSON.parse(await readFile(path, 'utf8')) }

/** Resolve package manifests even when exports intentionally hide package.json. */
export async function installedPackage(name, anchor) {
  if (!/^(?:@[^/]+\/)?[^/]+$/.test(name) || name === '.' || name === '..') throw new Error(`Invalid dependency name: ${name}`)
  for (const directory of createRequire(anchor).resolve.paths(name) ?? []) {
    const candidate = join(directory, name, 'package.json')
    try {
      const path = await realpath(candidate)
      return { root: dirname(path), manifest: await json(path) }
    } catch (error) { if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error }
  }
  throw Object.assign(new Error(`Missing production dependency ${name} from ${anchor}`), { code: 'MODULE_NOT_FOUND' })
}

function matches(values, value) {
  if (!values?.length) return true
  return !values.includes(`!${value}`) && (values.includes('any') || !values.some(item => !item.startsWith('!')) || values.includes(value))
}
export function supportsTarget(manifest, target) {
  return matches(manifest.os, target.platform) && matches(manifest.cpu, target.arch)
}

/** Conservative omissions from installed packages; unknown runtime assets stay. */
export function excludedFile(path, target) {
  const parts = path.split(/[\\/]/)
  if (parts.some(part => ['node_modules', '.git', '.bin', '.pnpm', '.DS_Store'].includes(part))) return true
  if (/\.(?:[cm]?[jt]s|css)\.map$|\.d\.[cm]?ts$|\.tsbuildinfo$/.test(path)) return true
  if (parts[0] === 'prebuilds' && parts[1]?.match(/^(?:darwin|linux|win32)-/) && parts[1] !== `${target.platform}-${target.arch}`) return true
  return false
}

function productionManifest(manifest) {
  const { scripts, devDependencies, packageManager, workspaces, ...runtime } = manifest
  return runtime
}

/** Node's nearest-package lookup in the already materialized destination tree. */
function stagedDependency(name, parent, runtime, packages) {
  let directory = parent
  while (directory === runtime || directory.startsWith(`${runtime}${sep}`)) {
    const candidate = join(directory, 'node_modules', name)
    if (packages.has(candidate)) return packages.get(candidate)
    if (directory === runtime) break
    directory = dirname(directory)
  }
}

export async function materializeRuntime({ hostRoot, runtime, target, sourceRevision }) {
  hostRoot = await realpath(hostRoot)
  runtime = resolve(runtime)
  if (runtime === hostRoot || hostRoot.startsWith(`${runtime}${sep}`)) throw new Error('Runtime destination would contain the source')
  await mkdir(join(runtime, 'node_modules'), { recursive: true })
  const sourceManifest = await json(join(hostRoot, 'package.json'))
  const packages = new Map(), queue = [], skippedOptional = []
  async function copyPackage(source, destination) {
    const previous = packages.get(destination)
    if (previous) {
      if (previous.source !== source.root) throw new Error(`Conflicting dependency destination: ${destination}`)
      return previous
    }
    const record = { source: source.root, destination, manifest: source.manifest }
    packages.set(destination, record)
    await mkdir(destination, { recursive: true })
    if (source.manifest.name === HOST_NAME) {
      for (const file of ['lib', 'assets', 'cordis.patch.yml', 'host.cordis.patch.yml', 'scripts/node-bin']) {
        await cp(join(source.root, file), join(destination, file), { recursive: true, dereference: true })
      }
    } else if (source.manifest.name === RENDERER_NAME) {
      // The client bundle contains the complete Renderer. Only its CSS and
      // package anchor are resolved at runtime; do not ship source/dev tooling.
      await cp(join(source.root, 'dist'), join(destination, 'dist'), { recursive: true, dereference: true })
      record.manifest = { name: RENDERER_NAME, version: source.manifest.version, private: true, type: 'module', license: source.manifest.license,
        exports: { './package.json': './package.json', './renderer.css': './dist/renderer.css' } }
    } else {
      await cp(source.root, destination, { recursive: true, dereference: true,
        filter: path => !excludedFile(relative(source.root, path), target) })
    }
    await writeFile(join(destination, 'package.json'), `${JSON.stringify(productionManifest(record.manifest), null, 2)}\n`)
    queue.push(record)
    return record
  }
  const host = await copyPackage({ root: hostRoot, manifest: sourceManifest }, join(runtime, 'node_modules', HOST_NAME))
  async function dependency(name, parent, optional) {
    let source
    try { source = await installedPackage(name, join(parent.source, 'package.json')) }
    catch (error) {
      if (optional && error.code === 'MODULE_NOT_FOUND') { skippedOptional.push(name); return }
      throw error
    }
    if (!supportsTarget(source.manifest, target)) {
      if (!optional) throw new Error(`Required dependency ${name} does not support ${target.platform}-${target.arch}`)
      skippedOptional.push(name); return
    }
    const existing = stagedDependency(name, parent.destination, runtime, packages)
    if (existing?.source === source.root) return
    const rootDestination = join(runtime, 'node_modules', name)
    const destination = !packages.has(rootDestination) && !existing ? rootDestination : join(parent.destination, 'node_modules', name)
    await copyPackage(source, destination)
  }
  // Reserve every direct package before traversal, so transitive versions
  // cannot accidentally replace the Host's declared roots.
  for (const [name] of Object.entries(sourceManifest.dependencies ?? {}).sort()) await dependency(name, host, false)
  for (let index = 0; index < queue.length; index++) {
    const parent = queue[index]
    const manifest = parent.manifest
    const edges = new Map()
    for (const name of Object.keys(manifest.peerDependencies ?? {})) edges.set(name, manifest.peerDependenciesMeta?.[name]?.optional === true)
    for (const name of Object.keys(manifest.dependencies ?? {})) edges.set(name, false)
    for (const name of Object.keys(manifest.optionalDependencies ?? {})) edges.set(name, true)
    for (const [name, optional] of [...edges].sort(([a], [b]) => a.localeCompare(b))) await dependency(name, parent, optional)
  }
  await writeFile(join(runtime, 'package.json'), `${JSON.stringify({ name: 'ling-desktop-runtime', private: true, type: 'module', version: sourceManifest.version })}\n`)
  const records = [...packages.values()].map(item => ({ name: item.manifest.name, version: item.manifest.version, path: relative(runtime, item.destination) }))
  const manifest = { schemaVersion: 1, version: sourceManifest.version, upstreamVersion: sourceManifest.dependencies['@deepseek-ai/dsh'],
    ...target, sourceRevision, packages: records, skippedOptional: [...new Set(skippedOptional)].sort(), files: await runtimeFiles(runtime) }
  await writeFile(join(runtime, RUNTIME_MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`)
  return manifest
}

async function hash(path) {
  const digest = createHash('sha256')
  for await (const block of createReadStream(path)) digest.update(block)
  return digest.digest('hex')
}
export async function runtimeFiles(runtime) {
  const files = []
  async function visit(directory) {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(directory, entry.name), name = relative(runtime, path)
      if (entry.isSymbolicLink()) throw new Error(`Runtime contains a source link: ${name}`)
      if (entry.isDirectory()) await visit(path)
      else if (entry.isFile() && name !== RUNTIME_MANIFEST) {
        const info = await stat(path)
        files.push({ path: name, size: info.size, executable: (info.mode & 0o111) !== 0, sha256: await hash(path) })
      } else if (!entry.isFile()) throw new Error(`Unsupported runtime file: ${name}`)
    }
  }
  await visit(runtime)
  return files
}

/** Audit the final copied payload, not the original development graph. */
export async function verifyRuntime(runtime, target) {
  runtime = await realpath(runtime)
  const manifest = await json(join(runtime, RUNTIME_MANIFEST))
  if (manifest.schemaVersion !== 1 || manifest.platform !== target.platform || manifest.arch !== target.arch) throw new Error('Runtime target mismatch')
  const actual = await runtimeFiles(runtime)
  if (JSON.stringify(actual) !== JSON.stringify(manifest.files)) throw new Error('Runtime content or executable permissions differ from the prepared manifest')
  const anchor = join(runtime, 'node_modules', HOST_NAME, 'package.json')
  const host = await json(anchor)
  for (const entry of manifest.packages) {
    const directory = resolve(runtime, entry.path)
    if (!directory.startsWith(`${resolve(runtime)}${sep}`)) throw new Error('Invalid package path in runtime manifest')
    const packageAnchor = join(directory, 'package.json'), metadata = await json(packageAnchor)
    if (metadata.name !== entry.name || metadata.version !== entry.version) throw new Error('Package identity differs from runtime manifest')
    const required = new Set([...Object.keys(metadata.dependencies ?? {}), ...Object.keys(metadata.peerDependencies ?? {}).filter(name => metadata.peerDependenciesMeta?.[name]?.optional !== true)])
    for (const name of required) {
      if (metadata.optionalDependencies?.[name] !== undefined) continue
      const dependency = await installedPackage(name, packageAnchor)
      if (!dependency.root.startsWith(`${resolve(runtime)}${sep}`)) throw new Error(`Dependency escaped installed runtime: ${name}`)
    }
  }
  for (const file of ['lib/main.js', 'lib/host.js', 'lib/client.js', 'lib/preload-app.cjs', 'lib/preload-browser.cjs', 'lib/preload-credentials.cjs',
    'lib/ssh-runtime.tar.gz', 'lib/ssh-runtime.json', 'cordis.patch.yml', 'host.cordis.patch.yml', 'scripts/node-bin/node']) {
    if (!(await stat(join(dirname(anchor), file))).isFile()) throw new Error(`Host resource missing: ${file}`)
  }
  const resolver = createRequire(anchor)
  for (const name of ['@deepseek-ai/dsh-web-frontend/dist/index.html', 'ling-desktop/package.json', '@vscode/tree-sitter-wasm']) {
    const path = resolver.resolve(name)
    if (!path.startsWith(`${resolve(runtime)}${sep}`)) throw new Error(`Dependency escaped installed runtime: ${name}`)
  }
  return manifest
}
