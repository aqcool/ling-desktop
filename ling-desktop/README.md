# LING Desktop

LING owns its renderer in this workspace and its desktop Host in `desktop/`.
DeepSeek Harness supplies the local task engine through the explicit runtime
adapter. The experimental `dsh-desktop-next/` application remains a separate
reference and is not part of the LING launch path.

```text
LING Renderer → LING runtime adapter → LING Host → DSH task engine
```

The renderer uses React, Tailwind CSS, and HeroUI. It does not import the DSH
client UI. `src/runtime/contract.ts` defines the renderer-facing API;
`src/runtime/dsh-adapter.ts` implements it from the client projections owned by
`desktop/src/client/`. The offline adapter supports isolated UI development.
The real Host loads the official DSH Web profile with LING's renderer bundle.

From the repository root:

```sh
corepack yarn dev:ling    # build the renderer and launch LING Electron
corepack yarn serve:ling  # serve the real local Host in a browser
corepack yarn check:ling  # build, typecheck, and test both LING workspaces
```

`corepack yarn workspace ling-desktop dev` starts the demo renderer only.
The real entry points do not silently fall back to demo data when the Host is
unavailable.

## Servers (connection onboarding)

The Connections page stores server metadata and supports visual SSH onboarding
for direct-address connections: it displays the host-key SHA-256 fingerprint,
requires explicit trust, and saves a password or imported private key using
Electron's OS-backed safe storage. Connection tests run from the credential
window and enforce that fingerprint. Directory browsing is currently a broker
capability without a Settings entry point. Existing SSH aliases remain available
through system OpenSSH. Task-scoped remote workspaces, local-to-remote deployment
and server operations are implemented by the LING server plugin, using the pinned
DSH remote filesystem, subprocess, PTY and sandbox providers. LING automatically
prepares the matching helper and Node runtime when needed. The same session
permission mode applies to remote tools; restricted changes require review with a
plain-language purpose, target, impact and full command. Command output is displayed
while running and retained after failure; private terminal I/O remains separate. The current same-user Electron process is not an OS-enforced
isolation boundary against an unrestricted local shell.
LING's server feature is a first-party plugin whose product contract is to
manage those workflows in the app without exposing passwords or private keys
through the task Remote. `~/.ssh/config` is an option, not the required setup path.
See [SSH_PLUGIN.md](docs/SSH_PLUGIN.md) for the intended workflows, boundaries,
acceptance criteria, native DSH composition and verified boundaries.

## Desktop UI conventions

Settings and form controls share `src/ui/SettingsControls.tsx`. HeroUI owns
selection, keyboard navigation, focus and switch hit targets; the wrappers only
provide desktop sizing with colocated Tailwind utilities. Use these controls
instead of native selects or hand-drawn switches. Existing actions, disabled
states and persistence remain owned by each feature.

Settings use a 768px maximum content width, 20px page headings, 13px row titles,
12px descriptions and controls, 32px controls, and 64px minimum settings rows.
Use 8px control corners, 12px cards/popovers and 16px dialogs with 20px padding.
Toolbar icon controls may use 28px square hit targets; ordinary icon controls
use 32px squares. Colors come from semantic theme variables, including hover,
selection and disabled states. Group borders remain; repetitive row separators
are omitted. Narrow settings rows stack their controls without horizontal
scrolling. Keep page-specific styles in JSX and reserve the stylesheet for
shared theme tokens and base behavior.

## ChatGPT authorization networking

The LING host reads the macOS static HTTP/HTTPS proxy at startup when neither
the launch environment nor the DSH home `.env` explicitly configures a proxy.
DSH installs that policy for Node fetch, covering OAuth token exchange and
refresh as well as model requests. Loopback callbacks stay direct. No system
settings or credentials are changed; restart LING after changing system proxy
settings. PAC, SOCKS-only and HTTP-only system configurations are not mapped to
the DSH HTTP/HTTPS policy. Explicit DSH proxy configuration takes precedence.

The upstream Pi callback page acknowledges receipt of the authorization code
before exchanging it for tokens. LING only marks the account connected after
the exchange succeeds. Failed attempts hide expired links and offer a fresh
login attempt.

## Git and Worktrees

The composer branch button opens an anchored branch picker. Repository changes
open in the right-hand Review tab, with a diff and a filterable file list; the
source menu preserves the separate last-turn review. Commit/push uses a compact
dialog, also reachable from the task monitor. The native Git adapter reads
repository status and staged/working diffs, stages or unstages individual files,
commits the index, switches/creates local branches, fetches remotes, pulls with
`--ff-only`, and pushes with optional upstream setup. It never auto-stages for a
commit, discards changes, or force-pushes. Network commands use existing local Git
credentials in noninteractive mode; errors remain visible in the panel.

The composer location menu can select an existing Worktree or create one and
use it immediately. It registers the chosen directory as a workspace, then starts
a new task there; existing sessions remain bound to their original directories.
The location indicator derives Local/Worktree from Git, and switching back to the
main checkout updates both the workspace and branch controls.

Worktrees can be created from new or existing local branches, opened in the file
manager, added to the sidebar, or removed after confirmation. Removal retains the
branch and uses Git's normal checks without force; main/current/locked worktrees
cannot be removed. The settings Worktrees page uses the same operations for a
selected workspace. Git settings persist branch prefixes, preferred push remotes,
and untracked-file visibility locally.

`desktop/src/workspace-git.ts` implements a fixed, validated command set using
argument arrays and literal pathspecs. The renderer reaches it through workspace
IDs resolved by the runtime adapter and an application-only IPC bridge. Writes
are serialized by the shared Git directory, including linked worktrees. Headless
integration tests use temporary repositories and a local bare remote; no user
repository is mutated by verification. Native bridge updates require an app
restart. Web-only sessions report that native Git operations are unavailable.

## Interactive terminals

Both the bottom panel and the side terminal tab render real xterm terminals.
Double-click a terminal tab (or press F2) to rename it. Enter or blur saves,
Escape cancels, and names are limited to 120 characters. Renaming updates the
DSH terminal title without replacing the process.
Their process lists are independent, with multiple tabs, keyboard input, control
keys, theme switching, PTY resizing and explicit process close. Hiding a panel or
switching tabs/tasks keeps the shell alive; reopening restores its screen and
working environment. Terminals belong to an existing DSH session and use that
session's workspace directory. Workspace action logs remain a separate view.

`desktop/src/client/terminal-projection.ts` adapts DSH's React-free `webTerminals`
service to the LING contract. DSH owns window retention, ordered input, stream
reconnection and screen snapshots. The LING renderer acknowledges output only
after xterm has parsed it. UI controls use HeroUI and inline Tailwind; xterm's
vendor stylesheet supplies the emulator's required base layout. Host failures
and exited shells are shown in the panel, with reconnect/retry actions.

## Side tasks and monitor actions

Side task tabs bind independent DSH sessions. They support prompts, attachments,
queue/steer messages, stop, permissions, plan/goal commands, model selection and
approval/question responses. Drafts and session bindings survive tab changes and
workbench collapse during the current application session. Closing a tab leaves
its DSH session in the task list. A new side task inherits the current workspace,
agent preset and permission preset; selecting its model does not change the
global default. Multiple views retain shared history and subagent subscriptions
until the last view closes. Failed sends retain drafts and failed interactions
remain retryable.

Task monitor sources download through the task attachment adapter; adding a
source attaches files to the current composer without sending. Web entries open
in the built-in browser. Task notes are local, per-session data stored under
`ling.task-notes.v1:<taskId>`; users can save replies, edit/delete notes and insert
them into the composer. The experimental notes preference controls entry points.
This storage is specific to the current application profile, with no cloud sync.

Terminal HTTP(S) links, including wrapped links and OSC 8 links, follow the
appearance preference for the built-in or system browser. Network settings test
configured providers through DSH's model-discovery API. Proxy policy remains
owned by the DSH launch environment, rather than an inactive renderer control.

## General and mode preferences

General settings persist locally (`ling.behavior.v1`) and update open renderer
windows. They control queue/steer input during execution, idle question skipping,
reading origin, tool counts and disclosure defaults, completed-process folding,
current-turn timing, thinking animation and rotating phrases. Idle skipping only
applies to untouched ordinary questions; approvals and plan reviews still wait.
Pointer/keyboard activity resets the idle countdown.

New goals use the configured round cap through the official `goals.create` API;
existing goals retain their own limits. Programming and general modes have
independent theme bindings and visibility preferences for environment controls,
monitor information, browser local addresses and conversation change cards.
These modes affect presentation, not agent permissions or model selection.

The desktop bridge adds task notifications and a persistent tray/menu-bar entry.
Notifications only follow observed transitions, suppress duplicates, and can
reopen the corresponding task. Delivery depends on OS permissions and, on macOS,
a signed application. Browser-only clients disable these native settings.
Deliverable placement and follow-up suggestions stay disabled until the runtime
exposes those capabilities.

## Composer skills

The add menu contains Goal, Plan and Skills; workspace file/folder upload and unavailable SaaS entries are omitted. The paperclip still accepts individual attachments. Skills are read from DSH's user-invocable catalog, including user-only skills. Existing tasks use `skills/list`; unsent drafts use the desktop `lingSkills/list` bridge with the selected workspace cwd and the staged agent preset scope, without creating a session. Selecting a skill inserts its literal `/name` reference, preserving the draft. Registered slash commands use the command channel; skill references stay user prompts (including attachments), allowing DSH `tool-skill` to load and inject the actual instructions.

The slash menu uses HeroUI ListBox with React Aria virtual focus so typing stays in the composer. It follows DSH's Add / Commands grouping, localized labels and command aliases, with descriptions aligned at the trailing edge. The menu shares the composer width and caps its height at 400px or the available space above it; skills use the same rows without a separate description flyout. Arrow keys navigate and scroll the list; Enter/Tab completes a choice, Escape or an outside click dismisses it, and IME composition retains its keys. The model row opens the existing HeroUI model picker.

## Conversation agent selection

The composer context row exposes the real DSH agent-preset roster for new conversations and blank sessions. The selected id is passed to `sessions.create` before any permission, goal, plan or prompt action; failed creation never falls back to another preset. Blank sessions use the official `agentPresets.select` operation. Once a session has started, choosing a different preset opens a new draft and preserves the original conversation. Built-in display names use DSH's display resolver with Chinese labels; custom names stay unchanged. Draft skill queries use the staged preset scope, and a new conversation returns to the host default after the staged choice is consumed.


## Agent preset and built-in plugin settings

Settings provides separate Agent presets and Built-in plugins pages. The renderer
uses `LingExtensionSettingsService` through the desktop projection; it does not
import upstream UI. Preset lists, read-only composition views, copy/delete and
native file/directory actions call DSH's existing remotes. Policy writes target
only `agent-presets.default` and `agent-presets.modeSelectionEnabled`, then read
back the host-effective roster. New drafts reset stale choices; blank sessions
can synchronize their preset, while started sessions remain unchanged. Turning
off the picker follows the host deployment default and retains the saved choice
for when selection is enabled again. Authoring and settings controls follow the
host's capabilities. Copy uses a new user preset id; deletion requires a dialog
and is available only for user presets.

The plugin inventory preserves both global Loader entries and per-preset
composition rows, including conditional enablement, expressions and lifecycle
phases. Selecting a preset here changes only the inspected inventory. Search
matches module names and entry ids across presets, and details distinguish
configuration from runtime state. This inventory is read-only; it never presents
unsupported enable/disable actions. Skills remain available in the composer;
Extension management provides the global plugin lifecycle described below.

## Plugin management

Extension management presents the DSH plugin catalog with HeroUI controls and
colocated Tailwind styles. `LingPluginManager` is the renderer boundary; the
Host client adapter calls `remote.pluginManager` and the settings/credentials
remotes. The Host declares the two official team-profile packages so the catalog
can discover them without activating them. Counts, selections, component state
and read-only restrictions come from the running profile.

The page supports inspecting and installing npm/path/Git bundles, streamed logs,
cancellation, explicit build-script approval, activation, component toggles and
confirmed removal. A failed application result remains a failure even when its
RPC succeeded; restart-required and overridden outcomes are shown separately.
Runtime foundation bundles are excluded from the management list. Optional
bundles remain governed by the Host's removal and management restrictions.

The DSH 0.1.6 loader can audit a dependent during bundle removal after its Fiber
is cleared but before its entry disappears. The desktop adapter reconfirms that
disable once only when the profile is disabled, every reported import failure
belongs to the removed bundle, and its entries are absent from the live
inventory. Enable failures, surviving entries, unrelated failures and failed
reconfirmation remain errors; the upstream checkout is unchanged.

Official configuration forms edit the `shell`, `agent-loop`, `subagent`,
`subagent-model-selection` and `web-search-deepseek` namespaces. Writes retain
revision checks and reset individual keys with unset operations. Search keys go
through the credentials domain; existing secrets are never returned to the
renderer. Subagent model options retain provider identity and use the actual
model catalog. The separate Built-in plugins inventory remains read-only.
