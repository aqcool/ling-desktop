# Computer use

LING loads computer use as one disabled-by-default built-in Loader entry, controlled in **设置 → 电脑操控**. It is not duplicated in extension management. The page shows the actual plugin state and uses the existing plugin manager and profile patch to enable/disable it. Optional feature preferences live in the existing Settings service's `ling-computer-control` namespace; there is no additional settings database or model loop. Disabling the entry removes its tools and waits for in-flight work and native shutdown. A missing native binary or startup error is surfaced by the existing plugin manager response.

## Settings

- **浏览器连接**: permits the native provider's browser tools, including browser preparation, state inspection and actions. Off by default. The switch does not launch a browser, grant access to a personal browser profile or relax session approvals. See [Cua browser tools](https://cua.ai/docs/reference/cua-driver/mcp-tools).
- **应用快照 → 全局快捷键**: defaults to unset. Choose Cmd/Ctrl + Shift + S or X. Registration conflicts are reported before saving. The shortcut captures the frontmost visible window before revealing LING, and stages the screenshot and accessibility text in the current unsent draft. It neither sends a message nor creates a session. Switching conversations during capture discards the result. Native shutdown, window closure and feature disable unregister the shortcut.
- **启用电脑操控**: the real opt-in native provider switch, with Loader startup state.
- **启用录制与回放**: permits new `start_recording` and `replay_trajectory` calls; defaults off. It records Agent actions and their surrounding snapshots, rather than automatically starting a video recording. Disabling prevents new recording/replay; `stop_recording` remains available under the ordinary session policy so an existing recording can be stopped.

Feature flags are rechecked at admission, guard and queued dispatch. No feature switch grants a mutation approval. The bounded Remote exposes only capability discovery and a user-requested foreground snapshot. Snapshot inspection uses the same ToolRuntime, native provider, queue and session ownership as Agent tools. Electron IPC only registers an allowlisted shortcut, delivers its event to a trusted application window and reveals that window; it exposes no generic native command execution.

## Selection (2026-10-01)

| Approach | Fit for LING |
| --- | --- |
| [OpenAI computer use](https://developers.openai.com/api/docs/guides/tools-computer-use) | Screenshot/action or code-execution interface; the application supplies execution and its API integration. Would require a provider-specific loop for the native interface. |
| [Anthropic computer use](https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool) | Client toolset with screenshot/mouse/keyboard calls executed by the application. Also tied to its model/API protocol. |
| [Playwright MCP](https://github.com/microsoft/playwright-mcp) | Browser automation through accessibility snapshots; useful for browser-only tasks, does not provide native desktop control. |
| [Terminator](https://github.com/mediar-ai/terminator) | Community Windows automation; does not cover LING's macOS development target. |
| [Cua Driver](https://cua.ai/docs/reference/cua-driver/sdk-reference) | Native application accessibility and screenshot grounding through an SDK or MCP. The pinned DSH already owns both adapters. Selected the native adapter to avoid requiring another installed application or daemon. |

The integration uses unchanged, vendored DSH `0.1.6-alpha.2` packages `dsh-computer-use` and `dsh-experimental-computer-use-cua-driver-native`, with the latter's exact `@trycua/cua-driver@0.28.0`. The native optional packages must remain installed. The SDK runs in the LING Host; native code failures can affect that Host. MCP/process isolation is a possible replacement transport, not a second enabled provider.

## Behavior and boundaries

- The provider's own catalog supplies schemas and results. DSH handles tool history, abort signals, durable image admission and model image capability checks. LING retains screenshot references in tool results and reuses the existing attachment preview; the Renderer imports no native SDK.
- Computer use always targets the local desktop, including when a task has an SSH workspace. It is not remote desktop support. Prefer existing file/shell/browser tools for work they already handle.
- Ordinary inspection is allowed in read-only mode. Screenshot export is a write. Clicks, typing, application launch, configuration and unknown/new tools are denied in read-only mode, request ordinary per-call approval in workspace-write mode, and execute under the existing policy in full-access mode. Approvals show the operation and its arguments. Other denials, cancellations and approvals are preserved.
- Agents may only use `check_permissions({prompt:false})`. OS grants are user setup. On macOS, grant Accessibility and Screen Recording to the responsible application reported by the driver; development Electron identity may differ from a packaged LING identity. The feature switch does not grant OS access. See [Cua macOS permissions](https://cua.ai/docs/reference/cua-driver/macos-permissions).
- A session owns the desktop from its first computer-use call through turn completion. Other sessions receive a clear refusal; calls within the owner session are serialized. Release waits for admitted calls to settle. This coordinates LING sessions; the user and other applications can still change the desktop. Fresh snapshots and explicit outcome verification remain necessary.
- A queued cancelled call does not dispatch. A permission downgrade is rechecked before dispatch. Cancel cannot undo input already delivered. Background refusal does not imply authorization to retry in the foreground.
- Screens and app text are untrusted task data. Enabling the capability or approving a click is not blanket authorization to publish, submit transactions or expose secrets.

[Platform support](https://cua.ai/docs/reference/cua-driver/platform-support) is conditional: macOS needs grants; Windows has integrity/background-delivery limits; Linux support depends on the window system. LING has not certified this feature on Windows or Linux.

## Validation

`corepack pnpm check` checks LING's builds, types and tests. Computer-use tests cover opt-in composition, failure containment, unload, permission decisions, turn ownership, serialization, cancellation, permission downgrade, live feature revocation, foreground target selection, snapshot draft isolation and shortcut conflicts/ownership without operating a real desktop.

The optional `LING_COMPUTER_USE_NATIVE_SMOKE=1` test reads only the installed native tool catalog and `check_permissions({prompt:false})`, then shuts down. It does not screenshot, click, type or prompt for grants. Run this outside a filesystem/OS sandbox in the responsible GUI login session; do not interpret successful catalog discovery as verification of actual input or screen capture.

Current validation: LING builds, typechecks and headless tests pass (295 Renderer tests and 324 Host tests; the optional native smoke is skipped). The built-in plugin has been enabled in the user's real LING instance. After restarting that instance, its settings page reports active and browser, snapshot shortcut and recording controls are available; the optional flags remain off and the shortcut unset. This verifies provider startup, capability discovery and settings metadata. Actual native screen capture, input and trajectory replay remain unverified. The shipped default is still disabled.
