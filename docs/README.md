# LING 文档

[English](README.en.md)

这里仅保留当前开发需要的架构与接口文档。历史 DSH Desktop 的下载、用户指南、赞助与社区宣传内容已从主仓库移出。

| 文档 | 用途 |
| --- | --- |
| [架构说明](architecture.md) | Runtime、Electron Host、Web carrier、Profile 与发布边界 |
| [插件开发](plugin-development.md) | 当前可用的 DSH/Cordis 与 Desktop service contract |
| [Desktop service contract](../dsh-plugin-desktop/docs/plugin-services.md) | `desktopProfiles` 与 `desktopPnpm` 的公开接口 |
| [包级参考](../dsh-plugin-desktop/README.md) | 稳定 Desktop 包的构建、运行和发布说明 |
| [实验性 Next shell](../dsh-desktop-next/README.zh.md) | LING Renderer 的实验承载点 |

`deepseek-harness/` 是固定版本的上游子模块。它自己的 README 和文档不属于 LING 文档，也不应从桌面功能分支修改。
