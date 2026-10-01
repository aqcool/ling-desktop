# Computer use

LING loads computer use as one disabled-by-default built-in Loader entry, controlled in **设置 → 电脑操控**. This is the product's only feature switch; it is not duplicated in extension management. The page shows the actual plugin state and uses the existing plugin manager and profile patch to enable/disable it; there is no additional settings database, model loop, HTTP endpoint or Renderer-to-native command bridge. Disabling the entry removes its tools and waits for in-flight work and native shutdown. A missing native binary or startup error is surfaced by the existing plugin manager response.

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

`corepack yarn check:ling` checks LING's builds, types and tests. Computer-use tests cover opt-in composition, failure containment, unload, permission decisions, turn ownership, serialization, cancellation, permission downgrade and screenshot projection without operating a real desktop.

The optional `LING_COMPUTER_USE_NATIVE_SMOKE=1` test reads only the installed native tool catalog and `check_permissions({prompt:false})`, then shuts down. It does not screenshot, click, type or prompt for grants. Run this outside a filesystem/OS sandbox in the responsible GUI login session; do not interpret successful catalog discovery as verification of actual input or screen capture.

Current validation: LING builds, typechecks and headless tests pass. The dedicated native check has not completed: initialization inside the development sandbox failed when accessing the macOS pasteboard, and the outside-sandbox approval review timed out twice. The built-in plugin has since been enabled in the user's real LING instance and its settings page reports active. This confirms provider startup; actual screen capture and input remain unverified. The shipped default is still disabled.
