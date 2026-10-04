/** Build and qualify a native LING package without opening UI. */
import { execFile, spawn } from 'node:child_process'
import { chmod, cp, mkdir, mkdtemp, rename, rm, stat, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { packageConfiguration, nativeTarget, targetName, applicationLayout, localBuildEnvironment } from './packaging/config.mjs'
import { BOOTSTRAP, json, materializeRuntime, verifyBootstrapArchive, verifyRuntime } from './packaging/runtime.mjs'

const execute = promisify(execFile)
const hostRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const repository = resolve(hostRoot, '..')
const require = createRequire(join(hostRoot, 'package.json'))
const target = nativeTarget()
const name = targetName(target)
const directoryOnly = process.argv.includes('--dir')
const verifyOnly = process.argv.includes('--verify')
const expectedPlatform = process.argv.find(value => value.startsWith('--platform='))?.slice(11)
if (expectedPlatform && expectedPlatform !== target.platform) throw new Error('Use a native runner for the requested package platform')
if (process.argv.slice(2).some(value => !['--dir', '--verify', '--platform=darwin', '--platform=win32', '--platform=linux'].includes(value))) throw new Error('Usage: package-desktop.mjs [--dir] [--verify] [--platform=darwin|win32|linux]')

const environment = localBuildEnvironment(process.env)
const staging = join(hostRoot, '.packaging', name)
const output = join(hostRoot, 'dist', name)
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
async function prepareElectron() {
  // Resolve the binary before tests need it. A failed network download gets a
  // fresh installer process, not a skipped native test or a changed version.
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const result = await execute(process.execPath, ['-e', 'console.log(JSON.stringify(require("electron")))'], {
        cwd: hostRoot, env: environment, timeout: 180_000, maxBuffer: 2 * 1024 * 1024,
      })
      const executable = JSON.parse(result.stdout.trim().split('\n').at(-1))
      if (!(await stat(executable)).isFile()) throw new Error('Native Electron executable is missing')
      return executable
    } catch (error) {
      if (attempt === 3) throw error
      console.log(`Retrying native Electron preparation (${attempt}/3)`)
      await new Promise(accept => setTimeout(accept, 5000))
    }
  }
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
  const layout = applicationLayout(output, target)
  const appPath = layout.app
  const finalRuntime = join(layout.resources, 'runtime')
  if (verifyOnly) {
    await verifyRuntime(finalRuntime, target)
    await smoke(layout.executable, finalRuntime)
  } else {
    const electronExecutable = await prepareElectron()
    // This gate builds and tests both LING workspaces, never a reference product.
    const pnpm = join(dirname(require.resolve('pnpm')), 'bin/pnpm.mjs')
    await run(process.execPath, [pnpm, 'check'], repository)
    const build = await mkdtemp(join(staging, 'prepare-'))
    try {
      const runtime = join(build, 'runtime'), app = join(build, 'app')
      const version = (await json(join(hostRoot, 'package.json'))).version
      const commit = (await execute('git', ['rev-parse', 'HEAD'], { cwd: repository })).stdout.trim()
      const dirty = (await execute('git', ['status', '--porcelain'], { cwd: repository })).stdout.trim() !== ''
      await chmod(join(hostRoot, 'scripts/node-bin/node'), 0o755)
      const manifest = await materializeRuntime({ hostRoot, runtime, target, sourceRevision: { commit, dirty } })
      await verifyRuntime(runtime, target)
      const electronDist = join(dirname(require.resolve('electron/package.json')), 'dist')
      await smoke(electronExecutable, runtime)
      await mkdir(app)
      await writeFile(join(app, 'package.json'), `${JSON.stringify({ name: 'ling-desktop-app', productName: 'LING', version, private: true, type: 'module', main: 'main.mjs', description: 'LING local desktop application', license: 'MIT', homepage: 'https://github.com/aqcool/ling-desktop', author: { name: 'LING Desktop', email: 'aqcool@users.noreply.github.com' }, desktopName: 'com.ling.desktop' }, null, 2)}\n`)
      await writeFile(join(app, 'main.mjs'), BOOTSTRAP)
      const config = packageConfiguration({ appRoot: app, runtimeRoot: runtime, output, electronDist, version,
        icon: join(hostRoot, 'assets/application-icons/fold-coral.png'), target })
      const { build: buildElectron, Platform, Arch } = require('electron-builder')
      const paths = await buildElectron({ projectDir: hostRoot, config,
        targets: Platform.fromString(target.platform).createTarget(directoryOnly ? ['dir'] : target.platform === 'linux' ? ['AppImage', 'deb'] : [target.format], Arch[target.arch]), publish: 'never' })
      // Audit the actual output bytes and package bootstrap, then relocate a
      // complete .app outside the checkout to detect source-path dependencies.
      const builderRequire = createRequire(require.resolve('electron-builder'))
      const asar = createRequire(builderRequire.resolve('app-builder-lib'))('@electron/asar')
      const archive = join(layout.resources, 'app.asar')
      verifyBootstrapArchive(asar, archive)
      await verifyRuntime(finalRuntime, target)
      const relocated = await mkdtemp(join(tmpdir(), 'ling-installed-app-'))
      let report
      try {
        const copy = join(relocated, target.platform === 'darwin' ? 'LING.app' : 'LING')
        // Electron frameworks use relative symlinks that are part of the
        // signed bundle. Preserve them when checking a relocated application.
        await cp(appPath, copy, { recursive: true, dereference: false, verbatimSymlinks: true })
        const relativeExecutable = target.platform === 'darwin' ? 'Contents/MacOS/LING' : target.platform === 'win32' ? 'LING.exe' : 'ling-desktop-app'
        const relativeResources = target.platform === 'darwin' ? 'Contents/Resources' : 'resources'
        report = await smoke(join(copy, relativeExecutable), join(copy, relativeResources, 'runtime'))
      } finally { await rm(relocated, { recursive: true, force: true }) }
      if (target.platform === 'darwin') {
        await execute('/usr/bin/codesign', ['--verify', '--deep', '--strict', appPath])
        await execute('/usr/bin/plutil', ['-lint', join(appPath, 'Contents/Info.plist')])
      }
      for (const path of paths.filter(path => path.endsWith('.dmg'))) await verifyDiskImage(path)
      const reportPath = join(output, 'packaging-report.json')
      const reportTemporary = `${reportPath}.tmp`
      await writeFile(reportTemporary, `${JSON.stringify({ schemaVersion: 1, version, upstreamVersion: manifest.upstreamVersion,
        target, signed: target.platform === 'darwin' ? 'ad-hoc' : false, notarized: false, packageCount: manifest.packages.length,
        runtimeBytes: manifest.files.reduce((sum, file) => sum + file.size, 0), runtimeFiles: manifest.files.length,
        artifacts: [appPath, ...paths.filter(path => /\.(dmg|exe|AppImage|deb)$/.test(path))], relocatedRuntime: report }, null, 2)}\n`)
      await rename(reportTemporary, reportPath)
      console.log(`LING ${name} package verified: ${appPath}`)
      for (const path of paths.filter(path => /\.(dmg|exe|AppImage|deb)$/.test(path))) console.log(`LING installer: ${path}`)
    } finally { await rm(build, { recursive: true, force: true }) }
  }
} finally { await rm(lock, { recursive: true, force: true }) }
