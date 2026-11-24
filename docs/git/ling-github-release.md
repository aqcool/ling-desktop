# LING GitHub 发布

## 发布来源与版本

LING 的本地和远端只保留 `master`，GitHub 默认分支与发布来源均为 `master`。原 `main` 的全部提交先合入 `master`，再删除本地和远端 `main`；后续提交、推送和发布均使用 `master`，不重建 `main`。发布版本以根 `package.json` 为准，tag 使用不可变的附注标签 `ling-v<version>`；已发布标签不得覆盖，分支合并和清理不改动已发布 tag。

2026-11-23 按用户要求重置 LING 发行版本线，从 `0.1.0` 开始，首个新 tag 为 `ling-v0.1.0`。该版本包含 `master` 上已提交的 GPT 订阅入口保留修复；重置版本号不回退源码。历史 `ling-v0.0.0-dev.*` 与 `ling-v3.18.*` tag 及其 GitHub Release 在新版本完整发布后清理，操作前保留旧 tag 的 Git bundle 和发布清单。本次明确授权的历史清理不改变后续 tag 不可覆盖的规则。

版本号重置后的首版需要手动下载安装；旧 `3.18.x` 不会通过普通语义版本比较自动升级到 `0.1.0`。不为重置关闭签名、完整性或订阅入口检查。

`.github/workflows/release.yml` 的 prepare job 检出 `master` 的完整历史，剥离附注标签得到确定 commit，验证该 commit 已包含在 `origin/master`，再核对标签版本与该 commit 的 manifest。分支外的 commit、轻量标签或版本不一致均拒绝；运行不依赖任何 `main` 引用。

## 发布顺序与所有者

```text
master：版本与代码提交 → 创建附注 tag → 原子推送 master/tag
  → prepare 校验来源和版本 → 四个平台按标签 commit 构建
  → macOS 签名完整性 / Agent 运行 / 订阅入口保留 / 安装格式验收
  → 汇总四平台报告、安装包和 SHA256SUMS
  → publish 创建或续传 draft → 全部齐备后发布
```

Git tag 唯一确定源码版本，prepare 只解析该版本，build 不使用浮动分支源码。publish 拥有发行状态，所有平台构建及资格验证完成前不得发布不完整安装包。失败时重跑同一标签的失败 job，不移动标签、不跳过验证。

仅修复流水线配置、未修改待发应用源码时，可以在 `master` 通过 `workflow_dispatch` 指定同一个已存在 tag 重新构建；安装包源码仍固定为该 tag commit。GitHub Actions 的无证书分支不能传入空的 `CSC_LINK` / `CSC_KEY_PASSWORD`，而应在调用打包工具前移除这两个环境变量。electron-builder 26.17.0 将空 `CSC_LINK` 视为已配置证书，会把项目目录作为证书文件导入并报 `not a file`；启用 ad-hoc 签名后才暴露这条证书初始化路径。Developer ID 发布继续保留非空凭据校验，不得通过清理环境跳过正式签名。

没有启用 `LING_SIGNED_RELEASES=1` 时沿用手动安装预发布渠道。macOS 仍需完整 ad-hoc 签名，但不表示已经通过 Apple 公证；Windows 无证书时不宣称已签名。签名与公证方案见 [macOS 手动安装包签名](../desktop/macos-manual-package-signing.md)。

## 验收

- 本地和远端均不存在 `main`、仅有 `master` 时，prepare 仍可解析正确 commit 和版本。
- 版本线从历史较高版本重置到 `0.1.0` 时，prepare 按 tag 与 manifest 确定版本，不从旧 tag 推断版本或回退源码。
- 未合入 `master` 的标签提交、轻量标签、manifest 与 tag 版本不一致时，prepare 必须失败。
- 无证书 arm64 / x64 macOS 构建在调用打包命令时，环境中不存在 `CSC_LINK` / `CSC_KEY_PASSWORD`；Intel 的自定义 DMG 入口继续有效。
- models.dev 切换后的包内验收以实际运行的 Agent 为准。在隔离数据目录确认三个订阅模板和随包版本，注入旧 ZCode 目录后继续采用新缓存路径，随后确认同随包版本的公开模型资料在重启后仍生效。
- 发布完成后核对 Release 非 draft，四平台共五个安装包、四份运行报告与 `SHA256SUMS` 齐全，报告的源码 revision 等于 tag commit，且 `subscriptionTemplates` 为 `passed`。
