import assert from 'node:assert/strict'
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { excludedFile, installedPackage, materializeRuntime, supportsTarget, verifyRuntime } from './runtime.mjs'
import { localBuildEnvironment, packageConfiguration, nativeTarget, applicationLayout, RELEASE_TARGETS, targetName } from './config.mjs'

const target = { platform: 'darwin', arch: 'arm64' }
async function packageAt(path, manifest, body = 'module.exports = 1') {
  await mkdir(path, { recursive: true })
  await writeFile(join(path, 'package.json'), JSON.stringify({ main: 'index.cjs', ...manifest }))
  await writeFile(join(path, 'index.cjs'), body)
}
async function hostAt(path, dependencies) {
  await packageAt(path, { name: 'ling-desktop-host', version: '0.0.0-dev.0', dependencies })
  for (const directory of ['lib', 'assets', 'scripts/node-bin']) await mkdir(join(path, directory), { recursive: true })
  await writeFile(join(path, 'lib/main.js'), 'export {}')
  for (const file of ['cordis.patch.yml', 'host.cordis.patch.yml', 'scripts/node-bin/node']) await writeFile(join(path, file), '')
}

test('materialized Node graph preserves nested versions and works after the source is removed', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'ling-production-graph-'))
  const source = join(scratch, 'source'), runtime = join(scratch, 'runtime')
  try {
    await hostAt(source, { a: '1.0.0', b: '1.0.0', shared: '1.0.0' })
    await packageAt(join(source, 'node_modules/a'), { name: 'a', version: '1.0.0', dependencies: { shared: '1.0.0' } }, "module.exports = require('shared')")
    await packageAt(join(source, 'node_modules/b'), { name: 'b', version: '1.0.0', dependencies: { shared: '2.0.0' }, optionalDependencies: { absent: '1.0.0', foreign: '1.0.0' } }, "module.exports = require('shared')")
    await packageAt(join(source, 'node_modules/shared'), { name: 'shared', version: '1.0.0', exports: { '.': './index.cjs' } }, "module.exports = 'v1'")
    await packageAt(join(source, 'node_modules/b/node_modules/shared'), { name: 'shared', version: '2.0.0' }, "module.exports = 'v2'")
    await packageAt(join(source, 'node_modules/foreign'), { name: 'foreign', version: '1.0.0', os: ['win32'] })
    await mkdir(join(source, 'node_modules/a/.bin'))
    await symlink(join(source, 'index.cjs'), join(source, 'node_modules/a/.bin/source-link'))
    const manifest = await materializeRuntime({ hostRoot: source, runtime, target })
    assert.deepEqual(manifest.skippedOptional, ['absent', 'foreign'])
    await rm(source, { recursive: true })
    const require = createRequire(join(runtime, 'node_modules/ling-desktop-host/package.json'))
    assert.equal(require('a'), 'v1')
    assert.equal(require('b'), 'v2')
    assert.equal((await installedPackage('shared', join(runtime, 'node_modules/b/package.json'))).manifest.version, '2.0.0')
    assert.equal(manifest.packages.filter(item => item.name === 'shared').length, 2)
  } finally { await rm(scratch, { recursive: true, force: true }) }
})

test('missing required production dependency fails preparation instead of shipping a partial app', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'ling-missing-dependency-'))
  try {
    await hostAt(join(scratch, 'source'), { unavailable: '1.0.0' })
    await assert.rejects(materializeRuntime({ hostRoot: join(scratch, 'source'), runtime: join(scratch, 'runtime'), target }), /Missing production dependency/)
  } finally { await rm(scratch, { recursive: true, force: true }) }
})

test('final runtime verification rejects altered executable permissions and resource bytes', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'ling-integrity-'))
  try {
    const source = join(scratch, 'source'), runtime = join(scratch, 'runtime')
    await hostAt(source, {})
    await materializeRuntime({ hostRoot: source, runtime, target })
    const file = join(runtime, 'node_modules/ling-desktop-host/scripts/node-bin/node')
    if (process.platform !== 'win32') {
      await chmod(file, 0o755)
      await assert.rejects(verifyRuntime(runtime, target), /permissions differ/)
      await chmod(file, 0o644)
    }
    await writeFile(file, 'altered')
    await assert.rejects(verifyRuntime(runtime, target), /content or executable permissions differ/)
  } finally { await rm(scratch, { recursive: true, force: true }) }
})

test('target filtering retains unknown assets and the selected native slice', () => {
  assert.equal(supportsTarget({ os: ['darwin'], cpu: ['arm64'] }, target), true)
  assert.equal(supportsTarget({ os: ['!darwin'] }, target), false)
  assert.equal(excludedFile('prebuilds/darwin-arm64/pty.node', target), false)
  assert.equal(excludedFile('prebuilds/linux-x64/pty.node', target), true)
  assert.equal(excludedFile('program/unknown-resource.dat', target), false)
  assert.equal(excludedFile('node_modules/hidden-source-link', target), true)
})

test('local configuration keeps runtime physical, ASAR small, and release credentials out', async () => {
  const config = packageConfiguration({ target, appRoot: '/stage/app', runtimeRoot: '/stage/runtime', output: '/output', electronDist: '/electron', version: '0.0.0-dev.0', icon: '/icon.png' })
  assert.equal(config.asar, true)
  assert.equal(config.electronFuses.runAsNode, true)
  assert.deepEqual(config.extraResources, [
    { from: '/stage/runtime', to: 'runtime', filter: ['**/*'] },
    { from: '/stage/runtime/node_modules', to: 'runtime/node_modules', filter: ['**/*'] },
  ])
  assert.deepEqual(config.files, ['main.mjs', 'package.json'])
  assert.equal(await config.beforeBuild(), false)
  assert.equal(config.publish, null)
  assert.equal(config.mac.notarize, false)
  assert.deepEqual(localBuildEnvironment({ PATH: '/bin', CSC_LINK: 'secret', APPLE_ID: 'secret', GH_TOKEN: 'secret', CSC_IDENTITY_AUTO_DISCOVERY: 'true' }), { PATH: '/bin', CSC_IDENTITY_AUTO_DISCOVERY: 'false' })
})

test('release targets have distinct native installers and predictable application paths', () => {
  assert.equal(RELEASE_TARGETS.length, 4)
  assert.throws(() => nativeTarget('freebsd', 'x64'), /Unsupported/)
  assert.throws(() => nativeTarget('win32', 'arm64'), /Unsupported/)
  for (const target of RELEASE_TARGETS) {
    assert.equal(nativeTarget(target.platform, target.arch), target)
    const config = packageConfiguration({ appRoot: '/app', runtimeRoot: '/runtime', output: '/output', electronDist: '/electron', version: '0.1.0-beta.1', icon: '/icon.png', target })
    assert.ok(config.artifactName.includes(targetName(target)))
    const layout = applicationLayout('/output', target)
    assert.ok(layout.executable.startsWith(layout.app))
    if (target.platform === 'darwin') assert.deepEqual(config.mac.target[0].arch, [target.arch])
    if (target.platform === 'win32') { assert.equal(config.win.target[0].target, 'nsis'); assert.equal(config.nsis.deleteAppDataOnUninstall, false) }
    if (target.platform === 'linux') assert.deepEqual(config.linux.target.map(item => item.target), ['AppImage', 'deb'])
  }
})

test('SSH archives preserve Unix helper execution permissions when prepared on Windows', async () => {
  const { writeSshArchive } = await import('../ssh-archive.mjs')
  const { list } = await import('tar')
  const root = await mkdtemp(join(tmpdir(), 'ling-ssh-permissions-'))
  try {
    for (const file of ['spawn-helper', 'landlock-run', 'helper.js']) await writeFile(join(root, file), 'fixture')
    const archive = join(root, 'runtime.tar')
    await writeSshArchive(archive, root, ['spawn-helper', 'landlock-run', 'helper.js'], 'win32')
    const modes = {}
    await list({ file: archive, onReadEntry(entry) { modes[entry.path] = entry.mode & 0o777 } })
    assert.deepEqual(modes, { 'spawn-helper': 0o755, 'landlock-run': 0o755, 'helper.js': 0o644 })
  } finally { await rm(root, { recursive: true, force: true }) }
})
