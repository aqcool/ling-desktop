# Sidebar Footer Log Export

## 目标

侧栏底部的「更多」菜单提供「导出日志」入口。

## 行为

- 桌面端菜单中，「导出日志」位于「资源管理器」与「关于 LING」之间。
- 菜单文案复用 Windows 菜单的 `titleBar.menu.help.exportLogs`，toast 文案复用已有 `sidebar.exportLogs.pending`、`sidebar.exportLogs.error`。
- 点击后复用 `platform.exportLogs()`，由 desktop main 负责打包日志并在系统文件浏览器中显示导出结果。

## 实现位置

- 菜单入口：`packages/ui/src/WorkspaceSidebarFooter.tsx`
- 共享动作：`packages/ui/src/lib/exportLogsAction.ts`
- Windows 标题栏菜单复用同一动作：`packages/ui/src/WindowsCaptionMenuButton.tsx`
