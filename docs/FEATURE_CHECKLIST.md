# LING Renderer feature checklist

Living checklist for the LING-owned Renderer in `src/`. Every capability records its UI
entry, its data source, and five separate status columns, so that "UI exists" can never stand in
for "the real service does it". Update it as work lands.

2026-09-26 的 Qoder 界面比较结果见 [UI_RESTORATION_AUDIT.md](./UI_RESTORATION_AUDIT.md)。
该报告区分已实屏检查、仅源码检查和待复验项；本清单的历史功能证据不代表当前视觉还原通过。

2026-09-28 独立 LING 宿主的工作流复验见 [REGRESSION_2026-09-28.md](./REGRESSION_2026-09-28.md)，包含真实操作、模拟故障、两处重试修复和未验收边界。

## 状态图例

| 列 | 含义 |
| --- | --- |
| UI | 界面已实现（含加载 / 空 / 错误态） |
| 服务 | 真实服务已接入：数据或动作经过 `dsh-adapter.ts` 到真实 DSH 宿主服务 |
| 操作 | 实际操作已验证：在真实连接的 LING 页面上操作，并重新读取确认结果 |
| 恢复 | 持久化 / 重启恢复已验证（适用于持久状态；纯展示行记 不适用） |
| 未完成/阻塞 | 尚未解决或无法在本 pin 完成的子项 |

单元测试与离线演示载体（`demo-adapter.ts`，`kind: offline-demo`）只证明交互形状与回归，不单独证明业务完成；
此类证据在证据列标注 `demo` / `unit`，对应的状态列不因此打钩。

证据来源：
- `live` — 2026-09-22 至 2026-09-23 的真实 DSH 宿主验收记录。彼时由 Next 承载 LING；迁移后的 LING 独立宿主已完成启动和 HTTP 页面 / 样式检查，历史操作证据尚未在新载体逐项复验。
- `demo` — 离线演示载体，仅交互形状。
- `unit` — `tests/*.spec.ts(x)`。

## 真实启动链

`corepack pnpm dev`（Electron）或 `corepack pnpm serve:web`（浏览器）→ `desktop` 独立宿主
（`loadLingProfile` + `cordis.patch.yml` 插件行）→ Web 服务打印带 token 的本机 URL（证据一律记 `token=REDACTED`）
→ 客户端装配（`desktop/src/client/index.ts` 提供 LING facade）→ `createDshRuntimeAdapter` → `LingShell`。
正常入口不加载 demo；连接失败显示真实失败态，不回落 demo。演示载体仅在 `VITE_LING_DEMO=1` 时挂载。

## 1. 应用框架

| 能力 | UI 入口 | 数据来源 | UI | 服务 | 操作 | 恢复 | 未完成/阻塞 | 证据 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 正常启动进入真实运行时 | `main.tsx` / `client.tsx` | `createDshRuntimeAdapter` | 是 | 是 | 是 | 是 | — | live：未启宿主时真实连接失败、无模拟任务（`/tmp/ling-real-bootfail.png`）；启动后接入（`/tmp/ling-real-phase1.png`、`/tmp/serve-web*.log`）；宿主重启后 ready（`/tmp/ready-after-restart.log`） |
| 侧栏导航 / 新对话 / 搜索 / 设置 | `LingShell` sidebar | — | 是 | 不适用 | 是 | 不适用 | — | live：`/tmp/p2-*.mjs`、`/tmp/scenario-sidebar.mjs`；demo 形状验证见旧清单 |
| 工作区 ⇄ 设置页切换 | `App` screen state | — | 是 | 不适用 | 是 | 不适用 | — | live：`/tmp/e-out2.txt` 由设置页操作提供商 |
| 右侧环境信息面板开关 / 窄窗行为 | `[aria-label="环境信息"]` | `snapshot`、`getTaskChanges`、`ling.inspector` | 是 | 是 | 是 | 是 | — | live：各 panel 探针（`/tmp/ling-jobs-*.json` 等）反复开关；偏好持久化 demo 验证 2026-09-22（`ling.inspector` 随重载保持） |
| 布局 / UI 状态持久化 | rail、主题、选中任务、草稿、面板偏好 | localStorage | 是 | 不适用 | 是 | 是 | 附件草稿不持久化（blob URL 失效属预期） | demo + live：`ling.selectedTask` / `ling.drafts` 重载恢复（`tests/session-state.spec.ts`，5 用例） |
| 窄窗无横向溢出 | `App` matchMedia | — | 是 | 不适用 | 是 | 不适用 | — | demo 2026-09-22（820 / 640） |

## 2. 项目与工作区

| 能力 | UI 入口 | 数据来源 | UI | 服务 | 操作 | 恢复 | 未完成/阻塞 | 证据 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 工作区列表 + 任务分组 | `WorkspaceSection` | `snapshot.workspaces` | 是 | 是 | 是 | 是 | — | live：真实工作区 `demo`、`ling-desktop`（`/tmp/p2-shell-dump.mjs`） |
| 按路径添加工作区 | 添加工作区 → 对话框 | `workspace.create` | 是 | 是 | 是 | 是 | — | live：`/tmp/p2-workspace-add.mjs` 添加真实目录并重读 |
| 原生目录选择器 | 对话框内选择目录 | 宿主 `directory-picker`（Electron） | 是 | 是 | 是 | 不适用 | “+” 快捷入口的点击与遮挡修复待用户验收 | live：`/tmp/scenario-picker.mjs` 打开系统目录选择器并回填路径；单元 迁移前参考测试（见 Git 历史） |
| 重命名 / 移除工作区 | 工作区菜单 | `workspace.rename` / `workspace.delete` | 是 | 是 | 是 | 是 | — | live：`/tmp/scenario-menu-diag*.mjs`；移除确认列出磁盘文件（demo 复核） |
| 选择 / 切换工作区（经任务行） | 任务行 | `snapshot` | 是 | 是 | 是 | 是 | — | live：各探针切换任务即切换工作区 |
| 搜索结果工作区归属 | `TaskSearch` | `LingTaskSearchMatch.workspaceId` | 是 | 是 | 是 | 不适用 | — | live：`/tmp/p2-search-nav.mjs` |
| 路径 / 权限错误处理 | 提示 + 对话框错误 | `LingCommandResult` | 是 | 是 | 是 | 不适用 | — | live + unit：拒绝即报错，无伪造成功 |

## 3. 任务管理

| 能力 | UI 入口 | 数据来源 | UI | 服务 | 操作 | 恢复 | 未完成/阻塞 | 证据 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 新建 / 选择 / 搜索 | 侧栏、`TaskSearch` | `tasks`、`searchTasks` | 是 | 是 | 是 | 是 | — | live：`/tmp/p2-e2e-task.mjs`、`/tmp/p2-search-nav.mjs`；真实任务 ID |
| 重命名 | 任务菜单 | `task.rename` | 是 | 是 | 是 | 是 | — | live：`/tmp/scenario-menu-diag*.mjs`（对话框预填、焦点、Enter 确认） |
| Fork（整任务） | 任务菜单 | `task.fork` | 是 | 是 | 是 | 是 | — | live：`/tmp/scenario-fork*.mjs`、`/tmp/scenario-fork-read.mjs`（分叉任务内容可读） |
| Fork（消息定点） | 时间线「从这条消息分叉」 | `LingTimelineItem.seq` → `task.fork.atSeq` | 是 | 是 | 是 | 是 | 截断粒度为轮次边界：轮内锚点保留锚点所在整轮（上游 `session/fork` 语义，非缺口） | live 2026-09-23：两轮任务真实点击锚定第 1 轮助手消息（seq 18）→ 分叉仅存第 1 轮（`fork1HasG2:false`），锚定第 2 轮（seq 27）→ 全量两轮；`POST /api/session/fork` 请求体实测带 `atSeq:18` / `atSeq:27`（`/tmp/fork-trunc-out.json`、截图 `/tmp/fork-trunc-fork1.png`）；unit：seq 投影 + `atSeq` 传递（`tests/dsh-runtime-adapter.spec.ts`、迁移前参考测试（见 Git 历史）） |
| 归档 / 恢复 | 任务菜单 + 归档区 | `task.archive` / `task.unarchive` | 是 | 是 | 是 | 是 | — | live：`/tmp/p2-task-crud*.mjs` 归档、恢复、重读 |
| 加载更早历史 | `.conversation-stream__older` | `task.load-older` | 是 | 是 | 是 | 不适用 | — | live 2026-09-23（真实长历史任务）：按钮出现 → 点击前插更早消息 → 加载完消失（见证据 11）；unit（`tests/dsh-runtime-adapter.spec.ts`） |
| 状态显示（含已停止≠已完成） | 任务行状态 | `tasks[].status` | 是 | 是 | 是 | 是 | — | live：`/tmp/p2-status-fix.mjs`、`/tmp/scenario-abort-status.mjs`：停止后 已取消/已停止，不再显示完成 |
| 每任务草稿恢复 | composer | `ling.drafts` | 是 | 不适用 | 是 | 是 | — | demo + unit（`tests/session-state.spec.ts`） |
| 消息时间戳 | `.timeline-item__time` | `timeline[].createdAt` | 是 | 是 | 是 | 不适用 | — | demo 形状 + live 时间线读数 |
| 瞬时失败后重试 | `ComposerNotice` 重试 | `LingCommandResult.retryable` | 是 | 是 | 是 | 不适用 | 真实离线发送失败显示「无法发送消息。」+ 重试按钮；离线中点击重试真实再次发送并保持可重试；恢复连接后消息恰好落地一次，落地后按钮自动消失防重复 | live：`/tmp/stale-retry-out.json`（retryNotice.retry=true、retryClickOffline 命中按钮、landed.mine=1）、截图 `/tmp/retry-notice-offline.png`；unit（4 用例，含瞬时映射与 submission.abandon） |

## 4. 输入与发送

| 能力 | UI 入口 | 数据来源 | UI | 服务 | 操作 | 恢复 | 未完成/阻塞 | 证据 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 多行 / 自动增高 / Enter 发送 | `.composer__textarea` | — | 是 | 不适用 | 是 | 不适用 | — | demo 2026-09-22 + live 各探针均以 Enter 发送真实消息 |
| IME 安全 | composer keydown 守卫 | `composingRef` | 是 | 不适用 | 是 | 不适用 | 真实 IME 候选窗无法经 CDP 驱动，端到端组合输入未浏览器验证 | demo（事件级 `isComposing`）+ unit |
| 附件选取 / 粘贴 / 预览 / 移除 / 真实提交 | `.composer__attachment` | `attachments` | 是 | 是 | 是 | 不适用 | — | live：`/tmp/scenario-attach*.mjs`、`/tmp/attach3.json`、`/tmp/ling-attach-test.txt` |
| 历史附件重新读取 | 时间线附件 | 时间线附件投影 | 是 | 是 | 是 | 是 | — | live：`/tmp/ling-check-attach*.txt`、`/tmp/attach-restart-out.txt`（重启后仍可读，不只本地预览） |
| 斜杠命令目录 + 执行 | `.composer__slash` | `getTaskCommands` → `task.run-command` | 是 | 是 | 是 | 不适用 | — | live：`/tmp/slash-catalog.log`、`/tmp/slash-catalog-full.log`（真实目录）、`/tmp/slash-execute.log`（执行 `/permission` 等真实指令） |
| 模型与参数快捷选择 | composer 模型条 | `getModelSettings`、`model.select-default`、任务级选择 | 是 | 是 | 是 | 是 | — | live：`/tmp/scenario-task-model*.mjs`、`/tmp/scenario-effort*.mjs`（任务级模型 + 推理档位），`/tmp/p2-default-model.mjs`（全局默认） |
| 运行中追加指令 | 追加按钮 | `task.send-message` `mode: steer` | 是 | 是 | 是 | 不适用 | — | live：`/tmp/scenario-stop-steer.mjs` 运行中追加被接受、任务续跑；2026-09-23 steer 回放显示验证：排队中徽标 → 回放为 "你追加指令" 条目并获真实回复（证据 12） |
| 停止 | `.composer__stop` | `task.cancel` | 是 | 是 | 是 | 是 | — | live：`/tmp/scenario-stop.mjs`（停止后时间线冻结、状态 已取消） |

## 5. 对话与执行显示

| 能力 | UI 入口 | 数据来源 | UI | 服务 | 操作 | 恢复 | 未完成/阻塞 | 证据 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 流式助手回复 | `.timeline-item` | 时间线事件 | 是 | 是 | 是 | 不适用 | — | live：真实模型请求多轮（`/tmp/ling-approval-out7.json` 等），回复来自流式事件 |
| Markdown / 代码块 / 链接 / 复制 | `Markdown` | 时间线文本 | 是 | 是 | 是 | 不适用 | — | live 时间线含真实 Markdown 回复；形状测量 demo 2026-09-22 |
| 表格 / 图片渲染 | `Markdown` | 时间线文本 | 是 | 是 | 是 | 不适用 | — | live 2026-09-23：真实任务「原样输出表格与图片」时间线渲染 GFM 表格（表头 文件/说明）与 2 张 https 图片（alt 示例），截图 `/tmp/md-table-img.png`、读数 `/private/tmp/shape-live-out.json`；`javascript:` 拒绝 live 实测：真实用户消息 `[bad](javascript:alert(1))` 渲染为纯文本、`[good](https://example.com)` 为真实链接、全页 0 个 `javascript:` 锚点（`/tmp/js-href-out.json`、`/tmp/js-href-probe.png`） |
| 思考 / 详情展开 | `.timeline-item__detail` | 时间线 detail | 是 | 是 | 是 | 不适用 | — | live 2026-09-23：真实点击「思考过程」展开并读回真实推理文本（`/tmp/thinking-open.png`、`/private/tmp/shape-live-out.json`）；demo 形状 2026-09-22 |
| 工具调用 / 结果 / 错误态 | 工具活动条目 | 时间线 kind/status | 是 | 是 | 是 | 是 | — | live：write 进行中→失败→已完成（`/tmp/ling-approval-out5.json`、`out7.json`）、bash/subagent/job_output（`/tmp/ling-jobs-*.json`） |
| 系统提示条目 | 系统条目 | adapter | 是 | 是 | 是 | 不适用 | — | live：各运行的提示条目 |
| 历史重放 | `subscribeTaskTimeline` | adapter | 是 | 是 | 是 | 是 | — | live：刷新 / 重启后时间线一致（`/tmp/ling-jobs-restart.json` 前后对照） |
| 滚动跟随 / 回到最新 | `.conversation-scroll` | 本地布局状态 | 是 | 不适用 | 是 | 不适用 | — | demo 2026-09-22（1440 / 820 / 640 / 430 矮窗） |

## 6. 用户交互（审批 / 提问 / 模式）

| 能力 | UI 入口 | 数据来源 | UI | 服务 | 操作 | 恢复 | 未完成/阻塞 | 证据 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 工具审批（允许） | `.interaction-panel` | `interaction.answer-approval` | 是 | 是 | 是 | 不适用 | — | live：只读权限下 write 被拦产生真实审批卡（`/tmp/ling-approval-out5.json`），允许一次后写入成功、文件变更 +1−0（`/tmp/ling-approval-out7.json`、`/tmp/ling-approval-live5.png`） |
| 工具审批（拒绝 / 取消 / 失效 / 重复提交） | 卡片操作 | `interaction.answer-approval` / `interaction.cancel` | 是 | 是 | 是 | 不适用 | 重复应答 live 验证：双客户端 25ms 内同时命中「提交回答」（elementFromPoint 命中证明），应答恰好生效一次、后到应答丢弃、双端卡片一致消失；「这项请求已经结束。」提示对应本地快照已无该请求的 `interaction-stale`，真实页窗口小于 20ms 无法稳定构造，映射 unit 覆盖 | live：真实拒绝链（证据 10）；问题取消（证据 12）；多端重复应答竞态（证据 13，`/tmp/stale-retry-out.json` raceTaps） |
| 问题回答（单选 / 多选 / 自由输入） | 问题卡 | `interaction.answer-question` | 是 | 是 | 是 | 不适用 | — | live：真实问题卡（确认意图，含选项与自由输入），回答后等待解除、任务续跑（`/tmp/ling-approval-out3.json`） |
| 计划审阅 | plan 卡 | `interaction.answer-question` | 是 | 是 | 是 | 不适用 | — | live 2026-09-23：计划模式触发真实计划审阅卡（跳过 / 提交回答），提交回答后 `exit_plan_mode` 返回真实语义 `The user chose to keep planning`（证据 12） |
| 计划 / 目标模式切换 | 模式控制 | 模式投影 + 指令 | 是 | 是 | 是 | 是 | — | live：`/tmp/scenario-plan-goal.mjs`、`/tmp/scenario-goal-diag.mjs`、`/tmp/scenario-goal-actions.mjs`（切换并重读会话状态） |
| 权限预设切换 | 环境信息 / `/permission` | 权限投影 | 是 | 是 | 是 | 是 | 已启动会话的权限语义按运行时执行 | live：`/permission` 切 read-only 后真实写入被拦并升级审批（out5/out7）；`/tmp/scenario-permission.mjs`、`/tmp/ling-recheck*.mjs` |

## 7. 文件、终端与结果

| 能力 | UI 入口 | 数据来源 | UI | 服务 | 操作 | 恢复 | 未完成/阻塞 | 证据 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 变更列表 + 每轮分组 + 增删统计 | 环境信息 文件变更 | `getTaskChanges` | 是 | 是 | 是 | 是 | — | live：`/tmp/scenario-changes*.mjs`、`/tmp/scenario-live-changes.mjs`，UI 统计与磁盘一致；审批链变更 `ling-approval-verify/approved2.md +1−0 第 2 轮`（out7）；2026-09-23 每轮分组实测：同一任务第 3 / 第 4 轮分组与磁盘逐条一致（`created-badge.md +1−0` 第 3 轮，`created-badge2.md +1−0`、`old-badge.md +0−1` 第 4 轮，`/private/tmp/badge-live-out.json`、`/private/tmp/badge-live2-out.json`，刷新后保持） |
| 文件 diff + 返回 | 变更行 → diff | `getTaskFileDiff` | 是 | 是 | 是 | 不适用 | — | live：按轮次与序号取真实 diff |
| 新建 / 删除 / 简化徽标、二进制 / 过大分支 | diff 头 | `LingFileDiff` | 是 | 是 | 是 | 不适用 | 删除等外部变更的跟踪依赖 git 轮次快照（边界 11） | live 2026-09-23：真实 write 新建 `created-badge.md` → 徽标 `本轮新增`、diff `+hello`（`/tmp/badge-file-0.png`）；真实 bash `rm` 删除 `old-badge.md` → 徽标 `本轮删除`、diff `-to be deleted`（`/private/tmp/badge-live2-out.json`、`/tmp/badge-delete-live.png`）；分支实测（真实任务，`/tmp/diff-branches2-out.json`、`/tmp/diff-binary-out.json`）：bash 写全零文件 → 行徽标 `二进制` + diff `这是二进制文件，无法显示文本差异。`；3MB 文件（捕获路径 + 轮次快照路径各一）→ 行徽标 `文件过大` + diff `文件过大，无法显示文本差异。`；8000 行整轮全量改写 → 徽标 `简化比较` + `@@ -1,8000 +1,8000 @@`（截图 `/tmp/diff-binary-detail.png`） |
| 工作区文件浏览 + 真实预览 | 环境信息 工作区文件 | `LingWorkspaceFile` 投影 | 是 | 是 | 是 | 不适用 | — | live：`/tmp/fb-out4.txt`——浏览真实目录、磁盘新写 `added-live.txt`（36 B）无需刷新即出现、打开预览逐行读回、600 行截断提示、上一级返回 |
| 终端列表 + 新建终端 | 环境信息 终端 | 终端投影 | 是 | 是 | 是 | 是 | 输出只读展示，无交互式终端输入 | live：`/tmp/ling-terminal-live.mjs`——新建终端后 `.terminal-list__item` 增加、刷新后保留（`terminalCreated` / `terminalSurvivedReload`） |
| 后台作业（只读） | 环境信息 后台作业 | `sessions.list` `jobsBySession` | 是 | 是 | 是 | 否 | 作业注册表是进程内存，宿主重启后作业行消失（属底层语义） | live：`/tmp/ling-jobs-*.json`（真实 `bash run_in_background` 输出 `exit code: 0`）、`/tmp/ling-jobs-restart.json`（重启对照） |
| 子任务 subagent（追问 / 中断） | 环境信息 子任务 | `subagentsByParent` + `remote.subagents.prompt` / `interruptByParent` | 是 | 是 | 是 | 是 | 仅可持续（continuable）子任务可追问；指令排队送达（delivery: queue） | live：真实子任务 `Run sleep 120 then report`（可持续）运行中 → 追加指令对话框发送排队 → 中断后子任务停止（按钮消失）（2026-09-22 真实会话）；历史只读证据 `/tmp/ling-jobs-restart.json` |
| 定时提醒（只读列表） | 环境信息 定时提醒 | schedule 投影 | 是 | 是 | 是 | 是 | 创建 / 删除经模型工具 `schedule_create` / `schedule_delete`，无客户端 CRUD 面 | live：`/tmp/ling-terminal-live.mjs`（创建后列表出现 LING-SCHEDULE-OK）、`/tmp/ling-schedule-live2.mjs`（创建出现→删除消失→刷新后为空，均无需刷新即更新） |
| 浏览器 / 文档侧板 | — | 无 | 否 | 否 | 否 | 不适用 | 未完成：本 pin 无对应客户端面，属产品决策项 | — |

## 8. 模型与提供商

| 能力 | UI 入口 | 数据来源 | UI | 服务 | 操作 | 恢复 | 未完成/阻塞 | 证据 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 提供商目录 + 凭据状态 | `ModelSettings` | `getModelSettings` | 是 | 是 | 是 | 是 | 凭据保存 / 提供商已加载 / 调用成功分开呈现 | live：`/tmp/p2-models.mjs` 读取真实目录（DeepSeek 就绪、key 只显示状态） |
| Codex 登录账户模型目录更新 | 提供商「刷新模型」 / 自动更新 | 账户 `/codex/models` → `lingModelCatalog` → `session.modelCatalog` | 是 | 是 | 是 | 是 | Pi 当前支持 low 至 max；不提供尚不支持的 ultra。此次实屏核对因 Mac 锁屏未完成，未发起模型推理请求 | live 2026-10-06：真实开发版重启后，两条目录 RPC 均成功，GPT-6.1-Sol、GPT-6-Astra、GPT-6-Sol、GPT-6-Luna 已进入可路由目录，无提供商失败，缓存已应用；原默认 GPT-5.6-Sol 保留。`desktop/tests/codex-catalog-auth.spec.ts` 和 `model-catalog.spec.ts` 覆盖令牌刷新、账户切换与离线保留；完整 Host check 550 项通过、1 项可选测试跳过 |
| API Key 写入真实凭据服务 | 密码框 + 保存 | `provider.store-api-key` | 是 | 是 | 是 | 是 | key 明文永不回显 | live：`/tmp/p2-models.mjs`（保存后状态翻转）；用户自行配置真实 DeepSeek key 后真实模型调用成功 |
| 默认模型保存（全局） | 默认卡 | `model.select-default` | 是 | 是 | 是 | 是 | — | live：`/tmp/p2-default-model.mjs`、`/tmp/p2-read-default.mjs`（刷新后仍为所选） |
| 任务级模型 / 推理档位 | composer 模型条 | `LingModelSelection`、`LingModelEffortOption` | 是 | 是 | 是 | 是 | 与全局默认分开呈现 | live：`/tmp/scenario-task-model*.mjs`、`/tmp/scenario-effort*.mjs` |
| 自定义提供商创建 | 添加自定义提供商 | `provider.create-custom` | 是 | 是 | 是 | 是 | id 冲突如实报错 | live：`/tmp/p2-custom-provider.mjs`；冲突横幅 demo + unit（缺陷 25/26） |
| 提供商编辑 / 测试连接 / 删除 | 提供商卡操作 | provider 更新 / 测试 / 删除命令 | 是 | 是 | 是 | 是 | — | live：`/tmp/provider-e.mjs`、`/tmp/e-out2.txt`——测试连接 `连接成功：已发现 2 个模型。`；编辑改名 + 追加模型保存后重读一致、刷新保持；删除有确认文案 |
| 保存配置后实际请求使用所选模型 | 对话 | 会话模型路由 | 是 | 是 | 是 | 不适用 | — | live：任务级模型切换后真实请求走所选模型（scenario-task-model 系列读回会话状态） |
| 默认模型不在目录中的警告 | 默认卡 | `defaultSelection` 对比目录 | 是 | 是 | 是 | 是 | — | live 2026-09-23：隔离配置下真实创建自定义提供商并把默认模型设为 `probe-warn-model` → 删除提供商 → 默认卡出现「当前默认模型不在已发现的模型目录中。」，整页刷新后保持（`/tmp/default-warn-out.json`、截图 `/tmp/default-warn-live.png`） |

## 9. 扩展能力与 agent 配置

| 能力 | UI 入口 | 数据来源 | UI | 服务 | 操作 | 恢复 | 未完成/阻塞 | 证据 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 插件 / MCP / 技能 清单 | 设置 → 扩展能力 | 扩展投影 | 是 | 是 | 是 | 是 | 只读清点，无启停开关（本 pin 无客户端启停面） | live：`/tmp/ling-extensions.mjs`、`/tmp/ling-extensions-out.json`（真实清单，6 个技能）、`/tmp/ling-extensions.png` |
| agent 预设切换 | 扩展能力 预设卡 | 预设投影 | 是 | 是 | 是 | 是 | 已启动会话的预设固定，切换作用于排队 / 新会话（运行时语义） | live：`/tmp/ling-preset-out.json`（已启动会话返回 `session … has already started; its agent preset is fixed` 并如实显示）、`/tmp/ling-preset2-out.json`（排队任务切到 ptc，`当前` 标签移动，刷新后保留） |
| 权限预设目录 | 扩展能力 / `/permission` | 权限预设投影 | 是 | 是 | 是 | 是 | — | live：read-only / workspace-write / danger 目录真实、切换生效（审批链 out5/out7 佐证） |
| UI 插槽与插件注册表 | `registry.ts` / `plugin-host.ts` / `slots.ts` | 进程内 | 是 | 不适用 | 是 | 不适用 | — | unit（7 用例）+ demo 浏览器 6 插槽安装 / 卸载（2026-09-22） |

## 10. 其他产品能力

| 能力 | UI 入口 | 数据来源 | UI | 服务 | 操作 | 恢复 | 未完成/阻塞 | 证据 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 主题 浅色 / 深色 / 跟随系统 | 设置 → 通用 | localStorage | 是 | 不适用 | 是 | 是 | — | demo 2026-09-22（全页对比度扫零失败） |
| 快捷键参考 | 设置 → 通用 | 静态列表 = 实际处理器 | 是 | 不适用 | 是 | 不适用 | — | demo 2026-09-22（可信 CDP 按键） |
| 版本 / 关于 | 设置 → 通用 | 构建版本 | 是 | 不适用 | 是 | 不适用 | — | demo 2026-09-22 |
| 语言偏好 跟随浏览器 / 中文 / English | 设置 → 通用 | settings 命名空间 `locale`（locale 投影） | 是 | 是 | 是 | 是 | 切换偏好不改变 LING 文案语言（文案多语言化是独立产品工作） | live：读回中文 → 切 English → 整页重载后仍 English → 恢复中文（2026-09-22 真实会话，settings 文档持久化） |
| 工作流 | 工具活动条目 + 工作流运行卡（阶段成员明细） | `workflow` 工具事件、`workflow-run` 节点投影 | 是 | 是 | 是 | 是 | 专用可交互流程树（成员跳转子会话等）属产品决策（边界 7） | live 2026-09-23 真实回放两张运行卡：`工作流 echo-two-step-parallel`（seq 20，2 个执行项，展开 执行详情 见 `阶段 echo-steps / echo step-1 · 已完成 / echo step-2 · 已完成`，真实点击命中 `执行详情`）与 `工作流 return-42`（0 个执行项）；卡按 run-start 序位居通用 workflow 条目（seq 28）之前；刷新后逐条一致（`/private/tmp/wf-run-out.json`、`/private/tmp/wf-detail2-out.json`、`/tmp/wf-detail-open.png`、`/tmp/wf-live-reload.png`）；2026-09-22 真实执行两步并行工作流 `workflow "echo-two-step-parallel" completed (2 agents)`（输出 step-1/step-2）与 `return-42`（`/private/tmp/ling-workflow-reject-out.json`） |
| 设置生命周期（读 → 存 → 重读 → 重启保持） | 设置各页 | 各服务 | 是 | 是 | 是 | 是 | — | live：提供商编辑 / 默认模型 / 预设切换均经刷新与宿主重启保持（provider-e `afterReload`、p2-read-default、ling-preset2 `afterReload`、ready-after-restart） |

## 历史验收证据

迁移前参考应用的运行记录保存在 Git 历史中，不作为当前 LING 的完成依据。
当前验证以根目录和 `desktop/` 的检查、测试及打包结果为准。

## 底层能力边界（代码依据与所需决策）

1. 后台作业不跨进程：作业注册表在进程内存（`deepseek-harness/packages/jobs/jobs-local/src/index.ts:1-5`），宿主重启后作业行消失。影响：后台作业列只能如实标 重启不恢复。所需决策：如需持久作业历史，需上游提供持久化作业存储。
2. 持续型子代理不产生作业行：`backgroundMode: continuable`（`packages/preset/agent-presets/presets/standard/agent.cordis.yml:181-199`、`packages/subagent/tool-subagent/src/index.ts:515-560`）不创建 `SessionJob`，标准预设下不会有子代理形态的作业行。
3. 子代理追问 / 中断（已接入）：宿主注入 `remote.subagents.*`（subagent 投影），LING 子任务行提供 追加指令 / 中断，live 验证见上表。剩余限制：仅可持续（continuable）子任务可追问，指令按 `delivery: queue` 排队送达。
4. 作业无客户端停止 / 终止调用：作业列表只能只读展示（上游参考 UI 同样只读：`deepseek-harness/packages/client/ui-jobs/src/client/index.ts:1-5`）。
5. agent 预设在会话启动后固定：真实运行时拒绝 `session … has already started; its agent preset is fixed`，LING 如实显示该状态；切换作用于排队 / 新会话（`/tmp/ling-preset-out.json`、`ling-preset2-out.json`）。属运行时语义，非缺口。
6. 定时提醒无客户端 CRUD 面：创建 / 删除经模型工具 `schedule_create` / `schedule_delete`，LING 提供只读列表。所需决策：如需独立 CRUD，需上游暴露 schedule 客户端命令。
7. 工作流（已接入运行卡呈现）：发布版标准预设自带组装——`vendor/dsh-runtime/0.1.6-alpha.2/deepseek-ai-dsh-agent-presets-*.tgz` 内 `presets/standard/agent.cordis.yml` 的 `delegation` 组含启用行 `workflow-ptc`（`config.provider: spawn`）与 `tool-workflow`；引擎 `workflowEngine` 由 `@deepseek-ai/dsh-workflow` 的 Service 注册，`PtcWorkflowEngine`（`packages/workflow/workflow-ptc/src/index.ts:102-106`）注入 `subagents/ptcRuntime/sandboxPolicy`，三者宿主均已具备，`workflow` 模型工具无需宿主补装即真实可用。2026-09-23 起 LING 额外投影上游 `ui-workflow-run` 注册的 `workflow-run` 会话节点（`WorkflowRunChatData`：名称 / 状态 / 阶段成员，`dsh-client-ui-workflow-run/lib/types/client/workflow-definition.d.ts:22-26`；由 web bundle 的 `cordis.patch.yml` 注册），在时间线以工作流运行卡呈现（阶段成员明细入「执行详情」），与通用 workflow 工具条目并列（live 证据 15）。所需决策：如需上游 `ui-workflow-run` 式可交互流程树（成员跳转子会话等），需另行定义 LING 侧呈现。
8. i18n / 语言偏好（已接入）：`@deepseek-ai/dsh-client-locale` 提供持久化设置面——settings 命名空间 `locale`、字段 `preference`、内建 `['zh','en']` 与校验 pattern（`packages/client/locale/src/locale-settings.ts:5-33`），经 settings controller remote 读写，LING 侧已接入并 live 验证持久化。剩余边界：LING 自身文案的多语言化是独立产品工作。
9. Fork 定点截断（已接入并修复）：上游 `session/fork` 支持 `atSeq`——边界 = 首个 `seq >= atSeq` 的 `turn/end` 事件，种子 = `events.slice(0, boundary.seq + 1)`（`deepseek-harness/packages/api/session-controller/src/commands.ts:227-238`，发布包同源 `dsh-api-session-controller/lib/types/commands.js:212-221`）。LING 侧全链路已通并 live 验证：真实点击锚点 seq 18 / 27 → 请求体 `atSeq:18` / `atSeq:27` → 分别得到第 1 轮截断与全量两轮（证据 14）。剩余语义：截断粒度为轮次边界，轮内锚点保留锚点所在整轮；属上游语义，非缺口。
10. 真实 IME 候选窗无法经 CDP 驱动，组合输入端到端仅事件级验证。
11. 文件变更跟踪对非 git 工作区的边界：`@deepseek-ai/dsh-workspace-changes` 的 `TurnRecorder` 在工作区不在 git 仓库（或宿主无 git）时不做轮次树快照，摘要只列 `write` / `edit` 文件工具触达的路径（类注释与 `mutationPath`，`lib/index.js:604-626、533-534`）；bash 等外部写入 / 删除只在工作区位于 git 仓库、轮次树对比生效时计入。实测：隔离工作区 git init 前 bash `rm` 删除不出现在变更列表，init 后同一操作显示 `+0−1` 与徽标 `本轮删除`（2026-09-23，证据 16）。影响：非 git 工作区的删除 / bash 写入不进入文件变更。所需决策：如需非 git 工作区也跟踪外部变更，需上游扩展捕获面。

## 未完成 / 待用户确认

1. “+” 目录快捷入口的点击与遮挡修复已实现（原生选择器主路径已实测，`/tmp/scenario-picker.mjs`），待用户在桌面客户端实际验收。
2. 工作流专用交互流程树：运行卡（名称 / 状态 / 阶段成员明细）已投影并真实验证（2026-09-23，证据 15）；如需上游 `ui-workflow-run` 式可交互流程树（成员跳转子会话等），需产品决策（边界 7）。
3. LING 文案多语言化：语言偏好已接入真实设置服务并验证持久化；界面文案的 i18n 是独立产品工作（边界 8）。

## 已修复缺陷（历史索引，详见证据列与 git 历史）

1 状态显示被陈旧 preview 掩盖（已停止显示为完成）· 2 伪斜杠目录与伪成功 · 3 设置页泄露内部措辞 · 4 滚动跟随死代码 · 5 断连重试入口缺失 · 6 发送按钮永不禁用 · 7 模态期间全局快捷键 · 8 对话框 Enter 无法提交 · 9/10 菜单键盘导航与焦点回归 · 11 未消费契约字段（时间戳 / 搜索归属 / 图片）· 12 ⌘N 在搜索面板内失效 · 13 菜单指针选择落在视口外 · 14 GFM 表格渲染为散文本 · 15 瞬时失败被当永久失败（无重试）· 16 `configurable` / `description` 字段未消费 · 17 diff 丢失新建 / 删除 / 简化徽标（含 demo 载体 seq 解析错误）· 18-22 深浅色对比度与可读性（多轮）· 23 会话状态重载丢失 · 24 菜单用被夹高度复测 · 25 提供商冲突错误无提示 · 26 错误横幅遮挡字段 · 27 截断数据无 tooltip 全文 · 28 高交互卡把输入框顶出视口（composer 区改为仅交互卡内部滚动）· 29 消息定点分叉包装未透传 `atSeq`（截断恒失效）。

## 验证命令

```
corepack pnpm check:renderer        # typecheck + build + 边界 + HeroUI + 单元测试
corepack pnpm test:renderer         # 单元测试
corepack pnpm --filter ling-desktop-host check   # LING 宿主装配变更时运行
corepack pnpm dev                            # Electron 启动真实 LING 应用
corepack pnpm serve:web                          # 浏览器启动真实 LING 应用（打印带 token 的本地 URL）
```
