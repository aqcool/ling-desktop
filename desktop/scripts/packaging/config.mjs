/** Native package targets share the verified physical runtime layout. */
import { join } from 'node:path'

export const RELEASE_TARGETS = [
  { platform: 'darwin', arch: 'arm64', runner: 'macos-15', format: 'dmg' },
  { platform: 'darwin', arch: 'x64', runner: 'macos-15-intel', format: 'dmg' },
  { platform: 'win32', arch: 'x64', runner: 'windows-2025', format: 'nsis' },
  { platform: 'linux', arch: 'x64', runner: 'ubuntu-24.04', format: 'AppImage' },
]
export function targetName(target) {
  return `${{ darwin: 'mac', win32: 'win', linux: 'linux' }[target.platform]}-${target.arch}`
}
export function nativeTarget(platform = process.platform, arch = process.arch) {
  const target = RELEASE_TARGETS.find(item => item.platform === platform && item.arch === arch)
  if (!target) throw new Error(`Unsupported native package target: ${platform}-${arch}`)
  return target
}
export function applicationLayout(output, target) {
  if (target.platform === 'darwin') {
    const app = join(output, target.arch === 'arm64' ? 'mac-arm64' : 'mac', 'LING.app')
    return { app, executable: join(app, 'Contents/MacOS/LING'), resources: join(app, 'Contents/Resources') }
  }
  const app = join(output, target.platform === 'win32' ? 'win-unpacked' : 'linux-unpacked')
  return { app, executable: join(app, target.platform === 'win32' ? 'LING.exe' : 'ling-desktop-app'), resources: join(app, 'resources') }
}
export function updateChannel(version) { return version.includes('-') ? 'dev' : 'latest' }
export function isPackageArtifact(name) {
  return /^LING-.+\.(dmg|zip|exe|AppImage|deb|blockmap)$/.test(name)
    || /^(dev|latest)(-mac|-linux)?\.yml$/.test(name)
}
export function updateMetadataName(version, target) {
  return `${updateChannel(version)}${target.platform === 'darwin' ? '-mac' : target.platform === 'linux' ? '-linux' : ''}.yml`
}
export function releaseBuild(target, environment) {
  if (environment.LING_RELEASE_BUILD !== '1') return false
  if (environment.CI !== 'true') throw new Error('LING_RELEASE_BUILD=1 requires CI=true; local packages do not enable automatic updates')
  const required = target.platform === 'darwin'
    ? ['CSC_LINK', 'CSC_KEY_PASSWORD', 'CSC_NAME', 'APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID']
    : target.platform === 'win32' ? ['WIN_CSC_LINK', 'WIN_CSC_KEY_PASSWORD', 'LING_WINDOWS_PUBLISHER_NAME'] : []
  const missing = required.filter(name => !environment[name]?.trim())
  if (missing.length) throw new Error(`Signed LING release requires configured credentials: ${missing.join(', ')}`)
  if (target.platform === 'darwin' && !environment.CSC_NAME.startsWith('Developer ID Application:')) throw new Error('CSC_NAME must identify a Developer ID Application certificate')
  return true
}
export function updatePolicy(version, enabled) {
  return { schemaVersion: 1, enabled, channel: updateChannel(version), provider: 'github', owner: 'aqcool', repo: 'ling-desktop' }
}
export function packageConfiguration({ appRoot, runtimeRoot, output, electronDist, version, icon, target, release = false, environment = {}, policyPath }) {
  const common = {
    appId: 'com.ling.desktop', productName: 'LING', electronVersion: '44.0.0',
    artifactName: `LING-\${version}-${targetName(target)}.\${ext}`,
    directories: { app: appRoot, output }, extraMetadata: { version },
    asar: true, electronDist,
    // The frozen production graph is already materialized. Disable Builder's
    // second workspace traversal, which would duplicate it inside app.asar.
    beforeBuild: async () => false,
    files: ['main.mjs', 'package.json'],
    extraResources: [
      { from: runtimeRoot, to: 'runtime', filter: ['**/*'] },
      { from: `${runtimeRoot}/node_modules`, to: 'runtime/node_modules', filter: ['**/*'] },
      ...(policyPath ? [{ from: policyPath, to: 'ling-update-policy.json' }] : []),
    ],
    electronFuses: { runAsNode: true, resetAdHocDarwinSignature: true },
    // Generate feed files without uploading. Only the final release job publishes.
    publish: release ? { provider: 'github', owner: 'aqcool', repo: 'ling-desktop', tagNamePrefix: 'ling-v', channel: updateChannel(version) } : null,
    detectUpdateChannel: false, generateUpdatesFilesForAllChannels: false, electronUpdaterCompatibility: '>=6.8.11',
    forceCodeSigning: release && target.platform !== 'linux',
  }
  if (target.platform === 'darwin') return { ...common,
    mac: { target: (release ? ['dmg', 'zip'] : ['dmg']).map(value => ({ target: value, arch: [target.arch] })), icon, category: 'public.app-category.developer-tools',
      // Builder chooses the Developer ID certificate class and rejects the type
      // prefix in its qualifier; CI stores the complete identity for clarity.
      identity: release ? environment.CSC_NAME.replace(/^Developer ID Application:\s*/, '') : '-', hardenedRuntime: release, notarize: release,
      signIgnore: ['/Contents/Resources/runtime(?:/|$)'] },
    dmg: { sign: release, writeUpdateInfo: release },
  }
  if (target.platform === 'win32') return { ...common,
    // The retained long-path installer manifest requires modern makensis.
    toolsets: { nsis: '1.2.1' },
    win: { target: [{ target: 'nsis', arch: [target.arch] }], icon,
      ...(release ? { signtoolOptions: { publisherName: environment.LING_WINDOWS_PUBLISHER_NAME }, verifyUpdateCodeSignature: true } : {}) },
    nsis: { oneClick: false, perMachine: false, allowToChangeInstallationDirectory: true,
      deleteAppDataOnUninstall: false, createDesktopShortcut: false },
  }
  return { ...common,
    linux: { target: [{ target: 'AppImage', arch: [target.arch] }, { target: 'deb', arch: [target.arch] }],
      icon, category: 'Development', executableName: 'ling-desktop-app', syncDesktopName: true,
      maintainer: 'LING Desktop <aqcool@users.noreply.github.com>' },
  }
}
export function releaseBuildEnvironment(environment) {
  return { ...Object.fromEntries(Object.entries(environment).filter(([name]) => !/^(?:GH_TOKEN|GITHUB_TOKEN|GITHUB_RELEASE_TOKEN)$/.test(name))), CSC_IDENTITY_AUTO_DISCOVERY: 'true' }
}
export function localBuildEnvironment(environment) {
  return Object.fromEntries([...Object.entries(environment).filter(([name]) =>
    !/^(?:CSC_|WIN_CSC_|APPLE_|DSH_DESKTOP_.*(?:SIGN|TOKEN|CER|PIN|NOTAR|COS|UPDATE)|GH_TOKEN$|GITHUB_TOKEN$|GITHUB_RELEASE_TOKEN$)/i.test(name)),
  ['CSC_IDENTITY_AUTO_DISCOVERY', 'false']])
}
