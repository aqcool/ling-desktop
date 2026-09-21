# LING Desktop

`ling-desktop/` is the new, LING-owned desktop presentation workspace. It is
the starting point for our own Renderer, not a fourth copy of the upstream DSH
interface.

## Ownership boundary

- LING owns the product experience, renderer state, navigation, and visual
  language here.
- DSH remains the runtime and host integration layer.
- The future renderer may access runtime capabilities only through a LING
  adapter contract.
- Do not import `@deepseek-ai/dsh-client-ui-*`, `@deepseek-ai/dsh-web-app`, or
  `@deepseek-ai/dsh-web-frontend` into this workspace.

## UI foundation

The Renderer uses React 19, Tailwind CSS 4, and HeroUI v3. HeroUI is a LING
presentation dependency only; its component primitives do not change the
runtime ownership boundary or introduce a DSH UI dependency.

The workspace remains an explicit Vite application rather than an Electron
bootstrap. `yarn workspace ling-desktop dev` launches it when graphical work is
intentional; build and validation remain headless-safe.

```text
LING Renderer -> LING runtime adapter -> DSH Host / Agent Runtime
```

## HeroUI development support

- `.codex/config.toml` registers the official `@heroui/react-mcp` stdio server
  for this repository. It supplies component documentation and theme data to
  Codex during development; it is not part of the packaged product runtime.
- `.agents/skills/heroui-react/` contains the official project-scoped HeroUI
  v3 skill. Its documentation and helper scripts keep component usage aligned
  with the current library version.
- `scripts/verify-heroui-setup.mjs` keeps the HeroUI packages, stylesheet order,
  project MCP configuration, and Codex skill in place.

## Runtime adapter v1

`src/runtime/contract.ts` is the framework-independent port consumed by the
Renderer. It exposes safe connection state, workspace and task summaries,
timeline events, and task create/send/cancel commands. The first implementation
is an offline adapter so the Renderer can develop without a live Host. A future
DSH adapter will translate between this contract and the runtime without
leaking upstream presentation components into LING.
