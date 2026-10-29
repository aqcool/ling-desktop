LING Desktop 本地桌面应用预发布版。

## 更新内容

- 恢复原有安装包发布方式，不再要求配置 Apple 或 Windows 签名证书才能构建。
- macOS 继续使用 ad-hoc 签名，Windows 继续提供未签名安装包；保留四个平台的构建、测试和运行时验证。
- 保留软件更新功能代码，但本次手动安装包不启用自动更新、不发布更新清单。
- 修复产物收集和发布校验，正常发布安装包、验证报告及校验和。
- 修复 Windows 构建校验中的跨平台文件权限测试问题。

## 下载与验证

- macOS：Apple Silicon（arm64）和 Intel（x64）DMG。
- Windows：x64 NSIS 安装程序。
- Linux：x64 AppImage 和 Debian 安装包。

安装包在四个原生平台全部完成构建、测试和运行验证后发布，附验证报告及 `SHA256SUMS`。

Windows 安装包未签名；macOS 使用 ad-hoc 签名，未进行 Apple 公证。本次版本通过下载新安装包手动升级，应用内自动更新关闭。已有用户配置保留。
