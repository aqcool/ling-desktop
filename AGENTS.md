# LING Desktop repository rules

LING Desktop is the only product in this repository. The Renderer lives in
`src/` at the repository root, and the Electron/DSH Host lives in `desktop/`.
Keep these two pnpm workspaces separate. The Renderer must not import upstream
DSH UI packages; DSH access belongs behind the explicit LING runtime adapter.

## Setup and commands

- Use Node.js `^22.19.0` or `>=24.0.0` and the exact pnpm release recorded in
  root `package.json`, through Corepack.
- Install with `corepack pnpm install --frozen-lockfile`.
- Start the real LING app with `corepack pnpm dev`; use `corepack pnpm start`
  only after building. `corepack pnpm dev:demo` explicitly starts the demo UI.
- `corepack pnpm build`, `typecheck`, `test`, and `check` cover both workspaces.
- `corepack pnpm check:renderer` checks only the Renderer;
  `corepack pnpm --filter ling-desktop-host check` checks only the Host.
- Package on a matching native machine with `corepack pnpm dist` (macOS
  arm64/x64, Windows x64 or Linux x64), or `corepack pnpm package:dir` for an
  application directory. These commands run
  headless qualification and never publish or launch a graphical application.
- `corepack pnpm check:package` rechecks the built application's runtime.
- GitHub Actions `LING Release` synchronizes versions, creates an annotated
  `ling-vVERSION` tag, and publishes only after all native package gates pass.
  See `docs/PACKAGING.md`. Never replace an existing release tag.

## Dependencies and upstream

- The root `pnpm-workspace.yaml` owns workspace configuration, overrides,
  package patches, dependency build permissions and supported architectures.
- `desktop` depends on the root Renderer with `workspace:*`. Preserve their
  separate React versions and declare dependencies in their owning workspace.
- `vendor/dsh-runtime/` contains the pinned DSH artifacts used by LING.
  Its manifest records the upstream source revision and archive hashes. Keep
  runtime upgrades separate from desktop behavior changes. Do not modify an
  upstream source checkout to implement a LING feature.
- Keep the required `patches/` files version-scoped. Verify any removal against
  the complete dependency graph, including the multi-platform SSH payload.
- Native optional dependencies for Linux and macOS, x64 and arm64, are needed
  by the SSH helper even when building on a macOS arm64 desktop.
- Keep `pnpm-lock.yaml` committed. Do not reintroduce Yarn, reference desktop
  workspaces or parallel product release targets into the LING checkout.

## Working safely

- Keep builds, types, unit tests and runtime smokes headless-safe. Graphical
  application launch must be explicit or part of switching the user's existing
  LING instance after an authorized migration.
- Do not launch separate fake-workspace desktop instances unless requested.
  Preserve the user's sessions, active tasks, credentials and SSH connections.
  Remove temporary test bundles, profiles and services after verification.
- Commit before major changes of direction. Preserve current work before
  destructive repository cleanup, and do not change unrelated project data.
