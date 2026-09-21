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

This first commit intentionally selects no UI framework and starts no Electron
process. It establishes an isolated workspace and an enforced presentation
boundary before we design the runtime adapter and implement the Renderer.

```text
LING Renderer -> LING runtime adapter -> DSH Host / Agent Runtime
```
