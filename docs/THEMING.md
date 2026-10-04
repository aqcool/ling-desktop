# LING themes

`src/theme/tokens.ts` is the shared, platform-independent definition. It owns the
palette catalogue, preference validation, light/dark semantic colors, typography,
spacing, control heights, radii, shadows and terminal ANSI colors. It has no React,
Electron, DSH, server or credential dependency. The package exposes it as
`ling-desktop/theme` for the Host.

## Consumers

- `src/theme.ts` manages browser preferences, OS changes and React subscriptions.
  Existing `ling.theme`, `ling.palette` and terminal preferences remain compatible.
- `src/theme/generated.css` is generated from the shared definition. `styles.css`
  imports it after HeroUI and maps its metrics to Tailwind utilities. Component
  layout stays in JSX. The settings catalogue and mode-bound themes use the same
  palette list.
- Both terminal panels use `terminalMode()` and `terminalTheme()`. Manual brightness
  is shared across local and SSH terminals; the active palette still applies.
  Updating the xterm theme does not replace its instance or reconnect the shell.
- Electron receives only validated `{ mode, palette }` values. Window backgrounds,
  Windows title bars and the pre-React boot background use the same palette. The
  Host persists `appearance.json`, with migration from the old `appearance-mode`.
- The credential document embeds the generated theme CSS. It starts with the Host's
  selected appearance and receives read-only appearance updates through its own
  authenticated IPC boundary. Credentials, DOM data and scripts are not shared with
  the main renderer. No network resource or storage permission was added.

## Changing appearance

Edit the definitions in `src/theme/tokens.ts`, then run:

```sh
node scripts/generate-theme.mjs
corepack pnpm check
```

The Renderer build regenerates CSS. `check:theme` detects stale generated CSS and
rejects new literal UI colors, font sizes and radii in JSX style utilities.
`theme-contract.spec.ts` covers all six palettes in both modes, normal/status text
contrast, terminal preferences, IPC enum validation and Tailwind size merging.

Use semantic variables for colors (`--surface`, `--foreground`, `--panel-border`,
`--danger`, `--action` / `--action-foreground`). Use `text-compact`, `text-xs`,
`h-control`, `h-control-sm`, `rounded-lg` and the Tailwind spacing scale for metrics.
`tailwind.ts` only merges classes; it knows the custom metric names so a text color
cannot erase a font-size utility. Add new semantic roles to the shared definition,
not ad hoc component palettes.

## Built-in theme packs

`src/theme/packs/index.ts` registers declarative pack descriptors; `index.css`
imports their scoped styles. A pack owns its metadata, light/dark tokens, final
semantic overrides, CSS, assets and attribution in one directory. `tokens.ts`
merges registered palettes and overrides without theme-specific conditionals.
Node-based generation imports `.ts` entries directly; Renderer type checking
allows those imports with `noEmit`.

The Windows XP pack lives in `src/theme/packs/windows-xp/`. Edit that directory
for XP changes. It contains the Luna blue caption, warm gray surfaces, fine
control borders, menu selection states, local Bliss wallpaper and original LING
color icons. Only new sessions use the wallpaper; task conversations retain the
normal reading surface. The dark variant is a LING adaptation. The descriptor
is source data with no React, Electron or DSH dependency.

Pack CSS must scope selectors to its palette. It may decorate existing semantic
classes and `data-icon` hooks, but must not change component layout or behavior.
No runtime ZIP installer, third-party script loading or marketplace is introduced.

Provider logos retain their official brand colors. User-chosen workspace/group
swatches are data, not theme colors. Web page canvases use `--browser-canvas` and
inverted message content uses inverse tokens. Layout constraints (panel widths,
breakpoints, image dimensions and positioning) remain component-owned.

This establishes shared theme definitions; it does not add a theme marketplace or
activate the existing placeholder font/icon/content-width settings.
