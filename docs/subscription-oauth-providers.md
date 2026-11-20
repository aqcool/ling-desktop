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

## 订阅额度

已授权的 ChatGPT 供应商在「模型设置」卡片内显示套餐档位、Codex 主额度的已用百分比和重置时间，以及可用重置卡张数。周期、档位和张数以服务端返回值为准。缺少档位或张数时隐藏对应项，明确返回零时显示零张。打开卡片、登录成功或手动刷新时读取一次。请求失败或没有额度窗口时分别显示对应状态。

```text
设置卡片 → ProviderSettings RPC → 当前 Host → Codex /wham/usage
设置卡片 ← 套餐档位、额度周期、已用百分比、重置时间、可用重置卡张数 ← 当前 Host
```

额度请求走现有 Host 网络传输和订阅凭据。凭据刷新以原凭据为条件写入，退出登录或重新授权后的凭据不会被较早的请求覆盖。额度结果随卡片卸载丢弃，桌面与 Web 使用同一读取接口。重置卡兑换由供应商页面处理。

ChatGPT 的 Pro 档位采用购买页面的名称，`prolite` 显示 `Pro 100`，`pro` 显示 `Pro 200`，`promax` 显示 `Pro 500`。额度周期和用量仍以接口返回为准。

已授权的 Grok 卡片通过同一个 Host 读取接口请求 Grok CLI 的 `/v1/settings`，显示服务端提供的 `subscription_tier_display`。打开卡片时请求一次，读取失败或未返回档位时仍可打开官方用量页面。Claude 卡片提供官方用量入口。设置中的「使用统计」继续显示本地模型调用统计。

每个供应商详情只显示一张授权卡片。刷新供应商列表时仍复用该卡片，首次查询授权状态完成后再显示授权操作。

## ChatGPT 订阅的 Fast

内置订阅目录 revision 46 将 `gpt-6.2-astra` 与 `gpt-6.2-sol` 加到已授权的 ChatGPT 订阅模型列表，已有会话和模型选择继续使用其原来的模型 ID。两个新模型使用现有 Codex Responses 通道，支持文本、图像、PDF 和 `low / medium / high / xhigh / max` 推理档位。Fast 继续以当前账号的 Codex 模型接口返回为准。验收时检查已有订阅可看到两个新模型，且标准请求分别使用对应模型 ID。 [OpenAI 模型规格](https://developers.openai.com/api/docs/models)

聊天工具栏的模型菜单右下角用齿轮打开「管理模型」。ChatGPT 和 Grok 订阅的模型使用 `GPT-6.1 Sol` 和 `Grok 4.7` 这样的名称显示，请求继续使用原始模型 ID。桌面和手机端使用同一模型菜单。

已授权账号的 Codex 模型目录声明 `priority` 时，菜单左下角显示 Fast 闪电开关。简体中文悬停提示分两行显示「1.5 倍速度」和「用量更多」。Fast 开启时，模型名左侧显示实心闪电。

账号未确认支持的模型只使用标准设置。新会话默认标准，同一会话切换推理强度保留速度，换模型回到标准。

```text
Codex 账号模型目录 → 当前 Host 的 Provider Registry → 聊天模型菜单
                                   ↓ 现有 Registry 刷新
模型菜单 → 会话或草稿 ModelSelection → Worker 冻结的 Submission → Codex Responses
```

Host 在加载授权、更换账号，或在聊天模型菜单切换到订阅供应商时读取目录。切换时目录在后台读取，模型选择无需等待。读取失败沿用已有能力，成功返回空目录则清除该供应商的 Fast 能力。退出登录丢弃账号能力，迟到的旧请求不能更新新授权。桌面和手机端共用当前 Host 的模型选项。速度随会话选择存储，已提交或排队的请求保留各自的选择。Worker 根据同一份能力目录校验 Fast。ChatGPT 订阅请求使用 `service_tier: "priority"`。

## Grok 4.7 Fast

Grok Build 的账户目录 `/models-v2` 列出 `grok-4.7-build-fast` 时，Grok 4.7 复用模型菜单左下角的 Fast 闪电。提示显示「Grok 4.7 Fast」和「用量更多」。开启后，Worker 使用现有 Grok OAuth 凭据发送到 Grok Build 的 `/responses`，请求模型和 `x-grok-model-override` 均使用 Fast 模型 ID。关闭 Fast 后走原 Grok 4.7 请求路径。会话、队列和模型菜单继续以 Grok 4.7 为模型身份。
