# LING Desktop repository rules

LING Desktop is the sole product development track in this repository. Its app lives in
`ling-desktop/` (Renderer) and `ling-desktop/desktop/` (Host). The Stable/Beta
packages (`dsh-plugin-desktop/` and `dsh-plugin-desktop-beta/`) and
`dsh-desktop-next/` are reference implementations only: use them to compare
architecture, behavior, and compatibility, not as parallel product roadmaps or
release targets. Do not count their feature coverage, packaging, or test results
as LING completion. Build new desktop features in LING unless explicitly asked
to maintain a reference package. DeepSeek Harness remains a pinned, unmodified
upstream checkout.

## Prerequisites and setup

- Use Node.js `^22.19.0` or `>=24.0.0` and the root Yarn `4.18.0` release through Corepack.
- Initialize the pinned upstream checkout with `git submodule update --init --recursive`.
- Install root dependencies with `corepack yarn install --immutable`.

## Build, run, and verify

- Start the LING desktop app with `corepack yarn dev:ling`; validate both LING workspaces with `corepack yarn check:ling`.
- `corepack yarn dev` starts the legacy Stable reference app, not LING. Use it only when inspecting or maintaining that reference.
- `corepack yarn build` builds all workspaces; it is not a LING release/package command.
- If explicitly maintaining a Stable/Beta release, run `corepack yarn aa:prepare-release` to build the latest official Agents Anywhere `main` for both reference Desktop channels. Commit the resulting artifact, provenance, manifests, and lockfile before packaging. Signed macOS releases and root Windows distribution commands verify freshness and installed versions; `DSH_AA_SOURCE_REF=pinned` is no longer supported. This reference release process does not establish LING release readiness.
- Run unit tests with `corepack yarn test`.
- Run type checking with `corepack yarn typecheck`.
- Run the complete headless gate with `corepack yarn check`.
- `corepack yarn dev:next` explicitly launches the experimental Next reference app; `corepack yarn check:next` validates it without a graphical application. Next uses the official published Web frontend and the recorded upstream Desktop presentation, with capabilities composed as a separate bundle.
- Only when explicitly changing the Stable/Beta references, develop and validate shared changes in `dsh-plugin-desktop-beta/` first, then synchronize them into `dsh-plugin-desktop/` while preserving declared variant differences. Before committing or pushing those shared changes, run `corepack yarn check:desktop-variants` and validate both affected packages; neither package automatically inherits the other's source edits.
- Run upstream operations through the root scripts, such as `corepack yarn upstream:build`.

- `deepseek-harness/` is a pinned upstream Git submodule. Never edit files inside it from a desktop feature branch.
- `ling-desktop/` owns the LING-native Renderer and its presentation boundary; `ling-desktop/desktop/` owns its Host and Electron integration. Keep the Renderer independent of upstream DSH client UI packages; introduce DSH access only through an explicit adapter.
- `dsh-plugin-desktop/` and `dsh-plugin-desktop-beta/` own the legacy Stable/Beta reference Host, Client faces, Electron bootstrap, packaging, and release tests.
- `dsh-desktop-next/` owns the separate experimental reference shell, Profiles and recovery, and adapters for the existing AA bridge and Community Market. Next-only changes do not belong in the Stable/Beta variant mirror. Keep its upstream reference and published runtime versions aligned; do not fork the official main frontend.
- `dsh-community-market/` owns the community-market shell. Until its runtime is implemented, it remains a private documentation scaffold and must not declare loadable DSH or package entry points.
- The outer repository and all owned packages use the root Yarn release with `nodeLinker: node-modules`.
- The upstream submodule keeps its own pnpm workspace. Run upstream commands through the root `upstream:*` scripts, whose Yarn portable-shell commands enter the submodule before invoking Corepack.
- Compatibility mode must run the upstream default client without overrides. Advanced presentation belongs to desktop-owned client plugins and may replace documented slots or services through profile composition.
- Keep graphical application launch explicit. Builds, typechecks, unit tests, and Loader smokes must remain headless-safe.
- Do not launch separate demo or isolated graphical LING instances with fake workspaces unless the user explicitly requests one. Validate with headless checks or the user's real LING instance, preserving active tasks and SSH connections. Remove temporary test application bundles, profiles, and services after use.
- Commit before major changes of direction and keep the submodule pin update separate from desktop behavior changes.
- Keep the repository topology and package-manager split consistent with the [owning Agent Note](.agents/notes/implemented/process/2026-08-15-pinned-upstream-and-isolated-yarn-workspace.md).
