LING Desktop 本地桌面应用预发布版。

## 更新内容

- Windows 使用独立顶部窗口工具栏，避免原生窗口按钮遮挡右侧面板，并统一侧栏折叠后的内容边距，保留原有圆角设计。
- 修复 Windows 与 macOS 关闭服务器凭据窗口时出现的 `Object has been destroyed` 崩溃。
- 修复切换会话时异步返回的目标模式串入其他会话。
- 服务器连接检查避免并发探测，并定期刷新连接状态，减少过期的断线提醒。
- 清理未使用的历史图标资源，保留当前图标及选定设计原稿。

## 下载与验证

- macOS：Apple Silicon（arm64）和 Intel（x64）DMG。
- Windows：x64 NSIS 安装程序。
- Linux：x64 AppImage 和 Debian 安装包。

安装包由对应原生平台完成构建、测试和运行验证后发布，附验证报告及 `SHA256SUMS`。

Windows 安装包未签名；macOS 使用 ad-hoc 签名，尚未进行 Apple 公证。尚未启用应用内自动更新；已有用户配置保留。
