# 灵创 · LING

[English](README.en.md)

LING 是一款任务优先的桌面 Agent 产品。本仓库保留经过固定版本约束的 DeepSeek Harness Runtime 与 Electron Host，同时逐步建设由 LING 自己掌控的 Renderer、任务体验和桌面工作流。

当前项目处于产品重构阶段；这里不是历史 DSH Desktop 安装包、赞助或社区入口。

## 产品边界

- `deepseek-harness/` 是固定的上游子模块，只作为 Runtime 使用，桌面功能不直接修改其中的源码。
- `dsh-plugin-desktop/` 与 `dsh-plugin-desktop-beta/` 分别承载稳定与 Beta 的 Electron Host、Profile、原生窗口和发布链。
- `dsh-desktop-next/` 是独立的实验性桌面壳，也是演进 LING Renderer 的隔离试验场。
- `dsh-community-market/` 仍在当前构建与打包依赖图中；在产品明确替换它之前保留。

LING 的目标是以 Workspace、Task 和 Thread 为中心，而不是把传统文件编辑器作为产品中心。Runtime 负责 Agent、会话、工具和审批；Renderer 负责 LING 的界面、状态适配和桌面体验。

## 开发

```sh
git submodule update --init --recursive
corepack yarn install --immutable
corepack yarn dev
```

常用的无图形验证命令：

```sh
corepack yarn typecheck
corepack yarn test
corepack yarn check
```

## 文档

- [架构说明](docs/architecture.md)
- [插件开发](docs/plugin-development.md)
- [Desktop service contract](dsh-plugin-desktop/docs/plugin-services.md)
- [贡献说明](CONTRIBUTING.md)
