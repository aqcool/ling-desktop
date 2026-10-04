# LING macOS packaging

LING has its own local **macOS arm64** target. From the outer Yarn workspace:

```sh
corepack yarn package:ling       # verified local LING.app directory
corepack yarn dist:ling:mac      # verified LING.app and DMG
corepack yarn check:ling:package # recheck the existing application's runtime
```

Artifacts are written to `ling-desktop/desktop/dist/mac-arm64/`. A successful
run writes `packaging-report.json` with the LING and DSH versions, dependency
count, runtime size and final smoke result. Temporary preparation and relocated
verification copies are removed. The application is ad-hoc signed for local
testing, **not Developer ID signed or notarized**; it is not a qualified public
release. No artifact is uploaded and no graphical application is launched.

## Runtime layout

```text
LING.app/Contents/
  MacOS/LING                    Electron 44 arm64
  Resources/app.asar            package metadata and ESM bootstrap
  Resources/runtime/
    package.json
    ling-runtime.json           package versions, hashes and executable bits
    node_modules/
      ling-desktop-host/        Host, preloads, client, patches, icons, SSH payload
      ling-desktop/             built Renderer CSS/assets and package anchor
      ...                      materialized production dependencies
```

The bootstrap uses a static ESM import into the physical runtime, so Electron
waits for the application module before its ready event. The existing LING Host
can keep its relative paths, package resolver and managed profile link. The
runtime includes `scripts/node-bin/node`, using Electron's Node mode only for
plugin package scripts. Agent shells retain the user's normal environment.
Knowledge indexing uses the packaged ripgrep executable. Git operations still
require the user's Git installation; the app itself needs no external Node,
Yarn, development checkout or upstream submodule.

The production dependency graph is copied from the **current immutable Yarn
installation**, including patched packages and the nearest dependency version
at each original package. Required missing dependencies fail preparation.
Optional unavailable/foreign-platform packages are recorded as omitted. Source
links are dereferenced, nested versions are preserved, and unknown package
assets are retained. The Renderer client is already self-contained; its source
files, build tools and Node dependencies are not deployed.

## Verification

The packaging command first runs `check:ling`. It then audits the materialized
runtime, its dependency resolution, resource hashes and executable permissions.
A headless probe under the actual Electron Node runtime checks:

- bundled pnpm running a lifecycle script with no system Node on PATH;
- SQLite, flock, Koffi, Sharp, selected Tree-sitter languages and ripgrep;
- a real PTY and native document-to-PDF conversion;
- the real LING Host/profile, client factory, stylesheet and SSH assets;
- clean Host shutdown, without sending an agent message or opening a workspace.

After Electron Builder runs, the same audit targets the final application. A
complete `.app` is copied outside the checkout and its runtime probe is repeated
with a fresh temporary data directory. Existing sessions, project files, plugin
settings and SSH connections are never used by these checks. Bundle signatures
and Info.plist are verified. DMG builds also verify the image checksum, mount it
read-only without Finder and audit the embedded app before the completion report
is promoted.

This is a headless runtime qualification. It does not claim graphical acceptance
of Finder/Dock, privacy-permission prompts or an actual installed-app upgrade.

## Official implementation reference

The preparation model follows the pinned official Desktop at
`deepseek-harness/apps/desktop`, commit
`ddefc45fbc7f8e46dd73185e68295696d1297887` (`0.1.6-alpha.2`):
`prepare-dsh.ts`, `runtime-file-policy.ts`, `prepare-runtime.ts`, the Node shim,
`electron-builder-config.mjs` and native/runtime smoke checks. The submodule is
unmodified. LING owns these adapted scripts and keeps the outer Yarn topology.

Official macOS release commands require Developer ID signing and notarization.
LING's local target is deliberately separate from those release credentials,
the official update feed and Stable/Beta reference commands. Formal distribution
will need native-resource signing before the hash manifest is written, hardened
runtime, Developer ID verification, notarization/stapling and installed-upgrade
acceptance. LING and its pinned DSH runtime have separate version identities.
