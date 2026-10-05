# Shell responsibilities

`src/ui/LingShell.tsx` composes the application navigation, conversation and
workbench. Its public props and existing exports remain compatible with the
runtime adapter and slot API. Renderer-only helpers live in `src/ui/shell/`.

Each state owner keeps its subscriptions, cleanup and persistence together:

- `useTaskSidebar`: task grouping, workspace appearance and workspace dialogs.
- `useWorkbench`: tab lifecycle, browser navigation, annotations and requests to
  open the remote terminal. It does not open or close the task monitor.
- `useTaskMonitor`: per-task visibility, pinning, section collapse and dismissal.
  Changing between fixed and floating presentation preserves those choices.
- `useShellLayout`: dimensions, saved layout, resize observers and sidebar shortcut.
- `useShellRemote`: remote bindings, connection checks and server availability.
- `useShellGit`: branch and change-stat refresh, scoped to the selected project.
- `useShellNotes`: note origins, shortcuts and native note-window actions.
- `useShellSettingsRouting`: settings targets that survive leaving the settings page.

`WorkspaceSection`, `TaskMonitor`, `WorkbenchControls` and `ShellSettings`
render their respective areas. Their types expose only the dependencies each
area uses, rather than the full shell prop surface. Runtime contracts remain in
the explicit LING adapter; no upstream DSH UI package is introduced.

The refactor preserves storage keys, shortcuts, markup, services and task
identity. `tests/shell-state.spec.tsx` exercises the state owners together across
task/workbench navigation, floating-monitor dismissal, late remote requests,
settings navigation and layout restoration. Run `corepack pnpm check:renderer`.
