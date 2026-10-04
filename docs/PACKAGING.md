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

Output is in `desktop/dist/{mac-arm64,mac-x64,win-x64,linux-x64}/`.
`packaging-report.json` records the version, target, runtime file/package counts,
size and relocated-runtime probe. The installed `runtime/ling-runtime.json`
records the source revision, dependency versions and individual file hashes.
Preparation copies, smoke profiles and mounted images are removed afterward.

macOS builds use ad-hoc signatures without Apple notarization. Windows builds
are unsigned. These packages may produce OS installation warnings; signing
credentials and an in-app update feed are not configured. Uninstalling the
Windows package keeps user data. LING remains a local desktop application.

## Version, tag and release automation

Run **LING Release** in GitHub Actions, enter a SemVer version such as
`0.1.0-beta.1`, and select `master`. The workflow:

1. validates and synchronizes Renderer/Host versions;
2. commits the version change and atomically pushes the branch and annotated
   `ling-vVERSION` tag, refusing to replace an existing tag;
3. builds and qualifies the same commit on all four native runners;
4. verifies the complete artifact matrix and writes `SHA256SUMS`;
5. publishes one GitHub Release only when every build succeeds. Versions with
   a prerelease suffix are marked as prereleases.

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
