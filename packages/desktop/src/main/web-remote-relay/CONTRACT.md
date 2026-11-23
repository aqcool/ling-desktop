# desktop-web-remote-relay

将 Main 的 HTTP、存储和 device WebSocket 与 manager 装配隔离。

仅 index.ts/contract.ts 供外部消费。manager 仍唯一拥有 window runtime 与 attachment；transport 唯一拥有 socket/generation。storage 只保存非敏感身份，clearLegacy 合并并发且失败可重试。凭据从注入端口读取，HTTP 错误只返回分类。

完整语义见 [Relay V2 spec](../../../../../docs/web-remote-control/relay-v2-pairing.md)。

局域网模式每个已认证的 terminal socket 对应一个 Main 连接上下文。网关将该 socket 的消息交给
其上下文并定向写回；关闭时只释放对应的页面 owner 与 attachment，仍使用窗口已有的 Host。

## 通知上报 owner

MobilePushConnection 按账号和环境管理 HTTP 通知资格、执行归属和单次上报，不为通知建立 WebSocket。远控 transport 由各窗口 runtime 独立持有，与通知无关。通知和远控共用持久设备注册 owner。切号或切环境中止旧请求并清除执行归属，同账号重复登录通知不清除；事件尝试后内存去重，不重试、不补发。GET status 协商 HTTP 能力，POST events 返回处理回执，回执不代表手机送达。

LING iroh 入口由主进程持有 Endpoint 身份及已授权客户端公钥。仅在已启用的窗口接受经过 QUIC 身份验证并通过配对检查的请求。窗口停止时关闭关联 terminal，持久化的身份用于下次主动启用后的重连。
