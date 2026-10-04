/** LING local macOS build. The official Desktop pattern is ASAR plus external
 * resources; our existing Host/profile needs the entire runtime to be physical.
 * This target is ad-hoc signed for local testing, never a Developer ID release.
 */
export function macConfiguration({ appRoot, runtimeRoot, output, electronDist, version, icon }) {
  return {
    appId: 'com.ling.desktop', productName: 'LING', electronVersion: '44.0.0',
    artifactName: 'LING-${version}-mac-${arch}.${ext}',
    directories: { app: appRoot, output },
    extraMetadata: { version },
    asar: true, electronDist,
    // The production graph is prepared and verified above. A falsy hook
    // result also disables Builder's workspace dependency collection, which
    // would otherwise duplicate the physical runtime inside app.asar.
    beforeBuild: async () => false,
    files: ['main.mjs', 'package.json'],
    // Builder omits a source directory's root node_modules. The official
    // Desktop also supplies it as a separate explicit file set.
    extraResources: [
      { from: runtimeRoot, to: 'runtime', filter: ['**/*'] },
      { from: `${runtimeRoot}/node_modules`, to: 'runtime/node_modules', filter: ['**/*'] },
    ],
    electronFuses: { runAsNode: true, resetAdHocDarwinSignature: true },
    mac: {
      target: [{ target: 'dmg', arch: ['arm64'] }], icon,
      category: 'public.app-category.developer-tools',
      identity: '-', hardenedRuntime: false, notarize: false,
      // Preserve prepared native-file bytes and their manifest. Formal releases
      // must sign these files before materialization, as official Desktop does.
      signIgnore: ['/Contents/Resources/runtime(?:/|$)'],
    },
    dmg: { sign: false, writeUpdateInfo: false },
    publish: null,
  }
}

export function localBuildEnvironment(environment) {
  return Object.fromEntries([...Object.entries(environment).filter(([name]) =>
    !/^(?:CSC_|WIN_CSC_|APPLE_|DSH_DESKTOP_.*(?:SIGN|TOKEN|CER|PIN|NOTAR|COS|UPDATE)|GH_TOKEN$|GITHUB_TOKEN$)/i.test(name)),
  ['CSC_IDENTITY_AUTO_DISCOVERY', 'false']])
}
