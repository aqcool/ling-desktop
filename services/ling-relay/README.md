# ling-relay

LING Desktop / LING Mobile v2 的无状态加密中继服务（纯 Go 标准库，零外部依赖）。

- 只维护内存中的 `desktopPubKey -> desktopWS` 与 `cid -> mobileWS` 路由表，不落盘、不解密、不持有任何业务状态或密钥。
- 本地运行：`go run . -addr :8787`
- 测试：`go test -v ./...`
- 桌面端配置：`LING_MOBILE_RELAY_URL=wss://relay.example.com/v1/tunnel`（本地调试可用 `ws://127.0.0.1:8787/v1/tunnel`）
