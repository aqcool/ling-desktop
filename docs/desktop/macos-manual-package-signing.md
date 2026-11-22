# macOS 手动安装包签名

## 规则与所有者

Electron Builder 负责在应用内容及原生依赖准备完成后签署整个 `.app`。没有 Developer ID 证书的本地构建和手动安装发行包必须使用 `mac.identity: '-'` 做 ad-hoc 签名，不能使用 `null` 跳过签名。Developer ID 发布继续使用配置的证书、hardened runtime、公证和 staple；ad-hoc 签名不表示通过 Apple 公证或保证 Gatekeeper 自动放行。

原因证据：已发布的 `ling-v3.18.6` arm64 DMG 哈希与发行清单一致，但其中 `LING.app` 仅保留 `Identifier=Electron` 的链接器签名，`Info.plist=not bound`、`Sealed Resources=none`，完整签名检查报 `code has no resources but signature indicates they must be present`。旧 `ling-v0.0.0-dev.16` 使用 ad-hoc 签名，同一检查通过。

`.github/scripts/qualify-release.mjs` 拥有 GitHub 发行资格判定。签名完整性检查与自动更新开关无关：所有 macOS 包都检查构建目录中的应用，以及最终 DMG 只读挂载后的 `LING.app`。任一检查失败不得生成通过报告或进入发布；不得删除 quarantine 属性、修改 Gatekeeper 设置或在验收阶段补签来掩盖构建错误。

## 接口与顺序

`.github/scripts/macos-release-signature.mjs` 提供 `verifyMacReleaseSignature({ appPath, imagePath, requireNotarization })`，只验证，不改动制品。挂载点由该函数创建和释放，任何签名检查失败都先卸载；卸载失败时保留挂载点，不递归删除挂载中的内容。

```text
构建代码/资源 → Electron Builder 签署整个 app → 生成 DMG
  → qualify：验证构建 app 签名 → 校验并只读挂载 DMG
  → 验证镜像内 app 签名 → 卸载
  → Developer ID 发布额外检查 app/DMG 的公证 staple 和 DMG 签名
  → 收集制品与报告 → publish
```

## 验收

- 无证书构建选择 `'-'`，不因环境里残留证书名称而切到 Developer ID；显式开启的 Developer ID 构建仍选择配置证书。
- 手动安装版和支持自动更新的版本都执行 `codesign --verify --deep --strict`，覆盖构建 app 与 DMG 内 app。
- 镜像内签名损坏时拒绝发行，并卸载、清理临时挂载点；挂载失败不继续检查，卸载失败不清理挂载中的目录。
- Developer ID 发布保留公证与 staple 检查；手动安装版不要求公证，也不生成自动更新清单。
- 工程测试验证配置分支、验证顺序和失败清理；macOS 运行验证使用真实应用签名及最终 DMG，签名后篡改资源必须被拒绝。

## 本次验证（2026-11-21）

26 项定向工程测试通过，包含实际执行发行入口、关闭自动更新且签名无效时拒绝收集制品和生成报告。`pnpm typecheck`、`pnpm lint`（544 条现有警告、0 错误）和架构检查通过。

macOS arm64 使用已下载且核对哈希的 3.18.6 发行应用：新验收入口拒绝原包；使用更新后的 Electron Builder 签名选项及其锁定的签名库重新签署副本，再生成 DMG，构建应用与最终镜像检查均通过；保持构建应用有效、仅篡改另一 DMG 内的资源时被拒绝。未重建整套应用源码或发布新版本，未验证 Intel 实机、Developer ID 公证或浏览器隔离下载后的首次启动；本机 Gatekeeper 已处于关闭状态，不能用本机放行结果证明分发信任已通过。
