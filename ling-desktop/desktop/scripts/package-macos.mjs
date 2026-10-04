/** LING's local macOS arm64 application/DMG gate; never publishes or opens UI. */
import { execFile, spawn } from 'node:child_process'
import { chmod, cp, mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { macConfiguration, localBuildEnvironment } from './packaging/config.mjs'
import { BOOTSTRAP, json, materializeRuntime, verifyRuntime } from './packaging/runtime.mjs'

const execute = promisify(execFile)
const hostRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const repository = resolve(hostRoot, '../..')
const require = createRequire(join(hostRoot, 'package.json'))
const target = { platform: 'darwin', arch: 'arm64' }
const directoryOnly = process.argv.includes('--dir')
const verifyOnly = process.argv.includes('--verify')
if (process.argv.slice(2).some(value => !['--dir', '--verify'].includes(value))) throw new Error('Usage: package-macos.mjs [--dir] [--verify]')
if (process.platform !== target.platform || process.arch !== target.arch) throw new Error('This LING target requires a native macOS arm64 host')

const environment = localBuildEnvironment(process.env)
const staging = join(hostRoot, '.packaging', 'mac-arm64')
const output = join(hostRoot, 'dist', 'mac-arm64')
await mkdir(staging, { recursive: true })
const lock = join(staging, 'lock')
try { await mkdir(lock) } catch (error) { if (error.code === 'EEXIST') throw new Error('A LING packaging run is already active'); throw error }

function run(command, args, cwd, env = environment) {
  return new Promise((accept, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', code => code === 0 ? accept() : reject(new Error(`${command} exited ${code}`)))
  })
}
async function smoke(executable, runtime) {
  const result = await execute(executable, ['--expose-internals', join(hostRoot, 'scripts/packaging/smoke.mjs'), runtime], {
    cwd: tmpdir(), env: { ...environment, ELECTRON_RUN_AS_NODE: '1', NODE_PATH: '', NODE_OPTIONS: '' }, timeout: 150_000, maxBuffer: 2 * 1024 * 1024,
  })
  // Emit only the probe result, not Host diagnostics/authentication URLs.
  const line = result.stdout.trim().split('\n').at(-1)
  const report = JSON.parse(line)
  if (report.verified?.length !== 4) throw new Error('Installed runtime smoke report is incomplete')
  console.log(`LING runtime verified: ${report.verified.join(', ')}`)
  return report
}
async function verifyDiskImage(path) {
  await execute('/usr/bin/hdiutil', ['verify', path], { timeout: 120_000 })
  const mount = await mkdtemp(join(tmpdir(), 'ling-package-image-'))
  let mounted = false
  try {
    await execute('/usr/bin/hdiutil', ['attach', '-readonly', '-nobrowse', '-mountpoint', mount, path], { timeout: 120_000 })
    mounted = true
    await verifyRuntime(join(mount, 'LING.app/Contents/Resources/runtime'), target)
    await execute('/usr/bin/codesign', ['--verify', '--deep', '--strict', join(mount, 'LING.app')])
  } finally {
    if (mounted) await execute('/usr/bin/hdiutil', ['detach', mount], { timeout: 30_000 })
    await rm(mount, { recursive: true, force: true })
  }
  console.log(`LING disk image verified: ${path}`)
}

try {
  const appPath = join(output, 'mac-arm64', 'LING.app')
  const finalRuntime = join(appPath, 'Contents/Resources/runtime')
  if (verifyOnly) {
    await verifyRuntime(finalRuntime, target)
    await smoke(join(appPath, 'Contents/MacOS/LING'), finalRuntime)
  } else {
    // This gate builds and tests both LING workspaces, never a reference product.
    await run('corepack', ['yarn', 'check:ling'], repository)
    const build = await mkdtemp(join(staging, 'prepare-'))
    try {
      const runtime = join(build, 'runtime'), app = join(build, 'app')
      const version = (await json(join(hostRoot, 'package.json'))).version
      const commit = (await execute('git', ['rev-parse', 'HEAD'], { cwd: repository })).stdout.trim()
      const dirty = (await execute('git', ['status', '--porcelain', '--', 'ling-desktop', 'package.json', 'yarn.lock'], { cwd: repository })).stdout.trim() !== ''
      await chmod(join(hostRoot, 'scripts/node-bin/node'), 0o755)
      const manifest = await materializeRuntime({ hostRoot, runtime, target, sourceRevision: { commit, dirty } })
      await verifyRuntime(runtime, target)
      const electronDist = join(dirname(require.resolve('electron/package.json')), 'dist')
      await smoke(join(electronDist, 'Electron.app/Contents/MacOS/Electron'), runtime)
      await mkdir(app)
      await writeFile(join(app, 'package.json'), `${JSON.stringify({ name: 'ling-desktop-app', productName: 'LING', version, private: true, type: 'module', main: 'main.mjs', description: 'LING local desktop application', license: 'MIT' }, null, 2)}\n`)
      await writeFile(join(app, 'main.mjs'), BOOTSTRAP)
      const config = macConfiguration({ appRoot: app, runtimeRoot: runtime, output, electronDist, version,
        icon: join(hostRoot, 'assets/application-icons/fold-coral.png') })
      const { build: buildElectron, Platform, Arch } = require('electron-builder')
      const paths = await buildElectron({ projectDir: hostRoot, config,
        targets: Platform.MAC.createTarget(directoryOnly ? ['dir'] : ['dmg'], Arch.arm64), publish: 'never' })
      // Audit the actual output bytes and package bootstrap, then relocate a
      // complete .app outside the checkout to detect source-path dependencies.
      const asar = createRequire(require.resolve('app-builder-lib'))('@electron/asar')
      const archive = join(appPath, 'Contents/Resources/app.asar')
      if (JSON.stringify(asar.listPackage(archive).sort()) !== JSON.stringify(['/main.mjs', '/package.json'])) throw new Error('Unexpected dependencies or files inside application bootstrap ASAR')
      if (asar.extractFile(archive, 'main.mjs').toString() !== BOOTSTRAP) throw new Error('Packaged bootstrap does not match LING')
      await verifyRuntime(finalRuntime, target)
      const relocated = await mkdtemp(join(tmpdir(), 'ling-installed-app-'))
      let report
      try {
        const copy = join(relocated, 'LING.app')
        // Electron frameworks use relative symlinks that are part of the
        // signed bundle. Preserve them when checking a relocated application.
        await cp(appPath, copy, { recursive: true, dereference: false, verbatimSymlinks: true })
        report = await smoke(join(copy, 'Contents/MacOS/LING'), join(copy, 'Contents/Resources/runtime'))
      } finally { await rm(relocated, { recursive: true, force: true }) }
      await execute('/usr/bin/codesign', ['--verify', '--deep', '--strict', appPath])
      await execute('/usr/bin/plutil', ['-lint', join(appPath, 'Contents/Info.plist')])
      for (const path of paths.filter(path => path.endsWith('.dmg'))) await verifyDiskImage(path)
      const reportPath = join(output, 'packaging-report.json')
      const reportTemporary = `${reportPath}.tmp`
      await writeFile(reportTemporary, `${JSON.stringify({ schemaVersion: 1, version, upstreamVersion: manifest.upstreamVersion,
        target, localTestBuild: true, notarized: false, packageCount: manifest.packages.length,
        runtimeBytes: manifest.files.reduce((sum, file) => sum + file.size, 0), runtimeFiles: manifest.files.length,
        artifacts: [appPath, ...paths.filter(path => path.endsWith('.dmg'))], relocatedRuntime: report }, null, 2)}\n`)
      await rename(reportTemporary, reportPath)
      console.log(`LING macOS arm64 package verified: ${appPath}`)
      for (const path of paths.filter(path => path.endsWith('.dmg'))) console.log(`LING disk image: ${path}`)
    } finally { await rm(build, { recursive: true, force: true }) }
  }
} finally { await rm(lock, { recursive: true, force: true }) }
