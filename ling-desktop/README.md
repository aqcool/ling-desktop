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

## Initial scope

This foundation intentionally selects no UI framework and starts no Electron
process. It establishes an isolated workspace and an enforced presentation
boundary before we design the runtime adapter and implement the Renderer.

```text
LING Renderer -> LING runtime adapter -> DSH Host / Agent Runtime
```

## Runtime adapter v1

`src/runtime/contract.ts` is the framework-independent port consumed by the
Renderer. It exposes safe connection state, workspace and task summaries,
timeline events, and task create/send/cancel commands. The first implementation
is an offline adapter so the Renderer can develop without a live Host. A future
DSH adapter will translate between this contract and the runtime without
leaking upstream presentation components into LING.
