# LING GitHub 发布

## 发布来源与版本

LING 的发布来源固定为 `main`，不跟随 GitHub 仓库默认分支。迁移期间默认分支仍可能是 `master`，不能因此拒绝已经合入 `main` 的版本，也不能从旧分支重新打包。发布版本以根 `package.json` 为准，tag 使用不可变的附注标签 `ling-v<version>`；已发布标签不得覆盖。

`.github/workflows/release.yml` 的 prepare job 检出 `main` 的完整历史，剥离附注标签得到确定 commit，验证该 commit 已包含在 `origin/main`，再核对标签版本与该 commit 的 manifest。分支外的 commit、轻量标签或版本不一致均拒绝。

## 发布顺序与所有者

```text
main：版本与代码提交 → 创建附注 tag → 原子推送 main/tag
  → prepare 校验来源和版本 → 四个平台按标签 commit 构建
  → macOS 签名完整性 / Agent 运行 / 安装格式验收
  → 汇总四平台报告、安装包和 SHA256SUMS
  → publish 创建或续传 draft → 全部齐备后发布
```

Git tag 唯一确定源码版本，prepare 只解析该版本，build 不使用浮动分支源码。publish 拥有发行状态，所有平台构建及资格验证完成前不得发布不完整安装包。失败时重跑同一标签的失败 job，不移动标签、不跳过验证。

没有启用 `LING_SIGNED_RELEASES=1` 时沿用手动安装预发布渠道。macOS 仍需完整 ad-hoc 签名，但不表示已经通过 Apple 公证；Windows 无证书时不宣称已签名。签名与公证方案见 [macOS 手动安装包签名](../desktop/macos-manual-package-signing.md)。

## 验收

- 默认分支停留在旧 `master`、标签提交只存在于 `main` 时，prepare 仍可解析正确 commit 和版本。
- 未合入 `main` 的标签提交、轻量标签、manifest 与 tag 版本不一致时，prepare 必须失败。
- 发布完成后核对 Release 非 draft，四平台共五个安装包、四份运行报告与 `SHA256SUMS` 齐全，报告的源码 revision 等于 tag commit。
