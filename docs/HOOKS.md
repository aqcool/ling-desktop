# LING Hooks

设置 → 钩子管理 LING 当前 Host 进程的 command Hooks。配置作用于该进程内的全部任务，默认停用。LING 不自动发现项目配置，也不修改导入的源文件。

页面可以添加、编辑、移除和逐项启用命令，读取用户指定绝对路径的 `hooks.json` 或含 `hooks` 的 `settings.json`，再通过「保存并应用」写入当前 profile 下的 `ling-hooks.json`。导入只替换页面草稿；保存前可还原。只接受同步 command 类型、1–600 秒超时和有效匹配表达式，拒绝未知事件和不支持的处理器，避免展示已保存但无法执行的规则。`${CLAUDE_PLUGIN_ROOT}` 需要改为明确的脚本绝对路径。

执行由官方 `@deepseek-ai/dsh-hooks-claude-code` 和 `@deepseek-ai/dsh-hooks-codex` 完成。每次应用会生成 profile 内的 `ling-hooks.runtime.json`，卸载旧桥接并从该文件加载新桥接。命令接收官方事件 JSON 标准输入，并在任务的会话工作目录中按当前用户权限执行。Claude Code 格式支持 SessionStart、UserPromptSubmit、PreToolUse、PostToolUse、Stop、SubagentStart、SubagentStop；Codex 格式支持前五项。UserPromptSubmit 和 Stop 没有匹配对象，忽略匹配字段。

应用要求所有任务和子任务处于空闲且没有排队输入。LING 用公开的 Agent maintenance 边界保留现有任务和排队输入，应用过程中创建的 Agent 等待桥接切换完成。任务正在执行或占用其他 maintenance 操作时拒绝修改，原配置继续生效。旧版本草稿也会被拒绝，防止覆盖另一窗口的修改。校验、写入或加载失败显示错误；加载开始后失败时尝试恢复原配置。

最近执行列表显示当前 Host 最近 50 次回合内 `hook/result` 事件，包括事件、决定、耗时、退出码和有界标准错误。完整 `hook/invoked` / `hook/result` 配对记录保存在对应任务日志。SessionStart 和子任务生命周期在官方引擎中是分离执行，不生成回合外的 hook 事件。停用 Hooks 会卸载监听器，不关闭 Agent 或 SSH 连接。

`desktop/tests/hooks.spec.ts` 在临时 profile 和工作目录中装载真实 DSH AgentLoop、Tools、Shell 和两个官方桥接，只模拟模型流。验证命令标准输入、上下文注入、工具阻止、日志读取、停用后工具恢复、状态冲突、maintenance 冲突、新建任务等待、导入边界及源文件保护。
