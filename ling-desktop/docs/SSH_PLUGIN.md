# LING server plugin

LING owns server management as a first-party product plugin. Stable/Beta and
Next are reference implementations; the pinned DSH checkout remains unmodified.
The feature's job is to turn a server into a usable work resource, not merely
to prove that an existing OpenSSH alias can authenticate.

## Product contract

The user should be able to complete three paths inside LING:

1. **Connect a server:** enter a name, address, login user, port and an
   authentication method; inspect and explicitly trust its host fingerprint;
   reach a usable connected state. Passwords and private keys must not appear
   in task context, model tools, logs, exported settings or the normal Renderer
   service contract. Existing `~/.ssh/config` entries may be imported, but are
   never a prerequisite.
2. **Develop remotely:** choose only a server when creating a task. LING uses
   the verified remote login directory as the initial workspace; the user or
   agent can navigate to a project directory during the session. Files,
   terminal, Git and tasks must use the same current remote directory. A
   connection test or directory browser alone is not remote development.
3. **Develop locally, deploy and operate remotely:** keep a local workspace,
   choose a server, use approved remote shell commands for operations, and
   preview and approve local-file or directory deployment and remote-file
   download. Local tools remain local. The server and credential are selected
   outside the model tool call.

The server list, credential lifecycle, connection lifecycle and workflow
actions belong to a LING-owned Host plugin with a narrow Renderer adapter.
No model tool accepts an SSH address, server ID or credential. A selected server
is an opaque capability for the task; `remote_run` executes only against that
binding, under the same session permission mode and DSH approval pipeline as local tools.

## Execution architecture

Remote execution now uses the pinned `@deepseek-ai/dsh-fs-ssh`,
`@deepseek-ai/dsh-subprocess-ssh` and `@deepseek-ai/dsh-sandbox-ssh` providers.
`desktop/src/ssh/runtime.ts` is an Electron-independent composition of these
providers. `server-broker.ts` retains only credential/connection ownership and
LING workflow adapters. Generic commands no longer use a separate ssh2 exec
implementation; deployment and Git also execute through the DSH subprocess
provider. Fixed onboarding probes and runtime installation still use SSH exec
because they run before the helper exists.

`desktop/src/ssh/connection.ts` adapts an authenticated ssh2 channel to the
public DSH SSH connection contract and uses its RPC protocol and schemas.
This retains visual password/key capture and host-key confirmation without
writing credentials to OpenSSH files or environment variables. Stdout, stderr,
stdin and PTY bytes use separate forwarded, TLS-PSK-authenticated channels.
The upstream helper owns process groups, cancellation, cleanup and leases.
Connection loss is reported without replaying the command.

The build copies the exact installed upstream helper and its dependency closure
unchanged, including Linux/macOS x64 and arm64 native dependencies. On first use,
LING uploads and verifies the archive under the account's private
`~/.local/share/ling/ssh-runtime` directory. It reuses a compatible Node.js, or
obtains a pinned Node.js 22.19.0 distribution from nodejs.org and checks its
published SHA-256 before installing it in that directory. No global installation,
SSH config edits or remote npm install is required. A compatible remote Node
avoids the Node download. Linux confinement requires usable bubblewrap or
Landlock; macOS uses sandbox-exec. An unavailable sandbox fails closed instead
of running restricted commands with full access.

### Session permissions

The controller resolves `ctx.sandboxPolicy` for each tool execution. The remote
workspace replaces the local path in that per-call policy; modes are never
stored globally on a shared server connection. DSH's existing `tools/pre-execute`
and approval flow remains the sole approval owner.

- **Read-only:** allows recognized inspections; rejects remote mutations.
- **Workspace-write:** remote text edits in the workspace use the DSH filesystem
  sandbox without another prompt. Server state changes, wider writes and unknown
  shell commands use the existing approval card. An approved escalation applies
  only to that execution. Upstream temporary-directory allowances still apply.
- **Full access:** no extra SSH approval is added. In particular, the upstream
  `approval=never` setting no longer causes LING's forced asks to reject work.
  Other DSH guards/denials remain authoritative.

Human actions in the private terminal and explicit file-editor saves are direct
user operations. Private terminal input/output is never fed into normal tool
results or the execution recorder. The agent may open that panel in both remote
development and local operations tasks.

### Native DSH composition

The `ling-desktop-host/ssh` export mounts the same three official providers in
an ordinary DSH Context with `ssh` and `sandboxPolicy` already provided:

```ts
import { SshConnection } from '@deepseek-ai/dsh-ssh'
import * as lingSSH from 'ling-desktop-host/ssh'

// ctx is the remote execution scope of the DSH composition, with its
// normal session projection and sandboxPolicy services already mounted.
await ctx.plugin(SshConnection, {
  host: 'my-server',
  node: '/absolute/path/to/node',
  helper: '/absolute/path/to/node_modules/@deepseek-ai/dsh-ssh/lib/helper.js',
  helperHash: '<sha256-of-that-helper>',
  workspace: '/srv/project',
})
await ctx.plugin(lingSSH)
```

Mount this in the remote execution scope, in place of local fs/subprocess/sandbox
providers; retain the host's normal session, approval and agent plugins. The
stock `dsh-ssh` transport uses configured OpenSSH. LING uses its credential broker
with the same provider contract. The UI and Electron safeStorage window remain
LING integrations, not a claim that these desktop screens exist in the DSH CLI.
`ling-desktop-host/ssh-runtime` also exports the same composition as a standalone
runtime for host adapters. No pinned upstream sources are changed.

## Current state: visual onboarding and task-scoped remote work

- `desktop/src/server-store.ts` persists a name, address/alias, optional user
  and port, and environment in a mode-`0600` metadata file. It stores no
  password, private key or passphrase.
- `desktop/src/host/server-controller.ts` exposes a typed Remote for server
  metadata and a durable task-to-server binding. Creating a task from the
  Composer can select one saved server; LING verifies the pin and credentials,
  probes the login directory, binds the task, and only then sends its first
  prompt. Forks retain that binding and current remote directory.
- For direct-address entries, `desktop/src/server-broker.ts` runs in Electron
  main, reads the SSH host key, displays its algorithm and SHA-256 fingerprint
  in a separate credential window, and requires explicit trust. The saved pin
  is checked on every broker connection. Changing the server address, port or
  login user invalidates that server's trust and credential status.
- The credential window imports a private key with a native file picker or
  accepts a password. The normal Renderer receives only a credential status;
  plaintext secrets are never passed through the DSH Host Remote. Electron
  `safeStorage` encrypts the credential payload, saved in a mode-`0600` file.
  If safe storage is unavailable, including Linux's `basic_text` backend,
  saving and using credentials fail closed. Secrets are not passed through
  command-line arguments, environment variables or a generic SSH subprocess.
- `remote_run`, `remote_cd`, `remote_list`, `remote_read` and `remote_write`
  are installed only in bound Agent scopes. A
  remote command goes through the shared risk classifier and a bounded,
  cancellable Host-to-Electron IPC request. Electron main decrypts the
  credential, checks the pinned host key for each connection, and runs the
  command in the task's remote directory. The model cannot select a different
  server or obtain the credential. Known local filesystem, shell and terminal
  tools are hidden or denied for these tasks. The session's file browser uses
  the same current directory and supports SHA-256-checked text edits. Its
  terminal uses a DSH-managed PTY over pinned SSH and keeps running when its panel closes. The
  Git review, branch and commit controls operate on that server and directory.
- A local task can separately select a saved operations server from the
  Composer. Its workspace, local tools and Git remain local. The selected
  server is bound to the task before the first prompt and retained by forks;
  an existing local task can attach one server from the same Composer control.
  `server_exec` executes general remote shell commands. Known read-only inspections
  follow the session mode described above. It can inspect processes, services, containers and logs, or run
  deployment commands. The model cannot change the bound server or access its
  credential.
- `server_exec` and `remote_run` share `server-command-policy.ts`. Literal
  inspection commands are checked across every pipeline and command-list stage;
  file writes, service changes, destructive flags, substitutions and unknown
  scripts require approval in workspace-write mode. Existing upstream denials and approval decisions
  remain authoritative. Approval cards show the model-provided purpose, the actual
  bound server/directory, a host-derived impact, and the exact expandable command.
  Purpose text never decides whether approval is required.
- Ordinary command stdout/stderr stream through opt-in broker IPC and a task-scoped
  presentation Remote while the command is running. The active row expands by
  default, shows elapsed time, and retains output on nonzero exit, cancellation
  or connection failure. LING stores mode-`0600` presentation checkpoints separately
  under `ling-server-executions`; it does not add custom events to upstream session
  logs. Recovered in-progress checkpoints become interrupted. The final tool result
  still supplies the model's ordinary command output. Private SSH terminal data
  never uses this recorder or enters conversation context.
- For a local workspace file, `server_deploy_plan` checks the local file and
  remote destination SHA-256 hashes. `server_deploy_apply` checks the session permission
  for the exact source and destination, rejects a changed local or remote file,
  streams the file through the pinned SSH connection, checks the transferred
  hash and atomically replaces the remote target. It does not create the
  target directory. Both tool
  calls appear in the task timeline.
- `server_deploy_directory_plan` previews the local tree and complete remote
  destination, including remote-only paths that will be removed. Its approved
  apply action uploads the full tree to a sibling staging directory, checks
  the staged hashes, rechecks the target version, then switches the directory
  with a rollback trap. It preserves empty directories and rejects source
  symlinks and special files. A failed or interrupted transfer requires a new
  preview. Release switching and health checks are available through approved
  `server_exec` commands.
- `server_download_plan` previews a remote file and any existing local target.
  Its approved apply action streams into a temporary file inside
  the workspace, verifies the remote hash before and after transfer and the
  downloaded bytes, rechecks the local target, then atomically replaces it.
- Approved remote commands and transfers write separate start/result records
  to a mode-`0600` `ling-server-operations.jsonl` under `DSH_HOME`. Records
  identify the task, server and action; command and path details are hashed
  rather than copied into the audit file. The task timeline retains the
  reviewable command and tool result. This is a local audit, not a
  tamper-proof record against processes running as the same OS user.
- The conversation checks server health when opened or updated. A missing or
  changed key shows the observed SHA-256 fingerprint and, when applicable, the
  previously trusted one. Its action opens the isolated credential window;
  closing it never replays a failed command.
- Direct connection tests in the credential window and backend-only directory
  browsing use the broker's pinned SSH connection. Existing SSH aliases still
  use `desktop/src/server-ssh.ts` and system OpenSSH with noninteractive
  authentication and strict host-key checks.

This makes a saved server usable from an Agent chat for approved remote
commands, file reading and writing, directory navigation and Git commands.
The LING file browser, persistent terminal and Git controls target the selected
server. OS-enforced isolation from other same-user processes has not been
demonstrated.

In a local task, select **运维服务器** below the Composer, then ask the Agent
to inspect Docker, manage a service, deploy a local build artifact or directory,
or retrieve a remote file. A remote command shows its exact text for approval.
File and directory changes are previewed with source, destination and hashes
before transfer approval. Changed local or remote files require a new preview.

## Connection and credential boundary

The implemented credential boundary and its remaining security gate are:

1. The normal Renderer handles non-secret server metadata and displays
   credential status. A separate sandboxed credential window sends password
   or key import requests to Electron main. The Renderer-facing DSH Remote
   never accepts or returns secret values.
2. Electron main owns OS-backed secret storage, host-fingerprint decisions
   and SSH session creation. The normal Renderer can request fixed probes and
   directory listings. A bound Agent can request an approved remote command
   only through its scoped tool and the Host-to-main bridge; it cannot supply a
   server ID to that tool or receive a credential.
3. A model-owned local subprocess shares the user's OS identity. A mode-`0600`
   encrypted blob and Electron `safeStorage` protect data at rest, but are not
   proof that a same-user process cannot access the live broker or operating
   system credential services. Before broad remote-workflow capabilities or a
   claim of OS-enforced isolation, build and test that stronger boundary with
   the most permissive local task preset. The known local model tools are
   blocked in a bound remote task, but this is not an OS security boundary.
4. First-contact host keys are shown for deliberate verification; production
   hosts are not silently trusted. The user can replace or remove a stored
   credential independently of deleting server metadata. A changed key blocks
   connections until the user independently verifies and explicitly trusts it.

## Session host-key recovery

Fingerprint problems are handled in the task's interface, outside
model-authored chat content:

- A missing local pin pauses remote work before authentication. Show the server
  identity, observed key algorithm and complete SHA-256 fingerprint, then offer
  an explicit confirmation action. A missing pin is never treated as trust.
- A changed host key stops the current operation and shows both the previously
  trusted and newly observed fingerprints. There is no ignore-and-continue path.
- The session action opens LING's isolated credential window for confirmation.
  Electron main must observe the key again when the user confirms it; the model
  cannot submit this decision. A changed pin invalidates the prior credential,
  so the user must authenticate again before retrying the paused operation.
- After confirmation, recheck the pin and credential state before an explicit
  retry. Do not mark the task connected or replay a write or deployment merely
  because the confirmation window closed.

The task health check and blocked command both fail closed. The health banner
can open the credential window, but the user must explicitly retry a failed
operation after connection recovery.

Electron `safeStorage` can protect data at rest on macOS through Keychain, but
its platform guarantees differ and it does not by itself isolate a same-user
model subprocess from a live SSH socket or agent. The current Electron-main
broker is separated from the DSH Host process and Remote, but remains under
the same OS user and does not satisfy OS-enforced isolation.

## Verification and remaining boundaries

The user has completed a real server deployment with the prior LING workflow.
The DSH-provider migration retains that workflow; it is verified separately
against a local SSH server and the actual packaged upstream helper. Tests cover
binary transfers, complete directory replacement, stale-version refusal,
concurrent filesystem policies, remote shell confinement, streamed large output,
process-range cancellation, persistent private PTYs and plain DSH plugin loading.
`corepack yarn check:ling` verifies both LING workspaces without a GUI.

This migration has not been run against the user's production server. The
cross-platform native dependencies are checked during packaging, but Linux
end-to-end acceptance still needs a Linux host; local protocol tests run on the
build host. No application restart or production command is part of these tests.

OS isolation from other processes owned by the same local user is not claimed.
Symlink deployment, text diff preview and resumable transfers remain distinct
workflow features. A successful fixed connection probe alone does not prove
helper installation or runtime readiness; actual execution initializes the
helper and reports installation/confinement failures.
