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
export function packageConfiguration({ appRoot, runtimeRoot, output, electronDist, version, icon, target }) {
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
    ],
    electronFuses: { runAsNode: true, resetAdHocDarwinSignature: true },
    publish: null,
  }
  if (target.platform === 'darwin') return { ...common,
    mac: { target: [{ target: 'dmg', arch: [target.arch] }], icon, category: 'public.app-category.developer-tools',
      identity: '-', hardenedRuntime: false, notarize: false,
      signIgnore: ['/Contents/Resources/runtime(?:/|$)'] },
    dmg: { sign: false, writeUpdateInfo: false },
  }
  if (target.platform === 'win32') return { ...common,
    // The retained long-path installer manifest requires modern makensis.
    toolsets: { nsis: '1.2.1' },
    win: { target: [{ target: 'nsis', arch: [target.arch] }], icon },
    nsis: { oneClick: false, perMachine: false, allowToChangeInstallationDirectory: true,
      deleteAppDataOnUninstall: false, createDesktopShortcut: false },
  }
  return { ...common,
    linux: { target: [{ target: 'AppImage', arch: [target.arch] }, { target: 'deb', arch: [target.arch] }],
      icon, category: 'Development', executableName: 'ling-desktop-app', syncDesktopName: true,
      maintainer: 'LING Desktop <aqcool@users.noreply.github.com>' },
  }
}
export function localBuildEnvironment(environment) {
  return Object.fromEntries([...Object.entries(environment).filter(([name]) =>
    !/^(?:CSC_|WIN_CSC_|APPLE_|DSH_DESKTOP_.*(?:SIGN|TOKEN|CER|PIN|NOTAR|COS|UPDATE)|GH_TOKEN$|GITHUB_TOKEN$)/i.test(name)),
  ['CSC_IDENTITY_AUTO_DISCOVERY', 'false']])
}
