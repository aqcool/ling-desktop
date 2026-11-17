# 订阅授权供应商

Claude、ChatGPT、Grok 的订阅登录是普通个人供应商，凭证类型是订阅授权。它们不进入应用登录的 `OAuthProviderId`，也不占用智谱账号或 Coding Plan 入口。

## 所有者

- 供应商配置保存访问类型、厂商、请求地址和模型目录。`claude-subscription`、`chatgpt-subscription`、`grok-subscription` 分别对应 `anthropic`、`openai-chatgpt`、`xai`。
- 访问令牌和刷新令牌在凭据库，键为 `subscription-oauth:${providerId}`。配置、设置同步和日志都不保存令牌。
- 登录使用与 Pi 相同的公开 OAuth 客户端：Claude Pro/Max（PKCE，本地回调 `127.0.0.1:53692`）、ChatGPT Codex（PKCE，本地回调 `127.0.0.1:1455`）、xAI Grok（设备码）。客户端没有密钥。
- 每次模型请求由 Host 读取当前访问令牌。过期则先刷新，再把访问令牌交给当次请求。ChatGPT 同时带 `ChatGPT-Account-ID`。

## 事件顺序

1. 用户从平铺模板添加「Claude 订阅」「ChatGPT 订阅」或「Grok 订阅」。创建结果是 `standard-personal`，可改名、可删除，默认不存在。
2. 设置详情不展示 API Key。请求地址来自模板：Claude 走 Anthropic Messages，ChatGPT 走 Codex Responses，Grok 走 xAI Responses。
3. 用户点击授权登录。Claude 与 ChatGPT 在本机生成 PKCE 授权地址，界面拿到地址后打开浏览器。回调端口被占用时，在卡片里粘贴回调地址或授权码。Grok 先向 `https://auth.x.ai/oauth2/device/code` 申请设备码（`referrer=opencode`，并带 `User-Agent`），成功后打开验证地址并展示设备码。Host 对 `auth.x.ai` 的授权请求使用经典 TLS 密钥组，兼容会在较长 ClientHello 上重置连接的网络路径。申请或换票失败时，卡片显示授权主机和连接原因。日志不记录令牌或响应体。
4. 这些 HTTP 请求走 Host 的网络传输，因此跟随桌面里配置的代理和自定义 CA。Host 进程自己的 `fetch` 看不到 Electron 会话代理，裸请求会把连接失败显示成 `fetch failed`。
5. 未登录时供应商留在设置里供授权，模型不进入会话选择，也不能作为当前会话模型。登录成功后凭据写入，设置侧模型目录按已登录的供应商 id 重新发布。退出登录或删除供应商时删除凭据，模型再次从会话目录消失。过期令牌仍算已登录，由当次请求刷新；刷新失败不把令牌写回配置。
6. 发送准入读的是 Agent 进程自己的模型目录，不是设置侧那份。Host 在创建会话和发送前，把当前已登录的供应商 id 交给该进程并让它重新发布目录；这份名单不含令牌。新进程第一次发送前先等启动时的凭据恢复完成。名单为空时，这些模型不在准入目录里。
7. CLI 发起模型请求时向 Host 要当前令牌。未登录则请求失败。Anthropic 订阅令牌只放在 `x-api-key`，不附加 `Authorization: Bearer`。
8. ChatGPT 订阅走 Codex Responses。SDK 序列化前把系统提示放入 `instructions`，以 `store: false` 重放历史并请求加密推理数据。最终发送的请求启用流式输出并省略 `max_output_tokens`。流式与一次性调用共用 SSE 分帧和错误处理，一次性调用取终止事件中的结果。普通 OpenAI API Key 与 xAI Responses 使用各自的请求格式。

## 与现有登录的边界

- 智谱应用登录仍走 `bigmodel` / `zai` 和 `zcode://oauth/callback`。订阅授权不复用这条会话。
- 同名 API Key 模板（Anthropic、OpenAI、xAI）继续只接受 Key。两种供应商不要合成一条凭证。
- 已移除的 codex / claude / gemini 官方 OAuth 设置入口和 model provider service RPC 保持关闭。
- 远程 Host 上，浏览器回调打不到监听端口；粘贴授权码和 Grok 设备码轮询仍然可用。
