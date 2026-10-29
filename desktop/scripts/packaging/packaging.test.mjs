import assert from 'node:assert/strict'
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, win32 } from 'node:path'
import { test } from 'node:test'
import { BOOTSTRAP, excludedFile, installedPackage, materializeRuntime, supportsTarget, verifyBootstrapArchive, verifyRuntime } from './runtime.mjs'
import { localBuildEnvironment, releaseBuildEnvironment, releaseBuild, updateChannel, updatePolicy, packageConfiguration, nativeTarget, applicationLayout, RELEASE_TARGETS, targetName, isPackageArtifact } from './config.mjs'
import { isMachO } from './signing.mjs'

const target = { platform: 'darwin', arch: 'arm64' }
const require = createRequire(import.meta.url)
test('Builder diagnostics are not updater feeds or release artifacts', () => {
  for (const name of ['builder-debug.yml', 'builder-effective-config.yaml', 'notes.yml']) assert.equal(isPackageArtifact(name), false)
  for (const name of ['dev-mac.yml', 'latest-linux.yml', 'latest.yml', 'LING-1.0.0-mac-arm64.zip', 'LING-1.0.0-win-x64.exe.blockmap']) assert.equal(isPackageArtifact(name), true)
})
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

test('bootstrap ASAR audit accepts Windows separators and still rejects extra files or changed code', async () => {
  const builderRequire = createRequire(require.resolve('electron-builder'))
  const asar = createRequire(builderRequire.resolve('app-builder-lib'))('@electron/asar')
  const scratch = await mkdtemp(join(tmpdir(), 'ling-bootstrap-archive-'))
  try {
    const source = join(scratch, 'app'), archive = join(scratch, 'app.asar')
    await mkdir(source)
    await writeFile(join(source, 'main.mjs'), BOOTSTRAP)
    await writeFile(join(source, 'package.json'), '{"main":"main.mjs"}')
    await asar.createPackage(source, archive)
    const windowsAsar = { ...asar, listPackage(path) { return asar.listPackage(path).map(file => win32.normalize(file)) } }
    verifyBootstrapArchive(asar, archive)
    verifyBootstrapArchive(windowsAsar, archive)
    await writeFile(join(source, 'unexpected.cjs'), 'injected')
    const extra = join(scratch, 'extra.asar')
    await asar.createPackage(source, extra)
    assert.throws(() => verifyBootstrapArchive(windowsAsar, extra), /Unexpected files/)
    await rm(join(source, 'unexpected.cjs'))
    await writeFile(join(source, 'main.mjs'), 'altered')
    const changed = join(scratch, 'changed.asar')
    await asar.createPackage(source, changed)
    assert.throws(() => verifyBootstrapArchive(windowsAsar, changed), /bootstrap does not match/)
  } finally { await rm(scratch, { recursive: true, force: true }) }
})

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
    assert.equal((await installedPackage('shared', join(runtime, 'node_modules/b/package.json'), runtime)).manifest.version, '2.0.0')
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

test('absent optional peers ignore ancestor and external symlink packages while workspace hoisting still resolves', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'ling-dependency-boundary-'))
  const workspace = join(scratch, 'workspace'), source = join(workspace, 'desktop'), runtime = join(scratch, 'runtime')
  try {
    await hostAt(source, { consumer: '1.0.0', hoisted: '1.0.0' })
    await packageAt(join(source, 'node_modules/consumer'), { name: 'consumer', version: '1.0.0',
      peerDependencies: { '@modelcontextprotocol/sdk': '1.0.0', 'linked-peer': '1.0.0', 'local-peer': '1.0.0' },
      peerDependenciesMeta: { '@modelcontextprotocol/sdk': { optional: true }, 'linked-peer': { optional: true }, 'local-peer': { optional: true } } })
    await packageAt(join(workspace, 'node_modules/hoisted'), { name: 'hoisted', version: '1.0.0' })
    await packageAt(join(source, 'node_modules/local-peer'), { name: 'local-peer', version: '1.0.0' })
    // Reproduce a user's unrelated home install with an incomplete dependency graph.
    await packageAt(join(scratch, 'node_modules/@modelcontextprotocol/sdk'), { name: '@modelcontextprotocol/sdk', version: '1.0.0', dependencies: { '@hono/node-server': '1.0.0' } })
    const external = join(scratch, 'external-peer')
    await packageAt(external, { name: 'linked-peer', version: '1.0.0' })
    await symlink(external, join(source, 'node_modules/linked-peer'), process.platform === 'win32' ? 'junction' : 'dir')
    const manifest = await materializeRuntime({ hostRoot: source, runtime, target, dependencyRoot: workspace })
    assert.deepEqual(manifest.skippedOptional, ['@modelcontextprotocol/sdk', 'linked-peer'])
    assert.deepEqual(manifest.packages.map(item => item.name).sort(), ['consumer', 'hoisted', 'ling-desktop-host', 'local-peer'])
    await assert.rejects(installedPackage('@modelcontextprotocol/sdk', join(source, 'package.json'), workspace), { code: 'MODULE_NOT_FOUND' })
    await assert.rejects(installedPackage('linked-peer', join(source, 'package.json'), workspace), { code: 'MODULE_NOT_FOUND' })
  } finally { await rm(scratch, { recursive: true, force: true }) }
})

test('required dependencies cannot be satisfied by unrelated ancestor installs', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'ling-required-boundary-'))
  try {
    const source = join(scratch, 'workspace')
    await hostAt(source, { 'ancestor-only': '1.0.0' })
    await packageAt(join(scratch, 'node_modules/ancestor-only'), { name: 'ancestor-only', version: '1.0.0' })
    await assert.rejects(materializeRuntime({ hostRoot: source, runtime: join(scratch, 'runtime'), target }), /Missing production dependency ancestor-only/)
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
  assert.deepEqual(config.mac.target.map(item => item.target), ['dmg'])
  assert.deepEqual(localBuildEnvironment({ PATH: '/bin', CSC_LINK: 'secret', APPLE_ID: 'secret', GH_TOKEN: 'secret', CSC_IDENTITY_AUTO_DISCOVERY: 'true' }), { PATH: '/bin', CSC_IDENTITY_AUTO_DISCOVERY: 'false' })
})

test('the default release workflow publishes manual installers without signing credentials', async () => {
  const { parse } = require('yaml')
  const workflow = parse(await readFile(new URL('../../../.github/workflows/release.yml', import.meta.url), 'utf8'))
  const build = workflow.jobs.build
  assert.equal(build.env.LING_RELEASE_BUILD, '0')
  assert.equal(JSON.stringify(build).includes('secrets.LING_'), false)
  assert.equal(build.steps.some(step => /^Require .*signing/.test(step.name ?? '')), false)
  assert.ok(build.steps.some(step => step.run?.includes('release-assets.mjs --collect') && step.run.includes('--manual')))
  assert.ok(workflow.jobs.publish.steps.some(step => step.run?.includes('release-assets.mjs release-assets') && step.run.includes('--all --manual')))
  assert.deepEqual(workflow.jobs.publish.needs, ['prepare', 'build'])
  for (const target of RELEASE_TARGETS) {
    const signed = releaseBuild(target, { CI: 'true', ...build.env })
    assert.equal(signed, false)
    const config = packageConfiguration({ target, appRoot: '/app', runtimeRoot: '/runtime', output: '/out', electronDist: '/electron', icon: '/icon.png', version: '0.0.0-dev.13', release: signed })
    assert.equal(config.publish, null)
    assert.equal(config.forceCodeSigning, false)
    assert.equal(updatePolicy('0.0.0-dev.13', signed).enabled, false)
  }
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

test('update feeds require explicit CI signing credentials and isolate preview from stable', () => {
  assert.equal(releaseBuild(target, {}), false)
  assert.throws(() => releaseBuild(target, { LING_RELEASE_BUILD: '1' }), /requires CI/)
  assert.throws(() => releaseBuild(target, { LING_RELEASE_BUILD: '1', CI: 'true' }), /CSC_LINK.*APPLE_TEAM_ID/)
  const environment = { LING_RELEASE_BUILD: '1', CI: 'true', CSC_LINK: 'test-certificate', CSC_KEY_PASSWORD: 'test-password', CSC_NAME: 'Developer ID Application: LING (TESTTEAM)', APPLE_ID: 'test', APPLE_APP_SPECIFIC_PASSWORD: 'test', APPLE_TEAM_ID: 'TESTTEAM' }
  assert.equal(releaseBuild(target, environment), true)
  assert.throws(() => releaseBuild(nativeTarget('win32', 'x64'), environment), /WIN_CSC_LINK.*LING_WINDOWS_PUBLISHER_NAME/)
  assert.equal(releaseBuild(nativeTarget('linux', 'x64'), environment), true)
  for (const [version, channel] of [['1.0.0-dev.11', 'dev'], ['1.0.0', 'latest']]) {
    assert.equal(updateChannel(version), channel)
    const config = packageConfiguration({ target, appRoot: '/app', runtimeRoot: '/runtime', output: '/out', electronDist: '/electron', icon: '/icon', version, release: true, environment })
    assert.equal(config.publish.channel, channel)
    assert.equal(config.publish.tagNamePrefix, 'ling-v')
    assert.equal(config.generateUpdatesFilesForAllChannels, false)
    assert.equal(config.forceCodeSigning, true)
    assert.equal(config.mac.hardenedRuntime, true)
    assert.equal(config.mac.notarize, true)
    assert.equal(config.mac.identity, 'LING (TESTTEAM)')
    assert.deepEqual(config.mac.target.map(item => item.target), ['dmg', 'zip'])
    assert.deepEqual(config.mac.signIgnore, ['/Contents/Resources/runtime(?:/|$)'])
    assert.equal(updatePolicy(version, false).enabled, false)
  }
  assert.equal(releaseBuildEnvironment({ CSC_LINK: 'test', GH_TOKEN: 'test', GITHUB_TOKEN: 'test' }).CSC_LINK, 'test')
  assert.equal(releaseBuildEnvironment({ GH_TOKEN: 'test' }).GH_TOKEN, undefined)
  assert.equal(isMachO(Buffer.from('cffaedfe', 'hex')), true)
  assert.equal(isMachO(Buffer.from('7f454c46', 'hex')), false)
  assert.equal(isMachO(Buffer.from('1f8b0800', 'hex')), false)
})

test('release configurations validate against the pinned Builder schema on every platform', async () => {
  const builderRequire = createRequire(require.resolve('electron-builder'))
  const { validateConfiguration } = builderRequire('app-builder-lib/out/util/config/config')
  for (const target of RELEASE_TARGETS) {
    const config = packageConfiguration({ target, appRoot: '/app', runtimeRoot: '/runtime', output: '/out', electronDist: '/electron', icon: '/icon.png',
      version: '1.0.0-dev.1', release: true, environment: { CSC_NAME: 'Developer ID Application: Test (TEAM)', LING_WINDOWS_PUBLISHER_NAME: 'Test' } })
    await validateConfiguration(config, {})
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
