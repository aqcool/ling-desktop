/** Check the pinned, pruned DSH artifacts against the pnpm dependency graph. */
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(resolve(root, 'desktop/package.json'))
const { parse } = require('yaml')
const config = parse(readFileSync(resolve(root, 'pnpm-workspace.yaml'), 'utf8'))
const lock = parse(readFileSync(resolve(root, 'pnpm-lock.yaml'), 'utf8'))
const version = '0.1.6-alpha.2'
const prefix = `vendor/dsh-runtime/${version}/`
const runtimeRoot = resolve(root, prefix)
const provenance = JSON.parse(readFileSync(resolve(runtimeRoot, 'manifest.json'), 'utf8'))
if (provenance.version !== version || !/^[a-f0-9]{40}$/.test(provenance.commit)
  || provenance.repository !== 'https://github.com/deepseek-ai/deepseek-harness.git') throw new Error('Invalid pinned DSH provenance')
const archives = new Set(readdirSync(runtimeRoot).filter(name => name.endsWith('.tgz')))
const recorded = new Set(provenance.packages.map(pkg => pkg.filename))
const used = new Set(Object.keys(lock.packages).flatMap(key => {
  const path = key.slice(key.indexOf('@file:') + 6)
  return key.includes('@file:') && path.startsWith(prefix) ? [path.slice(prefix.length)] : []
}))
if ([archives, recorded, used].some(set => set.size !== archives.size)
  || [...archives].some(name => !recorded.has(name) || !used.has(name))) throw new Error('DSH archives, provenance and pnpm dependency graph differ')
for (const pkg of provenance.packages) {
  const bytes = readFileSync(resolve(runtimeRoot, pkg.filename))
  if (pkg.version !== version || bytes.length !== pkg.size
    || createHash('sha256').update(bytes).digest('hex') !== pkg.sha256) throw new Error(`DSH artifact checksum mismatch: ${pkg.filename}`)
}
for (const [name, target] of Object.entries(config.overrides ?? {})) {
  if (target.startsWith('file:') && (!target.startsWith(`file:${prefix}`) || !archives.has(target.slice(5 + prefix.length)))) throw new Error(`Invalid LING artifact override: ${name}`)
}
for (const [name, path] of Object.entries(config.patchedDependencies ?? {})) {
  const hash = createHash('sha256').update(readFileSync(resolve(root, path))).digest('hex')
  if (lock.patchedDependencies?.[name] !== hash) throw new Error(`Patch is not locked: ${name}`)
}
const renderer = JSON.parse(readFileSync(resolve(root, 'package.json')))
const host = JSON.parse(readFileSync(resolve(root, 'desktop/package.json')))
if (renderer.packageManager !== 'pnpm@11.8.0' || host.dependencies['ling-desktop'] !== 'workspace:*'
  || config.packages.length !== 1 || config.packages[0] !== 'desktop') throw new Error('Invalid LING workspace layout')
for (const os of ['darwin', 'linux']) if (!config.supportedArchitectures.os.includes(os)) throw new Error(`Missing SSH OS: ${os}`)
for (const cpu of ['arm64', 'x64']) if (!config.supportedArchitectures.cpu.includes(cpu)) throw new Error(`Missing SSH CPU: ${cpu}`)
console.log(`LING runtime: ${archives.size} pinned archives, ${Object.keys(config.patchedDependencies).length} locked patches`)
