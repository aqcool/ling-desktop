# Image generation

The official desktop imagegen plugin exposes generation and editing through MCP. The local Host resolves the signed-in ChatGPT subscription and owns outbound requests. The credential stays in the Host. The plugin can call a loopback capability scoped to image requests.

```text
Skill → MCP → Host subscription service → ChatGPT Images
                            ↓
       workspace PNG + MCP image ← successful result
```

Each tool call generates one image. Cancellation closes the bridge request and aborts the provider request. A failed request is returned to the conversation for a user-directed retry. The tool accepts PNG, JPEG, or WebP reference files inside the active workspace and saves each output as a new PNG there. The agent receives a bounded MCP image and a workspace-relative Markdown preview link for its reply. The plugin requires a local desktop Host and an active ChatGPT subscription. With multiple active accounts, the Host uses the first eligible account in provider settings order.
