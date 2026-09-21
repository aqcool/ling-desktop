# LING Desktop

`ling-desktop/` is the new, LING-owned desktop presentation workspace. It is
the starting point for our own Renderer, not a fourth copy of the upstream DSH
interface.

## Ownership boundary

- LING owns the product experience, renderer state, navigation, and visual
  language here.
- DSH remains the runtime and host integration layer.
- The renderer accesses runtime capabilities through a LING
  adapter contract.
- The Next integration layer consumes DSH's public headless Conversation and
  Chat projections. This workspace depends only on the LING-owned projection;
  DSH React components, SlotRenderer, Web App, and Web Frontend remain outside.

## UI foundation

The Renderer uses React 19, Tailwind CSS 4, and HeroUI v3. HeroUI is a LING
presentation dependency only; its component primitives do not change the
runtime ownership boundary or introduce a DSH UI dependency.

The workspace remains an explicit Vite application rather than an Electron
bootstrap. `yarn workspace ling-desktop dev` launches its offline development
carrier. LING Next imports the public `ling-desktop/client` mount entry and
provides the live DSH facades through the same adapter contract.

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

## Runtime adapter v2

`src/runtime/contract.ts` is the framework-independent port consumed by the
Renderer. It exposes connection state, workspace and task summaries, timeline
items, pending approvals and questions, attachment submission, Workspace
lifecycle operations, and task create/send/steer/cancel/rename/archive/history
and slash-command operations. The offline adapter supports
standalone UI development. `src/runtime/dsh-adapter.ts` projects the official
Session and Workspace services plus a LING timeline source supplied by the
carrier. LING Next builds that source from DSH's assembled `chat` target instead
of interpreting raw Session events again. Pending interactions are projected
from the public Session status source, and files use DSH's staged upload receipt
flow before Session admission. `src/client.tsx` is the reusable React mount used
by LING Next's replaceable `uiRenderer` service.
