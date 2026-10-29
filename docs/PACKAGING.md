# LING packaging and releases

LING uses one pnpm workspace: the Renderer is at the repository root and the
Electron/DSH Host is in `desktop/`. Install the frozen graph with:

```sh
corepack pnpm install --frozen-lockfile
```

## Native packages

| Platform | Architecture | Installer | GitHub runner |
| --- | --- | --- | --- |
| macOS | arm64 | DMG | macos-15 |
| macOS | x64 | DMG | macos-15-intel |
| Windows | x64 | NSIS EXE | windows-2025 |
| Linux | x64 | AppImage, DEB | ubuntu-24.04 |

Build on the matching native machine; cross-compiling the native runtime is not
supported. Commands never open a graphical application or publish artifacts:

```sh
corepack pnpm dist          # native installers for the current machine
corepack pnpm dist:mac      # macOS only; architecture follows the machine
corepack pnpm dist:win      # Windows x64 only
corepack pnpm dist:linux    # Linux x64 only
corepack pnpm package:dir   # qualified application directory
corepack pnpm check:package # recheck its installed runtime
```

Output is in `desktop/dist.noindex/{mac-arm64,mac-x64,win-x64,linux-x64}/`.
The `.noindex` directory keeps local build copies out of macOS Spotlight app
searches; the installed application name and location are unchanged.
`packaging-report.json` records the version, target, runtime file/package counts,
size and relocated-runtime probe. The installed `runtime/ling-runtime.json`
records the source revision, dependency versions and individual file hashes.
Preparation copies, smoke profiles and mounted images are removed afterward.

Local builds and the default **LING Release** workflow use ad-hoc macOS signatures
without notarization and unsigned Windows executables. They write
`ling-update-policy.json` with `enabled:false`,
never emit an update feed, and remain available without signing credentials.
Uninstalling the Windows package keeps user data.

Signed automatic-update builds are a separate, explicit packaging mode selected
with `LING_RELEASE_BUILD=1` and `CI=true`. The default release workflow sets
`LING_RELEASE_BUILD=0`; missing certificates never block its manual installers.
Only the explicit automatic-update mode uses the following requirements:
macOS and Windows fail before packaging when their complete credential set is
missing; they never fall back to an unsigned update release. Linux uses the
qualified AppImage/DEB payloads and HTTPS plus SHA-512 integrity. These packages
write `enabled:true` in the policy only as part of this release path.
`app-update.yml` and the policy live beside the physical `runtime/`, outside the
bootstrap ASAR. The main process refuses automatic updates without both files.

## Version, tag and release automation

Run **LING Release** in GitHub Actions, enter a SemVer version such as
`0.1.0-beta.1`, and select `master`. The workflow:

1. validates and synchronizes Renderer/Host versions;
2. commits the version change and atomically pushes the branch and annotated
   `ling-vVERSION` tag, refusing to replace an existing tag;
3. builds and qualifies the same commit on all four native runners;
4. validates five manual installers and four native qualification reports with
   `release-assets.mjs --manual`, rejects automatic-update feeds in this output,
   and writes `SHA256SUMS`;
5. uploads the complete matrix to a private draft, then publishes it in one final
   operation. These releases contain manual installers, with automatic updates disabled.
   Versions with a prerelease suffix are marked as prereleases.

The build jobs run in the same workflow as tag creation, so they do not depend
on a second workflow being triggered by a `GITHUB_TOKEN` push. Only tag creation
and publication jobs receive repository write access. Build jobs cannot publish.

Manual tags also trigger the workflow, provided both workspace versions match:

```sh
corepack pnpm release:version 0.1.0-beta.1
corepack pnpm check
git add package.json desktop/package.json
git commit -m 'chore: release 0.1.0-beta.1'
git tag -a ling-v0.1.0-beta.1 -m 'LING 0.1.0-beta.1'
git push --atomic origin master ling-v0.1.0-beta.1
```

A failed build leaves the tag intact and publishes no release. Fix the source
and use a new version, or rerun the failed workflow if the failure was transient.
Deleting or overwriting released tags is not part of this automation.

## Runtime layout and qualification

The app contains a small bootstrap `app.asar` and an external physical
`resources/runtime/` (`Contents/Resources/` on macOS). The runtime holds Host
code, built Renderer assets, plugins, native modules, bundled pnpm and the SSH
helper. It needs neither the development checkout nor a system Node installation.
Git operations still require Git on the user's machine.

The materializer copies the **frozen installed production graph**, including
patches and nested dependency versions. It dereferences pnpm links, selects the
native platform slice, and rejects missing required dependencies. The runtime
manifest records every file's hash and executable permissions. The packaged
copy is audited again, then copied outside the checkout and probed under its
actual Electron Node executable with a temporary user home.

The headless probe checks bundled pnpm/Node launching, SQLite, native locking,
Koffi, Sharp, ripgrep, Tree-sitter, PTY operation, existing document-preview
infrastructure, the real LING Host/profile/client assets and clean shutdown.
macOS also verifies signatures, Info.plist and the mounted read-only DMG.
Windows and Linux run the same portable runtime gate on their native CI hosts.
These checks do not claim graphical installer or OS permission-prompt acceptance.

## Upstream and patches

The preparation approach follows the pinned [official Desktop source](https://github.com/deepseek-ai/deepseek-harness/tree/ddefc45fbc7f8e46dd73185e68295696d1297887/apps/desktop).
`vendor/dsh-runtime/0.1.6-alpha.2/manifest.json` records provenance and archive
checksums. Only the artifact closure used by LING remains in the checkout.
`pnpm-workspace.yaml` owns the remaining version-scoped `patchedDependencies`;
`check:runtime` verifies artifacts and patch hashes against the lockfile.
The bundled SSH helper retains Linux/macOS native slices for x64 and arm64.
LING and upstream DSH keep separate version identities.

## Optional signing configuration for automatic-update CI

These credentials apply only to explicitly enabled signed automatic-update
builds. They are not required by the default **LING Release** workflow.
The signed packaging mode validates presence without printing their values;
this repository does not provision certificates or alter GitHub secrets.

| Secret | Required value |
| --- | --- |
| `LING_MAC_CSC_LINK` | Base64-encoded Developer ID Application PKCS#12 certificate including its private key, as supported by electron-builder `CSC_LINK` |
| `LING_MAC_CSC_KEY_PASSWORD` | PKCS#12 password |
| `LING_MAC_CSC_NAME` | Full `Developer ID Application: Organization (TEAMID)` identity |
| `LING_APPLE_ID` | Apple account permitted to notarize this application |
| `LING_APPLE_APP_SPECIFIC_PASSWORD` | App-specific password for notarization |
| `LING_APPLE_TEAM_ID` | Team ID matching the signing identity |
| `LING_WIN_CSC_LINK` | Base64-encoded Authenticode PKCS#12 certificate including private key |
| `LING_WIN_CSC_KEY_PASSWORD` | Windows PKCS#12 password |
| `LING_WINDOWS_PUBLISHER_NAME` | Certificate subject common name used by NSIS update verification |

The macOS configuration uses hardened runtime, Developer ID signing, Apple
notarization and stapling. Qualification checks `codesign --deep --strict`,
`spctl --assess` and `stapler validate`; Windows checks Authenticode on the app
and installer. Missing credentials, a rejected notarization or an invalid
signature stops the matrix and publication. Existing ad-hoc/unsigned
installations must first be replaced manually with a qualified signed release;
adding an updater cannot upgrade the trust of the old installation.

The external runtime remains excluded from Builder's recursive signing. A
release-only `afterPack` hook uses the pinned Builder 26.15.7 temporary keychain
to sign only raw Mach-O binaries matching the native architecture, then rewrites
the runtime hash manifest before the outer app is sealed. A foreign raw Mach-O
fails qualification. ELF/PE files and the multi-platform SSH helper tarballs are
never unpacked or resigned. The final signed physical runtime is checked again
and exercised by the relocated headless smoke. This keeps the remote SSH
payload's upstream hashes and platform slices intact. A real signed/notarized
CI build is still required to qualify Apple acceptance of this payload; local
unit tests do not constitute notarization or OS acceptance.

## Automatic-update channels and resources

This section describes the retained signed automatic-update packaging mode.
It is not enabled for the default manual-install releases. Their artifact
collector uses `--manual`, without ZIP, blockmap or update-feed requirements;
the signed collector continues to require the complete signed update matrix.

The updater dependency is pinned to `electron-updater` 6.8.11, compatible with
the existing `electron-builder` 26.15.7. The UI channel `stable` uses `latest`;
`preview` uses `dev`. Stable versions emit `latest.yml`, `latest-mac.yml` and
`latest-linux.yml`; prereleases such as `0.1.0-dev.12` emit only the corresponding
`dev*.yml`. Preview releases never overwrite a stable feed. The updater downloads
in the background; installation and restart require the user's explicit action.

The client resolves published `ling-vVERSION` tags through GitHub's Releases API,
then pins the updater's generic feed to that release's asset directory. This
preserves the existing tag scheme, which the upstream GitHub provider cannot
parse for preview selection. Preview includes all supported prerelease labels
(including dev, beta and rc) and newer stable versions; neither channel downgrades
the installed application. GitHub errors remain visible and are not treated as
"up to date".

Users can open **设置 → 软件更新** to select a channel, check manually, read the
release notes, and choose **重启并安装** or **稍后**. Qualified packages first check
after 20 seconds, then every six hours. Ordinary application exit does not install
a downloaded update. Development mode and unsigned local builds show an explicit
unavailable state, as do the default manual-install releases; explicitly enabled
Linux application updates support AppImage, while DEB installs
are upgraded with a new installer.

Installation checks every LING window for unsaved content, confirms terminal
disconnection, locks Host admission, and rechecks tasks, queues, jobs, scheduled
runs and file transfers. Persisted conversation drafts are flushed; unpersisted
attachments, side-task drafts and unsaved file edits require the user to handle
them first. Final window acknowledgements freeze editing until handoff or recovery.
The Host must exit gracefully before the installer is called. Failed preparation
does not authorize installation; handoff failure restores the old runtime when
possible and never replays terminal commands. These updates replace the application
on restart; they do not swap Renderer or Host code in a running process.

macOS requires the signed ZIP in addition to the DMG. Both have external
`.blockmap` files; NSIS also has an external blockmap, while Linux AppImage uses
an embedded blockmap. Each native job stages its metadata under a unique
`LING-VERSION-TARGET-update.yml` name to prevent architecture collisions during
artifact download. The publication job validates all staged files and combines
both macOS architectures into a single channel feed. It rejects missing
installers, mismatched hashes/sizes, invalid blockmaps, unsigned reports, and
unexpected channel files. Staged metadata and checksums remain in the release
as qualification evidence.

Build jobs always call Builder with `publish: never` and cannot publish. Only
the final job receives repository write permission. A retry can finish a draft;
it refuses to change a published release. A draft left after an upload failure
is not an update feed and can safely be retried after the full matrix passes.

References: [electron-builder v26 publishing](https://www.electron.build/v26/docs/publish/),
[v26 macOS targets](https://www.electron.build/v26/docs/mac/),
and [electron-updater 6.8.11](https://www.npmjs.com/package/electron-updater/v/6.8.11).
