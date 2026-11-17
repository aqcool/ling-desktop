---
name: server-ops
description: Inspect logs and services, execute commands, and upload a local file to a saved SSH server selected for this session.
---

Call `server_list` to see the servers associated with the current conversation. If the desired server is missing or the target is ambiguous, open `open_server_picker` and let the user confirm their selection.

Use the returned server ID with `remote_run` or `server_copy`. Keep commands scoped to the task. Use workspace-relative paths for uploads and an absolute destination file path on the server. Summarize errors and command results, including the exit code when available. If the connection is offline, ask the user to connect the selected server in Settings → Remote Devices before retrying.
