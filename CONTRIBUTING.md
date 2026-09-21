# 为 LING 贡献

LING 正在从既有 Desktop Runtime 逐步演进为自有 Renderer 的产品。提交前请先确认改动属于当前阶段的产品边界。

## 开发环境

```sh
git submodule update --init --recursive
corepack yarn install --immutable
corepack yarn check
```

## 仓库边界

- 不修改 `deepseek-harness/`；上游更新独立提交。
- Desktop Host 改动先在 `dsh-plugin-desktop-beta/` 验证，再同步至稳定包，并运行 `corepack yarn check:desktop-variants`。
- `dsh-desktop-next/` 是自研 Renderer 的实验区；不要在其未稳定前删除现有官方前端路径。
- `dsh-community-market/` 仍属于当前构建与打包图，移除或替换它需要单独的产品决策与完整验证。

## 提交前

- 使用清晰的 Conventional Commit 信息，例如 `feat(renderer): ...` 或 `docs: ...`。
- 运行与改动相称的验证；影响 Host 或共享 Desktop 代码时，至少运行类型检查、相关测试和变体检查。
- 文档中英文同步更新，并更新对应的 `.i18n.yaml` 记录。
